// Module: Reparo CRM (Pro only). Scaffold: gate + action router. The customer actions are complete and are
// the reference for how every port must touch PII: through shared/customers.ts, never raw entity writes.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, withJsonErrors } from '../../shared/http.ts';
import { gateModule } from '../../shared/modules.ts';
import { fieldCrypto } from '../../shared/crypto.ts';
import { decodeCustomer, encodeCustomer, findCustomerByPhone, type CustomerInput } from '../../shared/customers.ts';
import type { Entities } from '../../shared/db.ts';

export default withJsonErrors('reparo', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const body = (await req.json().catch(() => ({}))) as { tenantId?: string; action?: string; customer?: CustomerInput; customerId?: string; phone?: string };
  const db = base44.asServiceRole.entities as unknown as Entities;
  const gate = await gateModule(db, user?.id, body.tenantId, 'reparo');
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const tenantId = gate.tenant.id;
  const fc = fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY'));

  switch (body.action) {
    case 'createCustomer': {
      if (!body.customer) return json({ error: 'Petición no válida' }, 400);
      let row;
      try {
        row = await encodeCustomer(fc, tenantId, body.customer);
      } catch {
        return json({ error: 'Revisa el nombre y el teléfono del cliente.' }, 400);
      }
      if (row.phone_hash && (await db.Customer.filter({ tenant_id: tenantId, phone_hash: row.phone_hash }, undefined, 1)).length) {
        return json({ error: 'Ya existe un cliente con ese teléfono.' }, 409);
      }
      const created = await db.Customer.create(row);
      return json({ customer: await decodeCustomer(fc, created) });
    }
    case 'getCustomer': {
      const [row] = await db.Customer.filter({ id: body.customerId, tenant_id: tenantId }, undefined, 1);
      if (!row) return json({ error: 'Cliente no encontrado' }, 404);
      return json({ customer: await decodeCustomer(fc, row) });
    }
    case 'findCustomerByPhone': {
      const row = body.phone ? await findCustomerByPhone(db, fc, tenantId, body.phone) : null;
      return json({ customer: row ? await decodeCustomer(fc, row) : null });
    }
    default:
      return json({ error: 'Acción no disponible todavía.' }, 501);
  }
});
