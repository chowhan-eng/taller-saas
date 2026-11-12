import { describe, expect, it } from 'vitest';
import { fieldCrypto } from '../base44/shared/crypto.ts';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const fc = fieldCrypto(KEY);

describe('fieldCrypto (AES-256-GCM)', () => {
  it('round-trips and never stores plaintext', async () => {
    const c = await fc.encrypt('tenantA', 'María López');
    expect(c).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(c).not.toContain('María');
    expect(await fc.decrypt('tenantA', c)).toBe('María López');
  });

  it('uses a fresh IV: same input encrypts differently', async () => {
    expect(await fc.encrypt('tenantA', '612345678')).not.toBe(await fc.encrypt('tenantA', '612345678'));
  });

  it("refuses to decrypt another tenant's ciphertext", async () => {
    const c = await fc.encrypt('tenantA', '34612345678');
    await expect(fc.decrypt('tenantB', c)).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const c = await fc.encrypt('tenantA', '1234');
    const [v, iv, ct] = c.split(':');
    const bytes = Uint8Array.from(atob(ct), (ch) => ch.charCodeAt(0));
    bytes[0] ^= 0x01;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(fc.decrypt('tenantA', [v, iv, tampered].join(':'))).rejects.toThrow();
  });

  it('a different master key cannot decrypt', async () => {
    const other = fieldCrypto(btoa(String.fromCharCode(...new Uint8Array(32).fill(9))));
    await expect(other.decrypt('tenantA', await fc.encrypt('tenantA', 'x'))).rejects.toThrow();
  });

  it('blind index is deterministic per tenant and differs across tenants', async () => {
    const a1 = await fc.blindIndex('tenantA', '34612345678');
    expect(a1).toMatch(/^[a-f0-9]{64}$/);
    expect(await fc.blindIndex('tenantA', '34612345678')).toBe(a1);
    expect(await fc.blindIndex('tenantB', '34612345678')).not.toBe(a1);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => fieldCrypto(btoa('short'))).toThrow(/32 bytes/);
    expect(() => fieldCrypto(undefined)).toThrow(/not set/);
  });

  it('rejects malformed ciphertext', async () => {
    await expect(fc.decrypt('tenantA', 'plaintext')).rejects.toThrow(/format/);
  });

  it('keeps empty optional values as null', async () => {
    expect(await fc.encryptOpt('tenantA', '')).toBeNull();
    expect(await fc.decryptOpt('tenantA', null)).toBeNull();
  });
});
