// Which of the 3 modules this user's shop may use (drives the app menu). Gating itself happens server-side
// in each module function — hiding a menu item is UX, not security.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { json, withJsonErrors } from '../../shared/http.ts';
import { entitlementsFor } from '../../shared/modules.ts';
import { membership } from '../../shared/tenancy.ts';
import { find, type Entities } from '../../shared/db.ts';

export default withJsonErrors('entitlements', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);
  const { tenantId } = (await req.json().catch(() => ({}))) as { tenantId?: string };
  if (!tenantId) return json({ error: 'Taller no encontrado' }, 404);
  const db = base44.asServiceRole.entities as unknown as Entities;
  const member = await membership(db, tenantId, user.id);
  if (!member) return json({ error: 'No tienes acceso a este taller.' }, 403);
  const [tenant] = await find(db.Tenant, { id: tenantId }, { limit: 1 });
  if (!tenant) return json({ error: 'Taller no encontrado' }, 404);
  return json({ plan: tenant.plan, status: tenant.status, role: member.role, modules: entitlementsFor(tenant.plan, tenant.status) });
});
