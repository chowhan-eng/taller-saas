// Auto-quote pricing engine — port of Reparo src/lib/quote/pricing.js (pure functions, integer CENTS).
// Never any maths in the AI: this file is the single source of truth.
//   PVP = (net cost × (1 + margin) + shipping + labour) × 1.21, rounded UP to a commercial price (,90),
//   then base and VAT are recomputed from the PVP so the ticket adds up to the cent.

export type PricingSettings = {
  iva_pct: number; rounding_mode: RoundingMode; rounding_cap_cents: number; quote_valid_days: number;
  warranty_months: number; level_defaults: Record<Level, number>;
};
export type RoundingMode = 'x90' | 'eur1' | 'x9' | 'none';
export type Level = 'N1' | 'N2' | 'N3' | 'N4' | 'N5';

export const DEFAULT_PRICING: PricingSettings = {
  iva_pct: 21,
  rounding_mode: 'x90',
  rounding_cap_cents: 100,
  quote_valid_days: 7,
  warranty_months: 3,
  level_defaults: { N1: 1500, N2: 2500, N3: 3500, N4: 4900, N5: 6900 },
};

export const TIERS: Record<number, { label: string; long: string }> = {
  1: { label: 'Económica', long: 'Económica / Compatible' },
  2: { label: 'Alta calidad', long: 'Alta calidad / Premium' },
  3: { label: 'Original', long: 'Original / Oficial' },
};

export type MarginRuleRow = { active?: unknown; cost_from_cents?: unknown; cost_to_cents?: unknown; margin_pct?: unknown; min_margin_cents?: unknown };
export type LaborRuleRow = { active?: unknown; category?: unknown; part_type?: unknown; level?: unknown; labor_cents?: unknown; consumables_cents?: unknown; label?: unknown };

const int = (n: unknown) => Math.round(Number(n) || 0);

/** Net cost (no VAT) from the price the supplier shows. */
export function netCostCents(p: { priceCents: number; taxMode: 'gross' | 'net'; ivaDeductible?: boolean; ivaPct?: number }): number {
  const price = int(p.priceCents);
  if (p.taxMode === 'net') return price;
  return p.ivaDeductible !== false ? Math.round((price * 100) / (100 + (p.ivaPct ?? 21))) : price;
}

/** Margin band that applies to a net cost. */
export function marginRuleFor(netCents: number, rules: MarginRuleRow[]): { margin_pct: number; min_margin_cents: number } {
  const list = (rules || []).filter((r) => r.active !== false).sort((a, b) => int(a.cost_from_cents) - int(b.cost_from_cents));
  const hit = list.find((r) => netCents >= int(r.cost_from_cents) && (r.cost_to_cents == null || r.cost_to_cents === '' || netCents < int(r.cost_to_cents)))
    || list[list.length - 1];
  return hit ? { margin_pct: Number(hit.margin_pct) || 0, min_margin_cents: int(hit.min_margin_cents) } : { margin_pct: 40, min_margin_cents: 0 };
}

/** Labour rule for family + part ('other' as wildcard; riveted keyboard falls back to keyboard). */
export function laborRuleFor(category: string, partType: string | undefined, rules: LaborRuleRow[]): LaborRuleRow {
  const act = (rules || []).filter((r) => r.active !== false);
  const pt = partType || 'other';
  return act.find((r) => r.category === category && r.part_type === pt)
    || (pt === 'keyboard_riveted' ? act.find((r) => r.category === category && r.part_type === 'keyboard') : undefined)
    || act.find((r) => r.category === category && r.part_type === 'other')
    || { category, part_type: pt, level: 'N2', label: 'Reparación' };
}

export function laborCentsFor(rule: LaborRuleRow | undefined, settings: PricingSettings = DEFAULT_PRICING): number {
  if (rule?.labor_cents != null && rule.labor_cents !== '') return int(rule.labor_cents) + int(rule.consumables_cents);
  const level = (rule?.level || 'N2') as Level;
  return int((settings.level_defaults || DEFAULT_PRICING.level_defaults)[level]) + int(rule?.consumables_cents);
}

/** Commercial rounding, always UP. Never lowers the price. */
export function roundCommercial(rawCents: number, mode: RoundingMode = 'x90', capCents = 100): number {
  const raw = int(rawCents);
  const eur1 = Math.ceil(raw / 100) * 100;
  if (mode === 'none') return raw;
  if (mode === 'eur1') return eur1;
  if (mode === 'x9') {
    let c = Math.floor(raw / 1000) * 1000 + 900;
    if (c < raw) c += 1000;
    return c - raw <= Math.max(capCents, 0) ? c : roundCommercial(raw, 'x90', capCents);
  }
  let c = Math.floor(raw / 100) * 100 + 90;
  if (c < raw) c += 100;
  return c - raw <= Math.max(capCents, 0) ? c : eur1;
}

