// Live supplier lookup for the Reparo quoter. Port of the production Reparo `partsSearch` function:
// the query normaliser + deterministic part/quality classifier are verbatim; the supplier adapters are
// rewritten per tenant:
//   * each shop's dealer login (and its session cookie) is stored ENCRYPTED in SupplierAccount, per tenant,
//     and a session is NEVER shared between shops (dealer prices are private to each shop);
//   * Androgeek: live HTML search (dealer price with a login, public price without);
//   * SpainSellers: the shop's CSV feed if configured, otherwise the public per-model category pages plus
//     the dealer price endpoint (needs a login for real prices; without one the price is an ESTIMATE);
//   * MuchoRepuesto: link only. Its site sits behind bot protection and, as in production, is not scraped.
// All amounts are cents; nothing here computes a PVP (that is pricing.ts).
import type { FieldCrypto } from './crypto.ts';
import { find, findOne, type Entities, type Row } from './db.ts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT_MS = 7000;
const IVA = 1.21;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const SESSION_CHECK_MS = 30 * 60 * 1000;
const LOGIN_BACKOFF_MS = 15 * 60 * 1000;
const CATEGORY_TTL_MS = 7 * 864e5;
const SS_DEALER_DISCOUNT = 0.20; // seen in production on 3/11/2026: guest net 24,46 → dealer 19,46
const SS = 'https://www.spainsellers.com';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// ───────────────────────────── text helpers (verbatim)
const ENT: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', euro: '€' };
export const decode = (s: string) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m)
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const CANON_FIX: [RegExp, string][] = [
  [/\b(samsumg|sasmung|samnsung|samgung|sansung|samung|samsun)\b/g, 'samsung'],
  [/\b(xiamo|xioami|xiomi|xaomi|xiami|xiaomy)\b/g, 'xiaomi'],
  [/\b(huawey|huaewi|hauwei|huwei|huawie)\b/g, 'huawei'],
  [/\b(iphon|iphen|iphoe|ipone|iphne|iphoen|ihpone)\b/g, 'iphone'],
  [/\b(swicht|swich|stiwch|swtich|switc|swith|swicth)\b/g, 'switch'],
  [/\b(ninentendo|nintedo|ninetndo|nitendo|nintento)\b/g, 'nintendo'],
  [/\b(mack ?book|macbok|mac book)\b/g, 'macbook'],
  [/\b(pnatalla|patalla|pantlla|pantala|panatalla|pantallla)\b/g, 'pantalla'],
  [/\b(bateira|baterria|bateri)\b/g, 'bateria'],
  [/\b(joy ?sticks?|joytick|joistick)\b/g, 'joystick'],
  [/\b(joy ?cons?)\b/g, 'joycon'],
  [/\bplay ?station ?([2-5])\b/g, 'ps$1'],
  [/\bpro ?max\b/g, 'pro max'],
  [/\b(?:ip|iph|ifone)(\d{1,2})\b/g, 'iphone $1'],
  [/\b(?:ip|iph)\s+(\d{1,2})\b/g, 'iphone $1'],
  [/\bswitch (normal|estandar|standard|v1)\b/g, 'switch'],
  [/\b(\d{1,2})\s?(pro|max|mini|plus)\b/g, '$1 $2'],
];
const CANON_DROP = new Set(['galaxy', 'de', 'del', 'para', 'el', 'la', 'los', 'las', 'y', 'con', 'mi']);

export function canon(text: unknown): string {
  let s = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, ' ').trim();
  s = s.replace(/\b(\d{1,2})(pro|max|mini|plus)\b/g, '$1 $2');
  for (const [re, to] of CANON_FIX) s = s.replace(re, to);
  let w: string[] = s.split(' ').filter(Boolean);
  if (w.includes('apple') && !w.some((x) => /^(iphone|ipad|macbook|imac|ipod|watch|whatch|airpods|mac)$/.test(x))) {
    const i = w.indexOf('apple');
    if (/^(\d{1,2}|x|xs|xr|se|\d{1,2}[a-z])$/.test(w[i + 1] || '')) w.splice(i + 1, 0, 'iphone');
  }
  if (w.some((x) => /^(iphone|ipad|macbook|imac|ipod)$/.test(x))) w = w.filter((x) => x !== 'apple');
  if (w.some((x) => /^(redmi|poco)$/.test(x))) w = w.filter((x) => x !== 'xiaomi');
  w = w.filter((x, i) => x !== w[i - 1]);
  return w.filter((x) => !CANON_DROP.has(x)).join(' ');
}

