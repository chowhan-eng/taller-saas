// TPV action router. EVERY action passes gateModule('tpv') first (ACTIVE PAID PRO subscription; Starter →
// 402) and the counter roles (technicians cannot touch the cash). Free of Base44 runtime imports for tests.
import type { Entities } from './db.ts';
import { gateModule } from './modules.ts';
import { CashError, cashMovement, closeSession, openSession, recordSale, sessionSummary } from './cash.ts';

export const TPV_ACTIONS = ['openSession', 'movement', 'recordSale', 'summary', 'close'] as const;

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
      case 'recordSale': return { status: 200, body: await recordSale(deps, gate.tenant, actor, body) };
      case 'summary': return { status: 200, body: await sessionSummary(deps, gate.tenant, body) };
      case 'close': return { status: 200, body: await closeSession(deps, gate.tenant, actor, gate.role, body) };
      default: return { status: 501, body: { error: 'Acción no disponible todavía.' } };
    }
  } catch (e) {
    if (e instanceof CashError) return { status: e.status, body: { error: e.message } };
    throw e;
  }
}
