// Stripe event → BillingEvent feed row. Pure mapping (no Stripe import) so it is testable; the webhook and the
// admin «sync» both go through recordBillingEvent, which dedupes on stripe_event_id.
import { findOne, type Entities } from './db.ts';

// deno-lint-ignore no-explicit-any
export type LooseEvent = { id: string; type: string; created?: number; data: { object: any; previous_attributes?: any } };
export type BillingRow = {
  stripe_event_id: string; kind: string; tenant_id: string | null; plan: string | null; amount_cents: number; currency: string; status: string | null;
  stripe_customer_id: string | null; stripe_subscription_id: string | null; detail: string; occurred_at: string;
};

const idOf = (v: unknown): string | null => (typeof v === 'string' ? v : (v as { id?: string } | null)?.id ?? null);
const at = (e: LooseEvent) => new Date((e.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

/** Map a Stripe event to a feed row, or null when the event is not worth showing. */
export function billingRowFor(e: LooseEvent): BillingRow | null {
  const o = e.data.object;
  const base = { tenant_id: (o?.metadata?.tenant_id as string) ?? null, plan: (o?.metadata?.plan as string) ?? null, currency: String(o?.currency ?? 'eur'), occurred_at: at(e) };
  const invoiceMeta = (key: 'tenant_id' | 'plan') => (o?.subscription_details?.metadata?.[key] ?? o?.parent?.subscription_details?.metadata?.[key] ?? base[key]) as string | null;
  const invoiceSub = idOf(o?.subscription) ?? idOf(o?.parent?.subscription_details?.subscription);
  switch (e.type) {
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      return { ...base, stripe_event_id: `${o.id}:paid`, kind: 'payment', amount_cents: Number(o.amount_paid) || 0, status: 'paid', stripe_customer_id: idOf(o.customer),
        stripe_subscription_id: invoiceSub, detail: String(o.number ?? o.id).slice(0, 100), tenant_id: invoiceMeta('tenant_id'), plan: invoiceMeta('plan') };
    case 'invoice.payment_failed':
      return { ...base, stripe_event_id: `${o.id}:failed:${Number(o.attempt_count) || 1}`, kind: 'payment_failed', amount_cents: Number(o.amount_due) || 0, status: 'failed', stripe_customer_id: idOf(o.customer),
        stripe_subscription_id: invoiceSub, detail: `intento ${Number(o.attempt_count) || 1}`, tenant_id: invoiceMeta('tenant_id'), plan: invoiceMeta('plan') };
    case 'checkout.session.completed':
      return { ...base, stripe_event_id: e.id, kind: 'checkout_completed', amount_cents: Number(o.amount_total) || 0, status: String(o.payment_status ?? ''), stripe_customer_id: idOf(o.customer),
        stripe_subscription_id: idOf(o.subscription), detail: 'Alta por Checkout', tenant_id: (o.metadata?.tenant_id ?? o.client_reference_id ?? null) as string | null };
    case 'customer.subscription.created':
      return { ...base, stripe_event_id: e.id, kind: 'subscription_created', amount_cents: 0, status: String(o.status), stripe_customer_id: idOf(o.customer), stripe_subscription_id: o.id, detail: o.trial_end ? 'con prueba gratis' : '' };
    case 'customer.subscription.deleted':
      return { ...base, stripe_event_id: e.id, kind: 'cancelled', amount_cents: 0, status: 'cancelled', stripe_customer_id: idOf(o.customer), stripe_subscription_id: o.id, detail: 'Suscripción cancelada' };
    case 'customer.subscription.updated': {
      const prev = e.data.previous_attributes ?? {};
      const planChanged = !!prev.metadata && 'plan' in prev.metadata && prev.metadata.plan !== o.metadata?.plan;
      const nowCancelling = o.cancel_at_period_end === true && prev.cancel_at_period_end === false;
      const statusChanged = 'status' in prev;
      if (!planChanged && !nowCancelling && !statusChanged) return null; // noise (period renewals, item edits…)
      const kind = planChanged ? 'upgrade' : (o.status === 'canceled' ? 'cancelled' : 'subscription_updated');
      const detail = planChanged ? `${prev.metadata.plan ?? '?'} → ${o.metadata?.plan ?? '?'}` : nowCancelling ? 'Cancelará al final del periodo' : `estado: ${prev.status} → ${o.status}`;
      return { ...base, stripe_event_id: e.id, kind, amount_cents: 0, status: String(o.status), stripe_customer_id: idOf(o.customer), stripe_subscription_id: o.id, detail };
    }
    default: return null;
  }
}

/** Store the row once (dedupe on stripe_event_id) and fill the tenant/plan from our Subscription when Stripe's payload lacks them. */
export async function recordBillingEvent(db: Entities, e: LooseEvent): Promise<boolean> {
  const row = billingRowFor(e);
  if (!row) return false;
  if (await findOne(db.BillingEvent, { stripe_event_id: row.stripe_event_id })) return false;
  if ((!row.tenant_id || !row.plan) && (row.stripe_subscription_id || row.stripe_customer_id)) {
    const sub = (row.stripe_subscription_id && await findOne(db.Subscription, { stripe_subscription_id: row.stripe_subscription_id }))
      || (row.stripe_customer_id && await findOne(db.Subscription, { stripe_customer_id: row.stripe_customer_id })) || null;
    if (sub) { row.tenant_id = row.tenant_id ?? (sub.tenant_id as string); row.plan = row.plan ?? (sub.plan as string); }
  }
  await db.BillingEvent.create(row);
  return true;
}
