import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fieldCrypto } from '../base44/shared/crypto.ts';
import { encodeCustomer } from '../base44/shared/customers.ts';
import { processWebhookPayload } from '../base44/shared/waInbound.ts';
import { sendWhatsapp } from '../base44/shared/waSend.ts';
import { runReceptionist } from '../base44/shared/receptionist.ts';
import type { Row } from '../base44/shared/db.ts';
import { fakeDb } from './fakeDb.ts';

const fc = fieldCrypto(btoa(String.fromCharCode(...new Uint8Array(32).fill(5))));
const PHONE = '34612345678';
const NOW = new Date('2026-11-12T11:00:00Z'); // Thursday 12:00 Madrid
const tenant: Row = { id: 'T1', trade_name: 'Taller Ana', plan: 'starter', status: 'active', wa_phone_number_id: 'PNID1', wa_daily_cap: 250, ai_autoreply_mode: 'live', ai_min_confidence: 0.8, ai_daily_cap: 50 };
const trialSub: Row = { id: 'S1', tenant_id: 'T1', status: 'trialing', trial_start: '2026-11-05T10:00:00Z' };

const inbound = (text: string, id = 'wamid.in1') => ({
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'PNID1' },
    contacts: [{ profile: { name: 'Luis Gómez' } }],
    messages: [{ id, from: PHONE, timestamp: String(Math.floor(NOW.getTime() / 1000)), type: 'text', text: { body: text } }],
  } }] }],
});

function metaOk() {
  let n = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ messages: [{ id: `wamid.out${++n}` }] }), { status: 200 }));
}
const sentBody = (m: ReturnType<typeof metaOk>, i = 0) => JSON.parse(String(m.mock.calls[i][1]?.body));
const secret = (n: string) => (n === 'META_ACCESS_TOKEN' ? 'platform-token' : undefined);
let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  db = fakeDb({ Tenant: [tenant], Subscription: [trialSub] });
});

describe('inbound webhook processing', () => {
  it('stores the message and thread encrypted, opens the 24 h window, asks for the receptionist', async () => {
    const [o] = await processWebhookPayload(db, fc, inbound('¿Cuánto cuesta la pantalla del iPhone 13?'), NOW);
    expect(o).toMatchObject({ conversationId: expect.any(String), wantsReceptionist: true, optedOut: false });
    const dump = JSON.stringify(db._rows);
    expect(dump).not.toContain(PHONE);
    expect(dump).not.toContain('Luis');
    expect(dump).not.toContain('pantalla');
    const conv = db._rows.Conversation[0];
    expect(await fc.decrypt('T1', conv.phone_enc as string)).toBe(PHONE);
    expect(conv).toMatchObject({ unread: true, unread_count: 1, service_window_expires_at: '2026-11-13T11:00:00.000Z' });
  });

  it('ignores a duplicate delivery of the same Meta message id', async () => {
    await processWebhookPayload(db, fc, inbound('Hola'), NOW);
    expect(await processWebhookPayload(db, fc, inbound('Hola'), NOW)).toEqual([]);
    expect(db._rows.WhatsappLog).toHaveLength(1);
  });

  it('BAJA opts the customer out (creating the record); "no" does not', async () => {
    const [no] = await processWebhookPayload(db, fc, inbound('no', 'w1'), NOW);
    expect(no.optedOut).toBe(false);
    expect(db._rows.Customer ?? []).toHaveLength(0);
    const [baja] = await processWebhookPayload(db, fc, inbound('BAJA', 'w2'), NOW);
    expect(baja).toMatchObject({ optedOut: true, wantsReceptionist: false });
    expect(db._rows.Customer[0]).toMatchObject({ wa_opted_out: true });
    // …and from then on nothing can be sent to that number.
    const meta = metaOk();
    const r = await sendWhatsapp({ db, fc, secret, fetchFn: meta as unknown as typeof fetch, now: NOW }, tenant, { phone: PHONE, text: 'Oferta', kind: 'manual' });
    expect(r).toMatchObject({ ok: false, reason: 'opted_out' });
    expect(meta).not.toHaveBeenCalled();
  });

  it('ignores numbers that belong to no shop, and applies delivery receipts', async () => {
    const other = inbound('Hola');
    other.entry[0].changes[0].value.metadata.phone_number_id = 'UNKNOWN';
    expect(await processWebhookPayload(db, fc, other, NOW)).toEqual([]);
    await sendWhatsapp({ db, fc, secret, fetchFn: metaOk() as unknown as typeof fetch, now: NOW }, tenant, { phone: PHONE, text: 'x', kind: 'manual', template: { name: 'actualizacion_taller2' } });
    await processWebhookPayload(db, fc, { entry: [{ changes: [{ value: { metadata: { phone_number_id: 'PNID1' }, statuses: [{ id: 'wamid.out1', status: 'read' }] } }] }] }, NOW);
    expect(db._rows.WhatsappLog.find((r) => r.wa_message_id === 'wamid.out1')?.status).toBe('read');
  });
});

