// AI receptionist = WhatsApp Inbox Pro generateDraft (prompt + parsing) + evaluateAutoReply (off /
// shadow / live decision, confidence, requires-human, blocked categories, daily cap, pause switches).
// Multi-tenant: persona, mode, thresholds and price list come from the shop's own Tenant/PriceItem rows.
// The draft is stored encrypted; a "live" reply is sent ONLY through sendWhatsapp() (quota + opt-out).
import { find, type Row } from './db.ts';
import { parseTs } from './http.ts';
import type { Llm } from './llm.ts';
import { sendWhatsapp, type SendDeps } from './waSend.ts';
import { madridDayStart } from './waQuota.ts';

export const CATEGORIES = ['faq', 'pricing', 'service', 'policy', 'repair_status', 'complaint', 'warranty', 'quote_negotiation', 'other'] as const;
export const BLOCKED_CATEGORIES = ['complaint', 'warranty', 'quote_negotiation', 'other'];

export type Draft = { reply: string; confidence: number; requiresHuman: boolean; summary: string; category: string };

export function buildReceptionistPrompt(p: {
  persona?: string | null; shopName: string; customerName: string; transcript: string;
  priceList?: string; openingHours?: string; agentInput?: string;
}): string {
  const persona = p.persona?.trim()
    || `Eres el asistente de atención al cliente de ${p.shopName}, un taller de reparación de móviles, ordenadores y consolas.`;
  const context = [
    p.openingHours ? `=== HORARIO ===\n${p.openingHours}` : '',
    p.priceList ? `=== TARIFAS ORIENTATIVAS ("desde") ===\n${p.priceList}` : '',
  ].filter(Boolean).join('\n\n');
  const task = p.agentInput
    ? `=== TAREA ===\nEl agente ha escrito este borrador. Mejóralo y púlelo SIN cambiar su intención ni inventar información. Mantén el idioma.\nBorrador del agente:\n"""${p.agentInput}"""\n\nConversación (contexto):\n${p.transcript}`
    : `=== TAREA ===\nGenera la mejor respuesta al último mensaje de ${p.customerName}.\nSi falta información para resolver la consulta, pide educadamente el dato necesario.\n\nConversación (últimos 20 mensajes):\n${p.transcript}`;
  return `${persona}
Respondes por WhatsApp. Tono: profesional y claro. Responde SIEMPRE en el idioma del cliente.
No inventes precios, plazos, estados de reparación ni datos que no aparezcan en el contexto proporcionado.

${context}

${task}

Devuelve SOLO el texto de la respuesta. Al final, cada uno en su propia línea, escribe:
CONFIDENCE: <número 0.0-1.0>
REQUIRES_HUMAN: <true|false>
CATEGORY: <una de: ${CATEGORIES.join(', ')}>
SUMMARY: <resumen en una frase de lo que trata>`;
}

const CONTROL = /^\s*(CONFIDENCE|REQUIRES_HUMAN|CATEGORY|SUMMARY)\s*:/i;

export function parseReceptionistOutput(raw: string): Draft | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const pick = (k: string) => text.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'im'))?.[1]?.trim();
  const reply = text.split('\n').filter((l) => !CONTROL.test(l)).join('\n').trim();
  if (!reply) return null;
  const conf = parseFloat(pick('CONFIDENCE') ?? '');
  const category = (pick('CATEGORY') ?? '').toLowerCase();
  return {
    reply,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.7, // same default as generateDraft
    requiresHuman: (pick('REQUIRES_HUMAN') ?? '').toLowerCase() === 'true',
    summary: pick('SUMMARY') ?? '',
    category: (CATEGORIES as readonly string[]).includes(category) ? category : 'other',
  };
}

export type Decision = { decision: 'sent' | 'would_send' | 'blocked'; reasons: string[] };

/** Pure port of evaluateAutoReply's allow/block rules. 'sent' means "allowed to send" in live mode. */
export function decideAutoReply(p: {
  mode: string; draft: Draft; minConfidence: number; usedToday: number; dailyCap: number;
  automationPaused: boolean; autoreplyDisabled: boolean;
}): Decision {
  if (p.autoreplyDisabled) return { decision: 'blocked', reasons: ['per_conversation_disabled'] };
  if (p.automationPaused) return { decision: 'blocked', reasons: ['automation_paused'] };
  const reasons: string[] = [];
  if (p.draft.confidence < p.minConfidence) reasons.push(`confidence_${p.draft.confidence.toFixed(2)}_below_${p.minConfidence}`);
  if (p.draft.requiresHuman) reasons.push('requires_human');
  if (BLOCKED_CATEGORIES.includes(p.draft.category)) reasons.push(`category_${p.draft.category}_blocked`);
  if (p.usedToday >= p.dailyCap) reasons.push('daily_cap_exceeded');
  if (reasons.length) return { decision: 'blocked', reasons };
  return { decision: p.mode === 'live' ? 'sent' : 'would_send', reasons: [] };
}

