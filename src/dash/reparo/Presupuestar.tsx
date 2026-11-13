// Presupuestar: side-by-side supplier comparison (Androgeek · SpainSellers · MuchoRepuesto · +custom), price
// memory with change alerts, customisable labour and a 21 % IVA breakdown. Every column is computed by the
// server's quote action (the shop's own margin/labour rules), then up to 3 options are applied to the ticket.
// NOTE: prices are typed or remembered, not scraped: live supplier scraping needs per-shop supplier logins.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Send, Trash2 } from 'lucide-react';
import { euros, mod } from '../api';
import { Alert, Modal, useDash } from '../ui';
import SupplierSearch, { type LiveOffer } from './SupplierSearch';

export const SUPPLIERS = ['Androgeek', 'SpainSellers', 'MuchoRepuesto'];
type Opt = { net_cost_cents: number; margin_pct: number; part_cents: number; shipping_cents: number; labor_cents: number; iva_cents: number; invoice_base_cents: number; pvp_cents: number; profit_cents: number; tier?: number; quality_label?: string; part_title?: string; labor_label?: string };
type Mem = { id: string; part_label: string; supplier: string; price_eur: number; previous_price_eur: number | null; tax_mode: string; shipping_eur: number; changed_at: string | null };
type Line = { supplier: string; price: string; shipping: string; taxMode: 'gross' | 'net'; opt?: Opt; use: boolean; sku?: string; url?: string };

