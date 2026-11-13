// Reparo CRM action router. EVERY action passes gateModule('reparo') first, which requires an ACTIVE PAID
// PRO subscription (Starter → 402). Kept free of Base44 runtime imports so tests can call every action.
import type { FieldCrypto } from './crypto.ts';
import { find, type Entities } from './db.ts';
import { decodeCustomer, encodeCustomer, findCustomerByPhone, type CustomerInput } from './customers.ts';
import { gateModule } from './modules.ts';
import {
  DEFAULT_PRICING, buildQuoteMessage, computeQuote, laborCentsFor, laborRuleFor, marginRuleFor, netCostCents, offerItemsFor,
  type LaborRuleRow, type MarginRuleRow, type QuoteOption, type RoundingMode,
} from './pricing.ts';
import {
  CLOSED_STATUSES, TicketError, createTicket, decodeTicket, findTicketsBySerial, getTicketWithCustomer, revealUnlockCode,
  setBudget, updateTicketDetails, updateTicketStatus, type TicketInput,
} from './tickets.ts';
import { queueStatusNotice } from './ticketNotify.ts';

export const REPARO_ACTIONS = [
  'createCustomer', 'getCustomer', 'findCustomerByPhone', 'createTicket', 'getTicket', 'listTickets', 'updateTicket',
  'setStatus', 'setBudget', 'quote', 'applyQuote', 'revealUnlockCode', 'findBySerial', 'shop',
  'team', 'listPartPrices', 'savePartPrice', 'deletePartPrice',
] as const;

export type ApiCtx = { db: Entities; fc: FieldCrypto; userId?: string; now?: Date };
export type ApiResult = { status: number; body: unknown };
const ok = (body: unknown): ApiResult => ({ status: 200, body });
const err = (status: number, error: string): ApiResult => ({ status, body: { error } });

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

