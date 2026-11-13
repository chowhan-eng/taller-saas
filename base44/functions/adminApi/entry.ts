// Platform-owner API for the /admin panel. NOT public: needs a signed-in user, and handleAdmin() answers
// 401 (anonymous) or 403 (any shop owner / staff) BEFORE touching any data. Admin = PLATFORM_ADMIN_EMAILS
// (default: the owner's address) or the Base44 app admin role.
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, withJsonErrors } from '../../shared/http.ts';
import { audit, handleAdmin } from '../../shared/admin.ts';
import { stripeClient } from '../../shared/stripe.ts';
import { recordBillingEvent, type LooseEvent } from '../../shared/billing.ts';
import type { Entities } from '../../shared/db.ts';

export default withJsonErrors('adminApi', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = base44.asServiceRole.entities as unknown as Entities;
  const ctx = { db, user, extraEmails: secrets.get('PLATFORM_ADMIN_EMAILS') ?? '' };

  if (body.action === 'syncStripe') {
    // Pull recent invoices from Stripe into the sales feed (history from before the webhook was wired).
    const gate = await handleAdmin(ctx, { action: 'whoami' });
    if (gate.status !== 200) return json(gate.body, gate.status);
    const key = secrets.get('STRIPE_SECRET_KEY');
    if (!key) return json({ error: 'Falta STRIPE_SECRET_KEY en los secretos de la app.' }, 400);
    const stripe = stripeClient(key);
    let paid = 0, failed = 0, added = 0, after: string | undefined;
    for (let page = 0; page < 3; page++) { // the 300 most recent invoices
      const res = await stripe.invoices.list({ limit: 100, ...(after ? { starting_after: after } : {}) });
      for (const inv of res.data) {
        const o = inv as unknown as Record<string, unknown> & { status_transitions?: { paid_at?: number | null }; created: number };
        if (o.status === 'paid') {
          paid++;
          if (await recordBillingEvent(db, { id: String(o.id), type: 'invoice.paid', created: o.status_transitions?.paid_at ?? o.created, data: { object: o } } as LooseEvent)) added++;
        } else if (o.status === 'open' && Number(o.attempt_count) > 0) {
          failed++;
          if (await recordBillingEvent(db, { id: String(o.id), type: 'invoice.payment_failed', created: o.created, data: { object: o } } as LooseEvent)) added++;
        }
      }
      if (!res.has_more || !res.data.length) break;
      after = res.data[res.data.length - 1].id;
    }
    await audit(db, String(user?.email ?? 'admin'), 'sync_stripe', null, `${paid} pagadas, ${failed} fallidas, ${added} nuevas`);
    return json({ ok: true, paid, failed, added });
  }

  const r = await handleAdmin(ctx, body);
  const stripeBase = String(secrets.get('STRIPE_SECRET_KEY') ?? '').startsWith('sk_test') ? 'https://dashboard.stripe.com/test' : 'https://dashboard.stripe.com';
  return json(r.status === 200 && body.action === 'tenants' ? { ...(r.body as object), stripe_base: stripeBase } : r.body, r.status);
});
