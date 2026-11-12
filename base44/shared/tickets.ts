// Reparo CRM core, ported from Reparo (RepairOrder, allocateOrderNumber, unlockCode) and the SQL
// lifecycle triggers. Multi-tenant; every customer-identifying or free-text field is AES-256-GCM
// ciphertext: IMEI/serial (+ blind index for warranty lookups), unlock PIN, fault, diagnosis,
// accessories, physical condition, signature URL. The customer itself lives in Customer (name/phone
// encrypted by shared/customers.ts).
import type { FieldCrypto } from './crypto.ts';
import { find, findOne, type Entities, type Row } from './db.ts';
import { decodeCustomer, encodeCustomer, type CustomerInput } from './customers.ts';

export const TICKET_STATUSES = ['recibido', 'diagnostico', 'presupuesto_enviado', 'presupuesto_aceptado', 'presupuesto_rechazado',
  'esperando_pieza', 'en_reparacion', 'listo_recoger', 'entregado', 'no_reparable', 'cancelado'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const DEVICE_TYPES = ['movil', 'tablet', 'portatil', 'sobremesa', 'consola', 'mando', 'smartwatch', 'otro'] as const;
export const CLOSED_STATUSES: TicketStatus[] = ['entregado', 'no_reparable', 'cancelado'];

// "No code" answers the counter types instead of a real PIN (port of Reparo unlockCode PLACEHOLDER).
const PLACEHOLDER = /^\s*(-+|\.+|no|n\/?a|na|ninguna?o?|sin( (contraseña|contrasena|clave|codigo|código|pin|patron|patrón|bloqueo))?|no tiene|no hay|no lleva|nada|x|0|ningun[ao]?|no tiene contraseña|sin bloqueo|no sabe|no se|no quiere|libre)\s*\.?\s*$/i;
export const isRealCode = (v: unknown) => !!String(v ?? '').trim() && !PLACEHOLDER.test(String(v));

export class TicketError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type TicketDeps = { db: Entities; fc: FieldCrypto; now?: Date };

const madridYear = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(d));
const madridDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * Atomic per-tenant, per-year ticket number "YYYY-000123" — port of Reparo allocateOrderNumber:
 * a conditional write (updateMany matching the value we read) so two counters never get the same number.
 */
export async function allocateTicketNumber(db: Entities, tenantId: string, now = new Date()): Promise<string> {
  const year = madridYear(now);
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await findOne(db.TicketCounter, { tenant_id: tenantId }, 'created_date');
    if (!row) {
      await db.TicketCounter.create({ tenant_id: tenantId, year, last_value: 0 });
      continue;
    }
    const current = Number(row.last_value) || 0;
    const sameYear = Number(row.year) === year;
    const next = sameYear ? current + 1 : 1;
    if (!db.TicketCounter.updateMany) throw new Error('updateMany unavailable: cannot allocate ticket numbers safely');
    const res = await db.TicketCounter.updateMany(
      { id: row.id, last_value: row.last_value, year: row.year },
      { $set: { last_value: next, year } },
    );
    if (res && (res.updated === 1 || res.modified === 1 || res.count === 1)) return `${year}-${String(next).padStart(6, '0')}`;
  }
  throw new TicketError(503, 'No se pudo asignar el número, vuelve a intentarlo.');
}

export type TicketInput = {
  customerId?: string; customer?: CustomerInput;
  device_type: string; brand: string; model?: string; serial_imei?: string; unlock_code?: string;
  accessories?: string; physical_condition?: string; reported_fault: string;
  diagnosis_fee_eur?: number; deposit_eur?: number; priority?: number; promised_at?: string;
  warranty_parent_id?: string; notify_whatsapp?: boolean;
};

const trimOrNull = (v: unknown, max = 2000) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const money = (v: unknown) => { const n = Math.round((Number(v) || 0) * 100) / 100; if (n < 0) throw new TicketError(400, 'Los importes no pueden ser negativos.'); return n; };

