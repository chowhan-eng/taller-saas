// INBOUND WhatsApp webhook processing, ported from WhatsApp Inbox Pro whatsappWebhook:
// idempotency on the Meta message id, reactions attached to their target, find-or-create thread,
// 24 h service window, unread counters, reopen resolved/spam threads, delivery receipts, strict
// BAJA/STOP opt-out. Multi-tenant: each change is routed by metadata.phone_number_id to its Tenant.
// Everything stored about the customer is ciphertext.
import type { FieldCrypto } from './crypto.ts';
import { findOne, type Entities, type Row } from './db.ts';
import { encodeCustomer, findCustomerByPhone } from './customers.ts';
import { ensureConversation } from './conversations.ts';
import { parseInbound, type MetaMessage } from './meta.ts';
import { isOptOut } from './optout.ts';

export const DRAFT_DEBOUNCE_MS = 15_000;
const WINDOW_MS = 24 * 3600e3;
const STATUS_MAP: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };

export type InboundOutcome = { tenant: Row; conversationId: string; wantsReceptionist: boolean; optedOut: boolean };

// deno-lint-ignore no-explicit-any
type Payload = any;

export async function processWebhookPayload(db: Entities, fc: FieldCrypto, body: Payload, now = new Date()): Promise<InboundOutcome[]> {
  const outcomes: InboundOutcome[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const tenant = await findOne(db.Tenant, { wa_phone_number_id: String(phoneNumberId) });
      if (!tenant) continue; // not a connected shop (e.g. the platform demo number): ignore
      for (const msg of value.messages ?? []) {
        const out = await handleInbound(db, fc, tenant, msg, value.contacts ?? [], now);
        if (out) outcomes.push(out);
      }
      for (const st of value.statuses ?? []) await handleStatus(db, tenant, st);
    }
  }
  return outcomes;
}

async function handleInbound(db: Entities, fc: FieldCrypto, tenant: Row, msg: MetaMessage, contacts: Payload[], now: Date): Promise<InboundOutcome | null> {
  const tenantId = tenant.id;
  const m = parseInbound(msg);
  if (!m.from) return null;
  if (m.waMessageId && (await findOne(db.WhatsappLog, { tenant_id: tenantId, wa_message_id: m.waMessageId }))) return null;

  // Reaction to a message we have: update that bubble, no new row (as in WhatsApp Inbox Pro).
  if (m.reaction?.targetId) {
    const target = await findOne(db.WhatsappLog, { tenant_id: tenantId, wa_message_id: m.reaction.targetId });
    if (target) {
      await db.WhatsappLog.update(target.id, { reaction_emoji: m.reaction.emoji });
      return null;
    }
  }

  const profileName: string | null = contacts?.[0]?.profile?.name ?? null;
  const customer = await findCustomerByPhone(db, fc, tenantId, m.from);
  const { conv, isNew } = await ensureConversation(db, fc, tenantId, m.from, { customerId: customer?.id ?? null, displayName: profileName });

  const stamp = now.toISOString();
  const reopen = conv.status === 'resolved' || conv.status === 'spam';
  await db.Conversation.update(conv.id, {
    last_message_preview_enc: await fc.encrypt(tenantId, m.body.slice(0, 100)),
    last_message_at: m.sentAt, last_customer_message_at: m.sentAt,
    service_window_expires_at: new Date(now.getTime() + WINDOW_MS).toISOString(),
    unread: true, unread_count: Number(isNew ? 0 : conv.unread_count ?? 0) + 1,
    ...(reopen ? { status: 'open' } : {}),
    ...(profileName && !conv.customer_name_enc ? { customer_name_enc: await fc.encrypt(tenantId, profileName) } : {}),
    ...(customer && !conv.customer_id ? { customer_id: customer.id } : {}),
  });

  await db.WhatsappLog.create({
    tenant_id: tenantId, conversation_id: conv.id, customer_id: customer?.id ?? null,
    direction: 'inbound', sender_type: 'customer', category: 'service', message_type: m.type,
    from_phone_enc: await fc.encrypt(tenantId, m.from), phone_hash: await fc.blindIndex(tenantId, m.from),
    body_preview_enc: await fc.encrypt(tenantId, m.body.slice(0, 4096)),
    media_id: m.mediaId, media_mime: m.mediaMime, wa_message_id: m.waMessageId,
    status: 'delivered', sent_at: m.sentAt, reaction_emoji: m.reaction?.emoji ?? null,
  });

  // Strict opt-out: exactly BAJA or STOP. Creates the customer record if needed, so every later send
  // (which checks the customer by phone blind index) is blocked.
  const optedOut = m.type === 'text' && isOptOut(m.body);
  if (optedOut) {
    if (customer) {
      if (!customer.wa_opted_out) await db.Customer.update(customer.id, { wa_opted_out: true, wa_opted_out_at: stamp });
    } else {
      const row = await encodeCustomer(fc, tenantId, { full_name: profileName || `+${m.from}`, phone_e164: m.from, consent_source: 'whatsapp' });
      const created = await db.Customer.create({ ...row, wa_opted_out: true, wa_opted_out_at: stamp });
      await db.Conversation.update(conv.id, { customer_id: created.id });
    }
  }

  const recent = !!conv.ai_processed_at && now.getTime() - Date.parse(String(conv.ai_processed_at)) < DRAFT_DEBOUNCE_MS;
  const wantsReceptionist = !optedOut && m.type === 'text' && m.body.trim().length >= 2 && conv.status !== 'spam' && !recent;
  return { tenant, conversationId: conv.id, wantsReceptionist, optedOut };
}

async function handleStatus(db: Entities, tenant: Row, st: Payload) {
  const status = STATUS_MAP[String(st?.status)];
  if (!st?.id || !status) return;
  const row = await findOne(db.WhatsappLog, { tenant_id: tenant.id, wa_message_id: String(st.id) });
  if (!row) return;
  const err = Array.isArray(st.errors) ? st.errors[0] : null;
  await db.WhatsappLog.update(row.id, {
    status,
    ...(status === 'failed' && err ? { error_code: Number(err.code) || null, error_title: String(err.title ?? err.message ?? '').slice(0, 200) } : {}),
  });
}
