// Minimal structural type for `base44.asServiceRole.entities.<Name>` so shared code stays typed
// without depending on generated types. Methods are the documented Base44 SDK entity methods.
export type Row = Record<string, unknown> & { id: string; created_date?: string };
export type EntityApi = {
  filter(query: Record<string, unknown>, sort?: string, limit?: number): Promise<Row[]>;
  list(sort?: string, limit?: number): Promise<Row[]>;
  create(data: Record<string, unknown>): Promise<Row>;
  bulkCreate?(data: Record<string, unknown>[]): Promise<Row[]>;
  update(id: string, data: Record<string, unknown>): Promise<Row>;
  delete(id: string): Promise<unknown>;
};
export type Entities = Record<string, EntityApi>;
