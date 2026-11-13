// TPV sale lines, stock and returns (Devoluciones). A sale stores what it contained (SaleLine) and takes tracked
// products out of stock; a return refunds a whole sale or single lines, puts stock back and records NEGATIVE
// CashMovement rows (kind 'refund') in the OPEN session, so the Cierre de Caja subtracts them from the right
// payment method (computeSessionTotals already does). Everything is scoped by tenant_id.
import { find, findOne, type Entities, type Row } from './db.ts';
import { CashError, METHOD_KEYS, openSessionOf, parseMoney, round2 } from './cash.ts';

export type CartLine = { product_id?: string; ticket_id?: string; name: string; qty: number; unit_price_eur: number; iva_pct?: number };

/** Validate the cart BEFORE any money is recorded: shape, total = payments, enough stock. */
export async function validateCart(db: Entities, tenantId: string, rawLines: unknown, paymentsTotal: number): Promise<CartLine[]> {
  if (!Array.isArray(rawLines) || !rawLines.length) return [];
  if (rawLines.length > 60) throw new CashError(400, 'Demasiadas líneas en el ticket.');
  const lines = rawLines.map((l) => {
    const q = l as Record<string, unknown>;
    const qty = Math.floor(Number(q.qty));
    const price = parseMoney(q.unit_price_eur);
    const name = String(q.name ?? '').trim().slice(0, 160);
    if (!name || !(qty >= 1) || qty > 999 || price === null || !Number.isFinite(price) || price < 0) throw new CashError(400, 'Revisa las líneas del ticket.');
    return { product_id: typeof q.product_id === 'string' && q.product_id ? q.product_id : undefined, ticket_id: typeof q.ticket_id === 'string' && q.ticket_id ? q.ticket_id : undefined, name, qty, unit_price_eur: price, iva_pct: [0, 4, 10, 21].includes(Number(q.iva_pct)) ? Number(q.iva_pct) : 21 };
  });
  const total = round2(lines.reduce((s, l) => s + l.qty * l.unit_price_eur, 0));
  if (Math.abs(total - round2(paymentsTotal)) > 0.005) throw new CashError(400, 'El ticket no coincide con el importe cobrado.');
  const need = new Map<string, number>();
  for (const l of lines) if (l.product_id) need.set(l.product_id, (need.get(l.product_id) ?? 0) + l.qty);
  for (const [id, qty] of need) {
    const p = await findOne(db.Product, { id, tenant_id: tenantId });
    if (!p) throw new CashError(404, 'Un producto del ticket ya no existe.');
    if (p.track_stock === true && (Number(p.stock) || 0) < qty) throw new CashError(409, `No queda stock suficiente de «${String(p.name)}» (quedan ${Number(p.stock) || 0}).`);
  }
  return lines;
}

/** After the sale is recorded: save its lines and take tracked products out of stock. */
export async function saveSaleLines(db: Entities, tenantId: string, saleRef: string, closingId: string | null, lines: CartLine[]) {
  for (const l of lines) {
    await db.SaleLine.create({ tenant_id: tenantId, sale_ref: saleRef, closing_id: closingId, product_id: l.product_id ?? null, ticket_id: l.ticket_id ?? null, name: l.name, qty: l.qty, returned_qty: 0, unit_price_eur: l.unit_price_eur, iva_pct: l.iva_pct ?? 21 });
  }
  const per = new Map<string, number>();
  for (const l of lines) if (l.product_id) per.set(l.product_id, (per.get(l.product_id) ?? 0) + l.qty);
  for (const [id, qty] of per) {
    const p = await findOne(db.Product, { id, tenant_id: tenantId });
    if (p?.track_stock === true) await db.Product.update(p.id, { stock: (Number(p.stock) || 0) - qty });
  }
}

export type SaleView = {
  sale_ref: string; created_date: string; total: number; refunded: number; methods: Record<string, number>; reason: string | null;
  lines: { id: string; name: string; qty: number; returned_qty: number; unit_price_eur: number; product_id: string | null }[];
};

