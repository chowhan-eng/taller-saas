// Backend behaviour added for the full dashboard port: configurable blocked topics, ticket search + paging,
// supplier price memory with change alerts, TPV catalogue and cierre history. All tenant-isolated.
import { describe, expect, it } from 'vitest';
import { fieldCrypto } from '../base44/shared/crypto.ts';
import type { Row } from '../base44/shared/db.ts';
import { handleReparo } from '../base44/shared/reparoApi.ts';
import { handleTpv } from '../base44/shared/tpvApi.ts';
import { decideAutoReply, BLOCKED_CATEGORIES, type Draft } from '../base44/shared/receptionist.ts';
import { fakeDb } from './fakeDb.ts';

const fc = fieldCrypto(btoa(String.fromCharCode(...new Uint8Array(32).fill(5))));
const A: Row = { id: 'TA', trade_name: 'Taller A', plan: 'pro', status: 'active' };
const B: Row = { id: 'TB', trade_name: 'Taller B', plan: 'pro', status: 'active' };
const seed = () => fakeDb({
  Tenant: [A, B],
  Subscription: [{ id: 'S1', tenant_id: 'TA', plan: 'pro', status: 'active' }, { id: 'S2', tenant_id: 'TB', plan: 'pro', status: 'active' }],
  TenantUser: [
    { id: 'm1', tenant_id: 'TA', user_id: 'owner', role: 'owner', active: true, display_name: 'Marta' },
    { id: 'm2', tenant_id: 'TA', user_id: 'counter', role: 'counter', active: true, user_email: 'caja@x.es' },
    { id: 'm3', tenant_id: 'TA', user_id: 'gone', role: 'technician', active: false },
    { id: 'm4', tenant_id: 'TB', user_id: 'bowner', role: 'owner', active: true, display_name: 'Otro' },
  ],
});

describe('AI blocked topics are configurable but the built-ins cannot be removed', () => {
  const draft: Draft = { reply: 'ok', confidence: 0.95, requiresHuman: false, summary: '', category: 'pricing' };
  const base = { mode: 'live', draft, minConfidence: 0.8, usedToday: 0, dailyCap: 50, automationPaused: false, autoreplyDisabled: false };
  it('a topic the shop adds becomes blocked', () => {
    expect(decideAutoReply(base).decision).toBe('sent');
    const r = decideAutoReply({ ...base, extraBlocked: ['pricing'] });
    expect(r).toEqual({ decision: 'blocked', reasons: ['category_pricing_blocked'] });
  });
  it('built-in categories stay blocked whatever the shop configures', () => {
    for (const category of BLOCKED_CATEGORIES) {
      expect(decideAutoReply({ ...base, draft: { ...draft, category }, extraBlocked: [] }).decision).toBe('blocked');
    }
  });
});

describe('Reparo list: search and 20-item paging', () => {
  const run = (db: ReturnType<typeof seed>, body: Record<string, unknown>, tenantId = 'TA', userId = 'owner') => handleReparo({ db, fc, userId }, { tenantId, ...body });
  async function fill(db: ReturnType<typeof seed>, n: number) {
    for (let i = 0; i < n; i++) {
      const r = await run(db, { action: 'createTicket', ticket: { device_type: 'movil', brand: i % 2 ? 'Apple' : 'Samsung', model: `Modelo ${i}`, reported_fault: 'no carga',
        customer: { full_name: `Cliente ${i}`, phone_e164: `3460000${String(1000 + i)}` } } });
      expect(r.status).toBe(200);
    }
  }
  it('pages by 20, reports the total and the per-status counts', async () => {
    const db = seed();
    await fill(db, 25);
    const p1 = (await run(db, { action: 'listTickets', limit: 20, offset: 0 })).body as { tickets: Row[]; total: number; counts: Record<string, number> };
    expect(p1.tickets).toHaveLength(20);
    expect(p1.total).toBe(25);
    expect(p1.counts.recibido).toBe(25);
    const p2 = (await run(db, { action: 'listTickets', limit: 20, offset: 20 })).body as { tickets: Row[] };
    expect(p2.tickets).toHaveLength(5);
    expect(new Set([...p1.tickets, ...p2.tickets].map((t) => t.id)).size).toBe(25);
  });
  it('search pages by 20 too, and matches name, model and phone digits', async () => {
    const db = seed();
    await fill(db, 25);
    const byBrand = (await run(db, { action: 'listTickets', q: 'apple', limit: 20 })).body as { tickets: Row[]; total: number };
    expect(byBrand.total).toBe(12);
    const byName = (await run(db, { action: 'listTickets', q: 'cliente 7' })).body as { tickets: Row[] };
    expect(byName.tickets.map((t) => t.customer_name)).toEqual(['Cliente 7']);
    const byPhone = (await run(db, { action: 'listTickets', q: '1003' })).body as { tickets: Row[] };
    expect(byPhone.tickets).toHaveLength(1);
    expect(byPhone.tickets[0].customer_phone).toBe('34600001003');
    const first = (await run(db, { action: 'listTickets', q: 'modelo', limit: 20 })).body as { tickets: Row[]; total: number };
    expect(first.total).toBe(25);
    expect(first.tickets).toHaveLength(20);
  });
  it('never returns another shop\'s tickets or team', async () => {
    const db = seed();
    await fill(db, 3);
    expect(((await run(db, { action: 'listTickets' }, 'TB', 'bowner')).body as { total: number }).total).toBe(0);
    const team = (await run(db, { action: 'team' })).body as { team: { user_id: string; name: string }[] };
    expect(team.team.map((m) => m.user_id).sort()).toEqual(['counter', 'owner']);
    expect(team.team.find((m) => m.user_id === 'owner')?.name).toBe('Marta');
    expect(team.team.find((m) => m.user_id === 'counter')?.name).toBe('caja@x.es');
  });
});

