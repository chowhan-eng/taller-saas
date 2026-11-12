// Conversation storage: one thread per (tenant, phone). Phone and names are ciphertext; the thread is
// found through the phone blind index. Ported from WhatsApp Inbox Pro's find-or-create resolver,
// including its re-check right before insert (near-simultaneous webhooks).
import type { FieldCrypto } from './crypto.ts';
import { find, findOne, type Entities, type Row } from './db.ts';

export async function findConversation(db: Entities, fc: FieldCrypto, tenantId: string, phone: string): Promise<Row | null> {
  const phoneHash = await fc.blindIndex(tenantId, phone);
  const rows = await find(db.Conversation, { tenant_id: tenantId, phone_hash: phoneHash }, { sort: '-last_message_at' });
  return rows[0] ?? null;
}

export async function ensureConversation(
  db: Entities, fc: FieldCrypto, tenantId: string, phone: string,
  extra: { customerId?: string | null; displayName?: string | null } = {},
): Promise<{ conv: Row; isNew: boolean }> {
  const existing = await findConversation(db, fc, tenantId, phone);
  if (existing) return { conv: existing, isNew: false };
  const again = await findConversation(db, fc, tenantId, phone);
  if (again) return { conv: again, isNew: false };
  const conv = await db.Conversation.create({
    tenant_id: tenantId,
    customer_id: extra.customerId ?? null,
    phone_enc: await fc.encrypt(tenantId, phone),
    phone_hash: await fc.blindIndex(tenantId, phone),
    customer_name_enc: await fc.encryptOpt(tenantId, extra.displayName ?? null),
    status: 'open', unread: false, unread_count: 0,
  });
  return { conv, isNew: true };
}

export async function conversationById(db: Entities, tenantId: string, id: unknown): Promise<Row | null> {
  if (typeof id !== 'string' || !id) return null;
  return findOne(db.Conversation, { id, tenant_id: tenantId });
}
