// OUTBOUND WhatsApp — the ONLY function that may send a message to a shop's customer.
// Port of WhatsApp Inbox Pro sendMessage (session text inside the 24 h window, approved template
// outside it, 131047 → template retry, failure logging), made multi-tenant and wrapped in:
//   1. checkWhatsappQuota()  — trial cap of 50 messages, daily cap, kill-switch (BEFORE any Meta call)
//   2. opt-out block          — a customer who sent BAJA/STOP never receives anything
//   3. encryption             — phone and text are stored only as AES-256-GCM ciphertext
import type { FieldCrypto } from './crypto.ts';
import { findOne, type Entities, type Row } from './db.ts';
import { findCustomerByPhone } from './customers.ts';
import { conversationById, ensureConversation } from './conversations.ts';
import { isWithinOpeningHours } from './hours.ts';
import { graphSend, normalizePhone, type GraphResult } from './meta.ts';
import { checkWhatsappQuota } from './waQuota.ts';

export type SendKind = 'manual' | 'auto_reply' | 'automated';
export type SendInput = {
  conversationId?: string;
  phone?: string;
  text: string;
  kind: SendKind;
  senderType?: 'agent' | 'ai_bot' | 'system';
  idempotencyKey?: string;
  template?: { name: string; lang?: string; params?: string[] };
  quotedWaMessageId?: string;
  ticketId?: string;
  category?: 'utility' | 'marketing' | 'service';
};
export type SendDeps = {
  db: Entities;
  fc: FieldCrypto;
  secret: (name: string) => string | undefined;
  fetchFn?: typeof fetch;
  now?: Date;
};
export type SendResult =
  | { ok: true; waMessageId: string; sentVia: 'session' | 'template'; conversationId: string; remainingInTrial: number | null }
  | { ok: false; reason: string; error: string; conversationId?: string };

const fail = (reason: string, error: string, conversationId?: string): SendResult => ({ ok: false, reason, error, conversationId });

