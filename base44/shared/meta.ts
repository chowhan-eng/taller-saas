// Meta WhatsApp Cloud API helpers, ported from WhatsApp Inbox Pro (whatsappWebhook + sendMessage).
export const GRAPH_VERSION = 'v23.0';

/** X-Hub-Signature-256 check over the RAW body. Never throws; false when anything is missing. */
export async function verifyMetaSignature(appSecret: string | undefined, rawBody: string, header: string | null): Promise<boolean> {
  if (!appSecret || !header || !header.startsWith('sha256=')) return false;
  const provided = header.slice(7).trim().toLowerCase();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
export type MetaMessage = Record<string, any>;
export type ParsedInbound = {
  waMessageId: string | null;
  from: string;
  type: string;
  body: string;
  mediaId: string | null;
  mediaMime: string | null;
  reaction: { targetId: string | null; emoji: string } | null;
  sentAt: string;
};

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

/** Turn one Meta inbound message into a readable body (same rules as WhatsApp Inbox Pro). */
export function parseInbound(msg: MetaMessage): ParsedInbound {
  const type = String(msg?.type ?? 'text');
  const ts = msg?.timestamp ? parseInt(msg.timestamp, 10) : Math.floor(Date.now() / 1000);
  const base = {
    waMessageId: (msg?.id as string | undefined) ?? null, from: String(msg?.from ?? '').replace(/\D/g, ''),
    mediaId: null as string | null, mediaMime: null as string | null, reaction: null as ParsedInbound['reaction'],
    sentAt: new Date(ts * 1000).toISOString(),
  };
  if (type === 'text') return { ...base, type, body: String(msg.text?.body ?? '') };
  if (type === 'reaction') {
    const emoji = typeof msg.reaction?.emoji === 'string' ? msg.reaction.emoji : '';
    return { ...base, type, body: emoji ? `Reaccionó con ${emoji}` : 'Quitó una reacción', reaction: { targetId: msg.reaction?.message_id ?? null, emoji } };
  }
  if (type === 'contacts') {
    // deno-lint-ignore no-explicit-any
    const lines = (Array.isArray(msg.contacts) ? msg.contacts : []).map((c: any) => {
      const name = c?.name?.formatted_name || [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' ') || 'Contacto';
      // deno-lint-ignore no-explicit-any
      const phones = Array.isArray(c?.phones) ? c.phones.map((p: any) => p?.phone).filter(Boolean) : [];
      return `👤 ${name}${phones.length ? ` — ${phones.join(', ')}` : ''}`;
    });
    return { ...base, type: 'text', body: lines.length ? `Contacto compartido:\n${lines.join('\n')}` : '[contacto compartido sin datos]' };
  }
  if (type === 'interactive') {
    const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply ?? {};
    return { ...base, type: 'text', body: String(r.title || r.id || '[respuesta interactiva]') };
  }
  if (type === 'button') return { ...base, type: 'text', body: String(msg.button?.text || msg.button?.payload || '[botón]') };
  if (MEDIA_TYPES.includes(type)) {
    const node = msg[type] ?? {};
    return { ...base, type, body: String(node.caption || `[${type}]`), mediaId: node.id ?? null, mediaMime: node.mime_type ?? null };
  }
  return { ...base, type, body: `[${type}]` };
}

/** Meta error code → retry class (port of classifyMetaError). */
export function classifyMetaError(code: unknown): 'transient' | 'hold' | 'permanent' {
  const c = parseInt(String(code), 10);
  if ([131042, 131047].includes(c)) return 'hold';
  if ([131026, 132001, 132012, 132015].includes(c)) return 'permanent';
  return 'transient';
}

export type GraphResult = { ok: boolean; id: string | null; errorCode: number | null; errorMessage: string | null; networkError: boolean };

export async function graphSend(fetchFn: typeof fetch, token: string, phoneNumberId: string, payload: unknown): Promise<GraphResult> {
  let res: Response;
  try {
    res = await fetchFn(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, id: null, errorCode: null, errorMessage: String((e as Error)?.message ?? e), networkError: true };
  }
  const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number; message?: string } };
  const id = data.messages?.[0]?.id ?? null;
  return {
    ok: res.ok && !!id, id,
    errorCode: data.error?.code ?? (res.ok ? null : res.status),
    errorMessage: data.error?.message ?? (res.ok ? null : `HTTP ${res.status}`),
    networkError: false,
  };
}

/** Spanish 9-digit numbers get the 34 prefix; everything else is digits only (as in WhatsApp Inbox Pro). */
export function normalizePhone(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9 && /^[6-9]/.test(digits)) return `34${digits}`;
  return digits;
}
