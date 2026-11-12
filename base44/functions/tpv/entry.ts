// Module: TPV / caja (Pro only). Thin wrapper over shared/tpvApi.ts (Pro gate + counter roles first).
// The CashDro is driven from the browser through the shop's local «Puente CashDro» (src/lib/cashdro.ts);
// this backend records the money and the cierre, and stores the CashDro levels snapshot taken at the Z.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { json, withJsonErrors } from '../../shared/http.ts';
import { handleTpv } from '../../shared/tpvApi.ts';
import type { Entities } from '../../shared/db.ts';

export default withJsonErrors('tpv', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await handleTpv({ db: base44.asServiceRole.entities as unknown as Entities, userId: user?.id }, body);
  return json(r.body, r.status);
});
