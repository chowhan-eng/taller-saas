import { find, type Entities, type Row } from './db.ts';

/** Active membership of `userId` in `tenantId`, or null. Replaces private.is_member()/has_role(). */
export async function membership(db: Entities, tenantId: string, userId: string): Promise<Row | null> {
  const rows = await find(db.TenantUser, { tenant_id: tenantId, user_id: userId, active: true }, { sort: '-created_date', limit: 1 });
  return rows[0] ?? null;
}

/** First tenant the user owns (onboarding resumes at step 3 if there is one). */
export async function ownedTenantId(db: Entities, userId: string): Promise<string | null> {
  const rows = await find(db.TenantUser, { user_id: userId, role: 'owner', active: true }, { sort: 'created_date', limit: 3 });
  return (rows[0]?.tenant_id as string | undefined) ?? null;
}
