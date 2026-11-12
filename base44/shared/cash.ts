// TPV cash register, ported from the live TPV app (cashTotals.ts, openCashSession, cashMovement,
// closeCashSession). Money in euros with 2 decimals. Sessions = CashClosing rows; every money movement
// (sale payments by method, refunds, cash in/out) = one append-only CashMovement row.
import { find, findOne, type Entities, type Row } from './db.ts';
import { parseTs } from './http.ts';

export const round2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
export const METHOD_KEYS = ['cash', 'card', 'bizum', 'transfer', 'deposit', 'voucher'] as const;
export type Method = (typeof METHOD_KEYS)[number];
export const emptyByMethod = (): Record<Method, number> => ({ cash: 0, card: 0, bizum: 0, transfer: 0, deposit: 0, voucher: 0 });

export class CashError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** «12,50» / «1.234,56» / 12.5 → 12.5; empty → null; non-numeric → NaN (verbatim port). */
export function parseMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? round2(raw) : NaN;
  let s = String(raw).replace(/[\s€]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : NaN;
}

export type SessionTotals = {
  byMethod: Record<Method, number>; saleCount: number; refundCount: number; salesTotal: number; refundTotal: number;
  cashRefund: number; cashIn: number; cashOut: number; openingFloat: number; expectedCash: number;
};

/** Port of computeSessionTotals: refunds subtract from their method and from total sales. */
export function computeSessionTotals(session: Row | { opening_float_eur?: unknown }, movements: Row[]): SessionTotals {
  const byMethod = emptyByMethod();
  const sales = new Set<string>();
  const refunds = new Set<string>();
  let salesTotal = 0, refundTotal = 0, cashRefund = 0, cashIn = 0, cashOut = 0;
  for (const m of movements) {
    const amount = round2(Math.abs(Number(m.amount_eur) || 0));
    const method = (METHOD_KEYS as readonly string[]).includes(String(m.method)) ? (m.method as Method) : 'cash';
    if (m.kind === 'sale') {
      byMethod[method] = round2(byMethod[method] + amount);
      salesTotal = round2(salesTotal + amount);
      sales.add(String(m.sale_ref ?? m.id));
    } else if (m.kind === 'refund') {
      byMethod[method] = round2(byMethod[method] - amount);
      salesTotal = round2(salesTotal - amount);
      refundTotal = round2(refundTotal + amount);
      if (method === 'cash') cashRefund = round2(cashRefund + amount);
      refunds.add(String(m.sale_ref ?? m.id));
    } else if (m.kind === 'cash_in') cashIn = round2(cashIn + amount);
    else if (m.kind === 'cash_out') cashOut = round2(cashOut + amount);
  }
  const openingFloat = round2((session as Row).opening_float_eur);
  return {
    byMethod, saleCount: sales.size, refundCount: refunds.size, salesTotal, refundTotal, cashRefund, cashIn, cashOut,
    openingFloat, expectedCash: round2(openingFloat + byMethod.cash + cashIn - cashOut),
  };
}

/**
 * Cierre (Z) — the paper sums, verbatim port of computeCierre:
 *   4. Esperado  = (Fondo + Ventas) − Tarjeta − other non-cash (Bizum, transfer, deposit, voucher) + in − out
 *   6. Diferencia = Real − Esperado
 *   8. Fondo para mañana = Real − Retirado
 */
export function computeCierre(totals: SessionTotals, p: { fondo: number; tarjeta: number; real: number | null; retirado: number }) {
  const m = totals.byMethod;
  const otherNonCash = round2((m.bizum || 0) + (m.transfer || 0) + (m.deposit || 0) + (m.voucher || 0));
  const ventas = round2(totals.salesTotal || 0);
  const esperado = round2((p.fondo || 0) + ventas - (p.tarjeta || 0) - otherNonCash + (totals.cashIn || 0) - (totals.cashOut || 0));
  const hasReal = p.real !== null && Number.isFinite(p.real);
  return {
    ventas, otherNonCash, esperado,
    diferencia: hasReal ? round2((p.real as number) - esperado) : null,
    manana: hasReal ? round2((p.real as number) - (p.retirado || 0)) : null,
  };
}

export type CashDeps = { db: Entities; now?: Date };
const register = (v: unknown) => String(v ?? '').trim().slice(0, 20) || 'CAJA1';
const madridDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);

