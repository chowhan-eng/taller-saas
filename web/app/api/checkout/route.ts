import { NextResponse } from 'next/server';
import { supabaseAdmin, userFromRequest } from '@/lib/supabase-admin';
import { PLANS, stripeClient, type PlanCode } from '@/lib/stripe';
import { withJsonErrors } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export const POST = withJsonErrors(handle);

async function handle(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { tenantId?: string; plan?: string };
  const plan = body.plan as PlanCode;
  if (!body.tenantId || !(plan in PLANS)) return json({ error: 'Petición no válida' }, 400);
  const price = process.env[PLANS[plan].priceEnv];
  if (!price) return json({ error: 'Pago no configurado todavía.' }, 500);

  const db = supabaseAdmin();
  // Only the OWNER of this tenant may start checkout.
  const { data: member } = await db.from('tenant_users').select('role')
    .eq('tenant_id', body.tenantId).eq('user_id', user.id).eq('active', true).maybeSingle();
  if (member?.role !== 'owner') return json({ error: 'Solo el titular del taller puede contratar.' }, 403);

  const { data: tenant } = await db.from('tenants').select('id, trade_name, nif, dpa_accepted_at').eq('id', body.tenantId).single();
  if (!tenant) return json({ error: 'Taller no encontrado' }, 404);
  if (!tenant.dpa_accepted_at) return json({ error: 'Falta aceptar el contrato de Encargado del Tratamiento.' }, 400);

  const stripe = stripeClient();
  const { data: sub } = await db.from('subscriptions').select('stripe_customer_id').eq('tenant_id', tenant.id).maybeSingle();
  let customerId = sub?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: tenant.trade_name,
      preferred_locales: ['es'],
      metadata: { tenant_id: tenant.id, nif: tenant.nif ?? '' },
    });
    customerId = customer.id;
    await db.from('subscriptions').upsert({ tenant_id: tenant.id, plan, stripe_customer_id: customerId, status: 'incomplete' },
                                          { onConflict: 'tenant_id' });
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: tenant.id,
    metadata: { tenant_id: tenant.id, plan },
    subscription_data: { metadata: { tenant_id: tenant.id, plan } },
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    customer_update: { name: 'auto', address: 'auto' },
    locale: 'es',
    success_url: `${site}/onboarding/gracias?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/onboarding?plan=${plan}`,
  });

  return json({ url: session.url });
}
