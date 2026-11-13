// Port of web/app/api/stripe/webhook/route.ts. The ONLY place that activates a tenant or changes its plan
// (and therefore the ONLY place that unlocks Reparo/TPV — see shared/modules.ts).
// Stripe endpoint URL: https://<your-app-domain>/functions/stripeWebhook
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, withJsonErrors } from '../../shared/http.ts';
import { mapSubStatus, mapTenantStatus, stripeClient, stripeCrypto, type Stripe } from '../../shared/stripe.ts';
import { find, type Entities } from '../../shared/db.ts';
import { recordBillingEvent, type LooseEvent } from '../../shared/billing.ts';

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
  // The admin panel's sales feed. Never allowed to make the webhook fail (Stripe would retry the billing change).
  await recordBillingEvent(db, event as unknown as LooseEvent).catch((e) => console.error('billing feed', e));
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode !== 'subscription' || !s.subscription) break;
        const sub = await stripe.subscriptions.retrieve(typeof s.subscription === 'string' ? s.subscription : s.subscription.id);
        await syncSubscription(db, sub, s.metadata?.tenant_id ?? s.client_reference_id ?? undefined);
        if (sub.metadata?.plan === 'founder') await scheduleFounderRenewal(stripe, sub);
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

/**
 * Founder lock-in: 1 year at 59 € (the price bought), then the founding rate 29 €/month for as long as they
 * stay. A Stripe subscription schedule makes the change automatic; the shop can cancel any time.
 */
async function scheduleFounderRenewal(stripe: Stripe, sub: Stripe.Subscription) {
  const monthly = secrets.get('STRIPE_PRICE_FOUNDER_MONTHLY');
  if (!monthly || sub.schedule) return;
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
  const first = schedule.phases[0];
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    phases: [
      { items: first.items.map((i) => ({ price: typeof i.price === 'string' ? i.price : i.price.id, quantity: i.quantity ?? 1 })), start_date: first.start_date, end_date: first.end_date },
      { items: [{ price: monthly, quantity: 1 }], iterations: 1, metadata: { tenant_id: String(sub.metadata?.tenant_id ?? ''), plan: 'founder' } },
    ],
  });
}

async function syncSubscription(db: Entities, sub: Stripe.Subscription, tenantHint?: string) {
  const tenantId = sub.metadata?.tenant_id || tenantHint;
  if (!tenantId) return;
  const plan = sub.metadata?.plan === 'pro' || sub.metadata?.plan === 'founder' ? sub.metadata.plan : 'starter';
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
  const [existing] = await find(db.Subscription, { tenant_id: tenantId }, { limit: 1 });
  // A plan granted by hand from the admin panel (courtesy) is not overwritten by Stripe: only the Stripe
  // bookkeeping fields are kept up to date, plan and status stay as the admin set them.
  if (existing?.manual_override === true) {
    await db.Subscription.update(existing.id, {
      stripe_customer_id: row.stripe_customer_id, stripe_subscription_id: row.stripe_subscription_id, current_period_end: row.current_period_end,
      trial_start: row.trial_start, trial_end: row.trial_end, cancel_at_period_end: row.cancel_at_period_end, ...(sub.trial_start ? { trial_used: true } : {}),
    });
    return;
  }
  if (existing) await db.Subscription.update(existing.id, row);
  else await db.Subscription.create(row);

  await db.Tenant.update(tenantId, { plan, status: mapTenantStatus(sub.status) });
}