export const openSessionOf = (db: Entities, tenantId: string, registerCode = 'CAJA1') =>
  findOne(db.CashClosing, { tenant_id: tenantId, status: 'abierta', register_code: registerCode }, '-opened_at');

async function lastClosed(db: Entities, tenantId: string, registerCode: string, excludeId = '') {
  return (await find(db.CashClosing, { tenant_id: tenantId, status: 'cerrada', register_code: registerCode }, { sort: '-closed_at', limit: 3 }))
    .find((s) => s.id !== excludeId) ?? null;
}

const nextDayFloat = (closed: Row | null) =>
  closed && closed.next_day_float_eur !== null && closed.next_day_float_eur !== undefined && Number.isFinite(Number(closed.next_day_float_eur))
    ? round2(closed.next_day_float_eur) : null;

/** Open the day's session (one open per register). Float: typed > last «fondo para mañana» > 0. */
export async function openSession(deps: CashDeps, tenant: Row, actorId: string, body: { opening_float?: unknown; register_code?: unknown }) {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const reg = register(body.register_code);
  const current = await openSessionOf(db, tenant.id, reg);
  if (current) return { session: current, existing: true };
  const typed = parseMoney(body.opening_float);
  const float = typed ?? nextDayFloat(await lastClosed(db, tenant.id, reg)) ?? 0;
  if (!Number.isFinite(float) || float < 0) throw new CashError(400, 'El fondo de caja no puede ser negativo.');
  const session = await db.CashClosing.create({
    tenant_id: tenant.id, register_code: reg, status: 'abierta', opened_by: actorId, opened_at: now.toISOString(),
    business_date: madridDay(now), opening_float_eur: round2(float), ticket_count: 0, refund_total_eur: 0,
  });
  return { session, existing: false };
}

/**
 * Append one movement, idempotent on client_request_id (port of cashMovement): a double click, a retry or a
 * slow CashDro returns the movement already recorded; two identical requests at once → the oldest wins.
 */
async function appendMovement(db: Entities, tenantId: string, row: Record<string, unknown>, requestId: string | null) {
  if (requestId) {
    const done = await findOne(db.CashMovement, { tenant_id: tenantId, client_request_id: requestId }, 'created_date');
    if (done) return { movement: done, duplicate: true };
  }
  const movement = await db.CashMovement.create({ tenant_id: tenantId, ...row, ...(requestId ? { client_request_id: requestId } : {}) });
  if (requestId) {
    const copies = await find(db.CashMovement, { tenant_id: tenantId, client_request_id: requestId }, { sort: 'created_date' });
    if (copies.length > 1 && copies[0].id !== movement.id) {
      await db.CashMovement.delete(movement.id).catch(() => {});
      return { movement: copies[0], duplicate: true };
    }
  }
  return { movement, duplicate: false };
}

const reqId = (v: unknown) => String(v ?? '').trim().slice(0, 80) || null;

/** Cash in / out of the open session (withdrawals, change, petty cash). */
export async function cashMovement(deps: CashDeps, tenant: Row, actorId: string, body: Record<string, unknown>) {
  const { db } = deps;
  const type = String(body.type ?? '');
  if (type !== 'in' && type !== 'out') throw new CashError(400, 'Elige si el efectivo entra o sale de la caja.');
  const amount = parseMoney(body.amount);
  if (amount === null || !Number.isFinite(amount) || !(amount > 0)) throw new CashError(400, 'El importe tiene que ser mayor que cero.');
  const person = String(body.person ?? '').trim().slice(0, 60);
  const reason = String(body.reason ?? '').trim().slice(0, 200);
  if (!reason && !person) throw new CashError(400, 'Indica el motivo del movimiento.');
  const session = await openSessionOf(db, tenant.id, register(body.register_code));
  if (!session) throw new CashError(400, 'No hay ninguna caja abierta.');
  return appendMovement(db, tenant.id, {
    closing_id: session.id, kind: type === 'in' ? 'cash_in' : 'cash_out', method: 'cash', amount_eur: amount,
    reason: reason || `Retirada de efectivo · ${person}`, person: person || null, actor_id: actorId,
    cashdro_operation_id: String(body.cashdro_operation_id ?? '') || null,
  }, reqId(body.client_request_id));
}

