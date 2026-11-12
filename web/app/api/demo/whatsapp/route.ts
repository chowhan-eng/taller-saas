import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { cleanIp, toSpanishMobile } from '@/lib/phone';
import { withJsonErrors } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONSENT_VERSION = 'demo-v1-2026-11';
const MAX_PER_PHONE_24H = 1;
const MAX_PER_IP_1H = 3;
const MAX_GLOBAL_24H = 200;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production'; // dev convenience; production REQUIRES Turnstile
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = (await r.json().catch(() => ({}))) as { success?: boolean };
  return data.success === true;
}

async function sendDemoTemplate(to: string, shopName: string) {
  const phoneId = process.env.DEMO_PHONE_NUMBER_ID;
  const token = process.env.DEMO_WA_TOKEN;
  if (!phoneId || !token) return { ok: false, id: null as string | null, error: 'demo WhatsApp not configured' };
  const r = await fetch(`https://graph.facebook.com/v23.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: process.env.DEMO_TEMPLATE_NAME ?? 'demo_taller_listo',
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
  const url = process.env.FOUNDER_ALERT_WEBHOOK;
  if (!url) return;
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
}

export const POST = withJsonErrors(handle);

async function handle(req: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'Petición no válida' }, 400);
  }
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

  const db = supabaseAdmin();

  // 4. Rate limits + do-not-contact
  const since24h = new Date(Date.now() - 24 * 3600e3).toISOString();
  const since1h = new Date(Date.now() - 3600e3).toISOString();
  const [byPhone, byIp, global, existing] = await Promise.all([
    db.from('demo_requests').select('id', { count: 'exact', head: true }).eq('phone_e164', to).gte('created_at', since24h),
    ip
      ? db.from('demo_requests').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since1h)
      : Promise.resolve({ count: 0 }),
    db.from('demo_requests').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
    db.from('leads').select('id, do_not_contact').eq('phone_e164', to).maybeSingle(),
  ]);
  if (existing.data?.do_not_contact) return json({ ok: true, note: 'Este número pidió no recibir mensajes. No te enviaremos nada.' });
  if ((byPhone.count ?? 0) >= MAX_PER_PHONE_24H) return json({ ok: true, note: 'Ya te lo enviamos hoy: mira tu WhatsApp 😉' });
  if ((byIp.count ?? 0) >= MAX_PER_IP_1H) return json({ ok: false, error: 'Demasiados intentos. Prueba dentro de un rato.' }, 429);
  if ((global.count ?? 0) >= MAX_GLOBAL_24H) return json({ ok: false, error: 'Hoy hemos llegado al límite de demos. Vuelve mañana.' }, 429);

  // 5. Hot lead with consent record (never downgrade an earlier call consent)
  const now = new Date().toISOString();
  const leadRow: Record<string, unknown> = {
    phone_e164: to, phone_kind: 'mobile', shop_name: shopName, source: 'web_simulator', stage: 'hot',
    consent_whatsapp_demo: true, consent_text_version: CONSENT_VERSION, consent_at: now, consent_ip: ip,
  };
  if (consentCall) leadRow.consent_commercial_call = true;
  const { data: lead, error: leadErr } = await db.from('leads').upsert(leadRow, { onConflict: 'phone_e164' }).select('id').single();
  if (leadErr || !lead) return json({ ok: false, error: 'No hemos podido registrar la demo. Inténtalo en unos minutos.' }, 500);

  const { data: dr } = await db.from('demo_requests')
    .insert({ lead_id: lead.id, phone_e164: to, ip, user_agent: req.headers.get('user-agent')?.slice(0, 300), turnstile_ok: true })
    .select('id').single();

  // 6. Send the demo template
  const sent = await sendDemoTemplate(to, shopName);
  if (dr) await db.from('demo_requests').update({ wa_message_id: sent.id, status: sent.ok ? 'sent' : 'failed' }).eq('id', dr.id);

  // 7. Founder alert
  alertFounder(`🔥 Demo ${sent.ok ? 'enviada' : 'FALLIDA'}: ${shopName} · +${to} · llamada: ${consentCall ? 'SÍ' : 'no'}${sent.ok ? '' : ` · ${sent.error}`}`);

  // 8. Consented voice callback (002_sales_engine.sql). Refuses inside SQL without consent.
  if (consentCall && sent.ok) {
    const { error } = await db.rpc('schedule_voice_callback', { p_lead: lead.id, p_delay_minutes: 5 });
    if (error) console.error('schedule_voice_callback', error.message);
  }

  if (!sent.ok) return json({ ok: false, error: 'No hemos podido enviarlo ahora. Te escribimos en unos minutos.' }, 502);
  return json({ ok: true });
}
