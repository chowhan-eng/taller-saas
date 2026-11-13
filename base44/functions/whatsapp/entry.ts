// Module: WhatsApp Pro (Starter + Pro). Gated router. All sends go through shared/waSend.ts
// (quota → opt-out → encryption); all AI drafts through shared/receptionist.ts.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, withJsonErrors } from '../../shared/http.ts';
import { gateModule } from '../../shared/modules.ts';
import { checkWhatsappQuota } from '../../shared/waQuota.ts';
import { fieldCrypto } from '../../shared/crypto.ts';
import { conversationById, findConversation } from '../../shared/conversations.ts';
import { findCustomerByPhone } from '../../shared/customers.ts';
import { isProActive } from '../../shared/modules.ts';
import { base44InvokeLLM, makeLlm } from '../../shared/llm.ts';
import { BLOCKED_CATEGORIES, CATEGORIES, runReceptionist } from '../../shared/receptionist.ts';
import { sendWhatsapp } from '../../shared/waSend.ts';
import { find, findOne, type Entities } from '../../shared/db.ts';

type Body = {
  tenantId?: string; action?: string; conversationId?: string; phone?: string; text?: string;
  quotedWaMessageId?: string; agentInput?: string; paused?: boolean; mode?: string; limit?: number;
  settings?: Record<string, unknown>;
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
        opening_hours: tenant.opening_hours ?? null, ai_min_confidence: tenant.ai_min_confidence ?? 0.8, ai_daily_cap: tenant.ai_daily_cap ?? 50,
        ai_persona_prompt: tenant.ai_persona_prompt ?? '', wa_daily_cap: tenant.wa_daily_cap ?? 250,
        ai_blocked_categories: Array.isArray(tenant.ai_blocked_categories) ? tenant.ai_blocked_categories : [],
        built_in_blocked_categories: BLOCKED_CATEGORIES, categories: CATEGORIES,
      });
    case 'saveSettings': {
      // Receptionist rules, opening hours, caps, review link. Owner/admin only; every field is validated.
      if (gate.role !== 'owner' && gate.role !== 'admin') return json({ error: 'Solo el titular o un administrador pueden cambiarlo.' }, 403);
      const patch: Record<string, unknown> = {};
      const s = (body.settings ?? {}) as Record<string, unknown>;
      if ('ai_min_confidence' in s) {
        const v = Number(s.ai_min_confidence);
        if (!(v >= 0 && v <= 1)) return json({ error: 'La confianza mínima va de 0 a 1.' }, 400);
        patch.ai_min_confidence = Math.round(v * 100) / 100;
      }
      for (const [k, max] of [['ai_daily_cap', 1000], ['wa_daily_cap', 5000]] as const) {
        if (k in s) {
          const v = Math.floor(Number(s[k]));
          if (!(v >= 0 && v <= max)) return json({ error: 'Límite diario no válido.' }, 400);
          patch[k] = v;
        }
      }
      if ('ai_persona_prompt' in s) patch.ai_persona_prompt = String(s.ai_persona_prompt ?? '').slice(0, 2000);
      if ('google_review_url' in s) {
        const u = String(s.google_review_url ?? '').trim();
        if (u && !/^https:\/\//i.test(u)) return json({ error: 'El enlace de reseñas debe empezar por https://' }, 400);
        patch.google_review_url = u.slice(0, 500) || null;
      }
      if ('ai_blocked_categories' in s) {
        const list = Array.isArray(s.ai_blocked_categories) ? s.ai_blocked_categories.map(String) : [];
        patch.ai_blocked_categories = list.filter((c) => (CATEGORIES as readonly string[]).includes(c) && !BLOCKED_CATEGORIES.includes(c));
      }
      if ('opening_hours' in s) {
        const oh = s.opening_hours as Record<string, unknown>;
        const clean: Record<string, [string, string][]> = {};
        for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
          const ranges = Array.isArray(oh?.[d]) ? (oh[d] as unknown[]) : [];
          clean[d] = ranges.slice(0, 3).map((r): [string, string] => (Array.isArray(r) ? [String(r[0]), String(r[1])] : ['', '']))
            .filter(([a, b]) => /^([01]\d|2[0-3]):[0-5]\d$/.test(a) && /^([01]\d|2[0-3]):[0-5]\d$/.test(b) && a < b);
        }
        patch.opening_hours = clean;
      }
      await db.Tenant.update(tenant.id, patch);
      return json({ ok: true });
    }
    case 'setPaused': {
      // Emergency stop: nothing leaves the shop's WhatsApp (manual, automatic or AI) while paused.
      if (gate.role !== 'owner' && gate.role !== 'admin') return json({ error: 'Solo el titular o un administrador pueden cambiarlo.' }, 403);
      await db.Tenant.update(tenant.id, { wa_paused: body.paused === true });
      return json({ ok: true, wa_paused: body.paused === true });
    }
    case 'aiLog': {
      // Decision log of the receptionist: never contains message text, only the decision and why.
      const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));
      const rows = await find(db.AutoReplyLog, { tenant_id: tenant.id }, { sort: '-created_date', limit: Math.min(200, Number(body.limit) || 100) });
      const names = new Map<string, string | null>();
      const log = [];
      for (const l of rows) {
        const cid = String(l.conversation_id ?? '');
        if (!names.has(cid)) {
          const c = cid ? await conversationById(db, tenant.id, cid) : null;
          names.set(cid, c ? (await fc.decryptOpt(tenant.id, c.customer_name_enc as string | null)) || (await fc.decryptOpt(tenant.id, c.phone_enc as string | null)) : null);
        }
        log.push({ id: l.id, created_date: l.created_date, conversation_id: cid, customer: names.get(cid), mode: l.mode_at_time, decision: l.decision,
          reasons: l.decision_reasons ?? [], category: l.category, confidence: l.confidence });
      }
      return json({ log });
    }
    case 'openByPhone': {
      // Deep link from Reparo: a ticket's phone → that customer's conversation (or null if they never wrote).
      const phone = String(body.phone ?? '').replace(/\D/g, '');
      if (!phone) return json({ conversationId: null });
      const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));
      const conv = await findConversation(db, fc, tenant.id, phone);
      return json({ conversationId: conv?.id ?? null });
    }
    case 'customerContext': {
      // Right-hand panel: the customer and (Pro only) their repairs. Tickets stay behind the Pro gate.
      const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));
      const conv = await conversationById(db, tenant.id, body.conversationId);
      if (!conv) return json({ error: 'Conversación no encontrada' }, 404);
      const phone = await fc.decryptOpt(tenant.id, conv.phone_enc as string | null);
      const customer = phone ? await findCustomerByPhone(db, fc, tenant.id, phone) : null;
      const pro = await isProActive(db, tenant);
      const tickets = [];
      if (customer && pro) {
        for (const t of await find(db.RepairTicket, { tenant_id: tenant.id, customer_id: customer.id }, { sort: '-created_date', limit: 10 })) {
          tickets.push({ id: t.id, ticket_number: t.ticket_number, status: t.status, device_type: t.device_type, brand: t.brand, model: t.model,
            budget_status: t.budget_status, budget_amount_eur: t.budget_amount_eur, created_date: t.created_date });
        }
      }
      return json({
        customer: customer ? { id: customer.id, name: await fc.decrypt(tenant.id, customer.full_name_enc as string), email: customer.email ?? null,
          wa_opted_out: customer.wa_opted_out === true, wa_service_opt_in: customer.wa_service_opt_in === true, notes: customer.notes ?? null } : null,
        tickets, pro,
        ai: { draft: await fc.decryptOpt(tenant.id, conv.ai_draft_enc as string | null), confidence: conv.ai_confidence ?? null,
          requires_human: conv.ai_requires_human === true, category: conv.ai_category ?? null, processed_at: conv.ai_processed_at ?? null },
      });
    }
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
          window_expires_at: c.service_window_expires_at ?? null, ai_requires_human: c.ai_requires_human === true, has_draft: !!c.ai_draft_enc,
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
      return json({ messages, draft: await fc.decryptOpt(tenant.id, conv.ai_draft_enc as string | null),
        draft_confidence: conv.ai_confidence ?? null, draft_category: conv.ai_category ?? null, draft_requires_human: conv.ai_requires_human === true,
        window_expires_at: conv.service_window_expires_at ?? null });
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