/** A sale (or refund) paid with one or more methods → one movement per payment, same sale_ref. */
export async function recordSale(deps: CashDeps, tenant: Row, actorId: string, body: Record<string, unknown>) {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const kind = body.kind === 'refund' ? 'refund' : 'sale';
  const payments = Array.isArray(body.payments) ? body.payments.slice(0, 6) : [];
  const parsed = payments.map((p) => {
    const q = p as Record<string, unknown>;
    const method = String(q.method ?? 'cash');
    const amount = parseMoney(q.amount);
    if (!(METHOD_KEYS as readonly string[]).includes(method)) throw new CashError(400, 'Forma de pago no válida.');
    if (amount === null || !Number.isFinite(amount) || !(amount > 0)) throw new CashError(400, 'Cada pago tiene que ser mayor que cero.');
    return { method, amount };
  });
  if (!parsed.length) throw new CashError(400, 'Falta el pago.');
  const session = await openSessionOf(db, tenant.id, register(body.register_code));
  if (!session) throw new CashError(400, 'No hay ninguna caja abierta.');

  const ticketId = typeof body.ticketId === 'string' && body.ticketId ? body.ticketId : null;
  const ticket = ticketId ? await findOne(db.RepairTicket, { id: ticketId, tenant_id: tenant.id }) : null;
  if (ticketId && !ticket) throw new CashError(404, 'Ticket no encontrado');

  const baseId = reqId(body.client_request_id);
  const saleRef = baseId ?? `sale-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const movements = [];
  for (const [i, p] of parsed.entries()) {
    movements.push((await appendMovement(db, tenant.id, {
      closing_id: session.id, kind, method: p.method, amount_eur: p.amount, sale_ref: saleRef, ticket_id: ticketId,
      reason: String(body.reason ?? '').slice(0, 200) || null, actor_id: actorId,
      cashdro_operation_id: p.method === 'cash' ? String(body.cashdro_operation_id ?? '') || null : null,
    }, baseId ? `${baseId}#${i}` : null)).movement);
  }
  if (ticket && kind === 'sale') {
    const total = round2(parsed.reduce((s, p) => s + p.amount, 0));
    await db.RepairTicket.update(ticket.id, { tpv_paid_total_eur: round2((Number(ticket.tpv_paid_total_eur) || 0) + total), tpv_paid_at: now.toISOString() });
  }
  return { sale_ref: saleRef, movements };
}

export async function sessionSummary(deps: CashDeps, tenant: Row, body: Record<string, unknown>) {
  const { db } = deps;
  const reg = register(body.register_code);
  const session = typeof body.session_id === 'string'
    ? await findOne(db.CashClosing, { id: body.session_id, tenant_id: tenant.id })
    : await openSessionOf(db, tenant.id, reg);
  const prev = await lastClosed(db, tenant.id, reg, session?.status === 'abierta' ? session.id : '');
  const previous = prev ? { id: prev.id, z_number: prev.z_number ?? null, closed_at: prev.closed_at ?? null, next_day_float: nextDayFloat(prev), recharges_balance: prev.recharges_balance_eur ?? null } : null;
  if (!session) return { session: null, totals: null, movements: [], previous };
  const movements = await find(db.CashMovement, { tenant_id: tenant.id, closing_id: session.id }, { sort: 'created_date' });
  return { session, totals: computeSessionTotals(session, movements), movements, previous };
}

/**
 * Z close (port of closeCashSession): counted cash required; optional boxes default to the system value;
 * withdrawn ≤ counted; Z number per tenant+register; the cierre's own cutoff_at moves anything recorded
 * AFTER it to tomorrow's session (opened automatically with «fondo para mañana»). Only the cashier who
 * opened it or an owner/admin may close. A closed session is never modified again.
 */
