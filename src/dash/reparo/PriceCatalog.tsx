// Catálogo de precios: the price memory (last cost of each part at each supplier) with change alerts.
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { euros, mod, when } from '../api';
import { Alert, useDash, useDebounced } from '../ui';
import { SUPPLIERS } from './Presupuestar';

type Row = { id: string; part_label: string; supplier: string; price_eur: number; previous_price_eur: number | null; tax_mode: string; shipping_eur: number; changed_at: string | null };

export default function PriceCatalog() {
  const { ctx } = useDash();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [form, setForm] = useState({ label: '', supplier: SUPPLIERS[0], price: '', shipping: '' });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => setRows((await mod<{ prices: Row[] }>('reparo', ctx, 'listPartPrices', { q: dq })).prices), [ctx, dq]);
  useEffect(() => { load().catch((e) => setErr((e as Error).message)); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await mod('reparo', ctx, 'savePartPrice', { label: form.label, supplier: form.supplier, priceEur: Number(form.price.replace(',', '.')), shippingEur: Number(form.shipping.replace(',', '.')) || 0 });
      setForm({ ...form, label: '', price: '', shipping: '' });
      await load();
    } catch (e2) { setErr((e2 as Error).message); }
  }
  const changed = (rows ?? []).filter((r) => r.previous_price_eur != null && r.previous_price_eur !== r.price_eur);

  return (
    <div className="space-y-4 p-5">
      <div>
        <h2 className="text-xl font-bold">Catálogo de precios de proveedor</h2>
        <p className="text-sm text-hc-muted">Aquí se recuerda el último coste de cada pieza en cada proveedor. Si un precio cambia, se marca para que revises tus presupuestos.</p>
      </div>
      {changed.length > 0 && <Alert kind="warn"><strong>{changed.length} precio(s) han cambiado:</strong> {changed.slice(0, 4).map((r) => `${r.part_label} (${r.supplier}) ${euros(r.previous_price_eur)} → ${euros(r.price_eur)}`).join(' · ')}{changed.length > 4 ? '…' : ''}</Alert>}
      <form onSubmit={add} className="hc-card grid items-end gap-3 p-3 sm:grid-cols-[1fr_170px_110px_110px_auto]">
        <label><span className="hc-label">Pieza</span><input className="hc-input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required placeholder="Pantalla iPhone 13 OLED" /></label>
        <label><span className="hc-label">Proveedor</span><select className="hc-input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })}>{SUPPLIERS.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label><span className="hc-label">Coste €</span><input className="hc-input" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label>
        <label><span className="hc-label">Envío €</span><input className="hc-input" inputMode="decimal" value={form.shipping} onChange={(e) => setForm({ ...form, shipping: e.target.value })} /></label>
        <button className="hc-btn"><Plus size={14} /> Guardar</button>
      </form>
      {err && <Alert>{err}</Alert>}
      <input className="hc-input max-w-sm" placeholder="Buscar pieza o proveedor" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="hc-card hc-surface overflow-x-auto">
        <table>
          <thead><tr><th>Pieza</th><th>Proveedor</th><th className="text-right">Coste</th><th className="text-right">Antes</th><th>Cambio</th><th>Actualizado</th><th /></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={7} className="text-hc-muted">Cargando…</td></tr>}
            {rows !== null && rows.length === 0 && <tr><td colSpan={7} className="text-hc-muted">Aún no hay precios guardados. Se añaden solos al presupuestar.</td></tr>}
            {(rows ?? []).map((r) => {
              const up = r.previous_price_eur != null && r.price_eur > r.previous_price_eur, down = r.previous_price_eur != null && r.price_eur < r.previous_price_eur;
              return (
                <tr key={r.id}>
                  <td className="font-medium">{r.part_label}</td><td>{r.supplier}</td>
                  <td className="text-right font-semibold">{euros(r.price_eur)}</td>
                  <td className="text-right text-hc-muted">{r.previous_price_eur != null ? euros(r.previous_price_eur) : '—'}</td>
                  <td>{up && <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 text-xs font-bold text-red-700"><ArrowUp size={12} /> Sube</span>}{down && <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 text-xs font-bold text-emerald-700"><ArrowDown size={12} /> Baja</span>}</td>
                  <td className="text-xs text-hc-muted">{when(r.changed_at)}</td>
                  <td><button type="button" aria-label="Borrar" className="text-hc-muted hover:text-red-600" onClick={async () => { await mod('reparo', ctx, 'deletePartPrice', { id: r.id }); await load(); }}><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