const num = (v: string) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export default function Presupuestar({ ticket, onClose, onApplied }: { ticket: Record<string, unknown>; onClose: () => void; onApplied: () => void }) {
  const { ctx } = useDash();
  const [part, setPart] = useState('');
  const [category, setCategory] = useState(String(ticket.device_type ?? 'movil'));
  const [labor, setLabor] = useState('');
  const [laborLabel, setLaborLabel] = useState('');
  const [lines, setLines] = useState<Line[]>(SUPPLIERS.map((s) => ({ supplier: s, price: '', shipping: '', taxMode: 'gross', use: false })));
  const [mem, setMem] = useState<Mem[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');

  const loadMem = useCallback(async (q: string) => {
    setMem((await mod<{ prices: Mem[] }>('reparo', ctx, 'listPartPrices', { q })).prices);
  }, [ctx]);
  useEffect(() => { loadMem(String(ticket.model ?? '')).catch(() => {}); }, [loadMem, ticket.model]);

  const remembered = useMemo(() => {
    const key = part.trim().toLowerCase().replace(/\s+/g, ' ');
    return new Map(mem.filter((m) => key && m.part_label.toLowerCase().replace(/\s+/g, ' ') === key).map((m) => [m.supplier, m]));
  }, [mem, part]);

  // Selecting a remembered part fills the suppliers' last known prices and flags changes.
  function fillFromMemory() {
    const a: string[] = [];
    setLines((ls) => ls.map((l) => {
      const m = remembered.get(l.supplier);
      if (!m) return l;
      if (m.previous_price_eur != null && m.previous_price_eur !== m.price_eur) a.push(`${m.supplier}: ${euros(m.previous_price_eur)} → ${euros(m.price_eur)}`);
      return { ...l, price: String(m.price_eur), shipping: String(m.shipping_eur || ''), taxMode: m.tax_mode === 'net' ? 'net' : 'gross' };
    }));
    setAlerts(a);
  }
  const upd = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...p, opt: p.price !== undefined || p.shipping !== undefined || p.taxMode ? undefined : l.opt } : l)));

  // «Usar» on a live result: fills (or adds) that supplier's column with its NET cost and remembers it by SKU.
  async function useOffer(o: LiveOffer) {
    if (o.net_cost_cents == null) return;
    const price = (o.net_cost_cents / 100).toFixed(2);
    if (!part.trim()) setPart(o.title);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.supplier === o.source_name);
      const next = { supplier: o.source_name, price, shipping: i >= 0 ? ls[i].shipping : '', taxMode: 'net' as const, use: false, sku: o.sku, url: o.url };
      return i >= 0 ? ls.map((l, x) => (x === i ? next : l)) : [...ls, next];
    });
    if (o.saved?.changed) setAlerts((a) => [...a, `${o.source_name}: ${euros(o.saved!.price_eur)} → ${euros(o.net_cost_cents! / 100)}`]);
    await mod('reparo', ctx, 'savePartPrice', { label: o.title, supplier: o.source_name, sku: o.sku, url: o.url, priceEur: Number(price), taxMode: 'net' }).catch(() => {});
    loadMem(o.title).catch(() => {});
  }

  async function compute() {
    setMsg(null); setBusy(true);
    try {
      const out: Line[] = [];
      for (const l of lines) {
        if (!(num(l.price) > 0)) { out.push({ ...l, opt: undefined }); continue; }
        const r = await mod<{ option: Opt }>('reparo', ctx, 'quote', {
          quote: { priceCents: Math.round(num(l.price) * 100), taxMode: l.taxMode, shippingCents: Math.round(num(l.shipping) * 100), category, partTitle: part || 'Recambio',
            qualityLabel: l.supplier, tier: 1, ...(labor.trim() !== '' ? { laborCents: Math.round(num(labor) * 100) } : {}), ...(laborLabel ? { laborLabel } : {}) },
        });
        out.push({ ...l, opt: r.option });
      }
      setLines(out);
      if (!out.some((l) => l.opt)) setMsg({ ok: false, text: 'Escribe el coste de la pieza en al menos un proveedor.' });
      // Remember each typed price; a price different from the remembered one raises an alert.
      if (part.trim()) {
        const a: string[] = [];
        for (const l of out) {
          if (!(num(l.price) > 0)) continue;
          const r = await mod<{ change: { from: number; to: number } | null }>('reparo', ctx, 'savePartPrice', { label: part, supplier: l.supplier, priceEur: num(l.price), taxMode: l.taxMode, shippingEur: num(l.shipping), sku: l.sku, url: l.url });
          if (r.change) a.push(`${l.supplier}: ${euros(r.change.from)} → ${euros(r.change.to)}`);
        }
        setAlerts(a);
        loadMem(part).catch(() => {});
      }
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  const priced = lines.filter((l) => l.opt);
  const cheapest = priced.length ? Math.min(...priced.map((l) => l.opt!.pvp_cents)) : 0;
  const chosen = lines.filter((l) => l.use && l.opt);

  async function apply(send: boolean) {
    setBusy(true); setMsg(null);
    try {
      const options = chosen.map((l, i) => ({ ...l.opt!, tier: i + 1 }));
      const r = await mod<{ budget_amount_eur: number; message: string }>('reparo', ctx, 'applyQuote', { ticketId: ticket.id, options });
      setText(r.message);
      if (send) await mod('reparo', ctx, 'setBudget', { ticketId: ticket.id, status: 'enviado', amountEur: r.budget_amount_eur }).catch(() => {});
      setMsg({ ok: true, text: `Presupuesto de ${euros(r.budget_amount_eur)} aplicado al ticket.` });
      onApplied();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Presupuestar · ${String(ticket.ticket_number ?? '')}`} onClose={onClose} wide>
      <div className="theme-reparo space-y-4 text-hc-ink">
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_150px_150px]">
          <label><span className="hc-label">Pieza</span><input className="hc-input" list="part-memory" value={part} onChange={(e) => setPart(e.target.value)} onBlur={fillFromMemory} placeholder={`Pantalla ${String(ticket.brand ?? '')} ${String(ticket.model ?? '')}`} />
            <datalist id="part-memory">{[...new Set(mem.map((m) => m.part_label))].map((p) => <option key={p} value={p} />)}</datalist></label>
          <label><span className="hc-label">Familia</span><select className="hc-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {['movil', 'tablet', 'portatil', 'sobremesa', 'consola', 'mando', 'smartwatch', 'otro'].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label><span className="hc-label">Mano de obra (€)</span><input className="hc-input" inputMode="decimal" value={labor} onChange={(e) => setLabor(e.target.value)} placeholder="según tus reglas" /></label>
          <label><span className="hc-label">Concepto</span><input className="hc-input" value={laborLabel} onChange={(e) => setLaborLabel(e.target.value)} placeholder="Mano de obra" /></label>
        </div>

        <SupplierSearch initialQuery={[String(ticket.brand ?? ''), String(ticket.model ?? '')].filter(Boolean).length ? `pantalla ${[ticket.brand, ticket.model].filter(Boolean).join(' ')}` : ''} onUse={useOffer} />

        {alerts.length > 0 && (
          <Alert kind="warn"><strong>El precio de proveedor ha cambiado:</strong> {alerts.join(' · ')}. Revisa el presupuesto antes de enviarlo.</Alert>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          {lines.map((l, i) => {
            const m = remembered.get(l.supplier);
            const up = m && m.previous_price_eur != null && m.price_eur > m.previous_price_eur;
            const down = m && m.previous_price_eur != null && m.price_eur < m.previous_price_eur;
            return (
              <div key={`${l.supplier}-${i}`} className={`hc-card p-3 ${l.opt && l.opt.pvp_cents === cheapest && priced.length > 1 ? 'ring-2 ring-emerald-500' : ''}`}>
                <div className="mb-2 flex items-center justify-between">
                  {SUPPLIERS.includes(l.supplier) ? <strong>{l.supplier}</strong> : <input className="hc-input !py-1 font-semibold" value={l.supplier} onChange={(e) => upd(i, { supplier: e.target.value })} aria-label="Proveedor" />}
                  {!SUPPLIERS.includes(l.supplier) && <button type="button" aria-label="Quitar proveedor" onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))} className="text-hc-muted hover:text-red-600"><Trash2 size={15} /></button>}
                  {m && (up || down) && <span className={`inline-flex items-center gap-0.5 rounded px-1.5 text-[11px] font-bold ${up ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{up ? <ArrowUp size={11} /> : <ArrowDown size={11} />} {euros(m.previous_price_eur)}</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="hc-label">Coste pieza €</span><input className="hc-input" inputMode="decimal" value={l.price} onChange={(e) => upd(i, { price: e.target.value })} /></label>
                  <label><span className="hc-label">Envío €</span><input className="hc-input" inputMode="decimal" value={l.shipping} onChange={(e) => upd(i, { shipping: e.target.value })} /></label>
                </div>
                <label className="mt-1.5 flex items-center gap-2 text-xs text-hc-muted"><input type="checkbox" checked={l.taxMode === 'net'} onChange={(e) => upd(i, { taxMode: e.target.checked ? 'net' : 'gross' })} /> El precio es sin IVA</label>
                {l.opt ? (
                  <div className="mt-3 space-y-1 border-t border-hc-line pt-2 text-[13px]">
                    <div className="flex justify-between"><span className="text-hc-muted">Pieza + margen ({l.opt.margin_pct} %)</span><span>{euros(l.opt.part_cents / 100)}</span></div>
                    {l.opt.shipping_cents > 0 && <div className="flex justify-between"><span className="text-hc-muted">Envío</span><span>{euros(l.opt.shipping_cents / 100)}</span></div>}
                    <div className="flex justify-between"><span className="text-hc-muted">{l.opt.labor_label ?? 'Mano de obra'}</span><span>{euros(l.opt.labor_cents / 100)}</span></div>
                    <div className="flex justify-between"><span className="text-hc-muted">Base imponible</span><span>{euros(l.opt.invoice_base_cents / 100)}</span></div>
                    <div className="flex justify-between"><span className="text-hc-muted">IVA 21 %</span><span>{euros(l.opt.iva_cents / 100)}</span></div>
                    <div className="flex items-baseline justify-between border-t border-hc-line pt-1 text-base font-bold"><span>PVP</span><span>{euros(l.opt.pvp_cents / 100)}</span></div>
                    <div className="flex justify-between text-xs text-hc-muted"><span>Tu beneficio</span><span>{euros(l.opt.profit_cents / 100)}</span></div>
                    <label className="mt-1 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={l.use} onChange={(e) => upd(i, { use: e.target.checked })} /> Ofrecer al cliente</label>
                  </div>
                ) : <p className="mt-3 text-xs text-hc-muted">Introduce el coste y pulsa «Calcular».</p>}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="hc-btn-ghost" onClick={() => setLines((ls) => [...ls, { supplier: 'Otro proveedor', price: '', shipping: '', taxMode: 'gross', use: false }])}><Plus size={14} /> Proveedor</button>
          <button type="button" className="hc-btn" disabled={busy} onClick={compute}>Calcular y recordar precios</button>
          <button type="button" className="hc-btn-ghost" disabled={busy || chosen.length === 0} onClick={() => apply(false)}>Aplicar al ticket ({chosen.length})</button>
          <button type="button" className="hc-btn-ghost" disabled={busy || chosen.length === 0} onClick={() => apply(true)}><Send size={14} /> Aplicar y marcar enviado</button>
        </div>
        {msg && <Alert kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert>}
        {text && (
          <div>
            <span className="hc-label">Mensaje para el cliente</span>
            <textarea readOnly className="hc-input h-40 font-mono text-xs" value={text} onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
      </div>
    </Modal>
  );
}
