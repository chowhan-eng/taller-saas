// TPV returns (Devoluciones): cart validation, stock out/in, refund by line or amount, negative movements in
// the open session and in the Cierre, limits per sale and per payment method, roles, idempotency, isolation.
import { describe, expect, it } from 'vitest';
import type { Row } from '../base44/shared/db.ts';
import { handleTpv } from '../base44/shared/tpvApi.ts';
import { fakeDb } from './fakeDb.ts';

const seed = () => fakeDb({
  Tenant: [{ id: 'TA', plan: 'pro', status: 'active' }, { id: 'TB', plan: 'pro', status: 'active' }],
  Subscription: [{ id: 'S1', tenant_id: 'TA', plan: 'pro', status: 'active' }, { id: 'S2', tenant_id: 'TB', plan: 'pro', status: 'active' }],
  TenantUser: [
    { id: 'm1', tenant_id: 'TA', user_id: 'owner', role: 'owner', active: true }, { id: 'm2', tenant_id: 'TA', user_id: 'counter', role: 'counter', active: true },
    { id: 'm3', tenant_id: 'TB', user_id: 'bowner', role: 'owner', active: true },
  ],
  Product: [
    { id: 'P1', tenant_id: 'TA', name: 'Funda', price_eur: 10, iva_pct: 21, track_stock: true, stock: 5, active: true },
    { id: 'P2', tenant_id: 'TA', name: 'Cable', price_eur: 6, iva_pct: 21, track_stock: false, stock: 0, active: true },
  ],
});
type Db = ReturnType<typeof seed>;
const run = (db: Db, body: Record<string, unknown>, userId = 'owner', tenantId = 'TA') => handleTpv({ db, userId }, { tenantId, ...body });
const stock = (db: Db, id: string) => Number((db._rows.Product.find((p: Row) => p.id === id) as Row).stock);
async function sell(db: Db, over: Record<string, unknown> = {}) {
  await run(db, { action: 'openSession', opening_float: 100 });
  return run(db, { action: 'recordSale', client_request_id: 'sale-1', payments: [{ method: 'cash', amount: 20 }, { method: 'card', amount: 16 }],
    lines: [{ product_id: 'P1', name: 'Funda', qty: 2, unit_price_eur: 10 }, { product_id: 'P2', name: 'Cable', qty: 1, unit_price_eur: 6 }, { name: 'Servicio', qty: 1, unit_price_eur: 10 }], ...over });
}
const summary = async (db: Db) => (await run(db, { action: 'summary' })).body as { totals: { byMethod: Record<string, number>; salesTotal: number; refundTotal: number; expectedCash: number; refundCount: number }; movements: Row[] };

describe('selling with a cart', () => {
  it('stores the lines and takes tracked stock out', async () => {
    const db = seed();
    expect((await sell(db)).status).toBe(200);
    expect(db._rows.SaleLine).toHaveLength(3);
    expect(stock(db, 'P1')).toBe(3);
    expect(stock(db, 'P2')).toBe(0);
  });
  it('refuses a cart that does not match the payment, or lacks stock, before any money moves', async () => {
    const db = seed();
    await run(db, { action: 'openSession', opening_float: 0 });
    const mismatch = await run(db, { action: 'recordSale', payments: [{ method: 'cash', amount: 5 }], lines: [{ product_id: 'P1', name: 'Funda', qty: 1, unit_price_eur: 10 }] });
    expect(mismatch.status).toBe(400);
    const noStock = await run(db, { action: 'recordSale', payments: [{ method: 'cash', amount: 60 }], lines: [{ product_id: 'P1', name: 'Funda', qty: 6, unit_price_eur: 10 }] });
    expect(noStock.status).toBe(409);
    expect(db._rows.CashMovement ?? []).toHaveLength(0);
    expect(stock(db, 'P1')).toBe(5);
  });
  it('a retry with the same request id does not store lines or take stock twice', async () => {
    const db = seed();
    await sell(db); await sell(db);
    expect(db._rows.SaleLine).toHaveLength(3);
    expect(stock(db, 'P1')).toBe(3);
  });
  it('a product of another shop cannot be sold', async () => {
    const db = seed();
    await run(db, { action: 'openSession', opening_float: 0 }, 'bowner', 'TB');
    const r = await run(db, { action: 'recordSale', payments: [{ method: 'cash', amount: 10 }], lines: [{ product_id: 'P1', name: 'Funda', qty: 1, unit_price_eur: 10 }] }, 'bowner', 'TB');
    expect(r.status).toBe(404);
    expect(stock(db, 'P1')).toBe(5);
  });
});

