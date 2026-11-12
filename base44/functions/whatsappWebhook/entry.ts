// Meta WhatsApp Cloud API webhook for EVERY connected shop (one Meta app, many numbers).
// Port of WhatsApp Inbox Pro whatsappWebhook: GET verification handshake, fail-closed
// X-Hub-Signature-256 check, inbound messages + delivery receipts, then the AI receptionist in the
// background for shops whose plan includes WhatsApp and whose auto-reply mode is not "off".
// Meta callback URL: https://<your-app-domain>/functions/whatsappWebhook
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets, waitUntil } from 'base44:runtime';
import { fieldCrypto } from '../../shared/crypto.ts';
import type { Entities } from '../../shared/db.ts';
import { base44InvokeLLM, makeLlm } from '../../shared/llm.ts';
import { verifyMetaSignature } from '../../shared/meta.ts';
import { entitlementsFor } from '../../shared/modules.ts';
import { runReceptionist } from '../../shared/receptionist.ts';
import { processWebhookPayload } from '../../shared/waInbound.ts';

// WhatsApp Inbox Pro (live) marks its webhook public this way; Meta calls it without a Base44 login.
export const config = { public: true };

const ok = () => Response.json({ ok: true });

export default async function (req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const verify = (secrets.get('WEBHOOK_VERIFY_TOKEN') ?? '').trim();
    if (url.searchParams.get('hub.mode') === 'subscribe' && verify && url.searchParams.get('hub.verify_token') === verify) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return ok();

  const raw = await req.text();
  if (!(await verifyMetaSignature(secrets.get('META_APP_SECRET'), raw, req.headers.get('x-hub-signature-256')))) {
    console.warn('[whatsappWebhook] signature check failed — rejected');
    return new Response('Forbidden', { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return ok(); }

  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities as unknown as Entities;
  try {
    const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));
    const secret = (n: string) => secrets.get(n);
    const outcomes = await processWebhookPayload(db, fc, body);
    const llm = makeLlm(secret, base44InvokeLLM(base44.asServiceRole));
    for (const o of outcomes) {
      if (!o.wantsReceptionist || String(o.tenant.ai_autoreply_mode ?? 'off') === 'off') continue;
      if (!entitlementsFor(o.tenant.plan, o.tenant.status).includes('whatsapp')) continue;
      waitUntil(runReceptionist({ db, fc, llm, secret }, o.tenant, o.conversationId)
        .catch((e) => console.error('[whatsappWebhook] receptionist', e)));
    }
  } catch (e) {
    // Always 200 to Meta (as the live app does) so it does not retry-storm; the error is logged.
    console.error('[whatsappWebhook] processing failed', e);
  }
  return ok();
}