export async function decodeTicket(fc: FieldCrypto, row: Row) {
  const t = row.tenant_id as string;
  const { serial_imei_enc, serial_hash: _h, unlock_code_enc: _u, accessories_enc, physical_condition_enc, reported_fault_enc, diagnosis_enc, customer_signature_url_enc, ...rest } = row;
  return {
    ...rest,
    serial_imei: await fc.decryptOpt(t, serial_imei_enc as string | null),
    accessories: await fc.decryptOpt(t, accessories_enc as string | null),
    physical_condition: await fc.decryptOpt(t, physical_condition_enc as string | null),
    reported_fault: await fc.decryptOpt(t, reported_fault_enc as string | null),
    diagnosis: await fc.decryptOpt(t, diagnosis_enc as string | null),
    customer_signature_url: await fc.decryptOpt(t, customer_signature_url_enc as string | null),
    // The unlock code is NEVER decoded here: only revealUnlockCode() returns it, and it logs the access.
  };
}

async function ticketOf(db: Entities, tenantId: string, ticketId: unknown): Promise<Row> {
  if (typeof ticketId !== 'string' || !ticketId) throw new TicketError(400, 'Falta el ticket.');
  const row = await findOne(db.RepairTicket, { id: ticketId, tenant_id: tenantId });
  if (!row) throw new TicketError(404, 'Ticket no encontrado');
  return row;
}

async function logEvent(db: Entities, tenantId: string, ticketId: string, from: string | null, to: string, actorId: string, note?: string) {
  await db.TicketEvent.create({ tenant_id: tenantId, ticket_id: ticketId, from_status: from, to_status: to, actor_id: actorId, note: note?.slice(0, 500) ?? null });
}

export async function createTicket(deps: TicketDeps, tenant: Row, actorId: string, input: TicketInput) {
  const { db, fc } = deps;
  const now = deps.now ?? new Date();
  const tenantId = tenant.id;
  if (!input || !(DEVICE_TYPES as readonly string[]).includes(String(input.device_type))) throw new TicketError(400, 'Elige el tipo de dispositivo.');
  const brand = trimOrNull(input.brand, 80);
  const fault = trimOrNull(input.reported_fault);
  if (!brand) throw new TicketError(400, 'Falta la marca.');
  if (!fault) throw new TicketError(400, 'Describe la avería.');

  // Customer: an existing one of THIS tenant, or a new one (encrypted).
  let customerId = input.customerId ?? null;
  if (customerId) {
    if (!(await findOne(db.Customer, { id: customerId, tenant_id: tenantId }))) throw new TicketError(404, 'Cliente no encontrado');
  } else if (input.customer) {
    let row;
    try { row = await encodeCustomer(fc, tenantId, input.customer); } catch { throw new TicketError(400, 'Revisa el nombre y el teléfono del cliente.'); }
    const existing = row.phone_hash ? await findOne(db.Customer, { tenant_id: tenantId, phone_hash: row.phone_hash }) : null;
    customerId = existing ? existing.id : (await db.Customer.create(row)).id;
  } else {
    throw new TicketError(400, 'Falta el cliente.');
  }
  if (input.warranty_parent_id && !(await findOne(db.RepairTicket, { id: input.warranty_parent_id, tenant_id: tenantId }))) {
    throw new TicketError(404, 'El ticket de garantía no existe.');
  }

  const serial = trimOrNull(input.serial_imei, 64)?.replace(/\s+/g, '') ?? null;
  const code = isRealCode(input.unlock_code) ? String(input.unlock_code).trim().slice(0, 200) : null;
  const ticketNumber = await allocateTicketNumber(db, tenantId, now);
  const warrantyDays = Math.max(90, Number(tenant.default_warranty_days ?? 90) || 90);

  const created = await db.RepairTicket.create({
    tenant_id: tenantId, ticket_number: ticketNumber, customer_id: customerId,
    device_type: input.device_type, brand, model: trimOrNull(input.model, 120),
    serial_imei_enc: await fc.encryptOpt(tenantId, serial), serial_hash: serial ? await fc.blindIndex(tenantId, serial.toUpperCase()) : null,
    unlock_code_enc: await fc.encryptOpt(tenantId, code), has_unlock_code: !!code,
    accessories_enc: await fc.encryptOpt(tenantId, trimOrNull(input.accessories, 500)),
    physical_condition_enc: await fc.encryptOpt(tenantId, trimOrNull(input.physical_condition, 1000)),
    reported_fault_enc: await fc.encrypt(tenantId, fault),
    budget_status: 'pendiente', diagnosis_fee_eur: money(input.diagnosis_fee_eur), deposit_eur: money(input.deposit_eur),
    status: 'recibido', priority: Math.min(2, Math.max(0, Number(input.priority) || 0)),
    promised_at: input.promised_at ?? null, warranty_days: warrantyDays, warranty_parent_id: input.warranty_parent_id ?? null,
    notify_whatsapp: input.notify_whatsapp !== false, opened_by_user_id: actorId, offer_items: [],
  });
  await logEvent(db, tenantId, created.id, null, 'recibido', actorId, 'Ticket creado');
  return created;
}