describe('refunds', () => {
  it('refunds one line: negative movements, stock back, totals and Cierre adjusted', async () => {
    const db = seed();
    await sell(db);
    const lineId = (db._rows.SaleLine.find((l: Row) => l.name === 'Funda') as Row).id;
    const r = await run(db, { action: 'refund', sale_ref: 'sale-1', items: [{ line_id: lineId, qty: 1 }], payments: [{ method: 'card', amount: 10 }], reason: 'No le gusta', client_request_id: 'ref-1' });
    expect(r.status).toBe(200);
    expect(stock(db, 'P1')).toBe(4);
    const s = await summary(db);
    expect(s.totals.salesTotal).toBe(26);
    expect(s.totals.byMethod.card).toBe(6);
    expect(s.totals.refundTotal).toBe(10);
    expect(s.totals.refundCount).toBe(1);
    const refund = s.movements.find((m) => m.kind === 'refund') as Row;
    expect(refund).toMatchObject({ method: 'card', amount_eur: 10, refund_of: 'sale-1' });
    const z = (await run(db, { action: 'close', counted_cash: 120 })).body as { totals: { salesTotal: number } };
    expect(z.totals.salesTotal).toBe(26);
  });
  it('a cash refund lowers the expected cash in the drawer', async () => {
    const db = seed();
    await sell(db);
    const before = (await summary(db)).totals.expectedCash;
    await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 4, payments: [{ method: 'cash', amount: 4 }], reason: 'Error de precio' });
    expect((await summary(db)).totals.expectedCash).toBe(before - 4);
  });
  it('defaults the refund to the sale\'s own payment methods, proportionally', async () => {
    const db = seed();
    await sell(db);
    await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 18, reason: 'x' });
    const refunds = (await summary(db)).movements.filter((m) => m.kind === 'refund');
    expect(refunds.map((m) => [m.method, m.amount_eur]).sort()).toEqual([['card', 8], ['cash', 10]]);
  });
  it('never refunds more than was sold, more lines than were sold, or more than was paid by a method', async () => {
    const db = seed();
    await sell(db);
    const lineId = (db._rows.SaleLine.find((l: Row) => l.name === 'Funda') as Row).id;
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', items: [{ line_id: lineId, qty: 3 }], reason: 'x' })).status).toBe(409);
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 40, reason: 'x' })).status).toBe(409);
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 20, payments: [{ method: 'card', amount: 20 }], reason: 'x' })).status).toBe(409);
    await run(db, { action: 'refund', sale_ref: 'sale-1', items: [{ line_id: lineId, qty: 2 }], payments: [{ method: 'cash', amount: 20 }], reason: 'x' });
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', items: [{ line_id: lineId, qty: 1 }], reason: 'x' })).status).toBe(409);
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 17, reason: 'x' })).status).toBe(409);
  });
  it('restock can be switched off (damaged goods)', async () => {
    const db = seed();
    await sell(db);
    const lineId = (db._rows.SaleLine.find((l: Row) => l.name === 'Funda') as Row).id;
    await run(db, { action: 'refund', sale_ref: 'sale-1', items: [{ line_id: lineId, qty: 1 }], restock: false, reason: 'roto' });
    expect(stock(db, 'P1')).toBe(3);
  });
  it('is idempotent on client_request_id', async () => {
    const db = seed();
    await sell(db);
    const body = { action: 'refund', sale_ref: 'sale-1', amount: 5, payments: [{ method: 'cash', amount: 5 }], reason: 'x', client_request_id: 'ref-9' };
    await run(db, body); const again = await run(db, body);
    expect((again.body as { duplicate: boolean }).duplicate).toBe(true);
    expect((await summary(db)).totals.refundTotal).toBe(5);
  });
  it('needs an open cash session, a reason from counter staff, and an existing sale', async () => {
    const db = seed();
    await sell(db);
    expect((await run(db, { action: 'refund', sale_ref: 'nope', amount: 1, reason: 'x' })).status).toBe(404);
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 1 }, 'counter')).status).toBe(400);
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 1, reason: 'cliente' }, 'counter')).status).toBe(200);
    await run(db, { action: 'close', counted_cash: 100 });
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 1, reason: 'x' })).status).toBe(400);
  });
  it('a refund after the sale\'s session was closed lands in TODAY\'s session', async () => {
    const db = seed();
    await sell(db);
    await run(db, { action: 'close', counted_cash: 120 });
    await run(db, { action: 'openSession', opening_float: 50 });
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 6, payments: [{ method: 'cash', amount: 6 }], reason: 'x' })).status).toBe(200);
    const s = await summary(db);
    expect(s.totals.refundTotal).toBe(6);
    expect(s.totals.salesTotal).toBe(-6);
  });
  it('lowers what a repair ticket shows as paid at the till', async () => {
    const db = seed();
    db._rows.RepairTicket = [{ id: 'T1', tenant_id: 'TA', tpv_paid_total_eur: 0 }];
    await run(db, { action: 'openSession', opening_float: 0 });
    await run(db, { action: 'recordSale', client_request_id: 'rep-1', ticketId: 'T1', payments: [{ method: 'cash', amount: 50 }] });
    await run(db, { action: 'refund', sale_ref: 'rep-1', amount: 20, reason: 'descuento' });
    expect(Number((db._rows.RepairTicket[0] as Row).tpv_paid_total_eur)).toBe(30);
  });
  it('another shop cannot refund or see this shop\'s sales', async () => {
    const db = seed();
    await sell(db);
    await run(db, { action: 'openSession', opening_float: 0 }, 'bowner', 'TB');
    expect((await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 1, reason: 'x' }, 'bowner', 'TB')).status).toBe(404);
    expect(((await run(db, { action: 'sales' }, 'bowner', 'TB')).body as { sales: unknown[] }).sales).toHaveLength(0);
  });
});

