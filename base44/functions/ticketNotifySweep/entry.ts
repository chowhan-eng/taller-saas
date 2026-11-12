// Scheduled (every 5 min, like Reparo's workflow): sends the due ticket WhatsApp notices of every shop.
// It only processes notices already queued by the reparo function; a shared secret (CRON_KEY, sent as the
// X-Cron-Key header by the scheduler) keeps anyone else from triggering it.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, withJsonErrors } from '../../shared/http.ts';
import { fieldCrypto } from '../../shared/crypto.ts';
import { isProActive } from '../../shared/modules.ts';
import { sweepNotices } from '../../shared/ticketNotify.ts';
import type { Entities } from '../../shared/db.ts';

export const config = { public: true };

export default withJsonErrors('ticketNotifySweep', async (req) => {
  const key = secrets.get('CRON_KEY');
  if (!key || req.headers.get('x-cron-key') !== key) return json({ error: 'forbidden' }, 403);
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities as unknown as Entities;
  const results = await sweepNotices(
    { db, fc: fieldCrypto(secrets.get('FIELD_ENCRYPTION_KEY')), secret: (n) => secrets.get(n) },
    (t) => isProActive(db, t),
  );
  return json({ ok: true, processed: results.length, results });
});