/** Recent sales of the shop (newest first) with what is still returnable. */
export async function listSales(db: Entities, tenantId: string, opts: { q?: string; days?: number } = {}): Promise<SaleView[]> {
  const since = Date.now() - Math.min(365, Math.max(1, Number(opts.days) || 30)) * 864e5;
  const moves = await find(db.CashMovement, { tenant_id: tenantId }, { sort: '-created_date' });
  const sales = new Map<string, SaleView>();
  const refunds = new Map<string, number>();
  for (const m of moves) {
    if (m.kind === 'refund' && m.refund_of) refunds.set(String(m.refund_of), round2((refunds.get(String(m.refund_of)) ?? 0) + Number(m.amount_eur)));
  }
  for (const m of moves) {
    if (m.kind !== 'sale' || !m.sale_ref) continue;
    const when = Date.parse(String(m.created_date ?? ''));
    if (Number.isFinite(when) && when < since) continue;
    const key = String(m.sale_ref);
    const s = sales.get(key) ?? { sale_ref: key, created_date: String(m.created_date ?? ''), total: 0, refunded: refunds.get(key) ?? 0, methods: {}, reason: (m.reason as string) ?? null, lines: [] };
    s.total = round2(s.total + Number(m.amount_eur));
    s.methods[String(m.method)] = round2((s.methods[String(m.method)] ?? 0) + Number(m.amount_eur));
    if (String(m.created_date ?? '') > s.created_date) s.created_date = String(m.created_date);
    sales.set(key, s);
  }
  const lines = await find(db.SaleLine, { tenant_id: tenantId });
  for (const l of lines) {
    const s = sales.get(String(l.sale_ref));
    if (s) s.lines.push({ id: l.id, name: String(l.name), qty: Number(l.qty), returned_qty: Number(l.returned_qty) || 0, unit_price_eur: Number(l.unit_price_eur), product_id: (l.product_id as string) ?? null });
  }
  const q = String(opts.q ?? '').trim().toLowerCase();
  return [...sales.values()]
    .filter((s) => !q || s.sale_ref.toLowerCase().includes(q) || String(s.reason ?? '').toLowerCase().includes(q) || s.lines.some((l) => l.name.toLowerCase().includes(q)))
    .sort((a, b) => b.created_date.localeCompare(a.created_date)).slice(0, 100);
}

export type RefundInput = {
  sale_ref: unknown; items?: { line_id: string; qty: number }[]; amount?: unknown; payments?: { method: string; amount: unknown }[];
  reason?: unknown; restock?: unknown; client_request_id?: unknown; register_code?: unknown;
};

/**
 * Refund a sale (or lines of it) in the open session. Items → amount from the lines; no items → amount typed
 * (sales made before lines were stored). Never more than was paid, per sale and per payment method.
 */
export async function refundSale(deps: { db: Entities; now?: Date }, tenant: Row, actorId: string, role: string, b: RefundInput) {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const saleRef = String(b.sale_ref ?? '');
  if (!saleRef) throw new CashError(400, 'Elige la venta que se devuelve.');
  const reason = String(b.reason ?? '').trim().slice(0, 200);
  if (role === 'counter' && !reason) throw new CashError(400, 'Indica el motivo de la devolución.');

  const moves = await find(db.CashMovement, { tenant_id: tenant.id });
  const sold = moves.filter((m) => m.kind === 'sale' && m.sale_ref === saleRef);
  if (!sold.length) throw new CashError(404, 'Venta no encontrada.');
  const soldBy: Record<string, number> = {};
  for (const m of sold) soldBy[String(m.method)] = round2((soldBy[String(m.method)] ?? 0) + Number(m.amount_eur));
  const refundedBy: Record<string, number> = {};
  for (const m of moves.filter((x) => x.kind === 'refund' && x.refund_of === saleRef)) refundedBy[String(m.method)] = round2((refundedBy[String(m.method)] ?? 0) + Number(m.amount_eur));
  const soldTotal = round2(Object.values(soldBy).reduce((a, c) => a + c, 0));
  const refundedTotal = round2(Object.values(refundedBy).reduce((a, c) => a + c, 0));

  const lines = await find(db.SaleLine, { tenant_id: tenant.id, sale_ref: saleRef });
  let amount: number;
  const returned: { line: Row; qty: number }[] = [];
  if (Array.isArray(b.items) && b.items.length) {
    amount = 0;
    for (const it of b.items) {
      const line = lines.find((l) => l.id === it.line_id);
      const qty = Math.floor(Number(it.qty));
      if (!line || !(qty >= 1)) throw new CashError(400, 'Revisa las líneas a devolver.');
      if (qty > Number(line.qty) - (Number(line.returned_qty) || 0)) throw new CashError(409, `De «${String(line.name)}» ya no se pueden devolver tantas unidades.`);
      returned.push({ line, qty });
      amount = round2(amount + qty * Number(line.unit_price_eur));
    }
  } else {
    const typed = parseMoney(b.amount);
    if (typed === null || !Number.isFinite(typed) || !(typed > 0)) throw new CashError(400, 'Indica el importe a devolver.');
    amount = typed;
  }
  if (amount > round2(soldTotal - refundedTotal) + 0.004) throw new CashError(409, `Solo quedan ${round2(soldTotal - refundedTotal).toFixed(2)} € por devolver de esta venta.`);

  // Payments: default = same methods as the sale, proportionally; or what the cashier chose.
  let payments = (Array.isArray(b.payments) ? b.payments : []).map((p) => ({ method: String(p.method), amount: parseMoney(p.amount) }));
  if (!payments.length) {
    let left = amount;
    payments = Object.entries(soldBy).map(([method, paid], i, arr) => {
      const part = i === arr.length - 1 ? left : round2((amount * paid) / soldTotal);
      left = round2(left - part);
      return { method, amount: part };
    }).filter((p) => (p.amount ?? 0) > 0);
  }
  if (!payments.length) throw new CashError(400, 'Falta la forma de devolución.');
  for (const p of payments) {
    if (!(METHOD_KEYS as readonly string[]).includes(p.method)) throw new CashError(400, 'Forma de pago no válida.');
    if (p.amount === null || !Number.isFinite(p.amount) || !(p.amount > 0)) throw new CashError(400, 'Cada importe devuelto tiene que ser mayor que cero.');
    if (p.amount > round2((soldBy[p.method] ?? 0) - (refundedBy[p.method] ?? 0)) + 0.004) throw new CashError(409, `No se puede devolver tanto por ${p.method}: se cobró menos por esa vía.`);
  }
  if (Math.abs(round2(payments.reduce((s, p) => s + (p.amount as number), 0)) - amount) > 0.005) throw new CashError(400, 'Lo devuelto por cada vía no suma el importe de la devolución.');

  const session = await openSessionOf(db, tenant.id, String(b.register_code ?? '').trim().slice(0, 20) || 'CAJA1');
  if (!session) throw new CashError(400, 'No hay ninguna caja abierta.');

  // Idempotent: a double click with the same client_request_id returns the refund already made.
  const rid = String(b.client_request_id ?? '').trim().slice(0, 80) || null;
  if (rid && (await findOne(db.CashMovement, { tenant_id: tenant.id, client_request_id: `${rid}#0` }))) return { duplicate: true, amount, refund_ref: rid };
  const refundRef = rid ?? `refund-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const ticketId = (sold.find((m) => m.ticket_id)?.ticket_id as string) ?? null;
  for (const [i, p] of payments.entries()) {
    await db.CashMovement.create({ tenant_id: tenant.id, closing_id: session.id, kind: 'refund', method: p.method, amount_eur: p.amount, sale_ref: refundRef, refund_of: saleRef, ticket_id: ticketId,
      reason: (reason || `Devolución de ${saleRef}`).slice(0, 200), actor_id: actorId, client_request_id: `${refundRef}#${i}` });
  }
  for (const { line, qty } of returned) await db.SaleLine.update(line.id, { returned_qty: (Number(line.returned_qty) || 0) + qty });
  const restock = b.restock !== false;
  const perProduct = new Map<string, number>();
  if (restock) for (const { line, qty } of returned) if (line.product_id) perProduct.set(String(line.product_id), (perProduct.get(String(line.product_id)) ?? 0) + qty);
  for (const [id, qty] of perProduct) {
    const p = await findOne(db.Product, { id, tenant_id: tenant.id });
    if (p?.track_stock === true) await db.Product.update(p.id, { stock: (Number(p.stock) || 0) + qty });
  }
  if (ticketId) {
    const t = await findOne(db.RepairTicket, { id: ticketId, tenant_id: tenant.id });
    if (t) await db.RepairTicket.update(t.id, { tpv_paid_total_eur: Math.max(0, round2((Number(t.tpv_paid_total_eur) || 0) - amount)) });
  }
  return { duplicate: false, amount, refund_ref: refundRef, closing_id: session.id, restocked: [...perProduct.entries()].map(([product_id, qty]) => ({ product_id, qty })) };
}