export async function closeSession(deps: CashDeps, tenant: Row, actorId: string, role: string, body: Record<string, unknown>) {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const reg = register(body.register_code);
  const session = typeof body.session_id === 'string'
    ? await findOne(db.CashClosing, { id: body.session_id, tenant_id: tenant.id })
    : await openSessionOf(db, tenant.id, reg);
  if (!session) throw new CashError(400, 'No hay ninguna caja abierta.');
  if (session.status !== 'abierta') throw new CashError(400, 'Esa caja ya está cerrada.');
  if (role !== 'owner' && role !== 'admin' && session.opened_by !== actorId) {
    throw new CashError(403, 'Sólo el cajero que abrió la caja o el encargado pueden cerrarla.');
  }
  if (body.counted_cash === null || body.counted_cash === undefined || body.counted_cash === '') throw new CashError(400, 'Indica el dinero contado en el cajón.');
  const counted = parseMoney(body.counted_cash);
  if (counted === null || !Number.isFinite(counted) || counted < 0) throw new CashError(400, 'El dinero contado no es un importe válido.');
  const optional = (key: string, label: string) => {
    const v = parseMoney(body[key]);
    if (v !== null && (!Number.isFinite(v) || v < 0)) throw new CashError(400, `${label}: importe no válido`);
    return v;
  };
  // CashDro reports the cassette collection with a minus sign: withdrawn is always positive.
  { const w = parseMoney(body.withdrawn_cash); if (w !== null && Number.isFinite(w) && w < 0) body.withdrawn_cash = Math.abs(w); }
  const fondoIn = optional('opening_float', 'Fondo de caja de ayer');
  const cardIn = optional('card_total', 'Total cobrado con tarjeta');
  const withdrawnIn = optional('withdrawn_cash', 'Efectivo retirado');
  const rechargesIn = optional('recharges_total', 'Total recargas');
  const rechargesBalIn = optional('recharges_balance', 'Saldo de recargas');

  const all = await find(db.CashMovement, { tenant_id: tenant.id, closing_id: session.id }, { sort: 'created_date' });
  let cutoff = parseTs(body.cutoff_at as string | undefined);
  if (!Number.isFinite(cutoff) || !cutoff || cutoff > now.getTime() || cutoff < parseTs(String(session.opened_at ?? session.created_date))) cutoff = NaN;
  const isLate = (m: Row) => Number.isFinite(cutoff) && parseTs(m.created_date) > cutoff;
  const movements = all.filter((m) => !isLate(m));
  const late = all.filter(isLate);

  const totals = computeSessionTotals(session, movements);
  const last = (await find(db.CashClosing, { tenant_id: tenant.id, register_code: reg }, { sort: '-z_number', limit: 1 }))[0];
  const zNumber = (Number(last?.z_number) || 0) + 1;
  const real = round2(counted);
  const fondo = fondoIn ?? totals.openingFloat;
  const cardSystem = round2(totals.byMethod.card);
  const card = cardIn ?? cardSystem;
  const withdrawn = withdrawnIn ?? 0;
  if (withdrawn > real + 0.001) throw new CashError(400, 'No puedes retirar más efectivo del que hay en caja.');
  const c = computeCierre(totals, { fondo, tarjeta: card, real, retirado: withdrawn });

  const closed = await db.CashClosing.update(session.id, {
    status: 'cerrada', closed_at: now.toISOString(), closed_by: actorId,
    counted_cash_eur: real, denominations: body.counted_by_denomination && typeof body.counted_by_denomination === 'object' ? body.counted_by_denomination : {},
    expected_cash_eur: c.esperado, difference_eur: c.diferencia, difference_reason: String(body.difference_reason ?? '').slice(0, 500) || null,
    opening_float_declared_eur: fondo, sales_total_eur: c.ventas, card_total_system_eur: cardSystem, card_total_declared_eur: card,
    other_non_cash_eur: c.otherNonCash, withdrawn_cash_eur: withdrawn, next_day_float_eur: c.manana,
    ...(rechargesIn !== null ? { recharges_total_eur: rechargesIn } : {}),
    ...(rechargesBalIn !== null ? { recharges_balance_eur: rechargesBalIn } : {}),
    totals_by_method: totals.byMethod, ticket_count: totals.saleCount, refund_total_eur: totals.refundTotal, z_number: zNumber,
    cashdro_report: body.cashdro_report && typeof body.cashdro_report === 'object' ? body.cashdro_report : null,
    cutoff_at: Number.isFinite(cutoff) ? new Date(cutoff).toISOString() : null,
  });

  // Everything after the cutoff belongs to tomorrow: move it to the next session (opened with the new float).
  let nextSession: Row | null = null;
  if (late.length) {
    nextSession = await openSessionOf(db, tenant.id, reg) ?? await db.CashClosing.create({
      tenant_id: tenant.id, register_code: reg, status: 'abierta', opened_by: actorId, opened_at: now.toISOString(),
      business_date: madridDay(now), opening_float_eur: round2(c.manana ?? 0), ticket_count: 0, refund_total_eur: 0,
    });
    for (const m of late) await db.CashMovement.update(m.id, { closing_id: nextSession.id });
  }
  return { session: closed, totals: { ...totals, openingFloat: fondo, expectedCash: c.esperado }, z_number: zNumber,
    difference: c.diferencia, next_day_float: c.manana, moved_to_next: { movements: late.length, session_id: nextSession?.id ?? null } };
}
