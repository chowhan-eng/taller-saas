// Devoluciones: pick a recent sale, refund the whole sale or single lines (or a typed amount for sales made
// before lines were stored). Puts tracked stock back and records negative movements in the OPEN cash session.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { euros, mod, uid, when } from '../api';
import { Alert, cx, useDash, useDebounced } from '../ui';

type Line = { id: string; name: string; qty: number; returned_qty: number; unit_price_eur: number; product_id: string | null };
type Sale = { sale_ref: string; created_date: string; total: number; refunded: number; methods: Record<string, number>; reason: string | null; lines: Line[] };
const METHOD: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', bizum: 'Bizum', transfer: 'Transferencia', deposit: 'Señal', voucher: 'Vale' };
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function Devoluciones({ onDone }: { onDone: () => void }) {
  const { ctx } = useDash();
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [sel, setSel] = useState<Sale | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [amount, setAmount] = useState('');
  const [via, setVia] = useState<string>('same');
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => setSales((await mod<{ sales: Sale[] }>('tpv', ctx, 'sales', { q: dq, days: 30 })).sales), [ctx, dq]);
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: (e as Error).message })); }, [load]);

  function pick(s: Sale) { setSel(s); setQty({}); setAmount(''); setVia('same'); setReason(''); setRestock(true); setMsg(null); }
  const hasLines = !!sel && sel.lines.length > 0;
  const left = sel ? r2(sel.total - sel.refunded) : 0;
  const itemsTotal = useMemo(() => r2((sel?.lines ?? []).reduce((s, l) => s + (qty[l.id] || 0) * l.unit_price_eur, 0)), [sel, qty]);
  const typed = Number(amount.replace(',', '.')) || 0;
  const refundAmount = hasLines ? itemsTotal : typed;
  const hasProducts = (sel?.lines ?? []).some((l) => l.product_id && (qty[l.id] || 0) > 0);

  async function confirm() {
    if (!sel || !(refundAmount > 0)) return;
    setBusy(true); setMsg(null);
    try {
      await mod('tpv', ctx, 'refund', {
        sale_ref: sel.sale_ref, reason, restock, client_request_id: uid(),
        ...(hasLines ? { items: sel.lines.filter((l) => (qty[l.id] || 0) > 0).map((l) => ({ line_id: l.id, qty: qty[l.id] })) } : { amount }),
        ...(via !== 'same' ? { payments: [{ method: via, amount: refundAmount }] } : {}),
      });
      setMsg({ ok: true, text: `Devolución de ${euros(refundAmount)} apuntada en la caja${via === 'cash' || via === 'same' ? ': entrega el efectivo del cajón' : ''}.` });
      setSel(null); await load(); onDone();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="tpv-window min-h-0 p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-bold">Ventas de los últimos 30 días</h2>
          <div className="relative ml-auto w-64"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" /><input className="tpv-input pl-8" placeholder="Buscar producto o concepto" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {msg && <div className="mb-2"><Alert kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert></div>}
        <div className="max-h-[62vh] overflow-y-auto border border-slate-300 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-200 text-left text-xs"><tr><th className="px-2 py-1">Cuándo</th><th>Concepto</th><th>Pago</th><th className="text-right">Total</th><th className="px-2 text-right">Devuelto</th></tr></thead>
            <tbody>
              {sales === null && <tr><td colSpan={5} className="p-3 text-slate-500">Cargando…</td></tr>}
              {sales?.length === 0 && <tr><td colSpan={5} className="p-3 text-slate-500">No hay ventas que coincidan.</td></tr>}
              {sales?.map((s) => (
                <tr key={s.sale_ref} onClick={() => pick(s)} className={cx('cursor-pointer border-t border-slate-200 hover:bg-yellow-50', sel?.sale_ref === s.sale_ref && 'bg-yellow-100')}>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-500">{when(s.created_date)}</td>
                  <td className="max-w-[260px] truncate" title={s.reason ?? ''}>{s.reason || s.lines.map((l) => l.name).join(', ') || s.sale_ref}</td>
                  <td className="text-xs text-slate-600">{Object.keys(s.methods).map((m) => METHOD[m] ?? m).join(' + ')}</td>
                  <td className="text-right font-semibold">{euros(s.total)}</td>
                  <td className={cx('px-2 text-right', s.refunded > 0 && 'font-semibold text-red-700')}>{s.refunded > 0 ? euros(s.refunded) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="tpv-window p-3">
        {!sel ? <p className="flex items-center gap-2 text-sm text-slate-600"><RotateCcw size={16} /> Elige una venta de la lista para devolverla.</p> : (
          <div className="space-y-3">
            <div><h2 className="text-sm font-bold">Devolver · {euros(sel.total)}</h2><p className="text-xs text-slate-500">{when(sel.created_date)} · quedan por devolver {euros(left)}</p></div>
            {hasLines ? (
              <ul className="divide-y divide-slate-200 border border-slate-300 bg-white text-sm">
                {sel.lines.map((l) => {
                  const max = l.qty - l.returned_qty;
                  return (
                    <li key={l.id} className="flex items-center gap-2 px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate" title={l.name}>{l.name}<span className="block text-xs text-slate-500">{l.qty} × {euros(l.unit_price_eur)}{l.returned_qty ? ` · ya devueltas ${l.returned_qty}` : ''}</span></span>
                      <select className="tpv-input !w-16" aria-label={`Unidades a devolver de ${l.name}`} disabled={max <= 0} value={qty[l.id] || 0} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })}>
                        {Array.from({ length: max + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <label className="block text-sm font-medium">Importe a devolver (€)
                <input className="tpv-input mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={left.toFixed(2).replace('.', ',')} />
                <span className="text-xs font-normal text-slate-500">Esta venta es anterior a las líneas guardadas: se devuelve por importe.</span></label>
            )}
            {hasLines && <button type="button" className="tpv-btn w-full" onClick={() => setQty(Object.fromEntries(sel.lines.map((l) => [l.id, l.qty - l.returned_qty])))}>Devolver todo lo pendiente</button>}

            <label className="block text-sm font-medium">Devolver por
              <select className="tpv-input mt-1" value={via} onChange={(e) => setVia(e.target.value)}>
                <option value="same">Las mismas formas de pago de la venta</option>
                {Object.keys(sel.methods).map((m) => <option key={m} value={m}>Solo {METHOD[m] ?? m}</option>)}
              </select></label>
            <label className="block text-sm font-medium">Motivo<input className="tpv-input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="No funciona, error de precio…" /></label>
            {hasProducts && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Devolver las unidades al stock</label>}
            <div className="flex items-baseline justify-between border-t border-slate-400 pt-2 text-xl font-extrabold"><span>A devolver</span><span>{euros(refundAmount)}</span></div>
            {msg && !msg.ok && <Alert>{msg.text}</Alert>}
            <button type="button" className="tpv-btn-yellow w-full" disabled={busy || !(refundAmount > 0) || refundAmount > left + 0.004} onClick={confirm}>{busy ? 'Guardando…' : `Devolver ${euros(refundAmount)}`}</button>
          </div>
        )}
      </aside>
    </div>
  );
}