/** «1.234,56 €» / «€29.99» / «49,50» → céntimos. */
export function cents(raw: unknown): number | null {
  if (typeof raw === 'number') return Math.round(raw * 100);
  let s = String(raw || '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot >= 0 && s.length - lastDot - 1 === 3) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isFinite(n) ? Math.round(n * 100) : null;
}

// ───────────────────────────── classification (verbatim)
const KEYWORDS: [string, RegExp][] = [
  ['junk', /\b(funda|fundas|protector|templado|hidrogel|adhesivo|adhesivos|pegatina|tornillo|tornillos|herramienta|herramientas|ventosa|estano|pegamento|malla|lamina|bandeja|tester|programador|estacion|ic|chip|chips|fpc|marco|flex|cristal|lector|soporte|cargador|cable|placa|placa base|nand|bms|kit|tactil|digitalizador)\b/g],
  ['keyboard_riveted', /\b(top ?case|palmrest|teclado remachado|carcasa superior con teclado|carcasa superior|cover superior|cover superior teclado)\b/g],
  ['charging_port', /\b(conector de carga|conector carga|placa de carga|placa carga|puerto de carga|puerto carga|pin carga|flex de carga|flex carga|dc jack|jack dc|conector dc|power jack|usb c|charging port)\b/g],
  ['screen', /\b(pantalla|pantallas|lcd|display|screen|oled|incell|pantalla tactil|pantalla digitalizador)\b/g],
  ['battery', /\b(bateria|baterias|battery)\b/g],
  ['hdmi', /\b(hdmi)\b/g],
  ['joystick', /\b(joystick|joysticks|thumbstick|analogico|stick)\b/g],
  ['keyboard', /\b(teclado|teclados|keyboard)\b/g],
  ['hinges', /\b(bisagra|bisagras|hinge|hinges)\b/g],
  ['fan', /\b(ventilador|ventiladores|fan|disipador)\b/g],
  ['back_cover', /\b(tapa trasera|tapa bateria|tapa|chasis|back cover|carcasa trasera)\b/g],
  ['camera', /\b(camara|camaras|lente|camera)\b/g],
  ['speaker', /\b(altavoz|buzzer|auricular|speaker)\b/g],
];
const PART_WORDS = /\b(pantalla|pantallas|lcd|display|screen|tactil|digitalizador|bateria|baterias|battery|conector|carga|placa|puerto|dc|jack|usb|hdmi|joystick|joysticks|stick|analogico|teclado|teclados|keyboard|remachado|top|case|bisagra|bisagras|ventilador|fan|tapa|trasera|chasis|camara|lente|altavoz|buzzer|auricular|cambio|cambiar|reparacion|reparar|de|del|para|la|el|los|las|con|y|nueva|nuevo|original|oled|incell|compatible|premium|calidad|repuesto|pieza)\b/g;

function detectType(n: string, allowJunk: boolean): string | null {
  let best: { t: string; i: number; len: number } | null = null;
  for (const [t, re] of KEYWORDS) {
    if (!allowJunk && t === 'junk') continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(n))) {
      if (!best || m.index < best.i || (m.index === best.i && m[0].length > best.len)) best = { t, i: m.index, len: m[0].length };
    }
  }
  return best?.t || null;
}

const CATEGORY: [string, RegExp][] = [
  ['consola', /\b(ps5|ps4|ps3|playstation|xbox|switch|joy con|joycon|nintendo|dualsense|dualshock|steam deck)\b/],
  ['portatil', /\b(portatil|laptop|notebook|ideapad|thinkpad|thinkbook|macbook|vivobook|zenbook|pavilion|probook|elitebook|envy|aspire|nitro|inspiron|vostro|latitude|xps|legion|yoga|chromebook|msi|rog|tuf|omen|victus|satellite|predator)\b/],
  ['tablet', /\b(ipad|tablet|tab|galaxy tab|mediapad|matepad)\b/],
  ['sobremesa', /\b(sobremesa|torre|pc gaming|fuente de alimentacion|grafica)\b/],
];
const BRANDS: [string, RegExp][] = [
  ['Apple', /\b(iphone|ipad|macbook|apple|imac)\b/], ['Samsung', /\b(samsung|galaxy)\b/], ['Xiaomi', /\b(xiaomi|redmi|poco|mi)\b/],
  ['Huawei', /\b(huawei|honor|mate|nova)\b/], ['Oppo', /\b(oppo)\b/], ['Realme', /\b(realme)\b/], ['OnePlus', /\b(oneplus)\b/],
  ['Motorola', /\b(motorola|moto)\b/], ['Google', /\b(pixel|google)\b/], ['Sony', /\b(ps5|ps4|playstation|sony|xperia|dualsense)\b/],
  ['Microsoft', /\b(xbox|surface|microsoft)\b/], ['Nintendo', /\b(switch|nintendo|joy con|joycon)\b/], ['Lenovo', /\b(lenovo|ideapad|thinkpad|thinkbook|legion|yoga)\b/],
  ['HP', /\b(hp|pavilion|probook|elitebook|envy|omen|victus)\b/], ['Asus', /\b(asus|vivobook|zenbook|rog|tuf)\b/], ['Acer', /\b(acer|aspire|nitro|predator)\b/],
  ['Dell', /\b(dell|inspiron|vostro|latitude|xps)\b/], ['MSI', /\b(msi)\b/], ['Toshiba', /\b(toshiba|satellite)\b/],
];
const VARIANTS = new Set(['pro', 'max', 'mini', 'plus', 'ultra', 'lite', 'fe', 'e', 'neo']);

