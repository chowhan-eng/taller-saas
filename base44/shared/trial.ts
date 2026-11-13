// Cardless 14-day Starter trial. No Stripe, no card: the owner of a shop activates it from /onboarding and
// the shop is `starter` / `trialing` with trial_end = now + 14 days and the 50-message WhatsApp cap (waQuota.ts).
// When trial_end passes and the shop has not subscribed through Stripe, outbound WhatsApp is refused (waQuota.ts).
import { find, findOne, type Entities, type Row } from './db.ts';
import { parseTs } from './http.ts';
import { TRIAL_DAYS, TRIAL_WA_CAP } from './waQuota.ts';

const DAY = 864e5;

/** A trial started without Stripe has no Stripe subscription: only the clock ends it. */
export const isCardlessTrial = (sub: Row | null | undefined) => !!sub && sub.status === 'trialing' && !sub.stripe_subscription_id;

export type TrialState = { state: 'none' | 'trial' | 'expired'; cardless: boolean; ends_at: string | null; days_left: number | null; wa_cap: number };

/** Where a shop stands: no trial, running (days left) or expired (cardless trial past its end, never upgraded). */
export function trialState(sub: Row | null | undefined, now = new Date()): TrialState {
  const none: TrialState = { state: 'none', cardless: false, ends_at: null, days_left: null, wa_cap: TRIAL_WA_CAP };
  if (!sub) return none;
  const end = parseTs(sub.trial_end as string | undefined);
  if (isCardlessTrial(sub) && end) {
    return end <= now.getTime()
      ? { ...none, state: 'expired', cardless: true, ends_at: new Date(end).toISOString(), days_left: 0 }
      : { ...none, state: 'trial', cardless: true, ends_at: new Date(end).toISOString(), days_left: Math.max(1, Math.ceil((end - now.getTime()) / DAY)) };
  }
  if (sub.status === 'trialing') return { ...none, state: 'trial', ends_at: end ? new Date(end).toISOString() : null, days_left: end ? Math.max(0, Math.ceil((end - now.getTime()) / DAY)) : null };
  return none;
}

export class TrialError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Start the free trial for the caller's shop. Rules:
 *  - only the OWNER of the shop, and only after accepting the RGPD processor contract (createTenant stores it);
 *  - one trial per shop AND one per owner (a second shop of the same user cannot restart it);
 *  - a shop that already pays (active / past_due) does not need it; a running trial is returned as is (double click safe).
 */
export async function activateFreeTrial(db: Entities, user: { id: string }, tenantId: unknown, now = new Date()) {
  if (typeof tenantId !== 'string' || !tenantId) throw new TrialError(404, 'Taller no encontrado');
  const member = await findOne(db.TenantUser, { tenant_id: tenantId, user_id: user.id, active: true });
  if (!member) throw new TrialError(403, 'No tienes acceso a este taller.');
  if (member.role !== 'owner') throw new TrialError(403, 'Solo el titular del taller puede empezar la prueba.');
  const tenant = await findOne(db.Tenant, { id: tenantId });
  if (!tenant) throw new TrialError(404, 'Taller no encontrado');
  if (!tenant.dpa_accepted_at) throw new TrialError(400, 'Falta aceptar el contrato de Encargado del Tratamiento.');
  if (tenant.status === 'suspended') throw new TrialError(403, 'Este taller está suspendido. Escríbenos para reactivarlo.');

  const sub = await findOne(db.Subscription, { tenant_id: tenantId });
  if (sub && (sub.status === 'active' || sub.status === 'past_due')) throw new TrialError(409, 'Tu taller ya tiene un plan activo.');
  if (sub && isCardlessTrial(sub) && trialState(sub, now).state === 'trial') return { ok: true, already: true, ...trialState(sub, now) };
  if (sub?.trial_used === true) throw new TrialError(409, 'Este taller ya usó su prueba gratuita. Elige un plan para seguir enviando mensajes.');
  // One free trial per owner: other shops of the same user that already used theirs count.
  const mine = await find(db.TenantUser, { user_id: user.id, role: 'owner', active: true });
  for (const m of mine) {
    if (m.tenant_id === tenantId) continue;
    const other = await findOne(db.Subscription, { tenant_id: m.tenant_id as string });
    if (other?.trial_used === true) throw new TrialError(409, 'Ya usaste la prueba gratuita en otro de tus talleres. Elige un plan.');
  }

  const row = {
    plan: 'starter', status: 'trialing', trial_start: now.toISOString(), trial_end: new Date(now.getTime() + TRIAL_DAYS * DAY).toISOString(),
    trial_used: true, cancel_at_period_end: false,
  };
  if (sub) await db.Subscription.update(sub.id, row); else await db.Subscription.create({ tenant_id: tenantId, ...row });
  await db.Tenant.update(tenantId, { plan: 'starter', status: 'active' });
  return { ok: true, already: false, ...trialState({ id: '', ...row } as Row, now) };
}

export type OnboardingCtx = { db: Entities; user: { id: string } | null; now?: Date };

/** Router of the `onboardingApi` function. */
export async function handleOnboarding(ctx: OnboardingCtx, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  if (!ctx.user) return { status: 401, body: { error: 'Tu sesión ha caducado. Vuelve a entrar.' } };
  try {
    switch (body.action) {
      case 'activateFreeTrial': return { status: 200, body: await activateFreeTrial(ctx.db, ctx.user, body.tenantId, ctx.now) };
      default: return { status: 501, body: { error: 'Acción no disponible.' } };
    }
  } catch (e) {
    if (e instanceof TrialError) return { status: e.status, body: { error: e.message } };
    throw e;
  }
}
