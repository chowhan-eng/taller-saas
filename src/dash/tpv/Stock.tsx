// Stock: tracked products with low-stock flags, manual adjustment (stocktake, breakage, goods received) and
// the audit trail. Only owner/admin can adjust; counter staff only see it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, History, Minus, Plus } from 'lucide-react';
import { euros, mod, when } from '../api';
import { Alert, canAdmin, cx, useDash } from '../ui';

export type StockProduct = { id: string; name: string; family: string; price_eur: number; track_stock: boolean; stock: number; low_stock_threshold: number };
type Move = { id: string; created_date: string; product_name: string; delta: number; stock_after: number; reason: string };

export const isLow = (p: StockProduct) => p.track_stock && p.stock <= p.low_stock_threshold;

export default function Stock({ onChanged }: { onChanged: () => void }) {
  const { ctx } = useDash();
  const admin = canAdmin(ctx);
  const [products, setProducts] = useState<StockProduct[] | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [sel, setSel] = useState<StockProduct | null>(null);
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [val, setVal] = useState('');
  const [reason, setReason] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setProducts((await mod<{ products: StockProduct[] }>('tpv', ctx, 'listProducts')).products);
    setMoves((await mod<{ moves: Move[] }>('tpv', ctx, 'stockLog')).moves);
  }, [ctx]);
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: (e as Error).message })); }, [load]);

  const low = useMemo(() => (products ?? []).filter(isLow), [products]);
  const rows = (products ?? []).filter((p) => (onlyLow ? isLow(p) : true)).sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || a.name.localeCompare(b.name));

  async function apply() {
    if (!sel) return;
    setBusy(true); setMsg(null);
    try {
      const n = Number(val.replace(',', '.'));
      const r = await mod<{ stock: number; delta: number }>('tpv', ctx, 'adjustStock', { product_id: sel.id, reason, ...(mode === 'set' ? { set: n } : { delta: n }) });
      setMsg({ ok: true, text: `«${sel.name}»: ${r.delta >= 0 ? '+' : ''}${r.delta} → ${r.stock} unidades.` });
      setSel(null); setVal(''); setReason(''); await load(); onChanged();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="tpv-window p-3">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold">Stock de productos</h2>
          <label className="ml-auto flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Solo poco stock ({low.length})</label>
        </div>
        {low.length > 0 && <div className="mb-2"><Alert kind="warn"><AlertTriangle size={14} className="mr-1 inline" /><strong>Poco stock:</strong> {low.slice(0, 6).map((p) => `${p.name} (${p.stock})`).join(' · ')}{low.length > 6 ? '…' : ''}</Alert></div>}
        {msg && <div className="mb-2"><Alert kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert></div>}
        <div className="max-h-[60vh] overflow-y-auto border border-slate-300 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-200 text-left text-xs"><tr><th className="px-2 py-1">Producto</th><th>Familia</th><th className="text-right">Precio</th><th className="text-right">Aviso ≤</th><th className="px-2 text-right">Stock</th></tr></thead>
            <tbody>
              {products === null && <tr><td colSpan={5} className="p-3 text-slate-500">Cargando…</td></tr>}
              {products !== null && rows.length === 0 && <tr><td colSpan={5} className="p-3 text-slate-500">{onlyLow ? 'Nada con poco stock.' : 'No hay productos.'}</td></tr>}
              {rows.map((p) => (
                <tr key={p.id} onClick={() => { setSel(p); setMode('delta'); setVal(''); setReason(''); setMsg(null); }} className={cx('cursor-pointer border-t border-slate-200 hover:bg-yellow-50', sel?.id === p.id && 'bg-yellow-100')}>
                  <td className="px-2 py-1.5 font-medium">{p.name}</td><td className="text-slate-600">{p.family}</td><td className="text-right">{euros(p.price_eur)}</td>
                  <td className="text-right text-slate-500">{p.track_stock ? p.low_stock_threshold : '—'}</td>
                  <td className={cx('px-2 text-right font-bold', !p.track_stock ? 'font-normal text-slate-400' : p.stock <= 0 ? 'text-red-700' : isLow(p) ? 'text-amber-700' : '')}>{p.track_stock ? p.stock : 'sin control'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="space-y-3">
        <section className="tpv-window p-3">
          {!sel ? <p className="text-sm text-slate-600">Elige un producto para ajustar su stock.</p> : !admin ? <p className="text-sm text-slate-600">Solo el titular o un administrador pueden ajustar el stock.</p> : (
            <div className="space-y-2.5">
              <div><h3 className="text-sm font-bold">{sel.name}</h3><p className="text-xs text-slate-500">{sel.track_stock ? `Ahora: ${sel.stock} unidades` : 'Sin control de stock: el ajuste lo activa'}</p></div>
              <div className="flex gap-1">
                {([['delta', 'Entra / sale'], ['set', 'Fijar recuento']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={mode === k} className={cx('tpv-btn flex-1', mode === k && '!bg-tpv-slate !from-tpv-slate !to-tpv-slate !text-white')} onClick={() => { setMode(k); setVal(''); }}>{l}</button>)}
              </div>
              <div className="flex items-center gap-1">
                {mode === 'delta' && <button type="button" aria-label="Quitar uno" className="tpv-btn !p-2" onClick={() => setVal(String((Number(val) || 0) - 1))}><Minus size={14} /></button>}
                <input className="tpv-input text-center text-lg" inputMode="numeric" aria-label={mode === 'delta' ? 'Unidades (negativo = salen)' : 'Unidades contadas'} placeholder={mode === 'delta' ? '+10 / -2' : '0'} value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d-]/g, ''))} />
                {mode === 'delta' && <button type="button" aria-label="Añadir uno" className="tpv-btn !p-2" onClick={() => setVal(String((Number(val) || 0) + 1))}><Plus size={14} /></button>}
              </div>
              <label className="block text-sm font-medium">Motivo<input className="tpv-input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recuento, pedido recibido, roto…" /></label>
              <button type="button" className="tpv-btn-yellow w-full" disabled={busy || !val || !reason.trim()} onClick={apply}>{busy ? 'Guardando…' : 'Aplicar ajuste'}</button>
            </div>
          )}
        </section>
        <section className="tpv-window p-3">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold"><History size={14} /> Últimos ajustes</h3>
          <ul className="max-h-60 divide-y divide-slate-200 overflow-y-auto border border-slate-300 bg-white text-xs">
            {moves.length === 0 && <li className="p-2 text-slate-500">Sin ajustes manuales todavía.</li>}
            {moves.map((m) => <li key={m.id} className="px-2 py-1.5"><div className="flex justify-between"><strong>{m.product_name}</strong><span className={m.delta < 0 ? 'font-bold text-red-700' : 'font-bold text-emerald-700'}>{m.delta > 0 ? '+' : ''}{m.delta} → {m.stock_after}</span></div><div className="text-slate-500">{when(m.created_date)} · {m.reason}</div></li>)}
          </ul>
        </section>
      </aside>
    </div>
  );
}
