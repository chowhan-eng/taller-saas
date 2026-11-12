import { describe, expect, it } from 'vitest';
import { decideQuota, TRIAL_WA_CAP } from '../base44/shared/waQuota.ts';

const now = new Date('2026-11-12T12:00:00Z');
const at = (iso: string, status = 'sent') => ({ status, created_date: iso });
const msgs = (n: number, iso: string, status = 'sent') => Array.from({ length: n }, () => at(iso, status));
const trialing = { status: 'trialing', trial_start: '2026-11-05T10:00:00Z', created_date: '2026-11-05T10:00:00Z' };
const tenant = { wa_paused: false, wa_daily_cap: 250 };

describe('WhatsApp quota', () => {
  it('trial: message 50 is allowed, the 51st is refused', () => {
    expect(decideQuota(tenant, trialing, msgs(49, '2026-11-10T10:00:00Z'), now)).toMatchObject({ ok: true, remainingInTrial: 1 });
    expect(decideQuota(tenant, trialing, msgs(TRIAL_WA_CAP, '2026-11-10T10:00:00Z'), now)).toMatchObject({ ok: false, reason: 'trial_cap' });
  });

  it('blocked attempts and pre-trial messages do not count', () => {
    const rows = [
      ...msgs(49, '2026-11-10T10:00:00Z'),
      ...msgs(10, '2026-11-10T10:00:00Z', 'blocked_opt_out'),
      ...msgs(10, '2026-11-01T10:00:00Z'),
    ];
    expect(decideQuota(tenant, trialing, rows, now)).toMatchObject({ ok: true, usedInTrial: 49 });
  });

  it('paid plans have no trial cap, only the daily cap', () => {
    const active = { status: 'active', trial_start: null, created_date: '2026-10-01T00:00:00Z' };
    expect(decideQuota(tenant, active, msgs(200, '2026-11-10T10:00:00Z'), now)).toMatchObject({ ok: true, trial: false });
    expect(decideQuota({ wa_daily_cap: 3 }, active, msgs(3, '2026-11-12T09:00:00Z'), now)).toMatchObject({ ok: false, reason: 'daily_cap' });
  });

  it('the kill-switch wins over everything', () => {
    expect(decideQuota({ wa_paused: true }, trialing, [], now)).toMatchObject({ ok: false, reason: 'paused' });
  });
});