/**
 * Manual stock adjustment (stocktake, breakage, goods received). Either `delta` (± units) or `set` (counted
 * units). Starts tracking the product if it was not tracked. Never below zero. Logged in StockMove.
 */
export async function adjustStock(db: Entities, tenant: Row, actorId: string, b: { product_id?: unknown; delta?: unknown; set?: unknown; reason?: unknown }) {
  const p = typeof b.product_id === 'string' ? await findOne(db.Product, { id: b.product_id, tenant_id: tenant.id }) : null;
  if (!p) throw new CashError(404, 'Producto no encontrado');
  const reason = String(b.reason ?? '').trim().slice(0, 200);
  if (!reason) throw new CashError(400, 'Indica el motivo del ajuste.');
  const before = p.track_stock === true ? Number(p.stock) || 0 : 0;
  let after: number;
  if (b.set !== undefined && b.set !== null && b.set !== '') {
    after = Math.floor(Number(b.set));
  } else {
    const d = Math.floor(Number(b.delta));
    if (!Number.isFinite(d) || d === 0) throw new CashError(400, 'Indica cuántas unidades entran o salen.');
    after = before + d;
  }
  if (!Number.isFinite(after) || after < 0) throw new CashError(400, 'El stock no puede quedar por debajo de cero.');
  if (after > 1_000_000) throw new CashError(400, 'Cantidad no válida.');
  await db.Product.update(p.id, { track_stock: true, stock: after });
  await db.StockMove.create({ tenant_id: tenant.id, product_id: p.id, product_name: String(p.name).slice(0, 120), delta: after - before, stock_after: after, reason, actor_id: actorId });
  return { product_id: p.id, stock: after, delta: after - before };
}

/** Latest manual adjustments of a product (or of the whole shop). */
export async function stockLog(db: Entities, tenantId: string, productId?: unknown) {
  const rows = await find(db.StockMove, { tenant_id: tenantId, ...(typeof productId === 'string' && productId ? { product_id: productId } : {}) }, { sort: '-created_date', limit: 50 });
  return rows.map((r) => ({ id: r.id, created_date: r.created_date, product_id: r.product_id, product_name: r.product_name, delta: r.delta, stock_after: r.stock_after, reason: r.reason }));
}
