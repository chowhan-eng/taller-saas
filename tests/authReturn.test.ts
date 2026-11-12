import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '../src/pages/Auth.tsx';

const O = 'https://taller-saas-99de3b84.base44.app';

describe('safeReturnTo (no open redirect after sign-in)', () => {
  it('accepts same-origin paths from returnTo and from the SDK from_url', () => {
    expect(safeReturnTo('?returnTo=/onboarding/%3Fplan%3Dpro', O)).toBe('/onboarding/?plan=pro');
    expect(safeReturnTo(`?from_url=${encodeURIComponent(O + '/onboarding/')}`, O)).toBe('/onboarding/');
    expect(safeReturnTo('', O)).toBe('/onboarding/');
  });
  it('refuses other origins and protocol-relative tricks', () => {
    for (const bad of ['https://evil.com/x', '//evil.com', '/.//evil.com', '/\evil.com', 'javascript:alert(1)']) {
      const r = safeReturnTo(`?returnTo=${encodeURIComponent(bad)}`, O);
      expect(r.startsWith('//')).toBe(false);
      expect(new URL(r, O).origin).toBe(O); // may be a same-origin path like /evil.com, never another site
    }
  });
  it('strips bootstrap params such as access_token', () => {
    expect(safeReturnTo(`?returnTo=${encodeURIComponent('/onboarding/?access_token=abc&plan=pro')}`, O)).toBe('/onboarding/?plan=pro');
  });
});