export async function sendWhatsapp(deps: SendDeps, tenant: Row, input: SendInput): Promise<SendResult> {
  const { db, fc } = deps;
  const now = deps.now ?? new Date();
  const tenantId = tenant.id;
  const text = String(input.text ?? '').trim();
  if (!text && !input.template) return fail('empty', 'El mensaje está vacío.');

  // 1. Quota FIRST: trial cap (50), daily cap, kill-switch. Nothing reaches Meta if refused.
  const quota = await checkWhatsappQuota(db, tenant, now);
  if (!quota.ok) return fail(quota.reason, quota.error);

  // 2. Resolve the thread and the destination phone (decrypted only in memory).
  let conv = await conversationById(db, tenantId, input.conversationId);
  let phone = normalizePhone(input.phone);
  if (!phone && conv) phone = await fc.decryptOpt(tenantId, conv.phone_enc as string | null);
  if (!phone) return fail('no_phone', 'Sin teléfono de destino.');
  const customer = await findCustomerByPhone(db, fc, tenantId, phone);
  if (!conv) conv = (await ensureConversation(db, fc, tenantId, phone, { customerId: customer?.id ?? null })).conv;
  const conversationId = conv.id;
  const phoneHash = await fc.blindIndex(tenantId, phone);

  // 3. Opt-out (BAJA/STOP): record the blocked attempt (not counted in the quota) and stop.
  if (customer?.wa_opted_out === true) {
    await db.WhatsappLog.create({
      tenant_id: tenantId, conversation_id: conversationId, customer_id: customer.id, direction: 'outbound',
      sender_type: input.senderType ?? 'agent', status: 'blocked_opt_out', phone_hash: phoneHash,
      idempotency_key: input.idempotencyKey ?? null,
    });
    return fail('opted_out', 'Este cliente pidió la BAJA: no se le puede escribir.', conversationId);
  }

  // 4. Idempotency (no unique index in Base44: checked before sending).
  if (input.idempotencyKey && (await findOne(db.WhatsappLog, { tenant_id: tenantId, idempotency_key: input.idempotencyKey }))) {
    return fail('duplicate', 'Este aviso ya se envió.', conversationId);
  }

  // 5. Automatic notifications wait for opening hours (manual sends and AI replies to a customer who
  //    just wrote are exempt, as in WhatsApp Inbox Pro).
  if (input.kind === 'automated' && !isWithinOpeningHours(tenant.opening_hours, now)) {
    return fail('off_hours', 'Envío automático aplazado: fuera de horario.', conversationId);
  }

  // 6. Credentials: the shop's own number (Embedded Signup) with its token, or the platform token.
  const phoneNumberId = String(tenant.wa_phone_number_id ?? '');
  const token = (await fc.decryptOpt(tenantId, tenant.wa_access_token_enc as string | null)) || deps.secret('META_ACCESS_TOKEN') || '';
  if (!phoneNumberId || !token) return fail('not_connected', 'Conecta el WhatsApp del taller antes de enviar.', conversationId);

  // 7. Session text inside the 24 h window, approved template outside it.
  const windowOpen = !!conv.service_window_expires_at && Date.parse(String(conv.service_window_expires_at)) > now.getTime();
  const template = input.template
    ?? (tenant.wa_fallback_template
      ? { name: String(tenant.wa_fallback_template), lang: String(tenant.wa_fallback_template_lang || 'es_ES'), params: [text] }
      : null);
  const templatePayload = template && {
    messaging_product: 'whatsapp', to: phone, type: 'template',
    template: {
      name: template.name, language: { code: template.lang || 'es_ES' },
      ...(template.params?.length ? { components: [{ type: 'body', parameters: template.params.map((t) => ({ type: 'text', text: t })) }] } : {}),
    },
  };
  const sessionPayload = {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text',
    text: { body: text, preview_url: true },
    ...(input.quotedWaMessageId ? { context: { message_id: input.quotedWaMessageId } } : {}),
  };

  const fetchFn = deps.fetchFn ?? fetch;
  let sentVia: 'session' | 'template';
  let result: GraphResult;
  if (windowOpen && !input.template) {
    sentVia = 'session';
    result = await graphSend(fetchFn, token, phoneNumberId, sessionPayload);
    // 131047 = window actually closed on Meta's side → retry once as template (port of step 6b).
    if (!result.ok && result.errorCode === 131047 && templatePayload) {
      sentVia = 'template';
      result = await graphSend(fetchFn, token, phoneNumberId, templatePayload);
    }
  } else {
    if (!templatePayload) return fail('window_closed', 'Han pasado más de 24 h desde el último mensaje del cliente: hace falta una plantilla aprobada.', conversationId);
    sentVia = 'template';
    result = await graphSend(fetchFn, token, phoneNumberId, templatePayload);
  }

  // 8. Persist — ciphertext only. A failed send is stored too (it counts towards the quota).
  const storedText = sentVia === 'template' && template ? `[Plantilla ${template.name}] ${text}`.trim() : text;
  const stamp = now.toISOString();
  await db.WhatsappLog.create({
    tenant_id: tenantId, conversation_id: conversationId, customer_id: customer?.id ?? null,
    direction: 'outbound', sender_type: input.senderType ?? 'agent', message_type: 'text', sent_via: sentVia,
    ticket_id: input.ticketId ?? null,
    category: input.category ?? (sentVia === 'template' ? 'utility' : 'service'), template_name: sentVia === 'template' ? template?.name ?? null : null,
    to_phone_enc: await fc.encrypt(tenantId, phone), phone_hash: phoneHash,
    body_preview_enc: await fc.encryptOpt(tenantId, storedText.slice(0, 4096)),
    wa_message_id: result.id, status: result.ok ? 'sent' : 'failed',
    error_code: result.ok ? null : result.errorCode, error_title: result.ok ? null : (result.errorMessage ?? '').slice(0, 200),
    idempotency_key: input.idempotencyKey ?? null, sent_at: stamp,
  });
  if (!result.ok) {
    const why = result.networkError ? 'No se pudo conectar con WhatsApp.' : `WhatsApp rechazó el envío (${result.errorCode}).`;
    return fail(result.networkError ? 'network' : 'meta_error', why, conversationId);
  }

  await db.Conversation.update(conversationId, {
    last_message_preview_enc: await fc.encrypt(tenantId, storedText.slice(0, 100)),
    last_message_at: stamp, last_agent_message_at: stamp, unread: false,
  });
  return {
    ok: true, waMessageId: result.id as string, sentVia, conversationId,
    remainingInTrial: quota.remainingInTrial === null ? null : quota.remainingInTrial - 1,
  };
}