function hoursText(openingHours: unknown): string {
  if (!openingHours || typeof openingHours !== 'object') return '';
  const names: Record<string, string> = { mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo' };
  return Object.entries(names).map(([k, n]) => {
    const r = (openingHours as Record<string, [string, string][]>)[k];
    return `${n}: ${Array.isArray(r) && r.length ? r.map(([a, b]) => `${a}-${b}`).join(', ') : 'cerrado'}`;
  }).join('\n');
}

export type ReceptionistDeps = SendDeps & { llm: Llm };
export type ReceptionistResult =
  | { ok: true; draft: Draft; decision: Decision['decision'] | 'draft_only'; reasons: string[]; waMessageId?: string }
  | { ok: false; reason: string };

/**
 * Generate a draft for the conversation's latest customer message; unless draftOnly, decide and (live)
 * send it. Every decision is logged in AutoReplyLog WITHOUT message text.
 */
export async function runReceptionist(
  deps: ReceptionistDeps, tenant: Row, conversationId: string, opts: { draftOnly?: boolean; agentInput?: string } = {},
): Promise<ReceptionistResult> {
  const { db, fc, llm } = deps;
  const now = deps.now ?? new Date();
  const tenantId = tenant.id;
  const mode = String(tenant.ai_autoreply_mode ?? 'off');
  if (!opts.draftOnly && mode === 'off') return { ok: false, reason: 'mode_off' };

  const [conv] = await find(db.Conversation, { id: conversationId, tenant_id: tenantId }, { limit: 1 });
  if (!conv) return { ok: false, reason: 'conversation_not_found' };

  const msgs = (await find(db.WhatsappLog, { tenant_id: tenantId, conversation_id: conversationId }, { sort: '-sent_at', limit: 20 })).reverse();
  const customerName = (await fc.decryptOpt(tenantId, conv.customer_name_enc as string | null)) || 'el cliente';
  const lines: string[] = [];
  for (const m of msgs) {
    if (m.status === 'blocked_opt_out' || !m.body_preview_enc) continue;
    const who = m.sender_type === 'customer' ? customerName : m.sender_type === 'system' ? '[Sistema]' : 'Taller';
    lines.push(`${who}: ${await fc.decrypt(tenantId, m.body_preview_enc as string)}`);
  }
  if (!lines.length) return { ok: false, reason: 'no_messages' };

  const prices = await find(db.PriceItem, { tenant_id: tenantId, active: true }, { limit: 40 });
  const priceList = prices.map((p) => `${p.brand}${p.model ? ` ${p.model}` : ''} · ${p.service}: ${p.price_is_from ? 'desde ' : ''}${p.price_eur} €`).join('\n');

  const raw = await llm(buildReceptionistPrompt({
    persona: tenant.ai_persona_prompt as string | null, shopName: String(tenant.trade_name ?? 'el taller'),
    customerName, transcript: lines.join('\n'), priceList, openingHours: hoursText(tenant.opening_hours), agentInput: opts.agentInput,
  }));
  const draft = parseReceptionistOutput(raw);
  if (!draft) return { ok: false, reason: 'llm_empty' };

  await db.Conversation.update(conversationId, {
    ai_draft_enc: await fc.encrypt(tenantId, draft.reply), ai_confidence: draft.confidence,
    ai_requires_human: draft.requiresHuman, ai_category: draft.category, ai_processed_at: now.toISOString(),
  });
  if (opts.draftOnly) return { ok: true, draft, decision: 'draft_only', reasons: [] };

  // Daily cap of auto-replies (Madrid day). Fail CLOSED on any query error, like evaluateAutoReply.
  let usedToday = Number.POSITIVE_INFINITY;
  try {
    const dayStart = madridDayStart(now);
    const sentLogs = await find(db.AutoReplyLog, { tenant_id: tenantId, decision: 'sent' });
    usedToday = sentLogs.filter((l) => parseTs(l.created_date) >= dayStart).length;
  } catch { /* stays blocked */ }

  const verdict = decideAutoReply({
    mode, draft, minConfidence: Number(tenant.ai_min_confidence ?? 0.8), usedToday, dailyCap: Number(tenant.ai_daily_cap ?? 50),
    automationPaused: conv.automation_paused === true, autoreplyDisabled: conv.autoreply_disabled === true,
  });

  let reasons = verdict.reasons;
  let decision = verdict.decision;
  let waMessageId: string | undefined;
  if (decision === 'sent') {
    const sent = await sendWhatsapp(deps, tenant, { conversationId, text: draft.reply, kind: 'auto_reply', senderType: 'ai_bot' });
    if (sent.ok) waMessageId = sent.waMessageId;
    else { decision = 'blocked'; reasons = [`send_failed:${sent.reason}`]; }
  }
  await db.AutoReplyLog.create({
    tenant_id: tenantId, conversation_id: conversationId, mode_at_time: mode, decision, decision_reasons: reasons,
    category: draft.category, confidence: draft.confidence, wa_message_id: waMessageId ?? null,
  });
  return { ok: true, draft, decision, reasons, waMessageId };
}