describe('sales list for the Devoluciones screen', () => {
  it('shows each sale with its lines, what is refunded and what is still returnable; search works', async () => {
    const db = seed();
    await sell(db);
    await run(db, { action: 'refund', sale_ref: 'sale-1', amount: 5, payments: [{ method: 'card', amount: 5 }], reason: 'x' });
    const all = ((await run(db, { action: 'sales' })).body as { sales: { sale_ref: string; total: number; refunded: number; methods: Record<string, number>; lines: unknown[] }[] }).sales;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ sale_ref: 'sale-1', total: 36, refunded: 5, methods: { cash: 20, card: 16 } });
    expect(all[0].lines).toHaveLength(3);
    expect(((await run(db, { action: 'sales', q: 'servicio' })).body as { sales: unknown[] }).sales).toHaveLength(1);
    expect(((await run(db, { action: 'sales', q: 'zzz' })).body as { sales: unknown[] }).sales).toHaveLength(0);
  });
});

describe('manual stock adjustment', () => {
  it('owner adds, removes and fixes a count; each one is logged and tracking starts if it was off', async () => {
    const db = seed();
    const adj = (extra: Record<string, unknown>, userId = 'owner', tenantId = 'TA') => run(db, { action: 'adjustStock', product_id: 'P1', reason: 'Recuento', ...extra }, userId, tenantId);
    expect(((await adj({ delta: 10 })).body as { stock: number }).stock).toBe(15);
    expect(((await adj({ delta: -4 })).body as { stock: number }).stock).toBe(11);
    expect(((await adj({ set: 7 })).body as { stock: number; delta: number })).toMatchObject({ stock: 7, delta: -4 });
    expect(stock(db, 'P1')).toBe(7);
    const p2 = await run(db, { action: 'adjustStock', product_id: 'P2', reason: 'Alta', delta: 3 });
    expect((p2.body as { stock: number }).stock).toBe(3);
    expect((db._rows.Product.find((p: Row) => p.id === 'P2') as Row).track_stock).toBe(true);
    const log = ((await run(db, { action: 'stockLog' })).body as { moves: { delta: number; reason: string }[] }).moves;
    expect(log).toHaveLength(4);
    expect(log.map((m) => m.delta).sort((a, b) => a - b)).toEqual([-4, -4, 3, 10]);
  });
  it('refuses negative stock, empty reason, zero change, counter staff and other shops', async () => {
    const db = seed();
    const adj = (extra: Record<string, unknown>, userId = 'owner', tenantId = 'TA') => run(db, { action: 'adjustStock', product_id: 'P1', reason: 'x', ...extra }, userId, tenantId);
    expect((await adj({ delta: -6 })).status).toBe(400);
    expect((await adj({ set: -1 })).status).toBe(400);
    expect((await adj({ delta: 0 })).status).toBe(400);
    expect((await adj({ delta: 2, reason: '' })).status).toBe(400);
    expect((await adj({ delta: 2 }, 'counter')).status).toBe(403);
    expect((await adj({ delta: 2 }, 'bowner', 'TB')).status).toBe(404);
    expect(stock(db, 'P1')).toBe(5);
    expect(db._rows.StockMove ?? []).toHaveLength(0);
  });
  it('stock log is per shop and the threshold is saved with the product', async () => {
    const db = seed();
    await run(db, { action: 'adjustStock', product_id: 'P1', reason: 'x', delta: 1 });
    expect(((await run(db, { action: 'stockLog' }, 'bowner', 'TB')).body as { moves: unknown[] }).moves).toHaveLength(0);
    const saved = (await run(db, { action: 'saveProduct', product: { id: 'P1', name: 'Funda', price_eur: 10, track_stock: true, stock: 5, low_stock_threshold: 8 } })).body as { product: { low_stock_threshold: number } };
    expect(saved.product.low_stock_threshold).toBe(8);
    const list = ((await run(db, { action: 'listProducts' })).body as { products: { id: string; low_stock_threshold: number }[] }).products;
    expect(list.find((p) => p.id === 'P1')?.low_stock_threshold).toBe(8);
    expect(list.find((p) => p.id === 'P2')?.low_stock_threshold).toBe(3);
  });
});
