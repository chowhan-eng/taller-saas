// Module: TPV / cierre de caja (Pro only). Scaffold: gate + action router. Port the TPV actions here.
// Cash data is append-only (CashMovement) and a 'cerrada' CashClosing is immutable — enforce both in handlers.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { json, withJsonErrors } from '../../shared/http.ts';
import { gateModule } from '../../shared/modules.ts';
import type { Entities } from '../../shared/db.ts';

export default withJsonErrors('tpv', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const body = (await req.json().catch(() => ({}))) as { tenantId?: string; action?: string };
  const db = base44.asServiceRole.entities as unknown as Entities;
  const gate = await gateModule(db, user?.id, body.tenantId, 'tpv', ['owner', 'admin', 'counter']);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  switch (body.action) {
    case 'openClosings': {
      const rows = await db.CashClosing.filter({ tenant_id: gate.tenant.id, status: 'abierta' }, '-created_date', 10);
      return json({ closings: rows });
    }
    default:
      return json({ error: 'Acción no disponible todavía.' }, 501);
  }
});
