// Ticket → customer WhatsApp, ported from Reparo notifyWhatsApp + the SQL enqueue trigger:
//   * a notice is QUEUED with a delay (default 60 s; review request: tenant.review_delay_hours) and the
//     ticket is read again when due — a status changed again within the delay, or a deleted ticket,
//     sends nothing (only the latest status goes out);
//   * service notices need the customer's WhatsApp service opt-in; the review request (marketing) needs the
//     marketing opt-in and the shop's Google review link; opted-out customers and paused shops get nothing;
//   * sending goes through sendWhatsapp(): trial quota, opt-out block, idempotency key, opening hours.
import { find, findOne, type Entities, type Row } from './db.ts';
import { decodeCustomer } from './customers.ts';
import { eur } from './pricing.ts';
import type { TicketStatus } from './tickets.ts';
import { sendWhatsapp, type SendDeps } from './waSend.ts';

export const NOTIFY_DELAY_S = 60;
const MAX_ATTEMPTS = 3;

export const STATUS_TEMPLATES: Partial<Record<TicketStatus, { name: string; category: 'utility' | 'marketing' }>> = {
  recibido: { name: 'taller_recibido_v1', category: 'utility' },
  presupuesto_enviado: { name: 'taller_presupuesto_v1', category: 'utility' },
  listo_recoger: { name: 'taller_listo_v1', category: 'utility' },
  entregado: { name: 'taller_resena_v1', category: 'marketing' },
};

/** Queue the notice for a new status (no-op when the status has no template). */
export async function queueStatusNotice(db: Entities, tenant: Row, ticket: Row, status: string, now = new Date()) {
  const tpl = STATUS_TEMPLATES[status as TicketStatus];
  if (!tpl || ticket.notify_whatsapp === false || tenant.wa_paused === true) return null;
  const delayMs = tpl.category === 'marketing'
    ? Math.min(168, Math.max(2, Number(tenant.review_delay_hours ?? 24) || 24)) * 3600e3
    : NOTIFY_DELAY_S * 1000;
  return db.TicketNotification.create({
    tenant_id: tenant.id, ticket_id: ticket.id, status, template_name: tpl.name,
    due_at: new Date(now.getTime() + delayMs).toISOString(), state: 'pending', attempts: 0,
  });
}

/** Template body parameters per status (the Meta templates must be approved with these variables). */
export function templateParams(status: string, tenant: Row, ticket: Row): string[] | null {
  const shop = String(tenant.trade_name ?? '');
  const device = [ticket.brand, ticket.model].filter(Boolean).join(' ') || 'tu dispositivo';
  switch (status) {
    case 'recibido': return [shop, String(ticket.ticket_number ?? ''), device];
    case 'presupuesto_enviado': return [shop, device, eur(Math.round((Number(ticket.budget_amount_eur) || 0) * 100))];
    case 'listo_recoger': return [shop, device, String(ticket.ticket_number ?? '')];
    case 'entregado': return tenant.google_review_url ? [shop, String(tenant.google_review_url)] : null;
    default: return null;
  }
}

const finish = (db: Entities, row: Row, state: string, result: string, extra: Record<string, unknown> = {}) =>
  db.TicketNotification.update(row.id, { state, result: result.slice(0, 500), processed_at: new Date().toISOString(), ...extra });

/** Process one due notice. */
export async function processNotice(deps: SendDeps, tenant: Row, row: Row): Promise<string> {
  const { db, fc } = deps;
  const now = deps.now ?? new Date();
  if (row.state !== 'pending') return String(row.state);
  const attempts = (Number(row.attempts) || 0) + 1;
  await db.TicketNotification.update(row.id, { state: 'sending', attempts });

  const ticket = await findOne(db.RepairTicket, { id: row.ticket_id as string, tenant_id: tenant.id });
  if (!ticket) return (await finish(db, row, 'skipped', 'El ticket se ha borrado antes de enviar'), 'skipped');
  if (ticket.status !== row.status) return (await finish(db, row, 'skipped', `Estado cambiado otra vez a «${ticket.status}» antes de enviar`), 'skipped');
  if (ticket.notify_whatsapp === false) return (await finish(db, row, 'skipped', 'Avisos desactivados en este ticket'), 'skipped');

  const tpl = STATUS_TEMPLATES[row.status as TicketStatus];
  const customerRow = await findOne(db.Customer, { id: ticket.customer_id as string, tenant_id: tenant.id });
  const customer = customerRow ? await decodeCustomer(fc, customerRow) : null;
  if (!tpl || !customer?.phone_e164) return (await finish(db, row, 'skipped', 'Sin teléfono o sin plantilla'), 'skipped');
  if (customer.wa_opted_out === true) return (await finish(db, row, 'skipped', 'El cliente pidió la BAJA'), 'skipped');
  if (tpl.category === 'marketing' ? customer.wa_marketing_opt_in !== true : customer.wa_service_opt_in !== true) {
    return (await finish(db, row, 'skipped', 'El cliente no aceptó este tipo de aviso'), 'skipped');
  }
  const params = templateParams(String(row.status), tenant, ticket);
  if (!params) return (await finish(db, row, 'skipped', 'Falta el enlace de reseñas de Google del taller'), 'skipped');

  const r = await sendWhatsapp(deps, tenant, {
    phone: String(customer.phone_e164), text: params.join(' · '), kind: 'automated', senderType: 'system', ticketId: ticket.id,
    category: tpl.category, idempotencyKey: `ticket:${ticket.id}:status:${row.status}`,
    template: { name: tpl.name, lang: String(tenant.wa_fallback_template_lang || 'es_ES'), params },
  });
  if (r.ok) return (await finish(db, row, 'done', `Enviado (${r.sentVia})`, { wa_message_id: r.waMessageId }), 'done');
  const retryAt = (ms: number) => db.TicketNotification.update(row.id, { state: 'pending', due_at: new Date(now.getTime() + ms).toISOString(), result: r.error.slice(0, 500) });
  switch (r.reason) {
    case 'off_hours': await retryAt(15 * 60e3); return 'pending';            // send when the shop opens
    case 'daily_cap': await retryAt(60 * 60e3); return 'pending';
    case 'network': case 'meta_error':
      if (attempts < MAX_ATTEMPTS) { await retryAt(2 * 60e3); return 'pending'; }
      await finish(db, row, 'failed', r.error); return 'failed';
    default: await finish(db, row, 'skipped', r.error); return 'skipped';   // trial_cap, paused, opted_out, duplicate, not_connected…
  }
}

/** Sweep every tenant's due notices (scheduled function). Tenants no longer on an active Pro plan are skipped. */
export async function sweepNotices(deps: SendDeps, isProActive: (tenant: Row) => Promise<boolean>, limit = 50) {
  const { db } = deps;
  const now = (deps.now ?? new Date()).getTime();
  const due = (await find(db.TicketNotification, { state: 'pending' }, { sort: 'due_at' }))
    .filter((r) => Date.parse(String(r.due_at)) <= now).slice(0, limit);
  const tenants = new Map<string, Row | null>();
  const results: { id: string; state: string }[] = [];
  for (const row of due) {
    const tid = String(row.tenant_id);
    if (!tenants.has(tid)) tenants.set(tid, await findOne(db.Tenant, { id: tid }));
    const tenant = tenants.get(tid);
    if (!tenant || !(await isProActive(tenant))) {
      await finish(db, row, 'skipped', 'El taller ya no tiene Reparo (plan Pro)');
      results.push({ id: row.id, state: 'skipped' });
      continue;
    }
    results.push({ id: row.id, state: await processNotice(deps, tenant, row) });
  }
  return results;
}
