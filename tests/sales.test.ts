import { describe, expect, it } from 'vitest';
import { nextCallSlot } from '../base44/shared/sales.ts';
import { toSpanishMobile } from '../base44/shared/phone.ts';

// 2026-11-12 is a Thursday; Madrid is UTC+1 in November.
describe('nextCallSlot (Europe/Madrid calling hours)', () => {
  it('keeps a time inside weekday hours', () => {
    const t = new Date('2026-11-12T10:00:00Z'); // 11:00 Madrid
    expect(nextCallSlot(t)?.toISOString()).toBe(t.toISOString());
  });
  it('moves early morning to 09:00 Madrid', () => {
    expect(nextCallSlot(new Date('2026-11-12T05:00:00Z'))?.toISOString()).toBe('2026-11-12T08:00:00.000Z');
  });
  it('moves Friday night to Saturday 10:00', () => {
    expect(nextCallSlot(new Date('2026-11-13T21:00:00Z'))?.toISOString()).toBe('2026-11-14T09:00:00.000Z');
  });
  it('skips Saturday afternoon and Sunday to Monday 09:00', () => {
    expect(nextCallSlot(new Date('2026-11-14T14:00:00Z'))?.toISOString()).toBe('2026-11-16T08:00:00.000Z');
  });
  it('handles summer time (UTC+2)', () => {
    expect(nextCallSlot(new Date('2026-07-01T04:00:00Z'))?.toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });
});

describe('toSpanishMobile', () => {
  it('accepts 6xx/7xx in any common format', () => {
    expect(toSpanishMobile('612 345 678')).toBe('34612345678');
    expect(toSpanishMobile('+34 712345678')).toBe('34712345678');
    expect(toSpanishMobile('0034612345678')).toBe('34612345678');
  });
  it('rejects landlines and garbage', () => {
    expect(toSpanishMobile('961234567')).toBeNull();
    expect(toSpanishMobile('abc')).toBeNull();
    expect(toSpanishMobile('61234567')).toBeNull();
  });
});
