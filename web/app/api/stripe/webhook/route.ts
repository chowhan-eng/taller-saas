import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { mapSubStatus, mapTenantStatus, stripeClient } from '@/lib/stripe';
import { withJsonErrors } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The ONLY place that activates a tenant. success_url pages never change billing state. */
export const POST = withJsonErrors(handle);

async function handle(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get('stripe-signature');
  if (!secret || !sig) return new NextResponse('missing signature', { status: 400 });

  const stripe = stripeClient();
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch {
    return new NextResponse('bad signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode !== 'subscription' || !s.subscription) break;
        const sub = await stripe.subscriptions.retrieve(typeof s.subscription === 'string' ? s.subscription : s.subscription.id);
        await syncSubscription(sub, s.metadata?.tenant_id ?? s.client_reference_id ?? undefined);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
  } catch (e) {
    console.error('stripe webhook', event.type, e);
    return new NextResponse('handler error', { status: 500 }); // Stripe retries
  }
  return NextResponse.json({ received: true });
}

async function syncSubscription(sub: Stripe.Subscription, tenantHint?: string) {
  const tenantId = sub.metadata?.tenant_id || tenantHint;
  if (!tenantId) return;
  const plan = sub.metadata?.plan === 'pro' ? 'pro' : 'starter';
  // current_period_end lives on the subscription (older API versions) or on its items (newer ones).
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;

  const db = supabaseAdmin();
  const { error: subErr } = await db.from('subscriptions').upsert({
    tenant_id: tenantId,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    plan,
    status: mapSubStatus(sub.status),
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end,
  }, { onConflict: 'tenant_id' });
  if (subErr) throw subErr;

  const { error: tErr } = await db.from('tenants').update({ plan, status: mapTenantStatus(sub.status) }).eq('id', tenantId);
  if (tErr) throw tErr;
}
