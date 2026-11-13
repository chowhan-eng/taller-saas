// TPV action router. EVERY action passes gateModule('tpv') first (ACTIVE PAID PRO subscription; Starter →
// 402) and the counter roles (technicians cannot touch the cash). Free of Base44 runtime imports for tests.
import { find, findOne, type Entities, type Row } from './db.ts';

const productOut = (p: Row) => ({ id: p.id, name: p.name, family: p.family ?? 'General', kind: p.kind ?? 'product', price_eur: Number(p.price_eur) || 0, iva_pct: p.iva_pct ?? 21, track_stock: p.track_stock === true, stock: Number(p.stock) || 0, low_stock_threshold: p.low_stock_threshold == null ? 3 : Number(p.low_stock_threshold) });
import { gateModule } from './modules.ts';
import { CashError, cashMovement, closeSession, openSession, parseMoney, recordSale, round2, sessionSummary } from './cash.ts';
import { adjustStock, listSales, refundSale, stockLog, saveSaleLines, validateCart, type RefundInput } from './returns.ts';

export const TPV_ACTIONS = ['openSession', 'movement', 'recordSale', 'summary', 'close', 'listProducts', 'saveProduct', 'deleteProduct', 'history', 'sales', 'refund', 'adjustStock', 'stockLog'] as const;

export type TpvCtx = { db: Entities; userId?: string; now?: Date };
// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

export async function handleTpv(ctx: TpvCtx, body: Body): Promise<{ status: number; body: unknown }> {
  const gate = await gateModule(ctx.db, ctx.userId, body?.tenantId, 'tpv', ['owner', 'admin', 'counter']);
  if (!gate.ok) return { status: gate.status, body: { error: gate.error } };
  const deps = { db: ctx.db, now: ctx.now };
  const actor = String(ctx.userId);
  try {
    switch (body.action) {
      case 'openSession': return { status: 200, body: await openSession(deps, gate.tenant, actor, body) };
      case 'movement': return { status: 200, body: await cashMovement(deps, gate.tenant, actor, body) };
      case 'recordSale': {
        // With a cart (`lines`): validate it BEFORE any money moves, then store the lines and take tracked stock out.
        const isSale = body.kind !== 'refund';
        const paid = round2((Array.isArray(body.payments) ? body.payments : []).reduce((s: number, p: { amount?: unknown }) => s + (parseMoney(p?.amount) || 0), 0));
        // A retry with the same client_request_id must not store the lines (or take stock out) twice.
        const rid = String(body.client_request_id ?? '').trim().slice(0, 80);
        const already = isSale && rid ? await findOne(ctx.db.SaleLine, { tenant_id: gate.tenant.id, sale_ref: rid }) : null;
        const lines = isSale && !already && Array.isArray(body.lines) && body.lines.length ? await validateCart(ctx.db, gate.tenant.id, body.lines, paid) : [];
        const sale = await recordSale(deps, gate.tenant, actor, body);
        if (lines.length) await saveSaleLines(ctx.db, gate.tenant.id, sale.sale_ref, (sale.movements[0]?.closing_id as string) ?? null, lines);
        return { status: 200, body: sale };
      }
      case 'adjustStock': {
        // Stocktake / breakage / goods received: owner or admin only (counter staff only sell).
        if (gate.role !== 'owner' && gate.role !== 'admin') return { status: 403, body: { error: 'Solo el titular o un administrador ajustan el stock.' } };
        return { status: 200, body: await adjustStock(ctx.db, gate.tenant, actor, body) };
      }
      case 'stockLog': return { status: 200, body: { moves: await stockLog(ctx.db, gate.tenant.id, body.product_id) } };
      case 'sales': return { status: 200, body: { sales: await listSales(ctx.db, gate.tenant.id, { q: body.q, days: body.days }) } };
      case 'refund': return { status: 200, body: await refundSale(deps, gate.tenant, actor, gate.role, body as RefundInput) };
      case 'summary': return { status: 200, body: await sessionSummary(deps, gate.tenant, body) };
      case 'close': return { status: 200, body: await closeSession(deps, gate.tenant, actor, gate.role, body) };
      case 'listProducts': {
        const rows = await find(ctx.db.Product, { tenant_id: gate.tenant.id }, { sort: 'name' });
        return { status: 200, body: { products: rows.filter((p) => p.active !== false).map(productOut) } };
      }
      case 'saveProduct': {
        // Catalogue edits are for the owner/admin; counter staff only sell.
        if (gate.role !== 'owner' && gate.role !== 'admin') return { status: 403, body: { error: 'Solo el titular o un administrador editan el catálogo.' } };
        const p = (body.product ?? {}) as Record<string, unknown>;
        const name = String(p.name ?? '').trim().slice(0, 120);
        const price = Number(p.price_eur);
        if (!name || !(price >= 0)) return { status: 400, body: { error: 'Indica el nombre y un precio válido.' } };
        const data = { tenant_id: gate.tenant.id, name, price_eur: Math.round(price * 100) / 100, family: String(p.family ?? '').trim().slice(0, 40) || 'General',
          kind: p.kind === 'service' ? 'service' : 'product', iva_pct: [0, 4, 10, 21].includes(Number(p.iva_pct)) ? Number(p.iva_pct) : 21, active: true,
          track_stock: p.track_stock === true, ...(p.track_stock === true ? { stock: Math.max(0, Math.floor(Number(p.stock) || 0)) } : {}),
          low_stock_threshold: Math.min(1000, Math.max(0, Math.floor(Number(p.low_stock_threshold ?? 3)))) };
        if (typeof p.id === 'string' && p.id) {
          const own = await findOne(ctx.db.Product, { id: p.id, tenant_id: gate.tenant.id });
          if (!own) return { status: 404, body: { error: 'Producto no encontrado' } };
          return { status: 200, body: { product: productOut(await ctx.db.Product.update(own.id, data)) } };
        }
        return { status: 200, body: { product: productOut(await ctx.db.Product.create(data)) } };
      }
      case 'deleteProduct': {
        if (gate.role !== 'owner' && gate.role !== 'admin') return { status: 403, body: { error: 'Solo el titular o un administrador editan el catálogo.' } };
        const own = await findOne(ctx.db.Product, { id: body.id, tenant_id: gate.tenant.id });
        if (!own) return { status: 404, body: { error: 'Producto no encontrado' } };
        await ctx.db.Product.update(own.id, { active: false });
        return { status: 200, body: { ok: true } };
      }
      case 'history': {
        // «Mostrar históricos» of the Cierre wizard: the latest closed sessions (Z reports) of this shop.
        const rows = await find(ctx.db.CashClosing, { tenant_id: gate.tenant.id, status: 'cerrada' }, { sort: '-closed_at', limit: 30 });
        return { status: 200, body: { closings: rows.map((c) => ({ id: c.id, z_number: c.z_number, business_date: c.business_date, closed_at: c.closed_at,
          sales_total_eur: c.sales_total_eur, expected_cash_eur: c.expected_cash_eur, counted_cash_eur: c.counted_cash_eur, difference_eur: c.difference_eur,
          withdrawn_cash_eur: c.withdrawn_cash_eur, next_day_float_eur: c.next_day_float_eur, card_total_declared_eur: c.card_total_declared_eur,
          recharges_total_eur: c.recharges_total_eur ?? null, ticket_count: c.ticket_count, difference_reason: c.difference_reason ?? null })) } };
      }
      default: return { status: 501, body: { error: 'Acción no disponible todavía.' } };
    }
  } catch (e) {
    if (e instanceof CashError) return { status: e.status, body: { error: e.message } };
    throw e;
  }
}
