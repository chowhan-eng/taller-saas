// Calls to the gated module functions. Every call carries the tenant; the server re-checks plan and role.
import { callFn } from '@/lib/base44';

export type Ctx = { tenantId: string; role: string; plan: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function mod<T extends object = Record<string, unknown>>(fn: 'whatsapp' | 'reparo' | 'tpv', ctx: Ctx, action: string, body: Record<string, unknown> = {}) {
  const r = await callFn<T>(fn, { tenantId: ctx.tenantId, action, ...body });
  if (!r.ok) throw new ApiError(r.status, r.data.error ?? `Error ${r.status}`);
  return r.data as T;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const euros = (n: unknown) => `${(Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export const when = (iso: unknown) => {
  if (!iso) return '';
  const s = String(iso);
  return new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
};
