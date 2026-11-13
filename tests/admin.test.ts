// Platform admin panel: strictly admin-only (403 for every shop owner on EVERY action), KPIs, manual overrides,
// quota reset, suspension, and the Stripe sales feed.
import { describe, expect, it } from 'vitest';
import { handleAdmin, isPlatformAdmin, MONTHLY_EUR } from '../base44/shared/admin.ts';
import { billingRowFor, recordBillingEvent } from '../base44/shared/billing.ts';
import { gateModule } from '../base44/shared/modules.ts';
import { decideQuota } from '../base44/shared/waQuota.ts';
import { fakeDb } from './fakeDb.ts';

const OWNER = { email: 'PCMaticaTorrent@gmail.com', role: 'user' };
const SHOP_OWNER = { email: 'taller@ejemplo.es', role: 'user' };
const APP_ADMIN = { email: 'otro@ejemplo.es', role: 'admin' };

const ALL_ACTIONS = ['whoami', 'overview', 'tenants', 'events', 'setPlan', 'clearOverride', 'resetQuota', 'setStatus', 'audit'];

const seed = () => {
  const db = fakeDb({
  Tenant: [
    { id: 'T1', trade_name: 'Taller Uno', slug: 'uno', plan: 'starter', status: 'active' },
    { id: 'T2', trade_name: 'Taller Dos', slug: 'dos', plan: 'pro', status: 'active' },
    { id: 'T3', trade_name: 'Taller Tres', slug: 'tres', plan: 'founder', status: 'active' },
    { id: 'T4', trade_name: 'Taller Cuatro', slug: 'cuatro', plan: 'starter', status: 'active' },
    { id: 'T5', trade_name: 'Taller Cinco', slug: 'cinco', plan: 'starter', status: 'active' },
  ],
  Subscription: [
    { id: 'S1', tenant_id: 'T1', plan: 'starter', status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' },
    { id: 'S2', tenant_id: 'T2', plan: 'pro', status: 'active', stripe_customer_id: 'cus_2', stripe_subscription_id: 'sub_2' },
    { id: 'S3', tenant_id: 'T3', plan: 'founder', status: 'active', stripe_customer_id: 'cus_3', stripe_subscription_id: 'sub_3' },
    { id: 'S4', tenant_id: 'T4', plan: 'starter', status: 'trialing', trial_start: '2026-11-01T00:00:00Z' },
    { id: 'S5', tenant_id: 'T5', plan: 'pro', status: 'active', manual_override: true },
  ],
  TenantUser: [
    { id: 'u1', tenant_id: 'T1', user_id: 'x1', role: 'owner', active: true, user_email: 'uno@ejemplo.es' },
    { id: 'u2', tenant_id: 'T2', user_id: 'x2', role: 'owner', active: true, user_email: 'dos@ejemplo.es' },
    { id: 'u4', tenant_id: 'T4', user_id: 'x4', role: 'owner', active: true, user_email: 'cuatro@ejemplo.es' },
  ],
  WhatsappLog: [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, tenant_id: 'T4', direction: 'outbound', status: 'sent', created_date: '2026-11-05T10:00:00Z' })),
    { id: 'old', tenant_id: 'T4', direction: 'outbound', status: 'sent', created_date: '2026-10-20T10:00:00Z' },
  ],
  BillingEvent: [
    { id: 'e1', stripe_event_id: 'in_1:paid', kind: 'payment', tenant_id: 'T1', plan: 'starter', amount_cents: 3900, currency: 'eur', occurred_at: '2026-11-10T10:00:00Z' },
    { id: 'e2', stripe_event_id: 'in_2:paid', kind: 'payment', tenant_id: 'T2', plan: 'pro', amount_cents: 7900, currency: 'eur', occurred_at: '2026-09-01T10:00:00Z' },
    { id: 'e3', stripe_event_id: 'in_3:failed:1', kind: 'payment_failed', tenant_id: 'T1', amount_cents: 3900, currency: 'eur', occurred_at: '2026-11-11T10:00:00Z' },
  ],
  });
  // fakeDb creates a table on first access: touch them all so tests can inspect/extend `_rows` directly.
  for (const t of ['Tenant', 'Subscription', 'TenantUser', 'WhatsappLog', 'BillingEvent', 'AdminAudit']) void (db as Record<string, unknown>)[t];
  return db;
};
type Db = ReturnType<typeof seed>;
const run = (db: Db, user: { email?: string; role?: string } | null, body: Record<string, unknown>, extraEmails = '') => handleAdmin({ db, user, extraEmails, now: new Date('2026-11-12T12:00:00Z') }, body);

