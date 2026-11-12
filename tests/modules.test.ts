import { describe, expect, it } from 'vitest';
import { entitlementsFor, gateModule } from '../base44/shared/modules.ts';
import type { Entities, Row } from '../base44/shared/db.ts';

describe('plan gating', () => {
  it('Starter = WhatsApp only; Pro = all three', () => {
    expect(entitlementsFor('starter', 'active')).toEqual(['whatsapp']);
    expect(entitlementsFor('pro', 'active')).toEqual(['whatsapp', 'reparo', 'tpv']);
  });
  it('suspended/cancelled tenants get nothing; unknown plans get nothing', () => {
    expect(entitlementsFor('pro', 'suspended')).toEqual([]);
    expect(entitlementsFor('pro', 'cancelled')).toEqual([]);
    expect(entitlementsFor('enterprise', 'active')).toEqual([]);
  });
});

function fakeDb(tenants: Row[], members: Row[]): Entities {
  const match = (rows: Row[]) => async (q: Record<string, unknown>) => rows.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v));
  const api = (rows: Row[]) => ({ filter: match(rows), list: async () => rows, create: async () => rows[0], update: async () => rows[0], delete: async () => null });
  return { Tenant: api(tenants), TenantUser: api(members) } as unknown as Entities;
}

describe('gateModule', () => {
  const db = fakeDb(
    [{ id: 'tS', plan: 'starter', status: 'active' }, { id: 'tP', plan: 'pro', status: 'active' }],
    [
      { id: 'm1', tenant_id: 'tS', user_id: 'u1', role: 'owner', active: true },
      { id: 'm2', tenant_id: 'tP', user_id: 'u2', role: 'technician', active: true },
    ],
  );
  it('requires sign-in', async () => expect(await gateModule(db, undefined, 'tS', 'whatsapp')).toMatchObject({ ok: false, status: 401 }));
  it('blocks users of another tenant', async () => expect(await gateModule(db, 'u1', 'tP', 'whatsapp')).toMatchObject({ ok: false, status: 403 }));
  it('Starter shop gets WhatsApp', async () => expect(await gateModule(db, 'u1', 'tS', 'whatsapp')).toMatchObject({ ok: true }));
  it('Starter shop is refused Reparo and TPV with 402', async () => {
    expect(await gateModule(db, 'u1', 'tS', 'reparo')).toMatchObject({ ok: false, status: 402 });
    expect(await gateModule(db, 'u1', 'tS', 'tpv')).toMatchObject({ ok: false, status: 402 });
  });
  it('role restriction applies inside an entitled module', async () => {
    expect(await gateModule(db, 'u2', 'tP', 'reparo')).toMatchObject({ ok: true, role: 'technician' });
    expect(await gateModule(db, 'u2', 'tP', 'tpv', ['owner', 'admin', 'counter'])).toMatchObject({ ok: false, status: 403 });
  });
});
