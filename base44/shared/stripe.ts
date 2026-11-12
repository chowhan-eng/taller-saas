// SERVER ONLY (Base44 Deno runtime). Port of web/lib/stripe.ts.
import Stripe from 'npm:stripe@17.7.0';

export function stripeClient(secretKey: string | undefined): Stripe {
  if (!secretKey) throw new Error('Missing STRIPE_SECRET_KEY');
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

/** WebCrypto signature verification (Deno has no Node crypto for Stripe's sync verifier). */
export const stripeCrypto = Stripe.createSubtleCryptoProvider();

export const PLANS = {
  starter: { label: 'Starter', priceSecret: 'STRIPE_PRICE_STARTER', eur: 39 },
  pro: { label: 'Pro', priceSecret: 'STRIPE_PRICE_PRO', eur: 79 },
} as const;
export type PlanCode = keyof typeof PLANS;

/** Stripe subscription status → Subscription.status enum. */
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

/** Stripe subscription status → Tenant.status enum. */
export function mapTenantStatus(s: Stripe.Subscription.Status): string {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'canceled') return 'cancelled';
  if (s === 'past_due' || s === 'unpaid' || s === 'paused') return 'past_due';
  return 'onboarding';
}

export type { Stripe };