describe('Supplier price memory', () => {
  const run = (db: ReturnType<typeof seed>, body: Record<string, unknown>, tenantId = 'TA', userId = 'owner') => handleReparo({ db, fc, userId }, { tenantId, ...body });
  it('flags a change only when the price differs from the remembered one', async () => {
    const db = seed();
    const save = (priceEur: number, supplier = 'Androgeek') => run(db, { action: 'savePartPrice', label: 'Pantalla iPhone 13', supplier, priceEur }).then((r) => r.body as { change: { from: number; to: number } | null });
    expect((await save(40)).change).toBeNull();
    expect((await save(40)).change).toBeNull();
    expect((await save(46.5)).change).toEqual({ from: 40, to: 46.5 });
    expect((await save(41, 'SpainSellers')).change).toBeNull();
    const list = (await run(db, { action: 'listPartPrices', q: 'iphone' })).body as { prices: { supplier: string; price_eur: number; previous_price_eur: number | null }[] };
    expect(list.prices).toHaveLength(2);
    expect(list.prices.find((p) => p.supplier === 'Androgeek')).toMatchObject({ price_eur: 46.5, previous_price_eur: 40 });
  });
  it('rejects empty input and keeps shops apart', async () => {
    const db = seed();
    expect((await run(db, { action: 'savePartPrice', label: '', supplier: 'X', priceEur: 5 })).status).toBe(400);
    expect((await run(db, { action: 'savePartPrice', label: 'Batería', supplier: 'X', priceEur: 0 })).status).toBe(400);
    await run(db, { action: 'savePartPrice', label: 'Batería', supplier: 'X', priceEur: 12 });
    expect(((await run(db, { action: 'listPartPrices' }, 'TB', 'bowner')).body as { prices: unknown[] }).prices).toHaveLength(0);
    const id = ((await run(db, { action: 'listPartPrices' })).body as { prices: { id: string }[] }).prices[0].id;
    expect((await run(db, { action: 'deletePartPrice', id }, 'TB', 'bowner')).status).toBe(404);
    expect((await run(db, { action: 'deletePartPrice', id })).status).toBe(200);
  });
  it('quote accepts a custom labour amount and label', async () => {
    const db = seed();
    const q = (extra: Record<string, unknown>) => run(db, { action: 'quote', quote: { priceCents: 5000, taxMode: 'gross', category: 'movil', ...extra } }).then((r) => r.body as { option: { labor_cents: number; labor_label: string } });
    const custom = await q({ laborCents: 3700, laborLabel: 'Microsoldadura' });
    expect(custom.option.labor_cents).toBe(3700);
    expect(custom.option.labor_label).toBe('Microsoldadura');
    expect((await q({})).option.labor_cents).not.toBe(3700);
  });
});

describe('TPV catalogue and cierre history', () => {
  const run = (db: ReturnType<typeof seed>, body: Record<string, unknown>, userId = 'owner', tenantId = 'TA') => handleTpv({ db, userId }, { tenantId, ...body });
  it('owner edits the catalogue, counter staff only reads it, shops are isolated', async () => {
    const db = seed();
    const saved = (await run(db, { action: 'saveProduct', product: { name: 'Funda silicona', family: 'Fundas', price_eur: 9.9, iva_pct: 21 } })).body as { product: { id: string; price_eur: number } };
    expect(saved.product.price_eur).toBe(9.9);
    expect((await run(db, { action: 'saveProduct', product: { name: 'Hack', price_eur: 1 } }, 'counter')).status).toBe(403);
    expect((await run(db, { action: 'deleteProduct', id: saved.product.id }, 'counter')).status).toBe(403);
    const seen = (await run(db, { action: 'listProducts' }, 'counter')).body as { products: { name: string }[] };
    expect(seen.products.map((p) => p.name)).toEqual(['Funda silicona']);
    expect(((await run(db, { action: 'listProducts' }, 'bowner', 'TB')).body as { products: unknown[] }).products).toHaveLength(0);
    expect((await run(db, { action: 'saveProduct', product: { id: saved.product.id, name: 'Robada', price_eur: 1 } }, 'bowner', 'TB')).status).toBe(404);
    expect((await run(db, { action: 'saveProduct', product: { name: '', price_eur: 1 } })).status).toBe(400);
    await run(db, { action: 'deleteProduct', id: saved.product.id });
    expect(((await run(db, { action: 'listProducts' })).body as { products: unknown[] }).products).toHaveLength(0);
  });
  it('history lists only this shop\'s closed sessions', async () => {
    const db = seed();
    await run(db, { action: 'openSession', opening_float: 50 });
    await run(db, { action: 'recordSale', payments: [{ method: 'cash', amount: 10 }] });
    await run(db, { action: 'close', counted_cash: 60 });
    const mine = (await run(db, { action: 'history' })).body as { closings: { z_number: number; counted_cash_eur: number }[] };
    expect(mine.closings).toHaveLength(1);
    expect(mine.closings[0]).toMatchObject({ z_number: 1, counted_cash_eur: 60 });
    expect(((await run(db, { action: 'history' }, 'bowner', 'TB')).body as { closings: unknown[] }).closings).toHaveLength(0);
  });
});
