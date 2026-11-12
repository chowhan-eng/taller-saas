// Port of web/app/api/stripe/webhook/route.ts. The ONLY place that activates a tenant or changes its plan
// (and therefore the ONLY place that unlocks Reparo/TPV — see shared/modules.ts).
// Stripe endpoint URL: https://<your-app-domain>/functions/stripeWebhook
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, withJsonErrors } from '../../shared/http.ts';
import { mapSubStatus, mapTenantStatus, stripeClient, stripeCrypto, type Stripe } from '../../shared/stripe.ts';
import type { Entities } from '../../shared/db.ts';

export default withJsonErrors('stripeWebhook', async (req) => {
  const secret = secrets.get('STRIPE_WEBHOOK_SECRET');
  const sig = req.headers.get('stripe-signature');
  if (!secret || !sig) return new Response('missing signature', { status: 400 });

  const stripe = stripeClient(secrets.get('STRIPE_SECRET_KEY'));
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret, undefined, stripeCrypto);
  } catch {
    return new Response('bad signature', { status: 400 });
  }

  const db = createClientFromRequest(req).asServiceRole.entities as unknown as Entities;
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode !== 'subscription' || !s.subscription) break;
        const sub = await stripe.subscriptions.retrieve(typeof s.subscription === 'string' ? s.subscription : s.subscription.id);
        await syncSubscription(db, sub, s.metadata?.tenant_id ?? s.client_reference_id ?? undefined);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(db, event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
  } catch (e) {
    console.error('stripe webhook', event.type, e);
    return new Response('handler error', { status: 500 }); // Stripe retries
  }
  return json({ received: true });
});

async function syncSubscription(db: Entities, sub: Stripe.Subscription, tenantHint?: string) {
  const tenantId = sub.metadata?.tenant_id || tenantHint;
  if (!tenantId) return;
  const plan = sub.metadata?.plan === 'pro' ? 'pro' : 'starter';
  // current_period_end lives on the subscription (older API versions) or on its items (newer ones).
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;

  const row = {
    tenant_id: tenantId,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    plan,
    status: mapSubStatus(sub.status),
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    trial_start: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    // Once a trial has started it is spent, even if the shop cancels and comes back (checkout checks this).
    ...(sub.trial_start ? { trial_used: true } : {}),
  };
  const [existing] = await db.Subscription.filter({ tenant_id: tenantId }, undefined, 1);
  if (existing) await db.Subscription.update(existing.id, row);
  else await db.Subscription.create(row);

  await db.Tenant.update(tenantId, { plan, status: mapTenantStatus(sub.status) });
}
