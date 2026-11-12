import { describe, expect, it } from 'vitest';
import { countFounderSeats, FOUNDER_CAP } from '../base44/shared/founder.ts';
import { entitlementsFor, gateModule, isProActive } from '../base44/shared/modules.ts';
import { fakeDb } from './fakeDb.ts';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const sub = (i: number, status: string, minutesAgo = 0, plan = 'founder') =>
  ({ id: `s${i}`, tenant_id: `t${i}`, plan, status, updated_date: new Date(NOW - minutesAgo * 60e3).toISOString() });

describe('founder seats (hard cap of 10)', () => {
  it('counts paid founders and checkouts in progress, not expired ones or other plans', () => {
    const subs = [sub(1, 'active'), sub(2, 'past_due'), sub(3, 'incomplete', 5), sub(4, 'incomplete', 60), sub(5, 'cancelled'), sub(6, 'active', 0, 'pro')];
    expect(countFounderSeats(subs, NOW)).toEqual({ cap: 10, taken: 3, left: 7 });
  });
  it('is full at 10 and never reports a negative number', () => {
    const subs = Array.from({ length: 12 }, (_, i) => sub(i, 'active'));
    expect(countFounderSeats(subs, NOW)).toEqual({ cap: FOUNDER_CAP, taken: 10, left: 0 });
  });
  it('a shop re-trying its own checkout does not block itself', () => {
    const subs = Array.from({ length: 10 }, (_, i) => sub(i, i === 9 ? 'incomplete' : 'active', 1));
    expect(countFounderSeats(subs, NOW).left).toBe(0);
    expect(countFounderSeats(subs, NOW, 't9').left).toBe(1);
  });
});

describe('founder = Pro in every permission check', () => {
  it('entitlements', () => expect(entitlementsFor('founder', 'active')).toEqual(['whatsapp', 'reparo', 'tpv']));
  it('isProActive and the module gate', async () => {
    const db = fakeDb({
      Tenant: [{ id: 'T', plan: 'founder', status: 'active' }],
      Subscription: [{ id: 'S', tenant_id: 'T', plan: 'founder', status: 'active' }],
      TenantUser: [{ id: 'm', tenant_id: 'T', user_id: 'u', role: 'owner', active: true }],
    });
    expect(await isProActive(db, { id: 'T', plan: 'founder', status: 'active' })).toBe(true);
    for (const m of ['whatsapp', 'reparo', 'tpv'] as const) expect(await gateModule(db, 'u', 'T', m)).toMatchObject({ ok: true });
  });
});
