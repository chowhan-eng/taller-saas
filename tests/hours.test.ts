import { describe, expect, it } from 'vitest';
import { isWithinOpeningHours } from '../base44/shared/hours.ts';

// 2026-11-12 is a Thursday (Madrid = UTC+1); 2026-07-01 is a Wednesday (UTC+2).
const shop = { thu: [['10:00', '14:00'], ['17:00', '20:30']], sun: [] };

describe('isWithinOpeningHours (Europe/Madrid, per-shop table)', () => {
  it('uses the shop table', () => {
    expect(isWithinOpeningHours(shop, new Date('2026-11-12T09:30:00Z'))).toBe(true);  // 10:30
    expect(isWithinOpeningHours(shop, new Date('2026-11-12T14:00:00Z'))).toBe(false); // 15:00 lunch
    expect(isWithinOpeningHours(shop, new Date('2026-11-12T19:29:00Z'))).toBe(true);  // 20:29
    expect(isWithinOpeningHours(shop, new Date('2026-11-12T19:30:00Z'))).toBe(false); // 20:30 closed
    expect(isWithinOpeningHours(shop, new Date('2026-11-15T10:00:00Z'))).toBe(false); // Sunday
  });
  it('falls back to the WhatsApp Inbox Pro default schedule, DST-safe', () => {
    expect(isWithinOpeningHours(null, new Date('2026-07-01T07:45:00Z'))).toBe(true);  // 09:45 summer
    expect(isWithinOpeningHours(null, new Date('2026-07-01T07:15:00Z'))).toBe(false); // 09:15 summer
  });
});