/** Status change + lifecycle timestamps (port of the SQL ticket_lifecycle trigger). */
export async function updateTicketStatus(deps: TicketDeps, tenant: Row, actorId: string, ticketId: unknown, toStatus: unknown, note?: string) {
  const { db } = deps;
  const now = deps.now ?? new Date();
  if (!(TICKET_STATUSES as readonly string[]).includes(String(toStatus))) throw new TicketError(400, 'Estado no válido.');
  const t = await ticketOf(db, tenant.id, ticketId);
  const to = String(toStatus) as TicketStatus;
  if (t.status === to) return { ticket: t, changed: false };
  const stamp = now.toISOString();
  const patch: Record<string, unknown> = { status: to };
  if (to === 'listo_recoger' && !t.ready_at) patch.ready_at = stamp;
  if (to === 'entregado' && !t.delivered_at) {
    patch.delivered_at = stamp;
    const until = new Date(`${madridDate(now)}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + Math.max(90, Number(t.warranty_days) || 90));
    patch.warranty_until = until.toISOString().slice(0, 10);
  }
  const updated = await db.RepairTicket.update(t.id, patch);
  await logEvent(db, tenant.id, t.id, String(t.status), to, actorId, note);
  return { ticket: updated, changed: true, from: String(t.status) };
}

export const BUDGET_TRANSITIONS: Record<string, TicketStatus | null> = {
  pendiente: null, enviado: 'presupuesto_enviado', aceptado: 'presupuesto_aceptado', rechazado: 'presupuesto_rechazado', no_requerido: null,
};

/** Budget: amount + state; sending/answering also moves the ticket status (and so the WhatsApp notice). */
export async function setBudget(deps: TicketDeps, tenant: Row, actorId: string, ticketId: unknown, p: { status: unknown; amountEur?: unknown; offerItems?: unknown[] }) {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const status = String(p.status);
  if (!(status in BUDGET_TRANSITIONS)) throw new TicketError(400, 'Estado de presupuesto no válido.');
  const t = await ticketOf(db, tenant.id, ticketId);
  const amount = p.amountEur === undefined ? (t.budget_amount_eur as number | null) : money(p.amountEur);
  if (status === 'enviado' && !(Number(amount) > 0)) throw new TicketError(400, 'Pon el importe del presupuesto antes de enviarlo.');
  const stamp = now.toISOString();
  await db.RepairTicket.update(t.id, {
    budget_status: status, budget_amount_eur: amount,
    ...(Array.isArray(p.offerItems) ? { offer_items: p.offerItems.slice(0, 20) } : {}),
    ...(status === 'enviado' && !t.budget_sent_at ? { budget_sent_at: stamp } : {}),
    ...((status === 'aceptado' || status === 'rechazado') && !t.budget_answered_at ? { budget_answered_at: stamp } : {}),
  });
  const next = BUDGET_TRANSITIONS[status];
  return next ? updateTicketStatus(deps, tenant, actorId, t.id, next, `Presupuesto ${status}`) : { ticket: await ticketOf(db, tenant.id, t.id), changed: false };
}

/** Editable details (diagnosis, condition, accessories, code…) — always re-encrypted. */
export async function updateTicketDetails(deps: TicketDeps, tenant: Row, ticketId: unknown, p: Record<string, unknown>) {
  const { db, fc } = deps;
  const t = await ticketOf(db, tenant.id, ticketId);
  const tid = tenant.id;
  const patch: Record<string, unknown> = {};
  if ('diagnosis' in p) patch.diagnosis_enc = await fc.encryptOpt(tid, trimOrNull(p.diagnosis));
  if ('accessories' in p) patch.accessories_enc = await fc.encryptOpt(tid, trimOrNull(p.accessories, 500));
  if ('physical_condition' in p) patch.physical_condition_enc = await fc.encryptOpt(tid, trimOrNull(p.physical_condition, 1000));
  if ('reported_fault' in p) {
    const f = trimOrNull(p.reported_fault);
    if (!f) throw new TicketError(400, 'Describe la avería.');
    patch.reported_fault_enc = await fc.encrypt(tid, f);
  }
  if ('serial_imei' in p) {
    const s = trimOrNull(p.serial_imei, 64)?.replace(/\s+/g, '') ?? null;
    patch.serial_imei_enc = await fc.encryptOpt(tid, s);
    patch.serial_hash = s ? await fc.blindIndex(tid, s.toUpperCase()) : null;
  }
  if ('unlock_code' in p) {
    const code = isRealCode(p.unlock_code) ? String(p.unlock_code).trim().slice(0, 200) : null;
    patch.unlock_code_enc = await fc.encryptOpt(tid, code);
    patch.has_unlock_code = !!code;
  }
  if ('customer_signature_url' in p) patch.customer_signature_url_enc = await fc.encryptOpt(tid, trimOrNull(p.customer_signature_url, 1000));
  for (const k of ['model', 'technician_id', 'promised_at'] as const) if (k in p) patch[k] = trimOrNull(p[k], 200);
  if ('priority' in p) patch.priority = Math.min(2, Math.max(0, Number(p.priority) || 0));
  if ('notify_whatsapp' in p) patch.notify_whatsapp = p.notify_whatsapp !== false;
  if (!Object.keys(patch).length) throw new TicketError(400, 'Nada que cambiar.');
  return db.RepairTicket.update(t.id, patch);
}

/** Unlock code — owner/admin only (port of Reparo unlockCode 'get'); every reveal is logged. */
export async function revealUnlockCode(deps: TicketDeps, tenant: Row, actorId: string, role: string, ticketId: unknown) {
  if (role !== 'owner' && role !== 'admin') throw new TicketError(403, 'Solo el titular o un administrador pueden ver la contraseña.');
  const t = await ticketOf(deps.db, tenant.id, ticketId);
  await logEvent(deps.db, tenant.id, t.id, String(t.status), String(t.status), actorId, 'Contraseña del dispositivo consultada');
  return deps.fc.decryptOpt(tenant.id, t.unlock_code_enc as string | null);
}

/** Warranty / repeat-device lookup by IMEI or serial, through the blind index. */
export async function findTicketsBySerial(deps: TicketDeps, tenant: Row, serial: unknown) {
  const s = String(serial ?? '').replace(/\s+/g, '').toUpperCase();
  if (!s) return [];
  return find(deps.db.RepairTicket, { tenant_id: tenant.id, serial_hash: await deps.fc.blindIndex(tenant.id, s) }, { sort: '-created_date', limit: 20 });
}

export async function getTicketWithCustomer(deps: TicketDeps, tenant: Row, ticketId: unknown) {
  const t = await ticketOf(deps.db, tenant.id, ticketId);
  const c = await findOne(deps.db.Customer, { id: t.customer_id as string, tenant_id: tenant.id });
  const events = await find(deps.db.TicketEvent, { tenant_id: tenant.id, ticket_id: t.id }, { sort: 'created_date' });
  return { ticket: await decodeTicket(deps.fc, t), customer: c ? await decodeCustomer(deps.fc, c) : null, events };
}
