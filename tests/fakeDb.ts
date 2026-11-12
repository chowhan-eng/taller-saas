// In-memory stand-in for base44.asServiceRole.entities (1-argument filter with equality matching).
import type { Entities, Row } from '../base44/shared/db.ts';

export function fakeDb(seed: Record<string, Row[]> = {}): Entities & { _rows: Record<string, Row[]> } {
  const rows: Record<string, Row[]> = {};
  let n = 0;
  const table = (name: string) => (rows[name] ??= (seed[name] ?? []).map((r) => ({ ...r })));
  const api = (name: string) => ({
    filter: async (q: Record<string, unknown>) => table(name).filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)).map((r) => ({ ...r })),
    list: async () => table(name).map((r) => ({ ...r })),
    get: async (id: string) => ({ ...table(name).find((r) => r.id === id)! }),
    create: async (data: Record<string, unknown>) => {
      const row = { id: `${name}-${++n}`, created_date: new Date(Date.now() + n).toISOString(), ...data } as Row;
      table(name).push(row);
      return { ...row };
    },
    update: async (id: string, data: Record<string, unknown>) => {
      const row = table(name).find((r) => r.id === id);
      if (!row) throw new Error(`${name} ${id} not found`);
      Object.assign(row, data);
      return { ...row };
    },
    delete: async (id: string) => { rows[name] = table(name).filter((r) => r.id !== id); },
  });
  return new Proxy({} as Entities & { _rows: Record<string, Row[]> }, {
    get: (_t, prop: string) => {
      if (prop === '_rows') return rows;
      table(prop);
      return api(prop);
    },
  });
}
