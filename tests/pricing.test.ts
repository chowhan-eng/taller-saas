// Ported verbatim from Reparo src/lib/quote/pricing.test.mjs (the live app's own expected figures).
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING, computeQuote, laborCentsFor, laborRuleFor, marginRuleFor, netCostCents, offerItemsFor, roundCommercial, buildQuoteMessage } from '../base44/shared/pricing.ts';

const MARGINS = [
  { cost_from_cents: 0, cost_to_cents: 1000, margin_pct: 100, min_margin_cents: 800 },
  { cost_from_cents: 1000, cost_to_cents: 3000, margin_pct: 60, min_margin_cents: 1000 },
  { cost_from_cents: 3000, cost_to_cents: 8000, margin_pct: 40, min_margin_cents: 0 },
  { cost_from_cents: 8000, cost_to_cents: 15000, margin_pct: 30, min_margin_cents: 0 },
  { cost_from_cents: 15000, margin_pct: 20, min_margin_cents: 0 },
];
const q = (net: number, ship: number, labor: number) => { const m = marginRuleFor(net, MARGINS); return computeQuote({ netCostCents: net, marginPct: m.margin_pct, minMarginCents: m.min_margin_cents, shippingCents: ship, laborCents: labor }); };
const counter = (net: number, labor: number) => computeQuote({ netCostCents: net, marginPct: 0, minMarginCents: 0, shippingCents: 0, laborCents: labor, roundingMode: 'none', roundingCapCents: 0 });
const sum = (items: { price: number }[]) => Math.round(items.reduce((s, i) => s + i.price * 100, 0));

describe('auto-quote pricing (Reparo blueprint examples)', () => {
  it('iPhone 12 Incell 25,63 € con IVA → 71,90 €', () => {
    expect(netCostCents({ priceCents: 2563, taxMode: 'gross' })).toBe(2118);
    const r = q(2118, 0, 2500);
    expect([r.part_cents, r.base_cents, r.pvp_raw_cents, r.pvp_cents]).toEqual([3389, 5889, 7126, 7190]);
    expect(r.invoice_base_cents + r.iva_cents).toBe(7190);
  });
  it('Soft OLED 45,08 € → 93,90 €; HDMI PS5 → 105,90 €; teclado remachado → 95,90 €', () => {
    const r = q(netCostCents({ priceCents: 4508, taxMode: 'gross' }), 0, 2500);
    expect([r.net_cost_cents, r.part_cents, r.pvp_cents]).toEqual([3726, 5216, 9390]);
    const h = q(400, 600, 6900);
    expect([h.part_cents, h.base_cents, h.pvp_raw_cents, h.pvp_cents]).toEqual([1200, 8700, 10527, 10590]);
    const k = q(1850, 0, 4900);
    expect([k.part_cents, k.pvp_cents]).toEqual([2960, 9590]);
  });
  it('non-deductible VAT, rounding never lowers the price', () => {
    expect(netCostCents({ priceCents: 2420, taxMode: 'gross', ivaDeductible: false })).toBe(2420);
    expect(roundCommercial(7190)).toBe(7190);
    expect(roundCommercial(7191)).toBe(7290);
    expect(roundCommercial(7195, 'eur1')).toBe(7200);
    expect(roundCommercial(7105, 'x9')).toBe(7190);
    expect(roundCommercial(7850, 'x9')).toBe(7900);
  });
  it('offer lines add up to the exact PVP (also hand-edited and below-cost PVPs)', () => {
    const r = q(2118, 0, 2500);
    const items = offerItemsFor({ ...r, tier: 1, quality_label: 'Incell', part_title: 'Pantalla iPhone 12', warranty_months: 3, labor_label: 'Cambio de pantalla' });
    expect(sum(items)).toBe(7190);
    expect(items[0].warranty_days).toBe(90);
    expect(sum(offerItemsFor({ ...counter(1946, 2500), tier: 1, part_title: 'x', warranty_months: 3 }))).toBe(5380);
    const manual = offerItemsFor({ ...counter(1946, 2500), pvp_cents: 4990, tier: 1, part_title: 'x', warranty_months: 3 });
    expect(sum(manual)).toBe(4990);
    expect([Math.round(manual[0].price * 100), Math.round(manual[1].price * 100)]).toEqual([2355, 2635]);
    const low = offerItemsFor({ ...counter(4703, 1000), pvp_cents: 5000, tier: 3, part_title: 'x', warranty_months: 3 });
    expect([Math.round(low[0].price * 100), Math.round(low[1].price * 100)]).toEqual([5000, 0]);
  });
  it('labour rules and the counter formula', () => {
    const LR = [{ category: 'portatil', part_type: 'keyboard', level: 'N2' }, { category: 'portatil', part_type: 'other', level: 'N3' }];
    expect(laborRuleFor('portatil', 'keyboard_riveted', LR).part_type).toBe('keyboard');
    expect(laborCentsFor({ level: 'N4', consumables_cents: 150 }, DEFAULT_PRICING)).toBe(5050);
    expect(counter(1946, 2500).pvp_cents).toBe(5380);
    expect(counter(2038, 3500).pvp_cents).toBe(6701);
    expect(counter(4703, 8500).pvp_cents).toBe(15976);
    const c = counter(1646, 1000);
    expect([c.pvp_cents, c.part_cents, c.rounding_delta_cents]).toEqual([3202, 1646, 0]);
  });
  it('quote message uses the shop line, not a hard-coded shop', () => {
    const m = buildQuoteMessage({ number: '2026-000001', device: 'iPhone 12', service: 'Cambio de pantalla', options: [q(2118, 0, 2500)], shopLine: 'Taller Ana · Calle Mayor 1' });
    expect(m).toContain('71,90 €');
    expect(m).toContain('Taller Ana · Calle Mayor 1');
    expect(m).not.toContain('Torrent');
  });
});
