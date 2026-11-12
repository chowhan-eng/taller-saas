import { describe, expect, it } from 'vitest';
import { toSpanishMobile } from '../base44/shared/phone.ts';

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
