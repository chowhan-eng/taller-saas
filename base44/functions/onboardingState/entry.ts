// Onboarding step routing (was a direct tenant_users query from the browser under Supabase RLS).
import { createClientFromRequest } from 'npm:@base44/sdk';
import { json, withJsonErrors } from '../../shared/http.ts';
import { ownedTenantId } from '../../shared/tenancy.ts';
import type { Entities } from '../../shared/db.ts';

export default withJsonErrors('onboardingState', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);
  const db = base44.asServiceRole.entities as unknown as Entities;
  return json({ tenantId: await ownedTenantId(db, user.id) });
});
