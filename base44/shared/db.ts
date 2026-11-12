// Minimal structural type for `base44.asServiceRole.entities.<Name>` so shared code stays typed
// without depending on generated types. Methods are the documented Base44 SDK entity methods.
export type Row = Record<string, unknown> & { id: string; created_date?: string };
export type EntityApi = {
  /** Call with ONE argument only (see find()). */
  filter(query: Record<string, unknown>): Promise<Row[]>;
  get?(id: string): Promise<Row>;
  list(sort?: string, limit?: number): Promise<Row[]>;
  create(data: Record<string, unknown>): Promise<Row>;
  bulkCreate?(data: Record<string, unknown>[]): Promise<Row[]>;
  update(id: string, data: Record<string, unknown>): Promise<Row>;
  delete(id: string): Promise<unknown>;
};
export type Entities = Record<string, EntityApi>;

/**
 * Query with sort/limit applied in JS. Production lesson from WhatsApp Inbox Pro (live Base44 app):
 * the 3-argument filter(query, sort, limit) threw in SDK 0.8.3x and caused silent failures, so
 * only the 1-argument filter(query) is ever called. Sort keys compare as strings (ISO dates sort
 * correctly); prefix with '-' for descending.
 */
export async function find(
  api: EntityApi, query: Record<string, unknown>, opts: { sort?: string; limit?: number } = {},
): Promise<Row[]> {
  const rows = await api.filter(query);
  const list = Array.isArray(rows) ? [...rows] : [];
  if (opts.sort) {
    const desc = opts.sort.startsWith('-');
    const key = opts.sort.replace(/^-/, '');
    list.sort((a, b) => {
      const va = String(a[key] ?? ''), vb = String(b[key] ?? '');
      return (va < vb ? -1 : va > vb ? 1 : 0) * (desc ? -1 : 1);
    });
  }
  return opts.limit ? list.slice(0, opts.limit) : list;
}

/** First match or null (1-argument filter). */
export async function findOne(api: EntityApi, query: Record<string, unknown>, sort?: string): Promise<Row | null> {
  return (await find(api, query, { sort, limit: 1 }))[0] ?? null;
}
