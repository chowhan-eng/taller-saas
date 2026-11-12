import { describe, expect, it } from 'vitest';
import { computeCierre, computeSessionTotals, parseMoney, closeSession, openSession, recordSale, cashMovement } from '../base44/shared/cash.ts';
import type { Row } from '../base44/shared/db.ts';
import { fakeDb } from './fakeDb.ts';

const tenant: Row = { id: 'T1', plan: 'pro', status: 'active' };
let seq = 0;
const mv = (kind: string, method: string, amount: number, extra: Record<string, unknown> = {}): Row => ({ id: `mv${++seq}`, kind, method, amount_eur: amount, ...extra });

describe('parseMoney (verbatim port)', () => {
  it('Spanish formats', () => {
    expect(parseMoney('12,50')).toBe(12.5);
    expect(parseMoney('1.234,56')).toBe(1234.56);
    expect(parseMoney(' 7 €')).toBe(7);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNaN();
  });
});

describe('cierre sums (paper formula)', () => {
  it('esperado = fondo + ventas − tarjeta − otros + entradas − salidas; refunds subtract', () => {
    const totals = computeSessionTotals({ opening_float_eur: 100 }, [
      mv('sale', 'cash', 50, { sale_ref: 'a' }), mv('sale', 'card', 30, { sale_ref: 'b' }), mv('sale', 'bizum', 20, { sale_ref: 'c' }),
      mv('refund', 'cash', 10, { sale_ref: 'd' }), mv('cash_in', 'cash', 5), mv('cash_out', 'cash', 15),
    ]);
    expect(totals).toMatchObject({ salesTotal: 90, refundTotal: 10, cashRefund: 10, saleCount: 3, refundCount: 1, cashIn: 5, cashOut: 15, expectedCash: 130 });
    expect(totals.byMethod).toMatchObject({ cash: 40, card: 30, bizum: 20 });
    const c = computeCierre(totals, { fondo: 100, tarjeta: 30, real: 128, retirado: 50 });
    // 100 + 90 − 30 − 20 + 5 − 15 = 130
    expect(c).toEqual({ ventas: 90, otherNonCash: 20, esperado: 130, diferencia: -2, manana: 78 });
  });
});

describe('cash session lifecycle', () => {
  const NOW = new Date('2026-11-12T19:00:00Z');
  it('open → sales → idempotent movement → Z close → next opening uses «fondo para mañana»', async () => {
    const db = fakeDb();
    const { session } = await openSession({ db, now: NOW }, tenant, 'U1', { opening_float: '100,00' });
    expect((await openSession({ db, now: NOW }, tenant, 'U1', {})).existing).toBe(true);
    await recordSale({ db, now: NOW }, tenant, 'U1', { payments: [{ method: 'cash', amount: 50 }, { method: 'card', amount: 30 }] });
    const m1 = await cashMovement({ db, now: NOW }, tenant, 'U1', { type: 'out', amount: '20', reason: 'cambio', client_request_id: 'req-1' });
    const m2 = await cashMovement({ db, now: NOW }, tenant, 'U1', { type: 'out', amount: '20', reason: 'cambio', client_request_id: 'req-1' });
    expect(m2).toMatchObject({ duplicate: true, movement: { id: m1.movement.id } });
    const z = await closeSession({ db, now: NOW }, tenant, 'U1', 'counter', { counted_cash: '129,50', withdrawn_cash: '-79,50', recharges_total: '12', recharges_balance: '88' });
    // esperado = 100 + 80 − 30 − 0 + 0 − 20 = 130 → diferencia −0,50; fondo mañana 129,50 − 79,50 = 50
    expect(z).toMatchObject({ z_number: 1, difference: -0.5, next_day_float: 50 });
    expect(z.session).toMatchObject({ status: 'cerrada', withdrawn_cash_eur: 79.5, recharges_balance_eur: 88, ticket_count: 1 });
    await expect(closeSession({ db, now: NOW }, tenant, 'U1', 'owner', { session_id: session.id, counted_cash: 1 })).rejects.toThrow('ya está cerrada');
    const next = await openSession({ db, now: NOW }, tenant, 'U1', {});
    expect(next.session.opening_float_eur).toBe(50);
  });

  it('refuses: no open session, withdrawing more than counted, another cashier closing', async () => {
    const db = fakeDb();
    await expect(recordSale({ db }, tenant, 'U1', { payments: [{ method: 'cash', amount: 5 }] })).rejects.toThrow('No hay ninguna caja abierta');
    await openSession({ db }, tenant, 'U1', { opening_float: 10 });
    await expect(closeSession({ db }, tenant, 'U1', 'counter', { counted_cash: 10, withdrawn_cash: 11 })).rejects.toThrow('No puedes retirar');
    await expect(closeSession({ db }, tenant, 'U2', 'counter', { counted_cash: 10 })).rejects.toThrow('Sólo el cajero');
    await expect(recordSale({ db }, tenant, 'U1', { payments: [{ method: 'crypto', amount: 5 }] })).rejects.toThrow('Forma de pago');
  });

  it('anything recorded after the cierre cutoff moves to tomorrow', async () => {
    const db = fakeDb();
    const t0 = new Date('2026-11-12T08:00:00Z');
    await openSession({ db, now: t0 }, tenant, 'U1', { opening_float: 0 });
    await recordSale({ db, now: t0 }, tenant, 'U1', { payments: [{ method: 'cash', amount: 10 }] });
    await new Promise((r) => setTimeout(r, 15));
    const cutoff = new Date().toISOString(); // fakeDb stamps created_date with the real clock
    await new Promise((r) => setTimeout(r, 15));
    await recordSale({ db, now: t0 }, tenant, 'U1', { payments: [{ method: 'cash', amount: 7 }] });
    const z = await closeSession({ db, now: new Date(Date.now() + 1000) }, tenant, 'U1', 'owner', { counted_cash: 10, cutoff_at: cutoff });
    expect(z.totals.salesTotal).toBe(10);
    expect(z.moved_to_next.movements).toBe(1);
    const open = db._rows.CashClosing.find((s) => s.status === 'abierta')!;
    expect(db._rows.CashMovement.filter((m) => m.closing_id === open.id)).toHaveLength(1);
  });
});
