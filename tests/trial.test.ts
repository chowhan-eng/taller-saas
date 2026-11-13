// Cardless 14-day Starter trial: activation rules, the 14-day window, the 50-message cap, and the guardrail that
// blocks outbound WhatsApp (no Meta call) once the trial has expired without a Stripe subscription.
import { describe, expect, it, vi } from 'vitest';
import { fieldCrypto } from '../base44/shared/crypto.ts';
import type { Row } from '../base44/shared/db.ts';
import { activateFreeTrial, handleOnboarding, trialState } from '../base44/shared/trial.ts';
import { checkWhatsappQuota, decideQuota, TRIAL_DAYS, TRIAL_WA_CAP } from '../base44/shared/waQuota.ts';
import { countFounderSeats } from '../base44/shared/founder.ts';
import { sendWhatsapp } from '../base44/shared/waSend.ts';
import { gateModule } from '../base44/shared/modules.ts';
import { handleAdmin } from '../base44/shared/admin.ts';
import { fakeDb } from './fakeDb.ts';

const fc = fieldCrypto(btoa(String.fromCharCode(...new Uint8Array(32).fill(6))));
const NOW = new Date('2026-11-12T11:00:00Z');
const DAY = 864e5;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

const seed = (extra: Record<string, Row[]> = {}) => {
  const db = fakeDb({
    Tenant: [
      { id: 'T1', trade_name: 'Taller Uno', slug: 'uno', plan: 'starter', status: 'onboarding', dpa_accepted_at: '2026-11-12T10:00:00Z', wa_phone_number_id: 'PN1', wa_daily_cap: 250 },
      { id: 'T2', trade_name: 'Taller Dos', slug: 'dos', plan: 'starter', status: 'onboarding', dpa_accepted_at: '2026-11-12T10:00:00Z' },
      { id: 'T3', trade_name: 'Sin DPA', slug: 'tres', plan: 'starter', status: 'onboarding' },
    ],
    Subscription: [
      { id: 'S1', tenant_id: 'T1', plan: 'starter', status: 'incomplete' }, { id: 'S2', tenant_id: 'T2', plan: 'starter', status: 'incomplete' }, { id: 'S3', tenant_id: 'T3', plan: 'starter', status: 'incomplete' },
    ],
    TenantUser: [
      { id: 'm1', tenant_id: 'T1', user_id: 'ana', role: 'owner', active: true }, { id: 'm2', tenant_id: 'T1', user_id: 'tec', role: 'technician', active: true },
      { id: 'm3', tenant_id: 'T2', user_id: 'ana', role: 'owner', active: true }, { id: 'm4', tenant_id: 'T3', user_id: 'bea', role: 'owner', active: true },
    ],
    ...extra,
  });
  for (const t of ['Tenant', 'Subscription', 'TenantUser', 'WhatsappLog']) void (db as Record<string, unknown>)[t];
  return db;
};
const sub = (db: ReturnType<typeof seed>, tenant: string) => db._rows.Subscription.find((s) => s.tenant_id === tenant) as Row;
const tenantRow = (db: ReturnType<typeof seed>, id: string) => db._rows.Tenant.find((t) => t.id === id) as Row;