describe('who is a platform admin', () => {
  it('the owner address (any case), extra configured addresses and the Base44 admin role', () => {
    expect(isPlatformAdmin(OWNER)).toBe(true);
    expect(isPlatformAdmin({ email: 'socio@x.es' }, 'socio@x.es, otro@y.es')).toBe(true);
    expect(isPlatformAdmin(APP_ADMIN)).toBe(true);
  });
  it('nobody else: shop owners, no email, empty config, anonymous', () => {
    expect(isPlatformAdmin(SHOP_OWNER)).toBe(false);
    expect(isPlatformAdmin({ email: '', role: 'user' }, ',')).toBe(false);
    expect(isPlatformAdmin({ email: 'pcmaticatorrent@gmail.com.evil.es' })).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });
});

describe('403 / 401 on EVERY admin action', () => {
  it.each(ALL_ACTIONS.map((a) => [a]))('a shop owner gets 403 on %s and nothing is read or written', async (action) => {
    const db = seed();
    const before = JSON.stringify(db._rows);
    const r = await run(db, SHOP_OWNER, { action, tenantId: 'T1', plan: 'founder', status: 'suspended' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('Taller');
    expect(JSON.stringify(db._rows)).toBe(before);
  });
  it.each(ALL_ACTIONS.map((a) => [a]))('an anonymous visitor gets 401 on %s', async (action) => {
    expect((await run(seed(), null, { action })).status).toBe(401);
  });
  it('a shop owner cannot grant themselves Pro, reset their quota or reactivate their shop', async () => {
    const db = seed();
    for (const body of [{ action: 'setPlan', tenantId: 'T1', plan: 'pro' }, { action: 'resetQuota', tenantId: 'T4' }, { action: 'setStatus', tenantId: 'T1', status: 'active' }]) {
      expect((await run(db, SHOP_OWNER, body)).status).toBe(403);
    }
    expect(db._rows.Tenant.find((t) => t.id === 'T1')).toMatchObject({ plan: 'starter' });
    expect(db._rows.AdminAudit ?? []).toHaveLength(0);
  });
  it('the owner and a Base44 admin get through', async () => {
    expect((await run(seed(), OWNER, { action: 'whoami' })).status).toBe(200);
    expect((await run(seed(), APP_ADMIN, { action: 'overview' })).status).toBe(200);
  });
});

describe('KPIs', () => {
  it('counts paying shops by plan, trials and courtesy, and computes MRR from real subscriptions only', async () => {
    const o = (await run(seed(), OWNER, { action: 'overview' })).body as Record<string, any>;
    expect(o.paying).toEqual({ founder: 1, starter: 1, pro: 1, total: 3 });
    expect(o.trials).toBe(1);
    expect(o.courtesy).toBe(1);
    expect(o.mrr_eur).toBe(Math.round((39 + 79 + MONTHLY_EUR.founder) * 100) / 100);
    expect(o.arr_eur).toBe(Math.round(o.mrr_eur * 12 * 100) / 100);
  });
  it('collected cash sums paid invoices, with a 30-day window; failed payments are not cash', async () => {
    const o = (await run(seed(), OWNER, { action: 'overview' })).body as Record<string, any>;
    expect(o.collected_total_eur).toBe(118);
    expect(o.collected_30d_eur).toBe(39);
  });
  it('founder seats and live checkout holds (35 min)', async () => {
    const db = seed();
    db._rows.Subscription.push({ id: 'S9', tenant_id: 'T9', plan: 'founder', status: 'incomplete', updated_date: '2026-11-12T11:50:00Z' });
    db._rows.Subscription.push({ id: 'S8', tenant_id: 'T8', plan: 'founder', status: 'incomplete', updated_date: '2026-11-12T09:00:00Z' });
    const o = (await run(db, OWNER, { action: 'overview' })).body as Record<string, any>;
    expect(o.founder).toMatchObject({ cap: 10, taken: 2, left: 8, hold_minutes: 35 });
    expect(o.founder.holds).toEqual([{ tenant_id: 'T9', minutes_left: 25 }]);
  });
});

describe('tenants table', () => {
  it('lists owner, plan, Stripe ids and the trial WhatsApp usage against the 50 cap', async () => {
    const t = ((await run(seed(), OWNER, { action: 'tenants' })).body as { tenants: Record<string, any>[] }).tenants;
    expect(t).toHaveLength(5);
    expect(t.find((x) => x.id === 'T1')).toMatchObject({ owner_email: 'uno@ejemplo.es', plan: 'starter', sub_status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', wa_cap: null });
    expect(t.find((x) => x.id === 'T4')).toMatchObject({ trial: true, wa_sent: 7, wa_cap: 50 });
    expect(t.find((x) => x.id === 'T5')).toMatchObject({ manual_override: true });
  });
});

describe('admin actions', () => {
  it('setPlan grants Pro by hand: tenant + subscription active, flagged as courtesy, audited, and the shop gets access', async () => {
    const db = seed();
    const r = await run(db, OWNER, { action: 'setPlan', tenantId: 'T1', plan: 'pro', note: 'Amigo del taller' });
    expect(r.status).toBe(200);
    expect(db._rows.Tenant.find((t) => t.id === 'T1')).toMatchObject({ plan: 'pro', status: 'active' });
    expect(db._rows.Subscription.find((s) => s.tenant_id === 'T1')).toMatchObject({ plan: 'pro', status: 'active', manual_override: true, manual_note: 'Amigo del taller' });
    expect(db._rows.AdminAudit[0]).toMatchObject({ actor_email: 'PCMaticaTorrent@gmail.com', action: 'set_plan', tenant_id: 'T1' });
    expect(await gateModule(db, 'x1', 'T1', 'reparo')).toMatchObject({ ok: true });
  });
  it('setPlan creates the subscription when a shop has none, and rejects bad input', async () => {
    const db = seed();
    db._rows.Tenant.push({ id: 'T6', trade_name: 'Nuevo', slug: 'nuevo', plan: 'starter', status: 'onboarding' });
    expect((await run(db, OWNER, { action: 'setPlan', tenantId: 'T6', plan: 'pro' })).status).toBe(200);
    expect(db._rows.Subscription.find((s) => s.tenant_id === 'T6')).toMatchObject({ plan: 'pro', manual_override: true });
    expect((await run(db, OWNER, { action: 'setPlan', tenantId: 'T6', plan: 'gold' })).status).toBe(400);
    expect((await run(db, OWNER, { action: 'setPlan', tenantId: 'NOPE', plan: 'pro' })).status).toBe(404);
  });
  it('founder grants respect the hard cap of 10 seats', async () => {
    const db = seed();
    for (let i = 0; i < 9; i++) db._rows.Subscription.push({ id: `F${i}`, tenant_id: `TF${i}`, plan: 'founder', status: 'active' });
    expect((await run(db, OWNER, { action: 'setPlan', tenantId: 'T1', plan: 'founder' })).status).toBe(409);
    expect(db._rows.Subscription.find((s) => s.tenant_id === 'T1')).toMatchObject({ plan: 'starter' });
  });
  it('clearOverride gives control back to Stripe, only for a shop that has an override', async () => {
    const db = seed();
    expect((await run(db, OWNER, { action: 'clearOverride', tenantId: 'T1' })).status).toBe(409);
    expect((await run(db, OWNER, { action: 'clearOverride', tenantId: 'T5' })).status).toBe(200);
    expect(db._rows.Subscription.find((s) => s.tenant_id === 'T5')).toMatchObject({ manual_override: false });
  });
  it('resetQuota restarts the trial message count: only newer messages count afterwards', async () => {
    const db = seed();
    const sub = () => db._rows.Subscription.find((s) => s.tenant_id === 'T4') as Record<string, unknown>;
    const cap = Array.from({ length: 50 }, (_, i) => ({ status: 'sent', created_date: `2026-11-05T10:${String(i % 60).padStart(2, '0')}:00Z` }));
    expect(decideQuota({}, sub(), cap, new Date('2026-11-12T12:00:00Z')).ok).toBe(false);
    expect((await run(db, OWNER, { action: 'resetQuota', tenantId: 'T4' })).status).toBe(200);
    expect(decideQuota({}, sub(), cap, new Date('2026-11-12T12:30:00Z'))).toMatchObject({ ok: true, usedInTrial: 0, remainingInTrial: 50 });
    const t = ((await run(db, OWNER, { action: 'tenants' })).body as { tenants: Record<string, any>[] }).tenants.find((x) => x.id === 'T4');
    expect(t?.wa_sent).toBe(0);
  });
  it('suspend blocks every module of the shop; reactivate gives them back; bad status refused', async () => {
    const db = seed();
    expect(await gateModule(db, 'x2', 'T2', 'reparo')).toMatchObject({ ok: true });
    expect((await run(db, OWNER, { action: 'setStatus', tenantId: 'T2', status: 'suspended' })).status).toBe(200);
    expect(await gateModule(db, 'x2', 'T2', 'reparo')).toMatchObject({ ok: false, status: 402 });
    expect(await gateModule(db, 'x2', 'T2', 'whatsapp')).toMatchObject({ ok: false });
    expect((await run(db, OWNER, { action: 'setStatus', tenantId: 'T2', status: 'active' })).status).toBe(200);
    expect(await gateModule(db, 'x2', 'T2', 'reparo')).toMatchObject({ ok: true });
    expect((await run(db, OWNER, { action: 'setStatus', tenantId: 'T2', status: 'deleted' })).status).toBe(400);
    expect(((await run(db, OWNER, { action: 'audit' })).body as { audit: unknown[] }).audit.length).toBe(2);
  });
});

describe('Stripe sales feed', () => {
  const inv = (o: Record<string, unknown>) => ({ id: 'in_9', object: 'invoice', currency: 'eur', customer: 'cus_9', subscription: 'sub_9', ...o });
  it('maps payments, failed payments, upgrades and cancellations; ignores renewal noise', () => {
    expect(billingRowFor({ id: 'evt_1', type: 'invoice.paid', created: 1762900000, data: { object: inv({ amount_paid: 7900, number: 'A-001' }) } })).toMatchObject({ kind: 'payment', amount_cents: 7900, stripe_event_id: 'in_9:paid', detail: 'A-001' });
    expect(billingRowFor({ id: 'evt_2', type: 'invoice.payment_failed', data: { object: inv({ amount_due: 3900, attempt_count: 2 }) } })).toMatchObject({ kind: 'payment_failed', amount_cents: 3900, stripe_event_id: 'in_9:failed:2' });
    const sub = { id: 'sub_9', customer: 'cus_9', status: 'active', metadata: { plan: 'pro', tenant_id: 'T1' } };
    expect(billingRowFor({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: sub, previous_attributes: { metadata: { plan: 'starter' } } } })).toMatchObject({ kind: 'upgrade', detail: 'starter → pro', tenant_id: 'T1' });
    expect(billingRowFor({ id: 'evt_4', type: 'customer.subscription.updated', data: { object: { ...sub, cancel_at_period_end: true }, previous_attributes: { cancel_at_period_end: false } } })?.detail).toContain('Cancelará');
    expect(billingRowFor({ id: 'evt_5', type: 'customer.subscription.updated', data: { object: sub, previous_attributes: { current_period_end: 1 } } })).toBeNull();
    expect(billingRowFor({ id: 'evt_6', type: 'customer.subscription.deleted', data: { object: sub } })).toMatchObject({ kind: 'cancelled' });
    expect(billingRowFor({ id: 'evt_7', type: 'charge.succeeded', data: { object: {} } })).toBeNull();
  });
  it('records once (Stripe retries) and fills the shop from our subscription', async () => {
    const db = seed();
    const ev = { id: 'evt_x', type: 'invoice.paid', created: 1762900000, data: { object: inv({ id: 'in_77', amount_paid: 3900, customer: 'cus_1', subscription: 'sub_1' }) } };
    expect(await recordBillingEvent(db, ev)).toBe(true);
    expect(await recordBillingEvent(db, ev)).toBe(false);
    expect(db._rows.BillingEvent.filter((e) => e.stripe_event_id === 'in_77:paid')).toHaveLength(1);
    expect(db._rows.BillingEvent.find((e) => e.stripe_event_id === 'in_77:paid')).toMatchObject({ tenant_id: 'T1', plan: 'starter' });
  });
  it('the feed endpoint shows shop names, newest first, to the admin only', async () => {
    const db = seed();
    const ev = ((await run(db, OWNER, { action: 'events' })).body as { events: Record<string, any>[] }).events;
    expect(ev[0]).toMatchObject({ kind: 'payment_failed', shop: 'Taller Uno', amount_eur: 39 });
    expect((await run(db, SHOP_OWNER, { action: 'events' })).status).toBe(403);
  });
});
