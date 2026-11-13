// Platform admin («Super-Admin Reseller Panel»): who may use it, the KPIs, the shop table and the manual
// overrides. Free of Base44 runtime imports so every rule is unit-tested. The ONLY gate is isPlatformAdmin():
// a shop owner — whatever their tenant role — is never an admin.
import { find, findOne, type Entities, type Row } from './db.ts';
import { activeHolds, countFounderSeats, FOUNDER_CAP, RESERVATION_MS } from './founder.ts';
import { parseTs } from './http.ts';
import { TRIAL_WA_CAP } from './waQuota.ts';
import { trialState } from './trial.ts';

/** The platform owner. More addresses can be added with the PLATFORM_ADMIN_EMAILS secret (comma separated). */
export const DEFAULT_ADMIN_EMAILS = ['pcmaticatorrent@gmail.com'];

export function isPlatformAdmin(user: { email?: string | null; role?: string | null } | null | undefined, extraEmails = ''): boolean {
  if (!user) return false;
  const allowed = [...DEFAULT_ADMIN_EMAILS, ...extraEmails.split(',')].map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = String(user.email ?? '').trim().toLowerCase();
  return (!!email && allowed.includes(email)) || user.role === 'admin';
}

/** Monthly value of each plan, in euros. Founder = 59 €/year (first year). */
export const MONTHLY_EUR: Record<string, number> = { starter: 39, pro: 79, founder: 59 / 12 };
const PAYING = ['active', 'past_due'];
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function audit(db: Entities, actorEmail: string, action: string, tenantId: string | null, detail: string) {
  await db.AdminAudit.create({ actor_email: actorEmail, action, tenant_id: tenantId, detail: detail.slice(0, 300) });
}

export async function overview(db: Entities, now = new Date()) {
  const subs = await find(db.Subscription, {});
  const real = subs.filter((s) => s.manual_override !== true);
  const byPlan = (plan: string) => real.filter((s) => s.plan === plan && PAYING.includes(String(s.status)));
  const paying = { founder: byPlan('founder').length, starter: byPlan('starter').length, pro: byPlan('pro').length };
  const trials = real.filter((s) => s.status === 'trialing' && trialState(s, now).state !== 'expired').length;
  const expiredTrials = real.filter((s) => trialState(s, now).state === 'expired').length;
  const pastDue = real.filter((s) => s.status === 'past_due').length;
  const courtesy = subs.filter((s) => s.manual_override === true).length;
  // MRR counts only subscriptions that are really paying (status active); past_due is at risk, courtesy is free.
  const mrr = r2(real.filter((s) => s.status === 'active').reduce((sum, s) => sum + (MONTHLY_EUR[String(s.plan)] ?? 0), 0));
  const events = await find(db.BillingEvent, { kind: 'payment' });
  const cutoff = now.getTime() - 30 * 864e5;
  const cash = (list: Row[]) => r2(list.filter((e) => String(e.currency ?? 'eur') === 'eur').reduce((s, e) => s + (Number(e.amount_cents) || 0), 0) / 100);
  const seats = countFounderSeats(subs, now.getTime());
  const holds = activeHolds(subs, now.getTime()).map((h) => ({ tenant_id: h.tenant_id, minutes_left: Math.max(0, Math.ceil((RESERVATION_MS - (now.getTime() - h.started)) / 60e3)) }));
  return {
    paying: { ...paying, total: paying.founder + paying.starter + paying.pro }, trials, expired_trials: expiredTrials, past_due: pastDue, courtesy,
    mrr_eur: mrr, arr_eur: r2(mrr * 12), collected_total_eur: cash(events), collected_30d_eur: cash(events.filter((e) => parseTs(e.occurred_at as string) >= cutoff)),
    founder: { cap: FOUNDER_CAP, taken: seats.taken, left: seats.left, holds, hold_minutes: RESERVATION_MS / 60e3 },
  };
}

