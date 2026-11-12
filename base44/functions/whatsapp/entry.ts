// Module: WhatsApp Pro (Starter + Pro). Gated router. All sends go through shared/waSend.ts
// (quota → opt-out → encryption); all AI drafts through shared/receptionist.ts.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, withJsonErrors } from '../../shared/http.ts';
import { gateModule } from '../../shared/modules.ts';
import { checkWhatsappQuota } from '../../shared/waQuota.ts';
import { fieldCrypto } from '../../shared/crypto.ts';
import { conversationById } from '../../shared/conversations.ts';
import { base44InvokeLLM, makeLlm } from '../../shared/llm.ts';
import { runReceptionist } from '../../shared/receptionist.ts';
import { sendWhatsapp } from '../../shared/waSend.ts';
import { find, findOne, type Entities } from '../../shared/db.ts';

type Body = {
  tenantId?: string; action?: string; conversationId?: string; phone?: string; text?: string;
  quotedWaMessageId?: string; agentInput?: string; paused?: boolean; mode?: string; limit?: number;
  phoneNumberId?: string; displayPhone?: string; accessToken?: string; fallbackTemplate?: string; fallbackLang?: string;
};

export default withJsonErrors('whatsapp', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const body = (await req.json().catch(() => ({}))) as Body;
  const db = base44.asServiceRole.entities as unknown as Entities;
  const gate = await gateModule(db, user?.id, body.tenantId, 'whatsapp');
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const tenant = gate.tenant;
  const secret = (n: string) => secrets.get(n);

  switch (body.action) {
    case 'settings':
      // Never returns the access token itself.
      return json({
        trade_name: tenant.trade_name, connected: !!tenant.wa_phone_number_id, has_token: !!tenant.wa_access_token_enc,
        wa_phone_number_id: tenant.wa_phone_number_id, wa_mode: tenant.wa_mode, wa_display_phone: tenant.wa_display_phone,
        wa_paused: tenant.wa_paused, wa_quality_rating: tenant.wa_quality_rating, google_review_url: tenant.google_review_url,
        review_delay_hours: tenant.review_delay_hours, ai_autoreply_mode: tenant.ai_autoreply_mode,
        wa_fallback_template: tenant.wa_fallback_template, wa_fallback_template_lang: tenant.wa_fallback_template_lang,
      });
    case 'listConversations': {
      const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));
      const rows = await find(db.Conversation, { tenant_id: tenant.id }, { sort: '-last_message_at', limit: Math.min(100, Number(body.limit) || 60) });
      const now = Date.now();
      const conversations = [];
      for (const c of rows) {
        conversations.push({
          id: c.id, name: await fc.decryptOpt(tenant.id, c.customer_name_enc as string | null), phone: await fc.decryptOpt(tenant.id, c.phone_enc as string | null),
          preview: await fc.decryptOpt(tenant.id, c.last_message_preview_enc as string | null), last_message_at: c.last_message_at,
          unread: c.unread === true, unread_count: Number(c.unread_count) || 0, automation_paused: c.automation_paused === true,
          window_open: !!c.service_window_expires_at && Date.parse(String(c.service_window_expires_at)) > now, status: c.status,
        });
      }
      return json({ conversations });
    }
    case 'getMessages': {
      const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));
      const conv = await conversationById(db, tenant.id, body.conversationId);
      if (!conv) return json({ error: 'Conversación no encontrada' }, 404);
      const rows = (await find(db.WhatsappLog, { tenant_id: tenant.id, conversation_id: conv.id }, { sort: '-sent_at', limit: 200 })).reverse();
      const messages = [];
      for (const m of rows) {
        messages.push({ id: m.id, direction: m.direction, sender_type: m.sender_type, status: m.status, sent_at: m.sent_at ?? m.created_date,
          message_type: m.message_type, reaction_emoji: m.reaction_emoji, body: await fc.decryptOpt(tenant.id, m.body_preview_enc as string | null) });
      }
      return json({ messages, draft: await fc.decryptOpt(tenant.id, conv.ai_draft_enc as string | null) });
    }
    case 'markRead': {
      const conv = await conversationById(db, tenant.id, body.conversationId);
      if (!conv) return json({ error: 'Conversación no encontrada' }, 404);
      await db.Conversation.update(conv.id, { unread: false, unread_count: 0 });
      return json({ ok: true });
    }
    case 'setAiMode': {
      if (gate.role !== 'owner' && gate.role !== 'admin') return json({ error: 'Solo el titular o un administrador pueden cambiarlo.' }, 403);
      if (!['off', 'shadow', 'live'].includes(String(body.mode))) return json({ error: 'Modo no válido' }, 400);
      await db.Tenant.update(tenant.id, { ai_autoreply_mode: body.mode });
      return json({ ok: true, ai_autoreply_mode: body.mode });
    }
    case 'saveConnection': {
      if (gate.role !== 'owner' && gate.role !== 'admin') return json({ error: 'Solo el titular o un administrador pueden cambiar la conexión.' }, 403);
      const phoneId = String(body.phoneNumberId ?? '').replace(/[^0-9]/g, '');
      if (phoneId.length < 6) return json({ error: 'Revisa el identificador del número (Phone number ID).' }, 400);
      // The webhook routes by this id, so it must belong to ONE shop only.
      const other = await findOne(db.Tenant, { wa_phone_number_id: phoneId });
      if (other && other.id !== tenant.id) return json({ error: 'Ese número ya está conectado a otro taller.' }, 409);
      const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));
      const token = String(body.accessToken ?? '').trim();
      await db.Tenant.update(tenant.id, {
        wa_phone_number_id: phoneId, wa_display_phone: String(body.displayPhone ?? '').trim().slice(0, 30) || null, wa_mode: 'own_number_cloud',
        wa_fallback_template: String(body.fallbackTemplate ?? '').trim().slice(0, 100) || null,
        wa_fallback_template_lang: String(body.fallbackLang ?? '').trim().slice(0, 10) || 'es_ES',
        ...(token ? { wa_access_token_enc: await fc.encrypt(tenant.id, token) } : {}),
      });
      return json({ ok: true });
    }
    case 'quota':
      return json(await checkWhatsappQuota(db, tenant));
    case 'send': {
      // Manual message from the shop's inbox. sendWhatsapp enforces the trial cap before Meta is called.
      const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));
      const r = await sendWhatsapp({ db, fc, secret }, tenant, {
        conversationId: body.conversationId, phone: body.phone, text: String(body.text ?? ''),
        kind: 'manual', senderType: 'agent', quotedWaMessageId: body.quotedWaMessageId,
      });
      if (r.ok) return json(r);
      const status = r.reason === 'trial_cap' || r.reason === 'daily_cap' ? 429 : r.reason === 'opted_out' ? 409 : 400;
      return json(r, status);
    }
    case 'draft': {
      // AI receptionist draft for the agent to review (never sent from here).
      const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));
      if (!(await conversationById(db, tenant.id, body.conversationId))) return json({ error: 'Conversación no encontrada' }, 404);
      const r = await runReceptionist({ db, fc, secret, llm: makeLlm(secret, base44InvokeLLM(base44.asServiceRole)) }, tenant, String(body.conversationId), {
        draftOnly: true, agentInput: body.agentInput,
      });
      return r.ok ? json({ draft: r.draft }) : json({ error: 'No se ha podido generar el borrador.', reason: r.reason }, 502);
    }
    case 'pause': {
      // An agent takes over (or hands back) a conversation: no bot may speak while paused.
      const conv = await conversationById(db, tenant.id, body.conversationId);
      if (!conv) return json({ error: 'Conversación no encontrada' }, 404);
      await db.Conversation.update(conv.id, { automation_paused: body.paused !== false });
      return json({ ok: true, automation_paused: body.paused !== false });
    }
    default:
      return json({ error: 'Acción no disponible todavía.' }, 501);
  }
});
