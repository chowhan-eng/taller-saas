/**
 * CashDro (automatic cash drawer) through the shop's «Puente CashDro» — port of the live TPV
 * src/lib/cashdro.js. The browser cannot talk to the CashDro directly (self-signed HTTPS, no CORS): a small
 * program on the shop's main PC keeps the machine's TPV password and relays.
 *   mode 'local'  → this PC runs the bridge:     http://127.0.0.1:8765
 *   mode 'remote' → another PC/tablet in the shop: https://<main PC IP>:8766 (needs the shop certificate)
 *   mode 'off'    → this station takes cash by hand.
 * Config lives ONLY in this browser (nothing goes to the cloud). CashDro works in cents; the TPV in euros.
 */
const STORAGE_KEY = 'tpv_cashdro_config';
const TERMINAL_KEY = 'tpv_cashdro_terminal_id';
export const LOCAL_URL = 'http://127.0.0.1:8765';
export const LAN_PORT = 8766;
export const CERT_PORT = 8765;

export type CashdroConfig = { mode: 'off' | 'local' | 'remote'; mainIp: string; token: string; refunds: boolean; lanRefunds: boolean; terminalName: string };
const DEFAULTS: CashdroConfig = { mode: 'off', mainIp: '', token: '', refunds: true, lanRefunds: false, terminalName: '' };

/** Private shop IPv4 (192.168.x.x, 10.x.x.x or 172.16-31.x.x). */
export const isValidLanIp = (ip: string) => {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number);
  return (a === 192 && b === 168) || a === 10 || (a === 172 && b >= 16 && b <= 31);
};

export function getCashdroConfig(): CashdroConfig {
  let stored: Partial<CashdroConfig> & { enabled?: boolean } = {};
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {}; } catch { stored = {}; }
  if (!stored.mode && stored.enabled) stored.mode = 'local';
  const { enabled: _old, ...rest } = stored;
  return { ...DEFAULTS, ...rest };
}

export function saveCashdroConfig(config: Partial<CashdroConfig>): CashdroConfig {
  const next = { ...getCashdroConfig(), ...config };
  next.mode = (['off', 'local', 'remote'] as const).includes(next.mode) ? next.mode : 'off';
  next.mainIp = String(next.mainIp || '').trim();
  next.token = String(next.token || '').trim();
  next.terminalName = String(next.terminalName || '').trim().slice(0, 40);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* no storage: cannot enable */ }
  return next;
}

export const bridgeUrl = (config = getCashdroConfig()) => (config.mode === 'remote' ? `https://${config.mainIp}:${LAN_PORT}` : LOCAL_URL);
export const certificateUrl = (ip: string) => `http://${ip}:${CERT_PORT}/certificado`;

export const cashdroEnabled = (config = getCashdroConfig()) => {
  if (!config.token) return false;
  if (config.mode === 'local') return true;
  return config.mode === 'remote' && isValidLanIp(config.mainIp);
};

export const cashdroRefundsEnabled = (config = getCashdroConfig()) =>
  cashdroEnabled(config) && (config.mode === 'remote' ? config.lanRefunds === true : config.refunds !== false);

export function terminalId(): string {
  try {
    let id = localStorage.getItem(TERMINAL_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(TERMINAL_KEY, id); }
    return id;
  } catch { return ''; }
}

export const toCents = (euros: unknown) => Math.round((Number(euros) || 0) * 100);
export const fromCents = (cents: unknown) => Math.round(Number(cents) || 0) / 100;

export class CashdroError extends Error {
  bridgeDown = false; status?: number; operationId: string | null = null; active: unknown = null;
}

async function call(path: string, { method = 'GET', body, timeoutMs = 20000, config = getCashdroConfig() }: { method?: string; body?: unknown; timeoutMs?: number; config?: CashdroConfig } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${bridgeUrl(config)}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json', 'X-Bridge-Token': config.token, 'X-Terminal-Id': terminalId(),
        'X-Terminal-Name': config.terminalName || (config.mode === 'local' ? 'PC principal' : ''),
      },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: 'no-store',
    });
  } catch (e) {
    const err = new CashdroError((e as Error)?.name === 'AbortError'
      ? 'El puente CashDro no contesta (tiempo agotado).'
      : config.mode === 'remote'
        ? `No se puede conectar con el puente CashDro en ${config.mainIp}. ¿Está encendido el PC principal? ¿Está instalado el certificado de la tienda en este dispositivo?`
        : 'No se encuentra el puente CashDro en este PC. Comprueba que está encendido.');
    err.bridgeDown = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  let data: Record<string, unknown> = {};
  try { data = await response.json(); } catch { /* empty body */ }
  if (!response.ok) {
    const err = new CashdroError(String(data.error || `CashDro: error ${response.status}`));
    err.status = response.status;
    err.operationId = (data.operationId as string) || null;
    err.active = data.active || null;
    throw err;
  }
  return data;
}

export const cashdro = {
  health: (config?: CashdroConfig) => call('/health', { timeoutMs: 5000, config }),
  status: (config?: CashdroConfig) => call('/status', { timeoutMs: 12000, config }),
  /** Machine inventory (recyclers + cassettes). Snapshot sent with the Z cierre. */
  levels: (config?: CashdroConfig) => call('/levels', { timeoutMs: 15000, config }),
  /** Start a sale: the customer inserts cash, the machine gives change. */
  startSale: (amountEuros: number, posUser: string) => call('/sale', { method: 'POST', body: { amountCents: toCents(amountEuros), posUser } }),
  /** Start a payout: the machine dispenses (refunds, withdrawals). */
  startPayout: (amountEuros: number, posUser: string) => call('/payout', { method: 'POST', body: { amountCents: toCents(amountEuros), posUser } }),
  /** Cierre: ready the machine to remove the banknote cassette (bridge v1.3+, main PC only). */
  startCassetteWithdrawal: (posUser: string) => call('/cassette-withdrawal', { method: 'POST', body: { posUser } }),
  ask: (operationId: string) => call(`/operation/${operationId}`, { timeoutMs: 10000 }),
  cancel: (operationId: string) => call(`/operation/${operationId}/cancel`, { method: 'POST' }),
};
