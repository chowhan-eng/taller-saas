import { describe, expect, it } from 'vitest';
import { fieldCrypto } from '../base44/shared/crypto.ts';
import { decodeCustomer, encodeCustomer, encodeUnlockCode } from '../base44/shared/customers.ts';

const fc = fieldCrypto(btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));

describe('customer storage layer', () => {
  it('stores name/phone only as ciphertext + blind index and decodes back', async () => {
    const row = await encodeCustomer(fc, 't1', { full_name: ' Juan Pérez ', phone_e164: '+34 612 345 678', wa_service_opt_in: true });
    const stored = JSON.stringify(row);
    expect(stored).not.toContain('Juan');
    expect(stored).not.toContain('612345678');
    expect(row.phone_hash).toBe(await fc.blindIndex('t1', '34612345678'));
    const back = await decodeCustomer(fc, { id: 'c1', ...row });
    expect(back.full_name).toBe('Juan Pérez');
    expect(back.phone_e164).toBe('34612345678');
    expect('phone_hash' in back).toBe(false);
  });

  it('validates before encrypting (the entity can no longer check plaintext)', async () => {
    await expect(encodeCustomer(fc, 't1', { full_name: '  ' })).rejects.toThrow();
    await expect(encodeCustomer(fc, 't1', { full_name: 'Ana', phone_e164: '12' })).rejects.toThrow();
  });

  it('encrypts device PINs', async () => {
    const pin = await encodeUnlockCode(fc, 't1', '0000');
    expect(pin).not.toContain('0000');
    expect(await fc.decryptOpt('t1', pin)).toBe('0000');
  });
});