describe('activateFreeTrial (no card, no Stripe)', () => {
  it('turns the shop into starter / trialing with a 14-day window and marks the trial as used', async () => {
    const db = seed();
    const r = await handleOnboarding({ db, user: { id: 'ana' }, now: NOW }, { action: 'activateFreeTrial', tenantId: 'T1' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, already: false, state: 'trial', cardless: true, days_left: 14, wa_cap: 50 });
    expect(sub(db, 'T1')).toMatchObject({ plan: 'starter', status: 'trialing', trial_used: true, trial_start: NOW.toISOString(), trial_end: at(TRIAL_DAYS).toISOString() });
    expect(tenantRow(db, 'T1')).toMatchObject({ plan: 'starter', status: 'active' });
    expect(sub(db, 'T1').stripe_subscription_id).toBeUndefined();
    expect(JSON.stringify(db._rows)).not.toMatch(/stripe/i);
  });

  it('gives access to WhatsApp (not Reparo/TPV) and activates the 50-message cap', async () => {
    const db = seed();
    await activateFreeTrial(db, { id: 'ana' }, 'T1', NOW);
    expect(await gateModule(db, 'ana', 'T1', 'whatsapp')).toMatchObject({ ok: true });
    expect(await gateModule(db, 'ana', 'T1', 'reparo')).toMatchObject({ ok: false, status: 402 });
    expect(await checkWhatsappQuota(db, tenantRow(db, 'T1'), NOW)).toMatchObject({ ok: true, trial: true, usedInTrial: 0, remainingInTrial: TRIAL_WA_CAP });
    const used = Array.from({ length: TRIAL_WA_CAP }, () => ({ status: 'sent', created_date: NOW.toISOString() }));
    expect(decideQuota(tenantRow(db, 'T1'), sub(db, 'T1'), used, at(1))).toMatchObject({ ok: false, reason: 'trial_cap' });
  });

  it('a double click returns the running trial and does not restart the clock', async () => {
    const db = seed();
    await activateFreeTrial(db, { id: 'ana' }, 'T1', NOW);
    const again = await activateFreeTrial(db, { id: 'ana' }, 'T1', at(3));
    expect(again).toMatchObject({ already: true, state: 'trial', days_left: 11 });
    expect(sub(db, 'T1').trial_end).toBe(at(TRIAL_DAYS).toISOString());
  });

  it('only the owner can start it; anonymous gets 401; strangers and technicians 403', async () => {
    const db = seed();
    const run = (userId: string | null, tenantId = 'T1') => handleOnboarding({ db, user: userId ? { id: userId } : null, now: NOW }, { action: 'activateFreeTrial', tenantId });
    expect((await run(null)).status).toBe(401);
    expect((await run('tec')).status).toBe(403);
    expect((await run('bea')).status).toBe(403);
    expect((await run('ana', 'NOPE')).status).toBe(403);
    expect(sub(db, 'T1').status).toBe('incomplete');
    expect(tenantRow(db, 'T1').status).toBe('onboarding');
  });

  it('needs the RGPD processor contract, refuses suspended shops and unknown actions', async () => {
    const db = seed();
    expect((await handleOnboarding({ db, user: { id: 'bea' }, now: NOW }, { action: 'activateFreeTrial', tenantId: 'T3' })).status).toBe(400);
    tenantRow(db, 'T1').status = 'suspended';
    expect((await handleOnboarding({ db, user: { id: 'ana' }, now: NOW }, { action: 'activateFreeTrial', tenantId: 'T1' })).status).toBe(403);
    expect((await handleOnboarding({ db, user: { id: 'ana' }, now: NOW }, { action: 'nope' })).status).toBe(501);
  });

  it('one free trial per shop and per owner; paying shops do not need it', async () => {
    const db = seed();
    await activateFreeTrial(db, { id: 'ana' }, 'T1', NOW);
    // the same user's second shop cannot start another trial
    await expect(activateFreeTrial(db, { id: 'ana' }, 'T2', at(1))).rejects.toMatchObject({ status: 409 });
    expect(sub(db, 'T2').status).toBe('incomplete');
    // an expired trial cannot be restarted
    await expect(activateFreeTrial(db, { id: 'ana' }, 'T1', at(30))).rejects.toMatchObject({ status: 409 });
    // a paying shop
    Object.assign(sub(db, 'T3'), { status: 'active' });
    tenantRow(db, 'T3').dpa_accepted_at = '2026-11-12T10:00:00Z';
    await expect(activateFreeTrial(db, { id: 'bea' }, 'T3', NOW)).rejects.toMatchObject({ status: 409 });
  });
});

