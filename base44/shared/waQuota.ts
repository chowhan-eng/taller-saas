// WhatsApp send quotas — MUST be checked before every outbound send (the WhatsApp module's send path).
//   * Trial cap: a tenant whose subscription is 'trialing' may send at most TRIAL_WA_CAP messages
//     during the trial (stops Meta API abuse with throwaway trials).
//   * Daily cap: Tenant.wa_daily_cap (default 250) per Europe/Madrid day, any plan.
//   * Kill-switch: Tenant.wa_paused blocks everything.
import { find, type Entities, type Row } from './db.ts';
import { parseTs } from './http.ts';

export const TRIAL_DAYS = 14;
export const TRIAL_WA_CAP = 50;

/** Statuses that mean "a message was (or will be) sent" — blocked_* attempts do not count. */
const COUNTED = new Set(['queued', 'sent', 'delivered', 'read', 'failed']);

export type QuotaDecision =
  | { ok: true; trial: boolean; usedInTrial: number; remainingInTrial: number | null }
  | { ok: false; reason: 'paused' | 'trial_cap' | 'daily_cap'; error: string };

export function madridDayStart(now: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const sinceMidnightMs = (+p.hour * 60 + +p.minute) * 60e3 + now.getUTCSeconds() * 1e3 + now.getUTCMilliseconds();
  return now.getTime() - sinceMidnightMs;
}

/** Pure decision, testable without a database. */
export function decideQuota(
  tenant: Record<string, unknown>, // reads wa_paused, wa_daily_cap
  subscription: Record<string, unknown> | null, // reads status, trial_start, created_date
  outbound: { status?: unknown; created_date?: string }[],
  now = new Date(),
): QuotaDecision {
  if (tenant.wa_paused === true) return { ok: false, reason: 'paused', error: 'Los envíos de WhatsApp están pausados para este taller.' };
  const counted = outbound.filter((m) => COUNTED.has(String(m.status)));

  const trial = subscription?.status === 'trialing';
  let usedInTrial = 0;
  if (trial) {
    // Only messages after the trial start count — or after an admin reset of the quota, whichever is later.
    const start = Math.max(parseTs((subscription?.trial_start ?? subscription?.created_date) as string | undefined), parseTs(subscription?.wa_quota_reset_at as string | undefined));
    usedInTrial = counted.filter((m) => parseTs(m.created_date) >= start).length;
    if (usedInTrial >= TRIAL_WA_CAP) {
      return {
        ok: false, reason: 'trial_cap',
        error: `Has llegado a los ${TRIAL_WA_CAP} mensajes de WhatsApp de la prueba gratis. Activa tu plan para seguir enviando.`,
      };
    }
  }

  const cap = Number(tenant.wa_daily_cap ?? 250);
  const dayStart = madridDayStart(now);
  if (counted.filter((m) => parseTs(m.created_date) >= dayStart).length >= cap) {
    return { ok: false, reason: 'daily_cap', error: 'Hoy se ha alcanzado el límite diario de mensajes de WhatsApp de tu taller.' };
  }
  return { ok: true, trial, usedInTrial, remainingInTrial: trial ? TRIAL_WA_CAP - usedInTrial : null };
}

/**
 * Load what the decision needs and decide. Base44 has no transactions, so two sends racing at message
 * 49 can both pass: the cap can be exceeded by the number of concurrent sends, never more.
 */
export async function checkWhatsappQuota(db: Entities, tenant: Row, now = new Date()): Promise<QuotaDecision> {
  const [subscription] = await find(db.Subscription, { tenant_id: tenant.id }, { limit: 1 });
  const window = Math.max(TRIAL_WA_CAP, Number(tenant.wa_daily_cap ?? 250)) + 1;
  const outbound = await find(db.WhatsappLog, { tenant_id: tenant.id, direction: 'outbound' }, { sort: '-created_date', limit: window });
  return decideQuota(tenant, subscription ?? null, outbound, now);
}
