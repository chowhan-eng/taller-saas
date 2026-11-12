import { describe, expect, it, vi } from 'vitest';
import { fieldCrypto } from '../base44/shared/crypto.ts';
import type { Row } from '../base44/shared/db.ts';
import { REPARO_ACTIONS, handleReparo } from '../base44/shared/reparoApi.ts';
import { TPV_ACTIONS, handleTpv } from '../base44/shared/tpvApi.ts';
import { isRealCode } from '../base44/shared/tickets.ts';
import { sweepNotices } from '../base44/shared/ticketNotify.ts';
import { isProActive } from '../base44/shared/modules.ts';
import { fakeDb } from './fakeDb.ts';

const fc = fieldCrypto(btoa(String.fromCharCode(...new Uint8Array(32).fill(3))));
const PHONE = '34612345678';
const pro: Row = { id: 'TP', trade_name: 'Taller Pro', plan: 'pro', status: 'active', wa_phone_number_id: 'PN', review_delay_hours: 24, google_review_url: 'https://g.page/r/x' };
const starter: Row = { id: 'TS', trade_name: 'Taller Starter', plan: 'starter', status: 'active' };
const seed = (extra: Record<string, Row[]> = {}) => fakeDb({
  Tenant: [pro, starter],
  Subscription: [{ id: 'S1', tenant_id: 'TP', plan: 'pro', status: 'active' }, { id: 'S2', tenant_id: 'TS', plan: 'starter', status: 'trialing' }],
  TenantUser: [
    { id: 'm1', tenant_id: 'TP', user_id: 'owner', role: 'owner', active: true },
    { id: 'm2', tenant_id: 'TP', user_id: 'tech', role: 'technician', active: true },
    { id: 'm3', tenant_id: 'TS', user_id: 'sowner', role: 'owner', active: true },
  ],
  ...extra,
});

describe('Pro gate on EVERY Reparo and TPV endpoint', () => {
  it.each(REPARO_ACTIONS.map((a) => [a]))('Starter is refused Reparo action %s with 402 and nothing is written', async (action) => {
    const db = seed();
    const r = await handleReparo({ db, fc, userId: 'sowner' }, { tenantId: 'TS', action, ticket: { device_type: 'movil', brand: 'X', reported_fault: 'y', customer: { full_name: 'A', phone_e164: PHONE } } });
    expect(r.status).toBe(402);
    for (const table of ['Customer', 'RepairTicket', 'TicketEvent', 'TicketCounter', 'TicketNotification']) expect(db._rows[table] ?? []).toHaveLength(0);
  });
  it.each(TPV_ACTIONS.map((a) => [a]))('Starter is refused TPV action %s with 402', async (action) => {
    const db = seed();
    const r = await handleTpv({ db, userId: 'sowner' }, { tenantId: 'TS', action, opening_float: 10, counted_cash: 1, payments: [{ method: 'cash', amount: 1 }] });
    expect(r.status).toBe(402);
    expect(db._rows.CashClosing ?? []).toHaveLength(0);
  });
  it('a Pro tenant whose subscription is not active (unpaid / cancelled / missing) is refused too', async () => {
    for (const sub of [{ plan: 'pro', status: 'unpaid' }, { plan: 'pro', status: 'cancelled' }, { plan: 'starter', status: 'active' }, null]) {
      const db = fakeDb({ Tenant: [pro], Subscription: sub ? [{ id: 'S', tenant_id: 'TP', ...sub }] : [], TenantUser: [{ id: 'm', tenant_id: 'TP', user_id: 'owner', role: 'owner', active: true }] });
      expect((await handleReparo({ db, fc, userId: 'owner' }, { tenantId: 'TP', action: 'listTickets' })).status).toBe(402);
      expect((await handleTpv({ db, userId: 'owner' }, { tenantId: 'TP', action: 'summary' })).status).toBe(402);
    }
  });
  it('past_due keeps working (Stripe grace period); technicians cannot use the cash register', async () => {
    const db = fakeDb({ Tenant: [{ ...pro, status: 'past_due' }], Subscription: [{ id: 'S', tenant_id: 'TP', plan: 'pro', status: 'past_due' }], TenantUser: [{ id: 'm', tenant_id: 'TP', user_id: 'owner', role: 'owner', active: true }, { id: 't', tenant_id: 'TP', user_id: 'tech', role: 'technician', active: true }] });
    expect((await handleReparo({ db, fc, userId: 'owner' }, { tenantId: 'TP', action: 'listTickets' })).status).toBe(200);
    expect((await handleTpv({ db, userId: 'tech' }, { tenantId: 'TP', action: 'summary' })).status).toBe(403);
    expect(await isProActive(db, { ...pro, status: 'past_due' })).toBe(true);
  });
});

