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
import type { Entities } from '../../shared/db.ts';

type Body = {
  tenantId?: string; action?: string; conversationId?: string; phone?: string; text?: string;
  quotedWaMessageId?: string; agentInput?: string; paused?: boolean;
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
      return json({
        wa_mode: tenant.wa_mode, wa_display_phone: tenant.wa_display_phone, wa_paused: tenant.wa_paused,
        wa_quality_rating: tenant.wa_quality_rating, google_review_url: tenant.google_review_url,
        review_delay_hours: tenant.review_delay_hours, ai_autoreply_mode: tenant.ai_autoreply_mode,
      });
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
