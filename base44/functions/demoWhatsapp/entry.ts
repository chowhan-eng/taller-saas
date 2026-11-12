// Port of web/app/api/demo/whatsapp/route.ts — the 5-Second Live WhatsApp Simulator.
// Public (no login): called with plain fetch from the landing page; all DB access via asServiceRole.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, parseTs, withJsonErrors } from '../../shared/http.ts';
import { cleanIp, toSpanishMobile } from '../../shared/phone.ts';
import { scheduleVoiceCallback } from '../../shared/sales.ts';
import type { Entities } from '../../shared/db.ts';

const CONSENT_VERSION = 'demo-v1-2026-11';
const MAX_PER_PHONE_24H = 1;
const MAX_PER_IP_1H = 3;
const MAX_GLOBAL_24H = 200;

async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = secrets.get('TURNSTILE_SECRET');
  // Production REQUIRES Turnstile. Only an explicit dev flag skips it (never set DEV_SKIP_TURNSTILE in production).
  if (!secret) return secrets.get('DEV_SKIP_TURNSTILE') === 'true';
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = (await r.json().catch(() => ({}))) as { success?: boolean };
  return data.success === true;
}

async function sendDemoTemplate(to: string, shopName: string) {
  const phoneId = secrets.get('DEMO_PHONE_NUMBER_ID');
  const token = secrets.get('DEMO_WA_TOKEN');
  if (!phoneId || !token) return { ok: false, id: null as string | null, error: 'demo WhatsApp not configured' };
  const r = await fetch(`https://graph.facebook.com/v23.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: secrets.get('DEMO_TEMPLATE_NAME') ?? 'demo_taller_listo',
        language: { code: 'es' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: shopName }] }],
      },
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  const id = data.messages?.[0]?.id ?? null;
  return { ok: !!id, id, error: id ? null : data.error?.message ?? `HTTP ${r.status}` };
}

function alertFounder(text: string) {
  const url = secrets.get('FOUNDER_ALERT_WEBHOOK');
  if (!url) return;
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
}

export default withJsonErrors('demoWhatsapp', async (req) => {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'Petición no válida' }, 400);
  }
  if (!payload || typeof payload !== 'object') return json({ ok: false, error: 'Petición no válida' }, 400);
  const ip = cleanIp(req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for'));

  // 1. Bot check
  if (!(await verifyTurnstile(String(payload.turnstileToken ?? ''), ip))) {
    return json({ ok: false, error: 'Verificación fallida. Recarga la página e inténtalo de nuevo.' }, 400);
  }
  // 2. Explicit consent for the single demo message
  if (payload.consentDemo !== true) {
    return json({ ok: false, error: 'Marca la casilla para recibir el WhatsApp de demostración.' }, 400);
  }
  // 3. Spanish mobile only
  const to = toSpanishMobile(String(payload.phone ?? ''));
  if (!to) return json({ ok: false, error: 'Introduce un móvil español (empieza por 6 o 7).' }, 400);
  const shopName = String(payload.shop ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) || 'tu taller';
  const consentCall = payload.consentCall === true;

  const db = createClientFromRequest(req).asServiceRole.entities as unknown as Entities;

  // 4. Rate limits + do-not-contact (no unique indexes in Base44: counted from recent rows)
  const now = Date.now();
  const since24h = now - 24 * 3600e3;
  const since1h = now - 3600e3;
  const [byPhone, byIp, recent, leads] = await Promise.all([
    db.DemoRequest.filter({ phone_e164: to }, '-created_date', MAX_PER_PHONE_24H + 1),
    ip ? db.DemoRequest.filter({ ip }, '-created_date', MAX_PER_IP_1H + 1) : Promise.resolve([]),
    db.DemoRequest.list('-created_date', MAX_GLOBAL_24H + 1),
    db.Lead.filter({ phone_e164: to }, 'created_date', 1),
  ]);
  const existing = leads[0] ?? null;
  const within = (rows: { created_date?: string }[], since: number) => rows.filter((r) => parseTs(r.created_date) >= since).length;
  if (existing?.do_not_contact) return json({ ok: true, note: 'Este número pidió no recibir mensajes. No te enviaremos nada.' });
  if (within(byPhone, since24h) >= MAX_PER_PHONE_24H) return json({ ok: true, note: 'Ya te lo enviamos hoy: mira tu WhatsApp 😉' });
  if (within(byIp, since1h) >= MAX_PER_IP_1H) return json({ ok: false, error: 'Demasiados intentos. Prueba dentro de un rato.' }, 429);
  if (within(recent, since24h) >= MAX_GLOBAL_24H) return json({ ok: false, error: 'Hoy hemos llegado al límite de demos. Vuelve mañana.' }, 429);

  // 5. Hot lead with consent record (never downgrade an earlier call consent)
  const leadRow: Record<string, unknown> = {
    phone_e164: to, phone_kind: 'mobile', shop_name: shopName, source: 'web_simulator', stage: 'hot',
    consent_whatsapp_demo: true, consent_text_version: CONSENT_VERSION, consent_at: new Date(now).toISOString(), consent_ip: ip,
  };
  if (consentCall) leadRow.consent_commercial_call = true;
  let leadId: string;
  try {
    if (existing) {
      await db.Lead.update(existing.id, leadRow);
      leadId = existing.id;
    } else {
      leadId = (await db.Lead.create(leadRow)).id;
    }
  } catch (e) {
    console.error('lead upsert', e);
    return json({ ok: false, error: 'No hemos podido registrar la demo. Inténtalo en unos minutos.' }, 500);
  }

  const dr = await db.DemoRequest.create({
    lead_id: leadId, phone_e164: to, ip, user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null, turnstile_ok: true,
  }).catch((e) => { console.error('demo_request insert', e); return null; });

  // 6. Send the demo template
  const sent = await sendDemoTemplate(to, shopName);
  if (dr) await db.DemoRequest.update(dr.id, { wa_message_id: sent.id, status: sent.ok ? 'sent' : 'failed' });

  // 7. Founder alert
  alertFounder(`🔥 Demo ${sent.ok ? 'enviada' : 'FALLIDA'}: ${shopName} · +${to} · llamada: ${consentCall ? 'SÍ' : 'no'}${sent.ok ? '' : ` · ${sent.error}`}`);

  // 8. Consented voice callback. scheduleVoiceCallback refuses without consent.
  if (consentCall && sent.ok) {
    await scheduleVoiceCallback(db, leadId, 5).catch((e) => console.error('schedule_voice_callback', e));
  }

  if (!sent.ok) return json({ ok: false, error: 'No hemos podido enviarlo ahora. Te escribimos en unos minutos.' }, 502);
  return json({ ok: true });
});