describe('Reparo tickets (Pro)', () => {
  const NOW = new Date('2026-11-12T10:00:00Z');
  const create = (db: ReturnType<typeof seed>, extra: Record<string, unknown> = {}) => handleReparo({ db, fc, userId: 'owner', now: NOW }, {
    tenantId: 'TP', action: 'createTicket',
    ticket: { device_type: 'movil', brand: 'Apple', model: 'iPhone 13', serial_imei: '35 123456 789012 3', unlock_code: '1234', reported_fault: 'Pantalla rota, Luis dice que se cayó', accessories: 'funda', customer: { full_name: 'Luis Gómez', phone_e164: PHONE, wa_service_opt_in: true, wa_marketing_opt_in: true }, ...extra },
  });

  it('creates a numbered ticket; customer and ticket PII are ciphertext only', async () => {
    const db = seed();
    const r = await create(db);
    expect(r.status).toBe(200);
    const t = (r.body as { ticket: Row }).ticket;
    expect(t).toMatchObject({ ticket_number: '2026-000001', status: 'recibido', reported_fault: 'Pantalla rota, Luis dice que se cayó', serial_imei: '351234567890123', has_unlock_code: true });
    expect('unlock_code' in t).toBe(false);
    const dump = JSON.stringify(db._rows.RepairTicket) + JSON.stringify(db._rows.Customer);
    for (const secret of ['Luis', PHONE, '351234567890123', 'Pantalla rota', 'funda', '"1234"']) expect(dump).not.toContain(secret);
    expect((await create(db)).body).toMatchObject({ ticket: { ticket_number: '2026-000002' } });
    expect(db._rows.Customer).toHaveLength(1); // same phone → same customer
  });

  it('"no tiene" is not stored as a PIN; only owner/admin can reveal the code, and it is logged', async () => {
    const db = seed();
    const none = (await create(db, { unlock_code: 'no tiene' })).body as { ticket: Row };
    expect(none.ticket.has_unlock_code).toBe(false);
    expect(isRealCode('sin contraseña')).toBe(false);
    const t = ((await create(db)).body as { ticket: Row }).ticket;
    expect(await handleReparo({ db, fc, userId: 'owner' }, { tenantId: 'TP', action: 'revealUnlockCode', ticketId: t.id })).toMatchObject({ status: 200, body: { code: '1234' } });
    expect((await handleReparo({ db, fc, userId: 'tech' }, { tenantId: 'TP', action: 'revealUnlockCode', ticketId: t.id })).status).toBe(403);
    expect(db._rows.TicketEvent.some((e) => e.note === 'Contraseña del dispositivo consultada')).toBe(true);
  });

  it('status lifecycle, budget flow, IMEI lookup and tenant isolation', async () => {
    const db = seed();
    const t = ((await create(db)).body as { ticket: Row }).ticket;
    const call = (body: Record<string, unknown>, user = 'owner') => handleReparo({ db, fc, userId: user, now: NOW }, { tenantId: 'TP', ticketId: t.id, ...body });
    expect((await call({ action: 'setBudget', status: 'enviado' })).status).toBe(400); // no amount yet
    expect(await call({ action: 'setBudget', status: 'enviado', amountEur: 109 })).toMatchObject({ status: 200, body: { ticket: { status: 'presupuesto_enviado' } } });
    await call({ action: 'setBudget', status: 'aceptado' });
    await call({ action: 'setStatus', status: 'listo_recoger' });
    const d = await call({ action: 'setStatus', status: 'entregado' });
    expect(d.body).toMatchObject({ ticket: { status: 'entregado', warranty_until: '2027-02-10' } });
    expect(db._rows.TicketEvent.map((e) => e.to_status)).toEqual(['recibido', 'presupuesto_enviado', 'presupuesto_aceptado', 'listo_recoger', 'entregado']);
    expect(await call({ action: 'findBySerial', serial: '351234567890123' })).toMatchObject({ body: { tickets: [{ id: t.id }] } });
    // Another shop's user cannot see this ticket.
    expect((await handleReparo({ db, fc, userId: 'sowner' }, { tenantId: 'TP', action: 'getTicket', ticketId: t.id })).status).toBe(403);
  });

  it('auto-quote uses the shop rules and writes the budget + message', async () => {
    const db = seed({
      MarginRule: [{ id: 'mr', tenant_id: 'TP', active: true, cost_from_cents: 1000, cost_to_cents: 3000, margin_pct: 60, min_margin_cents: 1000 }],
      LaborRule: [{ id: 'lr', tenant_id: 'TP', active: true, category: 'movil', part_type: 'screen', level: 'N2', label: 'Cambio de pantalla' }],
    });
    const q = await handleReparo({ db, fc, userId: 'owner' }, { tenantId: 'TP', action: 'quote', quote: { priceCents: 2563, taxMode: 'gross', category: 'movil', partType: 'screen', partTitle: 'Pantalla iPhone 12', qualityLabel: 'Incell' } });
    expect(q.body).toMatchObject({ option: { pvp_cents: 7190, labor_label: 'Cambio de pantalla' } });
    const t = ((await create(db)).body as { ticket: Row }).ticket;
    const a = await handleReparo({ db, fc, userId: 'owner' }, { tenantId: 'TP', action: 'applyQuote', ticketId: t.id, options: [(q.body as { option: unknown }).option] });
    expect(a.body).toMatchObject({ budget_amount_eur: 71.9, message: expect.stringContaining('71,90 €') });
    expect(db._rows.RepairTicket.find((x) => x.id === t.id)).toMatchObject({ budget_amount_eur: 71.9, budget_status: 'pendiente' });
  });
});

