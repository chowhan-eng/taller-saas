// Module: Reparo CRM (Pro only). Thin wrapper: every action is routed by shared/reparoApi.ts, which gates
// on an active paid Pro subscription before anything else.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, withJsonErrors } from '../../shared/http.ts';
import { fieldCrypto } from '../../shared/crypto.ts';
import { handleReparo } from '../../shared/reparoApi.ts';
import type { Entities } from '../../shared/db.ts';

export default withJsonErrors('reparo', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = base44.asServiceRole.entities as unknown as Entities;
  const r = await handleReparo({ db, fc: fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY')), userId: user?.id }, body);
  return json(r.body, r.status);
});