describe('14-day expiration', () => {
  const trial = (end: string, extra: Partial<Row> = {}) => ({ id: 'S', tenant_id: 'T1', plan: 'starter', status: 'trialing', trial_start: NOW.toISOString(), trial_end: end, trial_used: true, ...extra }) as Row;

  it('day 13 still sends; from day 14 on it is refused with a prompt to upgrade', () => {
    const s = trial(at(TRIAL_DAYS).toISOString());
    expect(decideQuota({}, s, [], at(13))).toMatchObject({ ok: true, trial: true });
    const expired = decideQuota({}, s, [], at(TRIAL_DAYS));
    expect(expired).toMatchObject({ ok: false, reason: 'trial_expired' });
    expect((expired as { error: string }).error).toMatch(/14 días/);
    expect((expired as { error: string }).error).toMatch(/\/dashboard/);
    expect((expired as { error: string }).error).toMatch(/\/onboarding/);
    expect(decideQuota({}, s, [], at(60))).toMatchObject({ ok: false, reason: 'trial_expired' });
  });

  it('a shop that subscribed through Stripe is not stopped by the clock', () => {
    expect(decideQuota({}, trial(at(1).toISOString(), { stripe_subscription_id: 'sub_1' }), [], at(40))).toMatchObject({ ok: true });
    expect(decideQuota({}, trial(at(1).toISOString(), { status: 'active', stripe_subscription_id: 'sub_1' }), [], at(40))).toMatchObject({ ok: true, trial: false });
  });

  it('upgrading after expiry (Stripe makes the subscription active) unblocks sending', async () => {
    const db = seed();
    await activateFreeTrial(db, { id: 'ana' }, 'T1', NOW);
    expect(await checkWhatsappQuota(db, tenantRow(db, 'T1'), at(15))).toMatchObject({ ok: false, reason: 'trial_expired' });
    Object.assign(sub(db, 'T1'), { status: 'active', stripe_subscription_id: 'sub_9', trial_start: null, trial_end: null });
    expect(await checkWhatsappQuota(db, tenantRow(db, 'T1'), at(15))).toMatchObject({ ok: true, trial: false });
  });

  it('no plan at all (never started the trial, abandoned checkout, cancelled, unpaid) cannot send either', () => {
    for (const status of ['incomplete', 'cancelled', 'unpaid']) {
      expect(decideQuota({}, { id: 'S', status }, [], NOW)).toMatchObject({ ok: false, reason: 'no_plan' });
    }
    expect(decideQuota({}, { id: 'S', status: 'past_due' }, [], NOW)).toMatchObject({ ok: true });
  });

  it('sendWhatsapp refuses BEFORE calling Meta and writes nothing', async () => {
    const db = seed();
    await activateFreeTrial(db, { id: 'ana' }, 'T1', NOW);
    const meta = vi.fn(async (..._a: unknown[]) => new Response('{}'));
    const secret = (n: string) => (n === 'META_ACCESS_TOKEN' ? 'tok' : undefined);
    const r = await sendWhatsapp({ db, fc, secret, fetchFn: meta as unknown as typeof fetch, now: at(15) }, tenantRow(db, 'T1'), { phone: '34612345678', text: 'Hola', kind: 'manual' });
    expect(r).toMatchObject({ ok: false, reason: 'trial_expired' });
    expect(meta).not.toHaveBeenCalled();
    expect(db._rows.WhatsappLog).toHaveLength(0);
    const day13 = await sendWhatsapp({ db, fc, secret, fetchFn: vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'w1' }] }))) as unknown as typeof fetch, now: at(13) }, tenantRow(db, 'T1'), { phone: '34612345678', text: 'Hola', kind: 'manual' });
    // Day 13 passes the quota check (the trial is still running); it only stops later, at the 24 h window rule.
    expect(day13).toMatchObject({ ok: false, reason: 'window_closed' });
  });

  it('trialState reports days left and expiry', () => {
    expect(trialState(trial(at(5).toISOString()), NOW)).toMatchObject({ state: 'trial', days_left: 5, cardless: true });
    expect(trialState(trial(at(0.2).toISOString()), NOW)).toMatchObject({ state: 'trial', days_left: 1 });
    expect(trialState(trial(at(-1).toISOString()), NOW)).toMatchObject({ state: 'expired', days_left: 0 });
    expect(trialState(trial(at(-1).toISOString(), { stripe_subscription_id: 'sub_1' }), NOW).state).toBe('trial');
    expect(trialState({ id: 'S', status: 'active' } as Row, NOW).state).toBe('none');
    expect(trialState(null, NOW).state).toBe('none');
  });
});

describe('a founder checkout does not destroy a running free trial', () => {
  const NOWMS = NOW.getTime();
  it('a hold reserves the seat for 35 minutes without touching plan or status', () => {
    const subs: Row[] = [{ id: 's', tenant_id: 'T1', plan: 'starter', status: 'trialing', founder_hold_at: new Date(NOWMS - 10 * 60e3).toISOString() }];
    expect(countFounderSeats(subs, NOWMS)).toEqual({ cap: 10, taken: 1, left: 9 });
    expect(countFounderSeats(subs, NOWMS + 30 * 60e3).left).toBe(10); // 40 min after: released
    expect(countFounderSeats(subs, NOWMS, 'T1').left).toBe(10); // the shop never blocks itself
  });
  it('a paid founder with an old hold is counted once', () => {
    const subs: Row[] = [{ id: 's', tenant_id: 'T1', plan: 'founder', status: 'active', founder_hold_at: new Date(NOWMS - 60e3).toISOString() }];
    expect(countFounderSeats(subs, NOWMS).taken).toBe(1);
  });
});

describe('admin panel with cardless trials', () => {
  it('counts running trials, separates expired ones and shows days left', async () => {
    const db = seed();
    await activateFreeTrial(db, { id: 'ana' }, 'T1', NOW);
    Object.assign(sub(db, 'T3'), { status: 'trialing', trial_start: at(-20).toISOString(), trial_end: at(-6).toISOString(), trial_used: true });
    const user = { email: 'pcmaticatorrent@gmail.com', role: 'user' };
    const o = (await handleAdmin({ db, user, now: at(2) }, { action: 'overview' })).body as Record<string, number>;
    expect(o.trials).toBe(1);
    expect(o.expired_trials).toBe(1);
    const t = ((await handleAdmin({ db, user, now: at(2) }, { action: 'tenants' })).body as { tenants: Record<string, unknown>[] }).tenants;
    expect(t.find((x) => x.id === 'T1')).toMatchObject({ trial: true, trial_expired: false, days_left: 12 });
    expect(t.find((x) => x.id === 'T3')).toMatchObject({ trial: true, trial_expired: true });
  });
});
