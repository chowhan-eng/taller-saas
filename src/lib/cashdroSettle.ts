/**
 * CashDro operation outcomes — the decision logic of the live TPV CashDroPayDialog, as pure functions.
 * Terminal phases of an operation: starting → running ⇄ lost (bridge silent) → canceling → checking →
 * done | aborted | confirm (a human must say how much came out). 'blocked' = another operation is active;
 * 'failed' = could not start. While running/canceling/lost/checking/confirm the dialog can NOT be closed
 * without cancelling on the machine: money is never taken without a ticket.
 */
export type CashdroPhase = 'starting' | 'running' | 'canceling' | 'lost' | 'blocked' | 'failed' | 'checking' | 'confirm';
export const LOCKED_PHASES: CashdroPhase[] = ['starting', 'running', 'canceling', 'lost', 'checking', 'confirm'];
export const isLocked = (p: CashdroPhase) => LOCKED_PHASES.includes(p);
export const POLL_MS = 800;
export const MAX_FAILS = 12; // ~10 s without an answer from the bridge → 'lost'

export type SaleOp = { id: string; canceled?: boolean; insertedCents: number; returnedCents: number; changeNotAvailableCents?: number };
export type Outcome =
  | { kind: 'done'; operationId: string; insertedCents?: number; returnedCents?: number; changeNotAvailableCents?: number; dispensedCents?: number; shortCents?: number; source?: string }
  | { kind: 'aborted'; message: string }
  | { kind: 'confirm'; operationId: string };

const fmt = (cents: number) => `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** A finished SALE: paid only if not cancelled and the inserted amount covers the price. */
export function settleSale(result: SaleOp, amountCents: number): Outcome {
  if (!result.canceled && result.insertedCents >= amountCents) {
    return { kind: 'done', operationId: result.id, insertedCents: result.insertedCents, returnedCents: result.returnedCents, changeNotAvailableCents: result.changeNotAvailableCents };
  }
  const back = result.returnedCents;
  return { kind: 'aborted', message: back > 0 ? `Cobro cancelado. La CashDro ha devuelto ${fmt(back)} al cliente.` : 'Cobro cancelado en la CashDro. No se ha cobrado nada.' };
}

/**
 * A finished PAYOUT: what really came out. The CashDro sometimes closes with totalout = 0 although it paid,
 * so the machine counters before/after win; then the operation's own figure; if neither is clear, a person
 * must confirm (never assume nothing came out).
 */
export function settlePayout(p: { operationId: string; amountCents: number; beforeCents: number | null; afterCents: number | null; reportedCents: number; canceled: boolean }): Outcome {
  const delta = p.beforeCents !== null && p.afterCents !== null ? p.beforeCents - p.afterCents : null;
  const reported = Math.max(0, Number(p.reportedCents) || 0);
  let dispensed: number | null = null;
  let source = '';
  if (delta !== null && delta > 0) { dispensed = Math.min(delta, p.amountCents); source = 'contadores de la CashDro'; }
  else if (reported > 0) { dispensed = Math.min(reported, p.amountCents); source = 'operación de la CashDro'; }
  else if (delta === 0 && p.canceled) dispensed = 0;
  if (dispensed === null) return { kind: 'confirm', operationId: p.operationId };
  if (dispensed === 0) return { kind: 'aborted', message: 'Pago cancelado en la CashDro. No ha salido dinero (comprobado en sus contadores).' };
  return { kind: 'done', operationId: p.operationId, dispensedCents: dispensed, shortCents: Math.max(0, p.amountCents - dispensed), source };
}

/** The person at the tray confirms the payout by hand. */
export function confirmPayoutByHand(operationId: string, cents: number, amountCents: number): Outcome {
  if (!(cents > 0)) return { kind: 'aborted', message: 'No ha salido dinero de la CashDro (confirmado a mano). No se ha apuntado nada.' };
  const value = Math.min(cents, amountCents);
  return { kind: 'done', operationId, dispensedCents: value, shortCents: Math.max(0, amountCents - value), source: 'confirmado a mano' };
}
