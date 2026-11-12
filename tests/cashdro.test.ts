import { describe, expect, it } from 'vitest';
import { confirmPayoutByHand, isLocked, settlePayout, settleSale } from '../src/lib/cashdroSettle.ts';
import { isValidLanIp } from '../src/lib/cashdro.ts';

describe('CashDro sale outcome', () => {
  it('paid only when not cancelled and inserted ≥ price', () => {
    expect(settleSale({ id: 'op1', insertedCents: 2000, returnedCents: 500 }, 1500)).toMatchObject({ kind: 'done', insertedCents: 2000 });
    expect(settleSale({ id: 'op1', canceled: true, insertedCents: 1000, returnedCents: 1000 }, 1500)).toMatchObject({ kind: 'aborted', message: expect.stringContaining('10,00 €') });
    expect(settleSale({ id: 'op1', insertedCents: 0, returnedCents: 0 }, 1500)).toMatchObject({ kind: 'aborted', message: expect.stringContaining('No se ha cobrado nada') });
  });
});

describe('CashDro payout outcome (machine counters win over a zero totalout)', () => {
  const base = { operationId: 'op2', amountCents: 5000 };
  it('counters say 50 € left the machine even though the operation reports 0', () => {
    expect(settlePayout({ ...base, beforeCents: 100000, afterCents: 95000, reportedCents: 0, canceled: false })).toMatchObject({ kind: 'done', dispensedCents: 5000, shortCents: 0, source: 'contadores de la CashDro' });
  });
  it('falls back to the operation figure, short payouts are reported', () => {
    expect(settlePayout({ ...base, beforeCents: null, afterCents: null, reportedCents: 3000, canceled: false })).toMatchObject({ kind: 'done', dispensedCents: 3000, shortCents: 2000 });
  });
  it('nothing came out only when the counters prove it; otherwise a human confirms', () => {
    expect(settlePayout({ ...base, beforeCents: 1000, afterCents: 1000, reportedCents: 0, canceled: true })).toMatchObject({ kind: 'aborted' });
    expect(settlePayout({ ...base, beforeCents: null, afterCents: null, reportedCents: 0, canceled: true })).toEqual({ kind: 'confirm', operationId: 'op2' });
    expect(confirmPayoutByHand('op2', 0, 5000)).toMatchObject({ kind: 'aborted' });
    expect(confirmPayoutByHand('op2', 7000, 5000)).toMatchObject({ kind: 'done', dispensedCents: 5000 });
  });
  it('locked phases and LAN IPs', () => {
    expect(isLocked('running')).toBe(true);
    expect(isLocked('failed')).toBe(false);
    expect(isValidLanIp('192.168.1.24')).toBe(true);
    expect(isValidLanIp('8.8.8.8')).toBe(false);
  });
});