export type Parsed = ReturnType<typeof parseQuery>;
export function parseQuery(q: string) {
  const n = canon(q).replace(/\bswitch (oled|lite)\b/g, 'switch_$1');
  const part_type = detectType(n, false) || 'other';
  let brand = (BRANDS.find(([, re]) => re.test(n.replace(/_/g, ' '))) || [''])[0];
  let modelTokens = n.replace(PART_WORDS, ' ').split(/\s+/).flatMap((t) => t.split('_')).filter((t) => t && t.length > 0);
  let inferred = '';
  if (!brand && /^([6-9]|1[0-7])$/.test(modelTokens[0] || '') && modelTokens.slice(1).every((t) => VARIANTS.has(t))) {
    modelTokens = ['iphone', ...modelTokens]; brand = 'Apple'; inferred = 'iphone';
  }
  const category = (CATEGORY.find(([, re]) => re.test(`${n} ${modelTokens.join(' ')}`)) || ['movil'])[0];
  const model_codes = modelTokens.filter((t) => /^a\d{4}$/.test(t) || (/\d/.test(t) && /[a-z]/.test(t) && t.length >= 4));
  const raw = String(q || '').trim();
  const qs = inferred || /\bip\s?\d|\biph\d|promax|\d(pro|max|mini|plus)\b|patalla|pnatalla|samsumg|xiamo|swicht/i.test(raw) ? `${inferred ? 'iphone ' : ''}${n}` : raw;
  return { q: raw, qs, category, brand, part_type, model: modelTokens.join(' '), modelTokens, model_codes, inferred };
}

function modelMatch(titleN: string, tokens: string[]): number {
  if (!tokens.length) return 0.7;
  const words = titleN.split(' ');
  const set = new Set(words);
  if (!tokens.every((t) => set.has(t))) return 0;
  const asked = new Set(tokens);
  let found = false, clean = false;
  for (let i = 0; i + tokens.length <= words.length; i++) {
    if (tokens.every((t, j) => words[i + j] === t)) {
      found = true;
      const next = words[i + tokens.length];
      if (!next || !VARIANTS.has(next) || asked.has(next)) clean = true;
    }
  }
  if (!found) return 0.6;
  return clean ? 1 : 0;
}

function tierOf(n: string) {
  const compat = /\b(compatible|no original|tipo original|aftermarket)\b/.test(n);
  const t3 = !compat && /\b(service pack|servicepack|despiece|original nuevo|genuine|original|originales)\b/.test(n);
  const incell = /\b(incell|ltps|tft)\b/.test(n);
  const t2 = !incell && /\b(soft oled|hard oled|oled|amoled|premium|oem|grado a|blue star|hrg|libre de aviso|alta capacidad)\b/.test(n);
  const t1 = /\b(incell|ltps|tft|compatible|aaa|generica|generico|aftermarket)\b/.test(n);
  const LABELS: [RegExp, string][] = [
    [/\bservice ?pack\b/, 'Service Pack'], [/\bdespiece\b/, 'Original (despiece)'], [/\boriginal\b.*\bremanufacturad/, 'Original remanufacturada'],
    [/\boriginal\b/, 'Original'], [/\bsoft oled\b/, 'Soft OLED'], [/\bhard oled\b/, 'Hard OLED'], [/\bamoled\b/, 'AMOLED'], [/\boled\b/, 'OLED'],
    [/\bpremium\b/, 'Premium'], [/\boem\b/, 'OEM'], [/\bincell\b.*\bfhd\b|\bfhd\b.*\bincell\b/, 'Incell FHD'], [/\bincell\b/, 'Incell'],
    [/\bltps\b/, 'LTPS'], [/\btft\b/, 'TFT'], [/\bgrado a\b/, 'Remanufacturada grado A'], [/\bcompatible\b/, 'Compatible'],
  ];
  const label = (LABELS.find(([re]) => re.test(n)) || [null, ''])[1];
  if (t3) return { tier: 3, quality_label: label || 'Original', confidence: 0.9 };
  if (t2) return { tier: 2, quality_label: label || 'Alta calidad', confidence: 0.85 };
  if (t1) return { tier: 1, quality_label: label || 'Compatible', confidence: 0.85 };
  return { tier: 1, quality_label: label || 'Compatible', confidence: 0.6 };
}

export function classify(title: string, parsed: Pick<Parsed, 'part_type' | 'modelTokens'>) {
  const n = norm(title);
  const type = detectType(n, true);
  const wanted = parsed.part_type;
  let is_junk = false, junk_reason = '';
  if (type === 'junk') { is_junk = true; junk_reason = 'accesorio / no es la pieza'; }
  else if (wanted !== 'other' && type && type !== wanted && !(wanted.startsWith('keyboard') && type.startsWith('keyboard'))) { is_junk = true; junk_reason = 'otra pieza'; }
  else if (wanted !== 'other' && !type) { is_junk = true; junk_reason = 'tipo de pieza no reconocido'; }
  const mm = modelMatch(canon(title), parsed.modelTokens);
  if (!is_junk && mm === 0) { is_junk = true; junk_reason = 'otro modelo'; }
  const t = tierOf(n);
  return { part_type: type && type !== 'junk' ? type : wanted, is_junk, junk_reason, ...t, confidence: Math.round(t.confidence * (mm || 1) * 100) / 100 };
}

export type RawOffer = { sku?: string; url?: string; title: string; price_cents: number | null; price_tax_mode: 'net' | 'gross'; iva_deductible?: boolean; image?: string; stock?: string; stock_qty?: number | null; price_note?: string; estimated?: boolean };
export type Source = { key: string; display_name: string };

