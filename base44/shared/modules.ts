// Plan gating for the three packaged apps. Single source of truth: change entitlements HERE only.
//   Starter (39 €/mes) = WhatsApp Pro (auto-avisos, recepcionista IA, reseñas)
//   Pro     (79 €/mes) = WhatsApp Pro + Reparo (tickets/CRM) + TPV (caja)
import { find, type Entities, type Row } from './db.ts';
import { membership } from './tenancy.ts';

export type ModuleCode = 'whatsapp' | 'reparo' | 'tpv';
export type Role = 'owner' | 'admin' | 'counter' | 'technician';

export const MODULE_PLANS: Record<ModuleCode, readonly string[]> = {
  whatsapp: ['starter', 'pro'],
  reparo: ['pro'],
  tpv: ['pro'],
};

/** Same statuses as private.tenant_active() in the old SQL: the tenant can use its plan's modules. */
export const USABLE_STATUSES = ['onboarding', 'active', 'past_due'] as const;

export function entitlementsFor(plan: unknown, status: unknown): ModuleCode[] {
  if (!USABLE_STATUSES.includes(status as (typeof USABLE_STATUSES)[number])) return [];
  return (Object.keys(MODULE_PLANS) as ModuleCode[]).filter((m) => MODULE_PLANS[m].includes(String(plan)));
}

export type Gate =
  | { ok: true; tenant: Row; role: Role }
  | { ok: false; status: 401 | 402 | 403 | 404; error: string };

/**
 * Every module call goes through here: signed-in user → active membership → tenant usable → plan includes
 * the module → role allowed. Plan comes from the Tenant row, which ONLY stripeWebhook changes.
 */
export async function gateModule(
  db: Entities, userId: string | undefined, tenantId: unknown, module: ModuleCode, roles?: readonly Role[],
): Promise<Gate> {
  if (!userId) return { ok: false, status: 401, error: 'Tu sesión ha caducado. Vuelve a entrar.' };
  if (typeof tenantId !== 'string' || !tenantId) return { ok: false, status: 404, error: 'Taller no encontrado' };
  const member = await membership(db, tenantId, userId);
  if (!member) return { ok: false, status: 403, error: 'No tienes acceso a este taller.' };
  const [tenant] = await find(db.Tenant, { id: tenantId }, { limit: 1 });
  if (!tenant) return { ok: false, status: 404, error: 'Taller no encontrado' };
  if (!entitlementsFor(tenant.plan, tenant.status).includes(module)) {
    return { ok: false, status: 402, error: 'Tu plan no incluye este módulo. Pásate a Pro para activarlo.' };
  }
  const role = member.role as Role;
  if (roles && !roles.includes(role)) return { ok: false, status: 403, error: 'Tu usuario no tiene permiso para esta acción.' };
  return { ok: true, tenant, role };
}
