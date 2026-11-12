/**
 * Application-level field encryption for shop-customer PII (names, phones, device PINs).
 *
 * - AES-256-GCM (authenticated). Random 96-bit IV per value. Format: "v1:<iv b64>:<ciphertext+tag b64>".
 * - One 32-byte master key in the Base44 secret FIELD_ENCRYPTION_KEY (base64). It never reaches the browser
 *   and is never stored in an entity.
 * - Per-tenant keys derived with HKDF-SHA256 (info = tenant id), and the tenant id is bound as AAD, so a
 *   ciphertext copied into another tenant's row fails to decrypt instead of leaking.
 * - Blind index: HMAC-SHA256 with a separate per-tenant key, so functions can look a customer up by phone
 *   (BAJA opt-out, dedupe) without the phone ever being stored in clear.
 *
 * What this protects against: a dump/export of the database, Base44 dashboard/entity browsing, and
 * backups. What it does NOT protect against: code running in our backend functions with the secret —
 * those must decrypt to send WhatsApp messages. See docs/07 §4.
 *
 * Pure WebCrypto: runs unchanged in Base44's Deno runtime and in Node 20+ (tests).
 */
const VERSION = 'v1';
const SALT = new TextEncoder().encode('taller-saas/field-crypto/v1');
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
/** Backed by a plain ArrayBuffer (what WebCrypto's BufferSource type requires in Deno). */
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

export type FieldCrypto = {
  encrypt(tenantId: string, plaintext: string): Promise<string>;
  decrypt(tenantId: string, value: string): Promise<string>;
  /** Encrypt when there is a value; keep null/empty as null (optional fields). */
  encryptOpt(tenantId: string, plaintext: string | null | undefined): Promise<string | null>;
  decryptOpt(tenantId: string, value: string | null | undefined): Promise<string | null>;
  blindIndex(tenantId: string, normalized: string): Promise<string>;
};

export function fieldCrypto(masterKeyB64: string | undefined): FieldCrypto {
  if (!masterKeyB64) throw new Error('FIELD_ENCRYPTION_KEY is not set');
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = unb64(masterKeyB64.trim());
  } catch {
    throw new Error('FIELD_ENCRYPTION_KEY must be base64');
  }
  if (raw.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)');

  const master = crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const cache = new Map<string, Promise<CryptoKey>>();

  function derive(purpose: 'enc' | 'idx', tenantId: string): Promise<CryptoKey> {
    if (!tenantId) throw new Error('tenantId required');
    const k = `${purpose}:${tenantId}`;
    let p = cache.get(k);
    if (!p) {
      p = master.then((m) =>
        crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(k) },
          m,
          purpose === 'enc' ? { name: 'AES-GCM', length: 256 } : { name: 'HMAC', hash: 'SHA-256', length: 256 },
          false,
          purpose === 'enc' ? ['encrypt', 'decrypt'] : ['sign'],
        ),
      );
      cache.set(k, p);
    }
    return p;
  }

  const api: FieldCrypto = {
    async encrypt(tenantId, plaintext) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: enc.encode(tenantId) },
        await derive('enc', tenantId),
        enc.encode(plaintext),
      );
      return `${VERSION}:${b64(iv)}:${b64(new Uint8Array(ct))}`;
    },
    async decrypt(tenantId, value) {
      const [v, ivB64, ctB64] = value.split(':');
      if (v !== VERSION || !ivB64 || !ctB64) throw new Error('Unsupported ciphertext format');
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: unb64(ivB64), additionalData: enc.encode(tenantId) },
        await derive('enc', tenantId),
        unb64(ctB64),
      );
      return dec.decode(pt);
    },
    async encryptOpt(tenantId, plaintext) {
      return plaintext ? api.encrypt(tenantId, plaintext) : null;
    },
    async decryptOpt(tenantId, value) {
      return value ? api.decrypt(tenantId, value) : null;
    },
    async blindIndex(tenantId, normalized) {
      return hex(await crypto.subtle.sign('HMAC', await derive('idx', tenantId), enc.encode(normalized)));
    },
  };
  return api;
}
