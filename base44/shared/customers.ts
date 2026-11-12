// Storage layer for shop customers: the ONLY way customer PII is written or read.
// Plaintext exists only inside backend functions; entities hold AES-256-GCM ciphertext (crypto.ts).
import type { FieldCrypto } from './crypto.ts';
import { find, type Entities, type Row } from './db.ts';

export type CustomerInput = {
  full_name: string;
  phone_e164?: string | null;
  email?: string | null;
  dni_last4?: string | null;
  wa_service_opt_in?: boolean;
  wa_marketing_opt_in?: boolean;
  consent_source?: string | null;
  notes?: string | null;
};

const PHONE = /^[1-9][0-9]{7,14}$/;

/** Validate (the entity can no longer check plaintext) and encrypt a customer for storage. */
export async function encodeCustomer(fc: FieldCrypto, tenantId: string, c: CustomerInput) {
  const name = String(c.full_name ?? '').trim();
  if (name.length < 1 || name.length > 160) throw new Error('full_name must be 1-160 characters');
  const phone = c.phone_e164 ? String(c.phone_e164).replace(/\D/g, '') : null;
  if (phone && !PHONE.test(phone)) throw new Error('phone_e164 must be E.164 digits without +');
  const now = new Date().toISOString();
  return {
    tenant_id: tenantId,
    full_name_enc: await fc.encrypt(tenantId, name),
    phone_enc: await fc.encryptOpt(tenantId, phone),
    phone_hash: phone ? await fc.blindIndex(tenantId, phone) : null,
    email: c.email ?? null,
    dni_last4: c.dni_last4 ?? null,
    wa_service_opt_in: !!c.wa_service_opt_in,
    wa_service_opt_in_at: c.wa_service_opt_in ? now : null,
    wa_marketing_opt_in: !!c.wa_marketing_opt_in,
    wa_marketing_opt_in_at: c.wa_marketing_opt_in ? now : null,
    consent_source: c.consent_source ?? null,
    notes: c.notes ?? null,
  };
}

export async function decodeCustomer(fc: FieldCrypto, row: Row) {
  const tenantId = row.tenant_id as string;
  const { full_name_enc, phone_enc, phone_hash: _h, ...rest } = row;
  return {
    ...rest,
    full_name: await fc.decrypt(tenantId, full_name_enc as string),
    phone_e164: await fc.decryptOpt(tenantId, phone_enc as string | null),
  };
}

/** Exact-match lookup by phone via the blind index (BAJA opt-out, dedupe on create). */
export async function findCustomerByPhone(db: Entities, fc: FieldCrypto, tenantId: string, phone: string) {
  const digits = phone.replace(/\D/g, '');
  const rows = await find(db.Customer, { tenant_id: tenantId, phone_hash: await fc.blindIndex(tenantId, digits) }, { limit: 1 });
  return rows[0] ?? null;
}

/** Device PIN / unlock pattern for RepairTicket.unlock_code_enc. */
export const encodeUnlockCode = (fc: FieldCrypto, tenantId: string, code: string | null | undefined) =>
  fc.encryptOpt(tenantId, code ? String(code).trim() || null : null);