/** Normalise one supplier row: cost without IVA (deductible shops pay net), class, quality tier, junk flag. */
export function offer(src: Source, o: RawOffer, parsed: Parsed) {
  const price = o.price_cents;
  const ded = o.iva_deductible !== false;
  const net = price == null ? null : o.price_tax_mode === 'net' ? price : ded ? Math.round(price / IVA) : price;
  return {
    id: `${src.key}:${o.sku || o.url}`, source: src.key, source_name: src.display_name, sku: String(o.sku || ''), title: o.title, url: o.url || '',
    image: o.image || '', stock: o.stock || 'unknown', price_shown_cents: price, price_tax_mode: o.price_tax_mode, iva_deductible: ded, net_cost_cents: net,
    price_note: o.price_note || '', estimated: !!o.estimated, stock_qty: o.stock_qty ?? null, ...classify(o.title, parsed),
  };
}

// ───────────────────────────── safe fetching
const SUPPLIER_HOSTS = /^(https:\/\/(www\.)?(androgeek\.es|spainsellers\.com)\/)/;
async function fetchText(f: Fetch, url: string, init: RequestInit = {}, ms = TIMEOUT_MS) {
  if (!SUPPLIER_HOSTS.test(url)) throw new Error('Dirección de proveedor no permitida');
  const r = await f(url, { ...init, headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9', ...(init.headers || {}) }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

/** A feed URL typed by a shop: https only, no IPs, no localhost, no private names (SSRF guard). */
export function safeFeedUrl(raw: unknown): string | null {
  let u: URL;
  try { u = new URL(String(raw ?? '').trim()); } catch { return null; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (!h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.startsWith('[') || /(^|\.)(localhost|local|internal|lan|home)$/.test(h)) return null;
  return u.toString();
}

// ───────────────────────────── per-tenant dealer sessions
export type Deps = { db: Entities; fc: FieldCrypto; fetchFn?: Fetch; now?: Date };
type Sess = { cookie: string; state: 'logged' | 'guest' | 'failed'; note?: string };
const MEM: Record<string, { cookie: string; at: number; checked: number }> = {}; // key = tenant:source (never shared)
const FAILED: Record<string, { at: number; note: string }> = {};

const LOGIN: Record<string, { url: string; account: string; fields: (e: string, p: string) => Record<string, string> }> = {
  androgeek: { url: 'https://androgeek.es/autenticacion?back=my-account', account: 'https://androgeek.es/mi-cuenta', fields: (e, p) => ({ back: 'my-account', email: e, password: p, submitLogin: '1' }) },
  spainsellers: { url: 'https://www.spainsellers.com/inicio-sesion', account: 'https://www.spainsellers.com/mi-cuenta', fields: (e, p) => ({ email: e, passwd: p, back: 'my-account', SubmitLogin: '' }) },
};
const accountOf = (d: Deps, tenantId: string, source: string) => findOne(d.db.SupplierAccount, { tenant_id: tenantId, source });
const doFetch = (d: Deps): Fetch => d.fetchFn ?? ((u, i) => fetch(u, i));

async function sessionAlive(d: Deps, source: string, cookie: string) {
  const r = await doFetch(d)(LOGIN[source].account, { headers: { 'User-Agent': UA, Cookie: cookie }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  if (!r) return false;
  const t = await r.text();
  return r.status === 200 && !/name="passw(or)?d"/.test(t) && !/"is_logged":false/.test(t);
}
function mergeCookies(prev: string, res: Response) {
  const jar = new Map(prev.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c] as [string, string]));
  const set: string[] = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || [];
  for (const sc of set) {
    const kv = sc.split(';')[0];
    const name = kv.split('=')[0];
    if (/=(deleted)?$/.test(kv) || /max-age=0|expires=thu, 01 jan 1970/i.test(sc)) jar.delete(name); else jar.set(name, kv);
  }
  return [...jar.values()].join('; ');
}

/** Sign in with THIS shop's own account. No account / wrong password → guest (never an error for the search). */
export async function dealerSession(d: Deps, tenantId: string, source: 'androgeek' | 'spainsellers', force = false): Promise<Sess> {
  const cfg = LOGIN[source];
  const acc = await accountOf(d, tenantId, source);
  if (!acc?.email_enc || !acc.password_enc) return { cookie: '', state: 'guest' };
  const key = `${tenantId}:${source}`;
  const now = (d.now ?? new Date()).getTime();
  const s = MEM[key];
  if (!force && s && now - s.at < SESSION_TTL_MS && (now - s.checked < SESSION_CHECK_MS || await sessionAlive(d, source, s.cookie))) { s.checked = now; return { cookie: s.cookie, state: 'logged' }; }
  const f = FAILED[key];
  if (!force && f && now - f.at < LOGIN_BACKOFF_MS) return { cookie: '', state: 'failed', note: f.note };
  if (!force && !s && acc.cookie_enc && acc.logged_at && now - Date.parse(String(acc.logged_at)) < 7 * 864e5) {
    const cookie = await d.fc.decrypt(tenantId, String(acc.cookie_enc));
    if (await sessionAlive(d, source, cookie)) { MEM[key] = { cookie, at: now, checked: now }; return { cookie, state: 'logged' }; }
  }
  const email = (await d.fc.decrypt(tenantId, String(acc.email_enc))).trim();
  const pass = await d.fc.decrypt(tenantId, String(acc.password_enc));
  try {
    const fx = doFetch(d);
    const g = await fx(cfg.url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    let jar = mergeCookies('', g); await g.text();
    const p = await fx(cfg.url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar, Referer: cfg.url, Origin: new URL(cfg.url).origin },
      body: new URLSearchParams(cfg.fields(email, pass)),
    });
    jar = mergeCookies(jar, p);
    const ptext = await p.text();
    const acct = await fx(cfg.account, { headers: { 'User-Agent': UA, Cookie: jar }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    jar = mergeCookies(jar, acct);
    const at = await acct.text();
    const ok = acct.status === 200 && !/name="passw(or)?d"/.test(at) && !/"is_logged":false/.test(at);
    const stamp = new Date(now).toISOString();
    if (!ok) {
      delete MEM[key];
      const alert = [...ptext.matchAll(/class="alert[^"]*"[^>]*>([\s\S]{0,500}?)<\/(div|ol|ul)>/g)].map((m) => decode(m[1]).replace(/^Error \d+\s*/, '')).filter(Boolean)[0];
      const note = alert ? `El proveedor dice: ${alert.slice(0, 160)}` : 'El proveedor no aceptó el inicio de sesión';
      FAILED[key] = { at: now, note };
      await d.db.SupplierAccount.update(acc.id, { cookie_enc: null, checked_at: stamp, last_error: note }).catch(() => {});
      return { cookie: '', state: 'failed', note };
    }
    delete FAILED[key];
    MEM[key] = { cookie: jar, at: now, checked: now };
    await d.db.SupplierAccount.update(acc.id, { cookie_enc: await d.fc.encrypt(tenantId, jar), logged_at: stamp, checked_at: stamp, last_error: null }).catch(() => {});
    return { cookie: jar, state: 'logged' };
  } catch (e) {
    return { cookie: '', state: 'failed', note: `Inicio de sesión: ${String((e as Error)?.message || e).slice(0, 80)}` };
  }
}
const sessionNote = (s: Sess, tax: string) => `${s.state === 'logged' ? 'Sesión de distribuidor' : s.state === 'failed' ? `Sin sesión (${s.note})` : 'Precios de invitado'} · ${tax === 'net' ? 'sin IVA' : 'con IVA'}`;

// ───────────────────────────── Androgeek
export function parseAndrogeekHtml(html: string): { offers: RawOffer[]; tax: 'net' | 'gross' } {
  const tax = /"display_prices_tax_incl":true/.test(html) ? 'gross' : 'net';
  const out: RawOffer[] = [];
  for (const b of html.split('js-product-miniature').slice(1, 61)) {
    const id = b.match(/data-id-product="(\d+)"/)?.[1];
    const t = b.match(/class="product-title"[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const p = b.match(/itemprop="price"[^>]*>([^<]+)</)?.[1];
    if (!t || !p) continue;
    const head = b.slice(0, b.indexOf('product-description') > 0 ? b.indexOf('product-description') : 2000);
    out.push({
      sku: id, url: t[1], title: decode(t[2]), price_cents: cents(p), price_tax_mode: tax, iva_deductible: true, image: b.match(/data-src="([^"]+)"/)?.[1] || '',
      stock: /Sin Stock|Agotado|Fuera de stock/i.test(head + (b.match(/info-stock[\s\S]{0,200}/)?.[0] || '')) ? 'out' : 'in_stock',
    });
  }
  return { offers: out, tax };
}
async function androgeek(d: Deps, tenantId: string, parsed: Parsed) {
  const url = `https://androgeek.es/buscar?s=${encodeURIComponent(parsed.qs || parsed.q)}&resultsPerPage=60`;
  const fx = doFetch(d);
  let sess = await dealerSession(d, tenantId, 'androgeek');
  let html = await fetchText(fx, url, sess.cookie ? { headers: { Cookie: sess.cookie } } : {});
  if (sess.state === 'logged' && /"is_logged":false/.test(html)) {
    sess = await dealerSession(d, tenantId, 'androgeek', true);
    html = await fetchText(fx, url, sess.cookie ? { headers: { Cookie: sess.cookie } } : {});
    if (/"is_logged":false/.test(html) && sess.state === 'logged') sess = { cookie: '', state: 'failed', note: 'sesión rechazada' };
  }
  const r = parseAndrogeekHtml(html);
  return { offers: r.offers, note: sessionNote(sess, r.tax), session: sess.state };
}

// ───────────────────────────── SpainSellers
const SS_ALIAS: Record<string, string[]> = { ps5: ['playstation', '5'], ps4: ['playstation', '4'], ps3: ['playstation', '3'], ps2: ['playstation', '2'], joycon: ['joy', 'con'] };
const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokRe = (t: string) => ({ n: { $regex: `(^| )${escRe(t)}( |$)` } });
const ssPages: Record<string, { at: number; items: { sku: string; url: string; title: string; guest_cents: number | null; image: string }[] }> = {};

export function ssPickCategories<T extends { title?: string; n?: string }>(list: T[], parsed: Pick<Parsed, 'modelTokens'>): T[] {
  const toks: string[] = parsed.modelTokens.filter((t) => t !== 'apple').flatMap((t) => SS_ALIAS[t] || [t]);
  if (!toks.length) return [];
  const asked = new Set(toks);
  const scored: { c: T; s: number }[] = [];
  for (const c of list) {
    const words = canon(c.title || c.n).split(' ');
    if (!toks.every((t) => words.includes(t))) continue;
    const numsOk = toks.every((t, j) => !/^\d+$/.test(t) || j === 0 || words.some((w, i) => w === toks[j - 1] && words[i + 1] === t));
    if (!numsOk) continue;
    const extraVariants = words.filter((w) => VARIANTS.has(w) && !asked.has(w)).length;
    scored.push({ c, s: -extraVariants * 10 + (words.includes('repuestos') ? 2 : 0) - words.length * 0.1 });
  }
  scored.sort((a, b) => b.s - a.s);
  if (!scored.length || scored[0].s <= -10) return [];
  return scored.filter((x, i) => i === 0 || (i === 1 && scored[0].s - x.s < 1.5)).map((x) => x.c);
}
export function ssParseItems(html: string) {
  const out: { sku: string; url: string; title: string; guest_cents: number | null; image: string }[] = [];
  for (const b of html.split('<li class="ajax_block_product').slice(1)) {
    const id = b.match(/-p-(\d+)\.html/)?.[1];
    const url = b.match(/class="product-name" href="([^"]+)"/)?.[1] || b.match(/href="([^"]+-p-\d+\.html)"/)?.[1];
    const title = b.match(/class="product-name"[^>]*title="([^"]+)"/)?.[1] || b.match(/alt="([^"]+)"/)?.[1];
    const price = b.match(/class="price product-price"[^>]*>\s*([^<]+)/)?.[1];
    if (id && title && url) out.push({ sku: id, url, title: decode(title), guest_cents: cents(price), image: b.match(/src="(https:\/\/www\.spainsellers\.com\/\d+-home_default[^"]+)"/)?.[1] || '' });
  }
  return out;
}
async function ssRefreshIndex(d: Deps) {
  const html = await fetchText(doFetch(d), `${SS}/buscar?controller=search&search_query=x`, {}, 25000);
  const list: { title: string; n: string; url: string }[] = [];
  for (const m of html.matchAll(/data-loc="([A-Za-z0-9+/=]+)"\s*class="OfCb64 ?"\s*title="Productos en ([^"]+)"/g)) {
    try { const url = atob(m[1]); if (url.startsWith(SS)) list.push({ title: decode(m[2]), n: norm(decode(m[2])), url }); } catch { /* skip */ }
  }
  if (list.length < 100) throw new Error(`Índice sospechoso (${list.length} categorías)`);
  const version = (d.now ?? new Date()).getTime();
  for (let i = 0; i < list.length; i += 500) await d.db.SupplierCategory.bulkCreate?.(list.slice(i, i + 500).map((c) => ({ source: 'spainsellers', ...c, version })));
  for (let i = 0; i < 40; i++) {
    const old = (await d.db.SupplierCategory.filter({ source: 'spainsellers', version: { $lt: version } })).slice(0, 500);
    if (!old.length) break;
    await Promise.all(old.map((r) => d.db.SupplierCategory.delete(r.id).catch(() => {})));
  }
  return version;
}
async function ssFindCategories(d: Deps, parsed: Parsed) {
  const toks = parsed.modelTokens.filter((t) => t !== 'apple').flatMap((t) => SS_ALIAS[t] || [t]);
  if (!toks.length) return [];
  const query = { $and: [{ source: 'spainsellers' }, ...toks.map(tokRe)] };
  const any = await d.db.SupplierCategory.filter({ source: 'spainsellers' });
  const newest = Math.max(0, ...(any ?? []).slice(0, 5).map((r) => Number(r.version) || 0));
  if (!newest || (d.now ?? new Date()).getTime() - newest > CATEGORY_TTL_MS) await ssRefreshIndex(d);
  const rows = (await d.db.SupplierCategory.filter(query)).slice(0, 200);
  const maxV = Math.max(0, ...rows.map((r) => Number(r.version) || 0));
  return ssPickCategories(rows.filter((r) => (Number(r.version) || 0) === maxV) as (Row & { title: string; url: string })[], parsed);
}
async function ssCategoryItems(d: Deps, url: string) {
  const mem = ssPages[url];
  const now = (d.now ?? new Date()).getTime();
  if (mem && now - mem.at < 30 * 60e3) return mem.items;
  const fx = doFetch(d);
  const first = await fetchText(fx, `${url}?n=30`, {}, 12000);
  const total = Number(first.match(/Hay (\d+) productos/)?.[1] || 0);
  const pages = Math.min(Math.ceil(total / 30) || 1, 8);
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchText(fx, `${url}?n=30&p=${i + 2}`, {}, 12000).catch(() => '')));
  const items = [first, ...rest].flatMap(ssParseItems);
  ssPages[url] = { at: now, items };
  return items;
}
async function ssDynamic(d: Deps, tenantId: string, ids: string[]) {
  const sess = await dealerSession(d, tenantId, 'spainsellers');
  if (!ids.length) return { prices: {} as Record<string, { pfin?: number; stoc?: number }>, sess };
  const r = await doFetch(d)(`${SS}/module/ecommfinder/dynamic`, {
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', ...(sess.cookie ? { Cookie: sess.cookie } : {}) },
    body: new URLSearchParams({ ids: `${ids.map((i) => `${i}|0`).join(',')},`, properties: 'pfin,pori,stoc' }),
  });
  const res = ((await r.json().catch(() => ({}))) as { results?: Record<string, { pfin?: number; stoc?: number }> }).results || {};
  const prices: Record<string, { pfin?: number; stoc?: number }> = {};
  for (const [k, v] of Object.entries(res)) prices[k.split('|')[0]] = v;
  return { prices, sess };
}
function splitCsv(line: string, delim: string) {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
export function parseSpainSellersCsv(text: string, parsed: Pick<Parsed, 'modelTokens' | 'q'>): RawOffer[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const head = splitCsv(lines[0], delim).map((h) => norm(h));
  const col = (n: string) => head.indexOf(n);
  const iId = col('id'), iName = col('nombre'), iCat = col('categoria'), iPrice = col('precio'), iPvd = col('pvd'), iStock = col('stock'), iImg = col('img');
  const rows = lines.slice(1).map((l) => {
    const c = splitCsv(l, delim);
    return { id: c[iId], name: c[iName], n: norm(`${c[iName]} ${c[iCat] || ''}`), price: c[iPrice], pvd: c[iPvd], stock: norm(c[iStock] || ''), img: c[iImg] || '' };
  }).filter((r) => r.id && r.name);
  const tokens = parsed.modelTokens.length ? parsed.modelTokens : norm(parsed.q).split(' ');
  return rows.filter((r) => tokens.every((t) => r.n.split(' ').includes(t))).slice(0, 80).map((r) => {
    const pvd = cents(r.pvd);
    return {
      sku: r.id, title: r.name, url: `${SS}/index.php?controller=product&id_product=${r.id}`, price_cents: pvd && pvd > 0 ? pvd : cents(r.price), price_tax_mode: 'net' as const,
      iva_deductible: true, image: r.img, stock: r.stock.includes('sin') ? 'out' : r.stock.includes('bajo') ? 'low' : r.stock ? 'in_stock' : 'unknown',
    };
  });
}
async function spainsellers(d: Deps, tenantId: string, parsed: Parsed) {
  const acc = await accountOf(d, tenantId, 'spainsellers');
  const feed = acc?.feed_url ? safeFeedUrl(acc.feed_url) : null;
  if (feed) {
    const text = await (await doFetch(d)(feed, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) })).text();
    const offers = parseSpainSellersCsv(text, parsed);
    return { offers, note: `CSV propio (${offers.length} coincidencias)` };
  }
  const picked = await ssFindCategories(d, parsed);
  if (!picked.length) return { offers: [] as RawOffer[], note: 'Sin categoría para ese modelo' };
  const seen = new Set<string>();
  const items = (await Promise.all(picked.map((c) => ssCategoryItems(d, String(c.url))))).flat().filter((it) => !seen.has(it.sku) && seen.add(it.sku));
  const relevant = items.filter((it) => !classify(it.title, parsed).is_junk).slice(0, 60);
  const dyn = await ssDynamic(d, tenantId, relevant.map((it) => it.sku));
  const logged = dyn.sess.state === 'logged';
  const offers: RawOffer[] = relevant.map((it) => {
    const v = dyn.prices[it.sku];
    const shown = v?.pfin != null ? Math.round(Number(v.pfin) * 100) : it.guest_cents;
    const stock_qty = v && Number.isFinite(Number(v.stoc)) ? Number(v.stoc) : null;
    const stock = v ? (Number(v.stoc) > 0 ? 'in_stock' : 'out') : 'unknown';
    if (logged || shown == null) return { sku: it.sku, url: it.url, title: it.title, image: it.image, price_cents: shown, price_tax_mode: 'net', iva_deductible: true, stock, stock_qty, price_note: 'precio distribuidor' };
    // Without a dealer login only the public (IVA incl.) price is known: net it and apply the usual dealer discount — flagged as an estimate.
    return { sku: it.sku, url: it.url, title: it.title, image: it.image, price_cents: Math.round((shown / IVA) * (1 - SS_DEALER_DISCOUNT)), price_tax_mode: 'net', iva_deductible: true, stock, stock_qty, price_note: 'estimado −20 % (sin sesión)', estimated: true };
  });
  return { offers, note: `${picked.map((c) => c.title).join(' + ')} · ${logged ? 'Sesión de distribuidor · sin IVA' : `Sin sesión (${dyn.sess.note || 'sin credenciales'}) · precio estimado −20 %`}`, session: dyn.sess.state };
}

// ───────────────────────────── search entry point
export const SOURCES: (Source & { mode: 'live' | 'link'; link: string })[] = [
  { key: 'androgeek', display_name: 'Androgeek', mode: 'live', link: 'https://androgeek.es/buscar?s={q}' },
  { key: 'spainsellers', display_name: 'SpainSellers', mode: 'live', link: 'https://www.spainsellers.com/#ecommfinder/{q}' },
  { key: 'muchorepuesto', display_name: 'MuchoRepuesto', mode: 'link', link: 'https://muchorepuesto.com/busqueda?controller=search&s={q}' },
];

export type SourceStatus = { state: 'ok' | 'empty' | 'error' | 'link'; ms: number; count: number; note: string; url: string };
export type Offer = ReturnType<typeof offer> & { saved?: { price_eur: number; changed: boolean; previous_price_eur: number | null } };

/** Search every supplier in parallel for ONE tenant; remembered prices (PartPrice) flag changes. */
export async function searchParts(d: Deps, tenantId: string, query: string) {
  const q = String(query ?? '').trim().slice(0, 120);
  if (q.length < 3) throw new Error('Escribe al menos 3 caracteres');
  const parsed = parseQuery(q);
  const sources: Record<string, SourceStatus> = {};
  const offers: Offer[] = [];
  const linkFor = (s: { link: string }) => s.link.replace('{q}', encodeURIComponent(q));
  const run = async (s: (typeof SOURCES)[number], fn: () => Promise<{ offers: RawOffer[]; note: string }>) => {
    const t = Date.now();
    try {
      const r = await fn();
      const list = r.offers.map((o) => offer(s, o, parsed));
      offers.push(...list);
      const usable = list.filter((o) => !o.is_junk).length;
      sources[s.key] = { state: usable ? 'ok' : 'empty', ms: Date.now() - t, count: usable, note: r.note, url: linkFor(s) };
    } catch (e) { sources[s.key] = { state: 'error', ms: Date.now() - t, count: 0, note: String((e as Error)?.message || e).slice(0, 120), url: linkFor(s) }; }
  };
  const [ag, ss, mr] = SOURCES;
  sources[mr.key] = { state: 'link', ms: 0, count: 0, note: 'Su web no permite accesos automáticos: ábrela y apunta el precio a mano', url: linkFor(mr) };
  await Promise.all([run(ag, () => androgeek(d, tenantId, parsed)), run(ss, () => spainsellers(d, tenantId, parsed))]);

  // Price memory: the same supplier product seen before at another price → change alert.
  const mem = await find(d.db.PartPrice, { tenant_id: tenantId });
  const byKey = new Map(mem.map((m) => [String(m.part_key), m]));
  for (const o of offers) {
    const m = o.sku ? byKey.get(`sku:${o.source}:${o.sku}`) : undefined;
    if (m && o.net_cost_cents != null) o.saved = { price_eur: Number(m.price_eur), previous_price_eur: m.previous_price_eur == null ? null : Number(m.previous_price_eur), changed: Math.abs(Number(m.price_eur) * 100 - o.net_cost_cents) > 1 };
  }
  offers.sort((a, b) => Number(a.is_junk) - Number(b.is_junk) || a.tier - b.tier || (a.net_cost_cents ?? 1e9) - (b.net_cost_cents ?? 1e9));
  return { parsed: { category: parsed.category, brand: parsed.brand, part_type: parsed.part_type, model: parsed.model }, sources, offers: offers.slice(0, 120) };
}

/** Public status of a shop's supplier accounts: flags only, never a credential. */
export async function supplierStatus(d: Deps, tenantId: string) {
  const out: Record<string, { configured: boolean; feed: boolean; state: string; note: string; logged_at: string | null }> = {};
  for (const s of ['androgeek', 'spainsellers'] as const) {
    const a = await accountOf(d, tenantId, s);
    out[s] = { configured: !!(a?.email_enc && a.password_enc), feed: !!a?.feed_url, state: a?.last_error ? 'failed' : a?.logged_at ? 'logged' : a?.email_enc ? 'unknown' : 'guest', note: String(a?.last_error ?? ''), logged_at: (a?.logged_at as string) ?? null };
  }
  return out;
}

export async function saveSupplierAccount(d: Deps, tenantId: string, p: { source: string; email?: string; password?: string; feedUrl?: string }) {
  if (p.source !== 'androgeek' && p.source !== 'spainsellers') throw new Error('Proveedor no válido');
  const acc = await accountOf(d, tenantId, p.source);
  const patch: Record<string, unknown> = {};
  if (p.email !== undefined || p.password !== undefined) {
    const email = String(p.email ?? '').trim().replace(/^mailto:/i, '').replace(/\s+/g, '');
    const pass = String(p.password ?? '');
    if (!email && !pass) { patch.email_enc = null; patch.password_enc = null; patch.cookie_enc = null; patch.logged_at = null; patch.last_error = null; }
    else {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Revisa el correo del proveedor.');
      if (pass.length < 4) throw new Error('Escribe la contraseña del proveedor.');
      patch.email_enc = await d.fc.encrypt(tenantId, email); patch.password_enc = await d.fc.encrypt(tenantId, pass); patch.cookie_enc = null; patch.logged_at = null; patch.last_error = null;
    }
  }
  if (p.feedUrl !== undefined) {
    const raw = String(p.feedUrl).trim();
    if (raw && p.source !== 'spainsellers') throw new Error('Solo SpainSellers admite un CSV.');
    const safe = raw ? safeFeedUrl(raw) : null;
    if (raw && !safe) throw new Error('La dirección del CSV debe ser https:// y de un dominio público.');
    patch.feed_url = safe;
  }
  delete MEM[`${tenantId}:${p.source}`]; delete FAILED[`${tenantId}:${p.source}`];
  if (acc) await d.db.SupplierAccount.update(acc.id, patch); else await d.db.SupplierAccount.create({ tenant_id: tenantId, source: p.source, ...patch });
}

/** Force a login now and report the result (the «Probar» button). */
export async function testSupplier(d: Deps, tenantId: string, source: 'androgeek' | 'spainsellers') {
  const s = await dealerSession(d, tenantId, source, true);
  return { state: s.state, note: s.note ?? '' };
}