describe('outbound send', () => {
  it('sends session text inside the window and stores only ciphertext', async () => {
    await processWebhookPayload(db, fc, inbound('Hola'), NOW);
    const meta = metaOk();
    const r = await sendWhatsapp({ db, fc, secret, fetchFn: meta as unknown as typeof fetch, now: NOW }, tenant, { conversationId: db._rows.Conversation[0].id, text: 'Ya está listo tu móvil', kind: 'manual' });
    expect(r).toMatchObject({ ok: true, sentVia: 'session', remainingInTrial: 49 });
    expect(sentBody(meta)).toMatchObject({ to: PHONE, type: 'text', text: { body: 'Ya está listo tu móvil' } });
    const out = db._rows.WhatsappLog.find((x) => x.direction === 'outbound')!;
    expect(JSON.stringify(out)).not.toContain(PHONE);
    expect(JSON.stringify(out)).not.toContain('listo');
    expect(await fc.decrypt('T1', out.body_preview_enc as string)).toBe('Ya está listo tu móvil');
  });

  it('enforces the 50-message trial cap BEFORE calling Meta', async () => {
    const used: Row[] = Array.from({ length: 50 }, (_, i) => ({ id: `L${i}`, tenant_id: 'T1', direction: 'outbound', status: 'sent', created_date: '2026-11-10T10:00:00Z' }));
    db = fakeDb({ Tenant: [tenant], Subscription: [trialSub], WhatsappLog: used });
    const meta = metaOk();
    const r = await sendWhatsapp({ db, fc, secret, fetchFn: meta as unknown as typeof fetch, now: NOW }, tenant, { phone: PHONE, text: 'Hola', kind: 'manual' });
    expect(r).toMatchObject({ ok: false, reason: 'trial_cap' });
    expect(meta).not.toHaveBeenCalled();
    expect(db._rows.WhatsappLog).toHaveLength(50);
  });

  it('never writes to a customer already marked opted-out', async () => {
    const row = await encodeCustomer(fc, 'T1', { full_name: 'Luis', phone_e164: PHONE });
    db = fakeDb({ Tenant: [tenant], Subscription: [], Customer: [{ id: 'C1', ...row, wa_opted_out: true }] });
    const meta = metaOk();
    const r = await sendWhatsapp({ db, fc, secret, fetchFn: meta as unknown as typeof fetch, now: NOW }, tenant, { phone: PHONE, text: 'Oferta', kind: 'manual' });
    expect(r).toMatchObject({ ok: false, reason: 'opted_out' });
    expect(meta).not.toHaveBeenCalled();
    expect(db._rows.WhatsappLog[0]).toMatchObject({ status: 'blocked_opt_out' });
  });

  it('outside the 24 h window: refuses without a template, uses the shop fallback template when set', async () => {
    const meta = metaOk();
    const deps = { db, fc, secret, fetchFn: meta as unknown as typeof fetch, now: NOW };
    expect(await sendWhatsapp(deps, tenant, { phone: PHONE, text: 'Hola', kind: 'manual' })).toMatchObject({ ok: false, reason: 'window_closed' });
    const withTpl: Row = { ...tenant, wa_fallback_template: 'actualizacion_taller2' };
    expect(await sendWhatsapp(deps, withTpl, { phone: PHONE, text: 'Tu reparación está lista', kind: 'manual' })).toMatchObject({ ok: true, sentVia: 'template' });
    expect(sentBody(meta).template).toMatchObject({ name: 'actualizacion_taller2', components: [{ parameters: [{ text: 'Tu reparación está lista' }] }] });
  });

  it('refuses when the shop has no WhatsApp connected', async () => {
    const r = await sendWhatsapp({ db, fc, secret, fetchFn: metaOk() as unknown as typeof fetch, now: NOW }, { ...tenant, wa_phone_number_id: '' }, { phone: PHONE, text: 'Hola', kind: 'manual' });
    expect(r).toMatchObject({ ok: false, reason: 'not_connected' });
  });
});

