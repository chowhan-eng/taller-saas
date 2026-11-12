// Port of web/app/api/checkout/route.ts — owner-only, DPA required, Stripe subscription Checkout (€39 / €79).
import { createClientFromRequest } from 'npm:@base44/sdk';
import { secrets } from 'base44:runtime';
import { json, withJsonErrors } from '../../shared/http.ts';
import { PLANS, stripeClient, type PlanCode } from '../../shared/stripe.ts';
import { membership } from '../../shared/tenancy.ts';
import { TRIAL_DAYS } from '../../shared/waQuota.ts';
import { find, type Entities } from '../../shared/db.ts';

export default withJsonErrors('checkout', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { tenantId?: string; plan?: string };
  const plan = body.plan as PlanCode;
  if (!body.tenantId || !(plan in PLANS)) return json({ error: 'Petición no válida' }, 400);
  const price = secrets.get(PLANS[plan].priceSecret);
  if (!price) return json({ error: 'Pago no configurado todavía.' }, 500);

  const db = base44.asServiceRole.entities as unknown as Entities;
  // Only the OWNER of this tenant may start checkout.
  const member = await membership(db, body.tenantId, user.id);
  if (member?.role !== 'owner') return json({ error: 'Solo el titular del taller puede contratar.' }, 403);

  const [tenant] = await find(db.Tenant, { id: body.tenantId }, { limit: 1 });
  if (!tenant) return json({ error: 'Taller no encontrado' }, 404);
  if (!tenant.dpa_accepted_at) return json({ error: 'Falta aceptar el contrato de Encargado del Tratamiento.' }, 400);

  const stripe = stripeClient(secrets.get('STRIPE_SECRET_KEY'));
  const [sub] = await find(db.Subscription, { tenant_id: tenant.id }, { limit: 1 });
  let customerId = (sub?.stripe_customer_id as string | undefined) ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: tenant.trade_name as string,
      preferred_locales: ['es'],
      metadata: { tenant_id: tenant.id, nif: (tenant.nif as string | null) ?? '' },
    });
    customerId = customer.id;
    if (sub) await db.Subscription.update(sub.id, { plan, stripe_customer_id: customerId, status: 'incomplete' });
    else await db.Subscription.create({ tenant_id: tenant.id, plan, stripe_customer_id: customerId, status: 'incomplete' });
  }

  // 14-day free trial: Starter only, once per tenant, card required up front. Stripe charges on day 15
  // unless cancelled; if the card is somehow missing when the trial ends, the subscription is cancelled.
  const withTrial = plan === 'starter' && sub?.trial_used !== true;

  const site = secrets.get('SITE_URL') ?? req.headers.get('origin') ?? new URL(req.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: tenant.id,
    metadata: { tenant_id: tenant.id, plan },
    payment_method_collection: 'always',
    subscription_data: {
      metadata: { tenant_id: tenant.id, plan },
      ...(withTrial
        ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } } }
        : {}),
    },
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    customer_update: { name: 'auto', address: 'auto' },
    locale: 'es',
    success_url: `${site}/onboarding/gracias/?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/onboarding/?plan=${plan}`,
  });

  return json({ url: session.url });
});
