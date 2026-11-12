// SERVER ONLY.
import Stripe from 'stripe';

let stripe: Stripe | null = null;

export function stripeClient(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('Missing STRIPE_SECRET_KEY');
    stripe = new Stripe(key);
  }
  return stripe;
}

export const PLANS = {
  starter: { label: 'Starter', priceEnv: 'STRIPE_PRICE_STARTER', eur: 29 },
  pro: { label: 'Pro', priceEnv: 'STRIPE_PRICE_PRO', eur: 69 },
} as const;
export type PlanCode = keyof typeof PLANS;

/** Stripe subscription status → public.sub_status enum. */
export function mapSubStatus(s: Stripe.Subscription.Status): string {
  switch (s) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'past_due': return 'past_due';
    case 'unpaid': return 'unpaid';
    case 'canceled': return 'cancelled';
    case 'paused': return 'past_due';
    default: return 'incomplete';
  }
}

/** Stripe subscription status → public.tenant_status enum. */
export function mapTenantStatus(s: Stripe.Subscription.Status): string {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'canceled') return 'cancelled';
  if (s === 'past_due' || s === 'unpaid' || s === 'paused') return 'past_due';
  return 'onboarding';
}