describe('AI receptionist end to end', () => {
  it('drafts from the decrypted transcript, sends through the quota, logs without text', async () => {
    db = fakeDb({
      Tenant: [tenant], Subscription: [trialSub],
      PriceItem: [{ id: 'P1', tenant_id: 'T1', active: true, brand: 'Apple', model: 'iPhone 13', service: 'Cambio pantalla', price_eur: 109, price_is_from: true }],
    });
    const [o] = await processWebhookPayload(db, fc, inbound('¿Precio pantalla iPhone 13?'), NOW);
    let seenPrompt = '';
    const llm = async (p: string) => { seenPrompt = p; return 'Desde 109 €, Luis. ¿Te lo dejamos hoy?\nCONFIDENCE: 0.9\nREQUIRES_HUMAN: false\nCATEGORY: pricing\nSUMMARY: precio'; };
    const meta = metaOk();
    const r = await runReceptionist({ db, fc, llm, secret, fetchFn: meta as unknown as typeof fetch, now: NOW }, tenant, o.conversationId);
    expect(r).toMatchObject({ ok: true, decision: 'sent' });
    expect(seenPrompt).toContain('Luis Gómez: ¿Precio pantalla iPhone 13?');
    expect(seenPrompt).toContain('desde 109 €');
    expect(sentBody(meta).text.body).toBe('Desde 109 €, Luis. ¿Te lo dejamos hoy?');
    expect(db._rows.WhatsappLog.find((x) => x.direction === 'outbound')).toMatchObject({ sender_type: 'ai_bot' });
    const log = db._rows.AutoReplyLog[0];
    expect(log).toMatchObject({ decision: 'sent', category: 'pricing' });
    expect(JSON.stringify(log)).not.toContain('109');
  });

  it('a complaint is drafted but blocked (not sent)', async () => {
    const [o] = await processWebhookPayload(db, fc, inbound('Me habéis roto el móvil'), NOW);
    const meta = metaOk();
    const llm = async () => 'Lo sentimos mucho, te llama el técnico.\nCONFIDENCE: 0.95\nREQUIRES_HUMAN: true\nCATEGORY: complaint\nSUMMARY: queja';
    const r = await runReceptionist({ db, fc, llm, secret, fetchFn: meta as unknown as typeof fetch, now: NOW }, tenant, o.conversationId);
    expect(r).toMatchObject({ ok: true, decision: 'blocked' });
    expect(meta).not.toHaveBeenCalled();
  });

  it('when the trial cap is hit, the live reply is blocked and logged as send_failed', async () => {
    const used: Row[] = Array.from({ length: 50 }, (_, i) => ({ id: `L${i}`, tenant_id: 'T1', direction: 'outbound', status: 'sent', created_date: '2026-11-10T10:00:00Z' }));
    db = fakeDb({ Tenant: [tenant], Subscription: [trialSub], WhatsappLog: used });
    const [o] = await processWebhookPayload(db, fc, inbound('¿Abrís el sábado?'), NOW);
    const meta = metaOk();
    const llm = async () => 'Sí, de 10:00 a 14:00.\nCONFIDENCE: 0.95\nREQUIRES_HUMAN: false\nCATEGORY: faq\nSUMMARY: horario';
    const r = await runReceptionist({ db, fc, llm, secret, fetchFn: meta as unknown as typeof fetch, now: NOW }, tenant, o.conversationId);
    expect(r).toMatchObject({ ok: true, decision: 'blocked', reasons: ['send_failed:trial_cap'] });
    expect(meta).not.toHaveBeenCalled();
  });
});