/** Every shop with its owner, subscription, Stripe ids and WhatsApp use (trial quota where it applies). */
export async function listTenants(db: Entities, now = new Date()) {
  const [tenants, subs, owners] = await Promise.all([
    find(db.Tenant, {}, { sort: '-created_date', limit: 500 }), find(db.Subscription, {}), find(db.TenantUser, { role: 'owner', active: true }),
  ]);
  const subOf = new Map(subs.map((s) => [String(s.tenant_id), s]));
  const ownerOf = new Map(owners.map((o) => [String(o.tenant_id), o]));
  const out = [];
  for (const t of tenants) {
    const s = subOf.get(t.id);
    const ts = trialState(s, now);
    const trial = s?.status === 'trialing';
    const since = trial ? Math.max(parseTs((s?.trial_start ?? s?.created_date) as string | undefined), parseTs(s?.wa_quota_reset_at as string | undefined)) : 0;
    const logs = await find(db.WhatsappLog, { tenant_id: t.id, direction: 'outbound' });
    const sent = logs.filter((m) => ['queued', 'sent', 'delivered', 'read', 'failed'].includes(String(m.status)) && parseTs(m.created_date) >= since).length;
    out.push({
      id: t.id, trade_name: t.trade_name, slug: t.slug, owner_email: (ownerOf.get(t.id)?.user_email as string) ?? null, created_date: t.created_date,
      plan: t.plan, tenant_status: t.status, sub_status: (s?.status as string) ?? null, trial, trial_expired: ts.state === 'expired', trial_end: ts.ends_at, days_left: ts.days_left, manual_override: s?.manual_override === true, manual_note: (s?.manual_note as string) ?? null,
      stripe_customer_id: (s?.stripe_customer_id as string) ?? null, stripe_subscription_id: (s?.stripe_subscription_id as string) ?? null,
      current_period_end: (s?.current_period_end as string) ?? null, wa_sent: sent, wa_cap: trial ? TRIAL_WA_CAP : null, wa_reset_at: (s?.wa_quota_reset_at as string) ?? null,
    });
  }
  return out;
}

export class AdminError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const tenantOf = async (db: Entities, id: unknown) => {
  const t = typeof id === 'string' && id ? await findOne(db.Tenant, { id }) : null;
  if (!t) throw new AdminError(404, 'Taller no encontrado');
  return t;
};

/** Grant a plan by hand (courtesy). Stripe no longer overwrites it until the override is removed. */
export async function setPlan(db: Entities, actor: string, p: { tenantId?: unknown; plan?: unknown; note?: unknown }) {
  const plan = String(p.plan);
  if (!['starter', 'pro', 'founder'].includes(plan)) throw new AdminError(400, 'Plan no válido');
  const t = await tenantOf(db, p.tenantId);
  if (plan === 'founder') {
    const seats = countFounderSeats(await find(db.Subscription, {}), Date.now(), t.id);
    if (seats.left <= 0) throw new AdminError(409, 'Las 10 plazas de Fundador ya están cogidas.');
  }
  const note = String(p.note ?? '').trim().slice(0, 200) || 'Concedido a mano';
  const sub = await findOne(db.Subscription, { tenant_id: t.id });
  const patch = { plan, status: 'active', manual_override: true, manual_note: note };
  if (sub) await db.Subscription.update(sub.id, patch); else await db.Subscription.create({ tenant_id: t.id, ...patch });
  await db.Tenant.update(t.id, { plan, status: 'active' });
  await audit(db, actor, 'set_plan', t.id, `${String(t.plan)} → ${plan} (${note})`);
  return { ok: true, plan };
}

/** Hand control of this shop back to Stripe (the plan stays as it is until the next Stripe event). */
export async function clearOverride(db: Entities, actor: string, tenantId: unknown) {
  const t = await tenantOf(db, tenantId);
  const sub = await findOne(db.Subscription, { tenant_id: t.id });
  if (!sub || sub.manual_override !== true) throw new AdminError(409, 'Este taller no tiene un plan concedido a mano.');
  await db.Subscription.update(sub.id, { manual_override: false, manual_note: null });
  await audit(db, actor, 'clear_override', t.id, 'Vuelve a depender de Stripe');
  return { ok: true };
}

