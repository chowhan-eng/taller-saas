// Port of public.create_tenant() + public.accept_dpa() + the is_autonomo update (one call, best-effort rollback).
import { createClientFromRequest } from 'npm:@base44/sdk';
import { json, withJsonErrors } from '../../shared/http.ts';
import { GLOBAL_TENANT } from '../../shared/priceTemplates.ts';
import type { Entities, Row } from '../../shared/db.ts';

const DPA_VERSIONS = new Set(['dpa-v1-2026-11']);
const MAX_OWNED = 3;
const GENERIC = 'No hemos podido crear tu taller. Inténtalo de nuevo.';

export default withJsonErrors('createTenant', async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tradeName = String(b.tradeName ?? '').trim();
  const slug = String(b.slug ?? '').toLowerCase();
  const nif = String(b.nif ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  const printer = b.printerWidth === 58 ? 58 : 80;
  const isAutonomo = b.isAutonomo !== false;
  const dpaVersion = String(b.dpaVersion ?? '');

  if (tradeName.length < 2 || tradeName.length > 120) return json({ error: GENERIC }, 400);
  if (nif && !/^[A-Z0-9]{9}$/.test(nif)) return json({ error: 'Revisa el NIF/CIF: el formato no es válido.' }, 400);
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return json({ error: 'La dirección debe tener entre 3 y 40 letras, números o guiones.' }, 400);
  if (b.dpaAccepted !== true || !DPA_VERSIONS.has(dpaVersion)) {
    return json({ error: 'Necesitamos que aceptes el contrato de Encargado del Tratamiento para guardar los datos de tus clientes.' }, 400);
  }

  const db = base44.asServiceRole.entities as unknown as Entities;
  const owned = await db.TenantUser.filter({ user_id: user.id, role: 'owner' }, undefined, MAX_OWNED);
  if (owned.length >= MAX_OWNED) return json({ error: GENERIC }, 403);
  if ((await db.Tenant.filter({ slug }, undefined, 1)).length) return json({ error: 'Esa dirección ya existe. Prueba otra.' }, 409);

  const created: [string, string][] = [];
  try {
    const now = new Date().toISOString();
    const tenant = await db.Tenant.create({
      trade_name: tradeName, slug, nif, printer_width_mm: printer, is_autonomo: isAutonomo,
      dpa_accepted_at: now, dpa_accepted_by: user.id, dpa_version: dpaVersion,
    });
    created.push(['Tenant', tenant.id]);
    // Slug race (no unique index in Base44): if an earlier create won, back out.
    const sameSlug = await db.Tenant.filter({ slug }, 'created_date', 2);
    if (sameSlug.length > 1 && sameSlug[0].id !== tenant.id) throw Object.assign(new Error('slug race'), { slugTaken: true });

    const member = await db.TenantUser.create({ tenant_id: tenant.id, user_id: user.id, user_email: user.email, role: 'owner', active: true });
    created.push(['TenantUser', member.id]);
    const sub = await db.Subscription.create({ tenant_id: tenant.id, plan: 'starter', status: 'incomplete' });
    created.push(['Subscription', sub.id]);

    const templates = await db.PriceItem.filter({ tenant_id: GLOBAL_TENANT, active: true }, undefined, 500);
    const rows = templates.map(({ category, brand, model, service, price_eur, price_is_from, duration_min }: Row) =>
      ({ tenant_id: tenant.id, category, brand, model, service, price_eur, price_is_from, duration_min, active: true }));
    if (rows.length) {
      if (db.PriceItem.bulkCreate) await db.PriceItem.bulkCreate(rows);
      else for (const r of rows) await db.PriceItem.create(r);
    }
    return json({ tenantId: tenant.id });
  } catch (e) {
    for (const [name, id] of created.reverse()) await db[name].delete(id).catch(() => {});
    if ((e as { slugTaken?: boolean }).slugTaken) return json({ error: 'Esa dirección ya existe. Prueba otra.' }, 409);
    throw e;
  }
});
