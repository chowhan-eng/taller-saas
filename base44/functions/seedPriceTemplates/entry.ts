// One-off, admin only: loads the 24 global price templates (was the seed INSERT in 001). Idempotent.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { json, withJsonErrors } from '../../shared/http.ts';
import { GLOBAL_TENANT, PRICE_TEMPLATES } from '../../shared/priceTemplates.ts';
import { find, type Entities } from '../../shared/db.ts';

export default withJsonErrors('seedPriceTemplates', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (user?.role !== 'admin') return json({ error: 'admin only' }, 403);
  const db = base44.asServiceRole.entities as unknown as Entities;
  if ((await find(db.PriceItem, { tenant_id: GLOBAL_TENANT }, { limit: 1 })).length) return json({ ok: true, inserted: 0 });
  const rows = PRICE_TEMPLATES.map((p) => ({ ...p, tenant_id: GLOBAL_TENANT, active: true }));
  if (db.PriceItem.bulkCreate) await db.PriceItem.bulkCreate(rows);
  else for (const r of rows) await db.PriceItem.create(r);
  return json({ ok: true, inserted: rows.length });
});