export type QuoteResult = {
  net_cost_cents: number; margin_pct: number; part_cents: number; shipping_cents: number; labor_cents: number;
  base_cents: number; iva_cents: number; invoice_base_cents: number; pvp_raw_cents: number; pvp_cents: number;
  rounding_delta_cents: number; profit_cents: number;
};

/** Full computation of one option (cents). */
export function computeQuote(p: {
  netCostCents: number; marginPct: number; minMarginCents?: number; shippingCents?: number; laborCents?: number;
  ivaPct?: number; roundingMode?: RoundingMode; roundingCapCents?: number;
}): QuoteResult {
  const ivaPct = p.ivaPct ?? 21;
  const n = int(p.netCostCents);
  const part = Math.max(Math.round(n * (1 + Number(p.marginPct || 0) / 100)), n + int(p.minMarginCents));
  const base = part + int(p.shippingCents) + int(p.laborCents);
  const pvpRaw = Math.round((base * (100 + ivaPct)) / 100);
  const pvp = roundCommercial(pvpRaw, p.roundingMode ?? 'x90', p.roundingCapCents ?? 100);
  const invoiceBase = Math.round((pvp * 100) / (100 + ivaPct));
  return {
    net_cost_cents: n, margin_pct: Number(p.marginPct || 0), part_cents: part, shipping_cents: int(p.shippingCents), labor_cents: int(p.laborCents),
    base_cents: base, iva_cents: pvp - invoiceBase, invoice_base_cents: invoiceBase,
    pvp_raw_cents: pvpRaw, pvp_cents: pvp, rounding_delta_cents: pvp - pvpRaw,
    profit_cents: invoiceBase - n - int(p.shippingCents),
  };
}

export type QuoteOption = QuoteResult & { tier?: number; quality_label?: string; part_title?: string; labor_label?: string; warranty_months?: number };

/** Ticket offer lines (VAT-inclusive prices, as in Reparo). They add up EXACTLY to the PVP. */
export function offerItemsFor(opt: QuoteOption, ivaPct = 21) {
  const partPvp = Math.min(opt.pvp_cents, Math.round(((opt.part_cents + opt.shipping_cents) * (100 + ivaPct)) / 100));
  const laborPvp = opt.pvp_cents - partPvp;
  const tier = TIERS[opt.tier ?? 1]?.label || '';
  const warrantyDays = Math.round((opt.warranty_months || 3) * 30);
  return [
    { kind: 'product', title: `${opt.part_title || 'Recambio'} · ${tier}${opt.quality_label ? ` (${opt.quality_label})` : ''}`.slice(0, 160), qty: 1, price: partPvp / 100, cost: (opt.net_cost_cents + opt.shipping_cents) / 100, discount: 0, warranty_days: warrantyDays },
    { kind: 'service', title: opt.labor_label || 'Mano de obra', qty: 1, price: laborPvp / 100, cost: 0, discount: 0, warranty_days: warrantyDays },
  ];
}

export const eur = (cents: number) => `${(int(cents) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Customer WhatsApp text (port of quoteText.buildQuoteMessage, shop line from the tenant instead of hard-coded). */
export function buildQuoteMessage(p: {
  number?: string; device?: string; service?: string; options: QuoteOption[]; warrantyMonths?: number; validDays?: number; shopLine: string;
}): string {
  const warrantyMonths = p.warrantyMonths ?? 3;
  const lines: string[] = [];
  lines.push(`*Presupuesto ${p.number || ''}*`.replace(' *', '*'));
  if (p.device || p.service) lines.push(`${[p.device, p.service].filter(Boolean).join(' · ')}.`);
  lines.push('');
  p.options.forEach((o, i) => {
    const t = TIERS[o.tier ?? 1]?.label || 'Opción';
    lines.push(`${i + 1}) ${t}${o.quality_label ? ` (${o.quality_label})` : ''}: *${eur(o.pvp_cents)}*. Garantía ${o.warranty_months || warrantyMonths} meses.`);
  });
  lines.push('');
  lines.push(`Precios con IVA (21 %) incluido. Garantía de ${warrantyMonths} meses por escrito.`);
  lines.push(`Presupuesto válido ${p.validDays ?? 7} días, sujeto a disponibilidad de la pieza.`);
  lines.push(p.options.length > 1 ? 'Responda con el número de la opción para confirmar.' : 'Responda «Sí» para confirmar.');
  lines.push(p.shopLine);
  return lines.join('\n');
}