describe('ticket WhatsApp notices (delayed, re-checked)', () => {
  const meta = () => vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({ messages: [{ id: 'wamid.t' }] }), { status: 200 }));
  const secret = (n: string) => (n === 'META_ACCESS_TOKEN' ? 'tok' : undefined);
  const t0 = new Date('2026-11-12T10:00:00Z'); // Thursday 11:00 Madrid (open)

  it('queues on creation, sends the template when due, skips a status that changed again', async () => {
    const db = seed();
    const t = ((await handleReparo({ db, fc, userId: 'owner', now: t0 }, { tenantId: 'TP', action: 'createTicket', ticket: { device_type: 'movil', brand: 'Apple', reported_fault: 'x', customer: { full_name: 'Luis', phone_e164: PHONE, wa_service_opt_in: true } } })).body as { ticket: Row }).ticket;
    expect(db._rows.TicketNotification).toHaveLength(1);
    const fetchFn = meta();
    const deps = { db, fc, secret, fetchFn: fetchFn as unknown as typeof fetch, now: new Date(t0.getTime() + 30e3) };
    expect(await sweepNotices(deps, (x) => isProActive(db, x))).toEqual([]); // not due yet (60 s)
    const due = { ...deps, now: new Date(t0.getTime() + 61e3) };
    expect(await sweepNotices(due, (x) => isProActive(db, x))).toEqual([{ id: expect.any(String), state: 'done' }]);
    const sent = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(sent.template).toMatchObject({ name: 'taller_recibido_v1', components: [{ parameters: [{ text: 'Taller Pro' }, { text: '2026-000001' }, { text: 'Apple' }] }] });
    // Two quick changes: only the latest status goes out.
    await handleReparo({ db, fc, userId: 'owner', now: t0 }, { tenantId: 'TP', action: 'setStatus', ticketId: t.id, status: 'listo_recoger' });
    await handleReparo({ db, fc, userId: 'owner', now: t0 }, { tenantId: 'TP', action: 'setStatus', ticketId: t.id, status: 'en_reparacion' });
    const res = await sweepNotices(due, (x) => isProActive(db, x));
    expect(res.map((r) => r.state)).toEqual(['skipped']);
  });

  it('no service opt-in → nothing is sent', async () => {
    const db = seed();
    await handleReparo({ db, fc, userId: 'owner', now: t0 }, { tenantId: 'TP', action: 'createTicket', ticket: { device_type: 'movil', brand: 'Apple', reported_fault: 'x', customer: { full_name: 'Ana', phone_e164: '34698765432' } } });
    const fetchFn = meta();
    const res = await sweepNotices({ db, fc, secret, fetchFn: fetchFn as unknown as typeof fetch, now: new Date(t0.getTime() + 61e3) }, (x) => isProActive(db, x));
    expect(res[0].state).toBe('skipped');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a shop that dropped to Starter gets its pending notices skipped', async () => {
    const db = seed();
    await handleReparo({ db, fc, userId: 'owner', now: t0 }, { tenantId: 'TP', action: 'createTicket', ticket: { device_type: 'movil', brand: 'Apple', reported_fault: 'x', customer: { full_name: 'Luis', phone_e164: PHONE, wa_service_opt_in: true } } });
    db._rows.Subscription[0].status = 'cancelled';
    const fetchFn = meta();
    const res = await sweepNotices({ db, fc, secret, fetchFn: fetchFn as unknown as typeof fetch, now: new Date(t0.getTime() + 61e3) }, (x) => isProActive(db, x));
    expect(res[0].state).toBe('skipped');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