/** Trial WhatsApp quota back to zero: only messages sent from now on count. */
export async function resetQuota(db: Entities, actor: string, tenantId: unknown, now = new Date()) {
  const t = await tenantOf(db, tenantId);
  const sub = await findOne(db.Subscription, { tenant_id: t.id });
  if (!sub) throw new AdminError(409, 'Este taller no tiene suscripción.');
  await db.Subscription.update(sub.id, { wa_quota_reset_at: now.toISOString() });
  await audit(db, actor, 'reset_quota', t.id, `cuota de prueba (${TRIAL_WA_CAP}) a cero`);
  return { ok: true, reset_at: now.toISOString() };
}

export async function setStatus(db: Entities, actor: string, tenantId: unknown, status: unknown) {
  if (status !== 'suspended' && status !== 'active') throw new AdminError(400, 'Estado no válido');
  const t = await tenantOf(db, tenantId);
  await db.Tenant.update(t.id, { status });
  await audit(db, actor, status === 'suspended' ? 'suspend' : 'reactivate', t.id, `${String(t.status)} → ${status}`);
  return { ok: true, status };
}

export async function billingFeed(db: Entities, limit = 100) {
  const rows = await find(db.BillingEvent, {}, { sort: '-occurred_at', limit: Math.min(300, Math.max(1, limit)) });
  const names = new Map((await find(db.Tenant, {})).map((t) => [t.id, String(t.trade_name)]));
  return rows.map((e) => ({
    id: e.id, kind: e.kind, occurred_at: e.occurred_at, amount_eur: (Number(e.amount_cents) || 0) / 100, currency: e.currency, status: e.status, plan: e.plan,
    tenant_id: e.tenant_id, shop: e.tenant_id ? names.get(String(e.tenant_id)) ?? null : null, detail: e.detail, stripe_customer_id: e.stripe_customer_id, stripe_subscription_id: e.stripe_subscription_id,
  }));
}

export type AdminCtx = { db: Entities; user: { email?: string | null; role?: string | null } | null; extraEmails?: string; now?: Date };

/** Router. The admin check happens FIRST and nothing else runs for a non-admin: 401 anonymous, 403 anyone else. */
export async function handleAdmin(ctx: AdminCtx, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  if (!ctx.user) return { status: 401, body: { error: 'Tu sesión ha caducado. Vuelve a entrar.' } };
  if (!isPlatformAdmin(ctx.user, ctx.extraEmails)) return { status: 403, body: { error: 'Acceso restringido al titular de la plataforma.' } };
  const { db } = ctx;
  const actor = String(ctx.user.email ?? 'admin');
  try {
    switch (body.action) {
      case 'whoami': return { status: 200, body: { ok: true, email: actor } };
      case 'overview': return { status: 200, body: await overview(db, ctx.now) };
      case 'tenants': return { status: 200, body: { tenants: await listTenants(db, ctx.now) } };
      case 'events': return { status: 200, body: { events: await billingFeed(db, Number(body.limit) || 100) } };
      case 'setPlan': return { status: 200, body: await setPlan(db, actor, body) };
      case 'clearOverride': return { status: 200, body: await clearOverride(db, actor, body.tenantId) };
      case 'resetQuota': return { status: 200, body: await resetQuota(db, actor, body.tenantId, ctx.now) };
      case 'setStatus': return { status: 200, body: await setStatus(db, actor, body.tenantId, body.status) };
      case 'audit': return { status: 200, body: { audit: (await find(db.AdminAudit, {}, { sort: '-created_date', limit: 50 })).map((a) => ({ id: a.id, at: a.created_date, actor: a.actor_email, action: a.action, tenant_id: a.tenant_id, detail: a.detail })) } };
      default: return { status: 501, body: { error: 'Acción no disponible.' } };
    }
  } catch (e) {
    if (e instanceof AdminError) return { status: e.status, body: { error: e.message } };
    throw e;
  }
}