export async function handleReparo(ctx: ApiCtx, body: Body): Promise<ApiResult> {
  const gate = await gateModule(ctx.db, ctx.userId, body?.tenantId, 'reparo');
  if (!gate.ok) return err(gate.status, gate.error);
  const { tenant, role } = gate;
  const { db, fc } = ctx;
  const deps = { db, fc, now: ctx.now };
  const actor = String(ctx.userId);
  try {
    switch (body.action) {
      case 'createCustomer': {
        let row;
        try { row = await encodeCustomer(fc, tenant.id, body.customer as CustomerInput); } catch { return err(400, 'Revisa el nombre y el teléfono del cliente.'); }
        if (row.phone_hash && (await find(db.Customer, { tenant_id: tenant.id, phone_hash: row.phone_hash }, { limit: 1 })).length) return err(409, 'Ya existe un cliente con ese teléfono.');
        return ok({ customer: await decodeCustomer(fc, await db.Customer.create(row)) });
      }
      case 'getCustomer': {
        const [row] = await find(db.Customer, { id: body.customerId, tenant_id: tenant.id }, { limit: 1 });
        return row ? ok({ customer: await decodeCustomer(fc, row) }) : err(404, 'Cliente no encontrado');
      }
      case 'findCustomerByPhone': {
        const row = body.phone ? await findCustomerByPhone(db, fc, tenant.id, String(body.phone)) : null;
        return ok({ customer: row ? await decodeCustomer(fc, row) : null });
      }
      case 'createTicket': {
        const t = await createTicket(deps, tenant, actor, body.ticket as TicketInput);
        await queueStatusNotice(db, tenant, t, 'recibido', ctx.now);
        return ok({ ticket: await decodeTicket(fc, t) });
      }
      case 'getTicket':
        return ok(await getTicketWithCustomer(deps, tenant, body.ticketId));
      case 'listTickets': {
        // Same page size on the list AND on search (the production app's infinite scroll uses 20 for both):
        // the client asks offset/limit; `total` lets it know when to stop.
        const open = body.open !== false;
        const q = String(body.q ?? '').trim().toLowerCase();
        const qDigits = q.replace(/\D/g, '');
        const customers = new Map<string, { name: string; phone: string | null }>();
        for (const c of await find(db.Customer, { tenant_id: tenant.id })) {
          customers.set(c.id, { name: await fc.decrypt(tenant.id, c.full_name_enc as string), phone: await fc.decryptOpt(tenant.id, c.phone_enc as string | null) });
        }
        const all = (await find(db.RepairTicket, { tenant_id: tenant.id }, { sort: '-created_date' }))
          .filter((t) => (open ? !CLOSED_STATUSES.includes(t.status as never) : true))
          .filter((t) => (body.status ? t.status === body.status : true))
          .filter((t) => (body.technicianId ? t.technician_id === body.technicianId : true))
          .filter((t) => {
            if (!q) return true;
            const c = customers.get(String(t.customer_id));
            const hay = [t.ticket_number, t.brand, t.model, c?.name].map((x) => String(x ?? '').toLowerCase()).join(' ');
            return hay.includes(q) || (qDigits.length >= 3 && String(c?.phone ?? '').includes(qDigits));
          });
        const offset = Math.max(0, Number(body.offset) || 0);
        const rows = all.slice(offset, offset + Math.min(200, Number(body.limit) || 20));
        const counts: Record<string, number> = {};
        for (const t of all) counts[String(t.status)] = (counts[String(t.status)] ?? 0) + 1;
        const out = rows.map((t) => {
          const c = customers.get(String(t.customer_id));
          return {
            id: t.id, ticket_number: t.ticket_number, status: t.status, device_type: t.device_type, brand: t.brand, model: t.model,
            budget_status: t.budget_status, budget_amount_eur: t.budget_amount_eur, promised_at: t.promised_at, priority: t.priority,
            technician_id: t.technician_id ?? null, has_unlock_code: t.has_unlock_code === true, tpv_paid_total_eur: t.tpv_paid_total_eur ?? null,
            created_date: t.created_date, customer_name: c?.name ?? null, customer_phone: c?.phone ?? null,
          };
        });
        return ok({ tickets: out, total: all.length, counts });
      }
      case 'team': {
        // Technician picker: active members of THIS shop only.
        const members = (await find(db.TenantUser, { tenant_id: tenant.id, active: true })).map((m) => ({
          user_id: m.user_id, name: (m.display_name as string) || (m.user_email as string) || 'Usuario', role: m.role,
        }));
        return ok({ team: members });
      }
      case 'listPartPrices': {
        const q = String(body.q ?? '').trim().toLowerCase();
        const rows = (await find(db.PartPrice, { tenant_id: tenant.id }, { sort: '-changed_at' }))
          .filter((p) => !q || String(p.part_label ?? '').toLowerCase().includes(q) || String(p.supplier ?? '').toLowerCase().includes(q))
          .slice(0, 300);
        return ok({ prices: rows.map((p) => ({ id: p.id, part_key: p.part_key, part_label: p.part_label, supplier: p.supplier, price_eur: p.price_eur,
          previous_price_eur: p.previous_price_eur ?? null, tax_mode: p.tax_mode ?? 'gross', shipping_eur: p.shipping_eur ?? 0, changed_at: p.changed_at ?? null, url: p.url ?? null })) });
      }
      case 'savePartPrice': {
        // Price memory: one row per (part, supplier). A different price than the one remembered flags a change.
        const label = String(body.label ?? '').trim().slice(0, 200);
        const supplier = String(body.supplier ?? '').trim().slice(0, 60);
        const price = Number(body.priceEur);
        if (!label || !supplier || !(price > 0)) return err(400, 'Indica la pieza, el proveedor y un precio mayor que cero.');
        const key = label.toLowerCase().replace(/\s+/g, ' ');
        const prev = (await find(db.PartPrice, { tenant_id: tenant.id, part_key: key, supplier }, { limit: 1 }))[0];
        const nowIso = (ctx.now ?? new Date()).toISOString();
        const data = { tenant_id: tenant.id, part_key: key, part_label: label, supplier, price_eur: price, tax_mode: body.taxMode === 'net' ? 'net' : 'gross',
          shipping_eur: Math.max(0, Number(body.shippingEur) || 0), url: String(body.url ?? '').slice(0, 500) || null };
        if (!prev) { const row = await db.PartPrice.create({ ...data, changed_at: nowIso }); return ok({ price: row, change: null }); }
        const changed = Math.abs(Number(prev.price_eur) - price) > 0.004;
        const row = await db.PartPrice.update(prev.id, changed ? { ...data, previous_price_eur: prev.price_eur, changed_at: nowIso } : data);
        return ok({ price: row, change: changed ? { from: Number(prev.price_eur), to: price } : null });
      }
      case 'deletePartPrice': {
        const row = (await find(db.PartPrice, { id: body.id, tenant_id: tenant.id }, { limit: 1 }))[0];
        if (!row) return err(404, 'Precio no encontrado');
        await db.PartPrice.delete(row.id);
        return ok({ ok: true });
      }
      case 'updateTicket':
        return ok({ ticket: await decodeTicket(fc, await updateTicketDetails(deps, tenant, body.ticketId, body.patch ?? {})) });
      case 'setStatus': {
        const r = await updateTicketStatus(deps, tenant, actor, body.ticketId, body.status, body.note);
        if (r.changed) await queueStatusNotice(db, tenant, r.ticket, String(body.status), ctx.now);
        return ok({ ticket: await decodeTicket(fc, r.ticket), changed: r.changed });
      }
      case 'setBudget': {
        const r = await setBudget(deps, tenant, actor, body.ticketId, { status: body.status, amountEur: body.amountEur, offerItems: body.offerItems });
        if (r.changed) await queueStatusNotice(db, tenant, r.ticket, String(r.ticket.status), ctx.now);
        return ok({ ticket: await decodeTicket(fc, r.ticket), changed: r.changed });
      }
      case 'quote': {
        // Auto-quote from the shop's own margin/labour rules (port of Reparo Presupuestar + pricing.js).
        const q = body.quote ?? {};
        const net = q.netCostCents != null ? Math.round(Number(q.netCostCents) || 0)
          : netCostCents({ priceCents: Number(q.priceCents) || 0, taxMode: q.taxMode === 'net' ? 'net' : 'gross', ivaDeductible: q.ivaDeductible !== false });
        if (!(net > 0)) return err(400, 'Indica el coste de la pieza.');
        const [margins, labors] = await Promise.all([
          find(db.MarginRule, { tenant_id: tenant.id, active: true }),
          find(db.LaborRule, { tenant_id: tenant.id, active: true }),
        ]);
        const m = marginRuleFor(net, margins as MarginRuleRow[]);
        const lr = laborRuleFor(String(q.category ?? 'movil'), q.partType, labors as LaborRuleRow[]);
        const res = computeQuote({
          netCostCents: net, marginPct: m.margin_pct, minMarginCents: m.min_margin_cents, shippingCents: Number(q.shippingCents) || 0,
          // The shop may overwrite the labour of a single quote (customisable labour); otherwise its own labour rule applies.
          laborCents: q.laborCents != null && q.laborCents !== '' && Number(q.laborCents) >= 0 ? Math.round(Number(q.laborCents)) : laborCentsFor(lr), ivaPct: DEFAULT_PRICING.iva_pct,
          roundingMode: (['x90', 'eur1', 'x9', 'none'].includes(q.roundingMode) ? q.roundingMode : DEFAULT_PRICING.rounding_mode) as RoundingMode,
          roundingCapCents: DEFAULT_PRICING.rounding_cap_cents,
        });
        const option: QuoteOption = { ...res, tier: Number(q.tier) || 1, quality_label: q.qualityLabel, part_title: q.partTitle, labor_label: String(q.laborLabel || lr.label || 'Mano de obra').slice(0, 80), warranty_months: DEFAULT_PRICING.warranty_months };
        return ok({ option, offer_items: offerItemsFor(option) });
      }
      case 'applyQuote': {
        // Chosen option(s) → ticket budget amount + offer lines + the customer message (send = setBudget 'enviado').
        const options = (Array.isArray(body.options) ? body.options : []).slice(0, 3) as QuoteOption[];
        if (!options.length || options.some((o) => !(Number(o?.pvp_cents) > 0))) return err(400, 'Elige al menos una opción con precio.');
        const first = options[0];
        const r = await setBudget(deps, tenant, actor, body.ticketId, { status: 'pendiente', amountEur: first.pvp_cents / 100, offerItems: offerItemsFor(first) });
        const message = buildQuoteMessage({
          number: String(r.ticket.ticket_number ?? ''), device: [r.ticket.brand, r.ticket.model].filter(Boolean).join(' '),
          service: first.labor_label, options, shopLine: [tenant.trade_name, tenant.address_line, tenant.city].filter(Boolean).join(' · '),
        });
        return ok({ budget_amount_eur: first.pvp_cents / 100, message });
      }
      case 'shop': {
        // What the 58/80 mm resguardo prints (no secrets).
        const t = tenant;
        return ok({ shop: { trade_name: t.trade_name, nif: t.nif, address_line: t.address_line, postal_code: t.postal_code, city: t.city,
          phone: t.phone, ticket_footer: t.ticket_footer, printer_width_mm: t.printer_width_mm } });
      }
      case 'revealUnlockCode':
        return ok({ code: await revealUnlockCode(deps, tenant, actor, role, body.ticketId) });
      case 'findBySerial': {
        const rows = await findTicketsBySerial(deps, tenant, body.serial);
        return ok({ tickets: rows.map((t) => ({ id: t.id, ticket_number: t.ticket_number, status: t.status, delivered_at: t.delivered_at, warranty_until: t.warranty_until })) });
      }
      default:
        return err(501, 'Acción no disponible todavía.');
    }
  } catch (e) {
    if (e instanceof TicketError) return err(e.status, e.message);
    throw e;
  }
}
