// Venta: product/service grid by family, quick-ticket billing from Reparo (repairs ready to collect), cart with
// IVA breakdown and the Cobrar button. There is deliberately NO cash-in/out button here: withdrawals live in Cierre.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minus, PackagePlus, Pencil, Plus, Search, Trash2, Wrench } from 'lucide-react';
import { euros, mod } from '../api';
import { Alert, Modal, canAdmin, cx, useDash, useDebounced } from '../ui';
import CobrarDialog, { type Cart } from './Cobrar';

type Product = { id: string; name: string; family: string; kind: string; price_eur: number; iva_pct: number; track_stock: boolean; stock: number };
type ReadyTicket = { id: string; ticket_number: string; brand: string; model: string | null; customer_name: string | null; budget_amount_eur: number | null };

const COLORS = ['bg-sky-200', 'bg-emerald-200', 'bg-amber-200', 'bg-rose-200', 'bg-violet-200', 'bg-teal-200', 'bg-orange-200', 'bg-lime-200'];
const colorOf = (s: string) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

function ProductEditor({ products, onClose, onChanged }: { products: Product[]; onClose: () => void; onChanged: () => void }) {
  const { ctx } = useDash();
  const blank = { id: '', name: '', family: '', kind: 'product', price_eur: '', iva_pct: '21', track_stock: false, stock: '0' };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await mod('tpv', ctx, 'saveProduct', { product: { ...f, id: f.id || undefined, price_eur: Number(String(f.price_eur).replace(',', '.')), iva_pct: Number(f.iva_pct), track_stock: f.track_stock, stock: Number(f.stock) || 0 } });
      setF(blank); onChanged();
    } catch (e2) { setErr((e2 as Error).message); }
  }
  return (
    <Modal title="Productos y servicios" onClose={onClose} wide>
      <form onSubmit={save} className="theme-tpv mb-3 grid items-end gap-2 bg-transparent sm:grid-cols-[1fr_130px_100px_90px_80px_auto]">
        <label className="text-xs font-semibold">Nombre<input className="tpv-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className="text-xs font-semibold">Familia<input className="tpv-input" value={f.family} onChange={(e) => setF({ ...f, family: e.target.value })} placeholder="Fundas" list="fams" /></label>
        <label className="text-xs font-semibold">Tipo<select className="tpv-input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="product">Producto</option><option value="service">Servicio</option></select></label>
        <label className="text-xs font-semibold">Precio €<input className="tpv-input" inputMode="decimal" value={f.price_eur} onChange={(e) => setF({ ...f, price_eur: e.target.value })} required /></label>
        <label className="text-xs font-semibold">IVA<select className="tpv-input" value={f.iva_pct} onChange={(e) => setF({ ...f, iva_pct: e.target.value })}>{[21, 10, 4, 0].map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" checked={f.track_stock} onChange={(e) => setF({ ...f, track_stock: e.target.checked })} /> Controlar stock
          {f.track_stock && <input className="tpv-input !w-16" inputMode="numeric" aria-label="Unidades en stock" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value.replace(/\D/g, '') })} />}</label>
        <button className="tpv-btn-primary">{f.id ? 'Guardar' : 'Añadir'}</button>
        <datalist id="fams">{[...new Set(products.map((p) => p.family))].map((x) => <option key={x} value={x} />)}</datalist>
      </form>
      {err && <Alert>{err}</Alert>}
      <div className="max-h-80 overflow-y-auto border border-slate-300">
        <table className="w-full text-sm"><tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-b border-slate-200">
              <td className="px-2 py-1.5 font-medium">{p.name}</td><td className="px-2 text-slate-600">{p.family}</td><td className="px-2 text-right">{euros(p.price_eur)}</td><td className="px-2 text-xs text-slate-500">IVA {p.iva_pct} %{p.track_stock ? ` · stock ${p.stock}` : ''}</td>
              <td className="px-2 text-right">
                <button type="button" aria-label="Editar" className="mr-2 text-slate-600 hover:text-slate-900" onClick={() => setF({ id: p.id, name: p.name, family: p.family, kind: p.kind, price_eur: String(p.price_eur), iva_pct: String(p.iva_pct), track_stock: p.track_stock, stock: String(p.stock) })}><Pencil size={14} /></button>
                <button type="button" aria-label="Borrar" className="text-slate-600 hover:text-red-700" onClick={async () => { await mod('tpv', ctx, 'deleteProduct', { id: p.id }); onChanged(); }}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
          {products.length === 0 && <tr><td className="p-3 text-slate-500">Sin productos todavía.</td></tr>}
        </tbody></table>
      </div>
    </Modal>
  );
}

export default function Venta({ reviewUrl, onSold }: { reviewUrl: string | null; onSold: () => void }) {
  const { ctx, nav, go } = useDash();
  const [products, setProducts] = useState<Product[]>([]);
  const [family, setFamily] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const [cart, setCart] = useState<Cart>([]);
  const [ready, setReady] = useState<ReadyTicket[]>([]);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [free, setFree] = useState({ name: '', price: '' });
  const [err, setErr] = useState<string | null>(null);

  const loadProducts = useCallback(async () => setProducts((await mod<{ products: Product[] }>('tpv', ctx, 'listProducts')).products), [ctx]);
  const loadReady = useCallback(async () => {
    const r = await mod<{ tickets: ReadyTicket[] }>('reparo', ctx, 'listTickets', { status: 'listo_recoger', limit: 50 }).catch(() => ({ tickets: [] as ReadyTicket[] }));
    setReady(r.tickets);
  }, [ctx]);
  useEffect(() => { loadProducts().catch((e) => setErr((e as Error).message)); loadReady(); }, [loadProducts, loadReady]);

  const add = (p: { key: string; name: string; price: number; iva: number; ticketId?: string; productId?: string }, stock?: number) =>
    setCart((c) => {
      const have = c.find((l) => l.key === p.key)?.qty ?? 0;
      if (stock !== undefined && have + 1 > stock) { setErr(`No queda más stock de «${p.name}».`); return c; }
      const hit = c.find((l) => l.key === p.key);
      return hit ? c.map((l) => (l.key === p.key ? { ...l, qty: l.qty + 1 } : l)) : [...c, { ...p, qty: 1 }];
    });

  // Quick-ticket: what is still owed on a repair = budget − deposit − already charged at the till.
  const addTicket = useCallback(async (id: string) => {
    setErr(null);
    if (cart.some((l) => l.ticketId && l.ticketId !== id)) { setErr('Cobra primero la reparación que ya está en el carrito.'); return; }
    try {
      const r = await mod<{ ticket: Record<string, unknown> }>('reparo', ctx, 'getTicket', { ticketId: id });
      const t = r.ticket;
      const due = Math.round(((Number(t.budget_amount_eur) || 0) - (Number(t.deposit_eur) || 0) - (Number(t.tpv_paid_total_eur) || 0)) * 100) / 100;
      if (!(due > 0)) { setErr(`${String(t.ticket_number)} no tiene nada pendiente de cobro.`); return; }
      add({ key: `t-${id}`, name: `Reparación ${String(t.ticket_number)} · ${[t.brand, t.model].filter(Boolean).join(' ')}`, price: due, iva: 21, ticketId: id });
    } catch (e) { setErr((e as Error).message); }
  }, [ctx, cart]);
  useEffect(() => { if (nav.ticketId && nav.tab === 'tpv') addTicket(nav.ticketId).then(() => go({ tab: 'tpv' })); }, [nav.ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  const families = useMemo(() => [...new Set(products.map((p) => p.family))].sort(), [products]);
  const shown = products.filter((p) => (!family || p.family === family) && (!dq || p.name.toLowerCase().includes(dq.toLowerCase())));
  const total = Math.round(cart.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100;
  const base = Math.round(cart.reduce((s, l) => s + (l.price * l.qty) / (1 + l.iva / 100), 0) * 100) / 100;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="tpv-window flex min-h-0 flex-col p-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" /><input className="tpv-input pl-8" placeholder="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {canAdmin(ctx) && <button type="button" className="tpv-btn" onClick={() => setEditing(true)}><PackagePlus size={15} /> Productos</button>}
        </div>
        <div className="mb-2 flex flex-wrap gap-1" role="tablist">
          <button type="button" role="tab" className="tpv-tab" aria-selected={family === ''} onClick={() => setFamily('')}>Todo</button>
          {families.map((f) => <button key={f} type="button" role="tab" className="tpv-tab" aria-selected={family === f} onClick={() => setFamily(f)}>{f}</button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => (
              <button key={p.id} type="button" onClick={() => add({ key: `p-${p.id}`, name: p.name, price: p.price_eur, iva: Number(p.iva_pct), productId: p.id }, p.track_stock ? p.stock : undefined)}
                className={cx('flex h-24 flex-col justify-between border border-slate-400 p-2 text-left shadow-sm hover:brightness-95 active:translate-y-px', colorOf(p.family))}>
                <span className="line-clamp-2 text-sm font-semibold leading-tight">{p.name}</span><span className="flex items-baseline justify-between"><span className="text-base font-extrabold">{euros(p.price_eur)}</span>{p.track_stock && <span className={cx('text-[11px] font-semibold', p.stock <= 0 ? 'text-red-700' : p.stock <= 3 ? 'text-amber-800' : 'text-slate-600')}>{p.stock <= 0 ? 'Sin stock' : `${p.stock} ud.`}</span>}</span>
              </button>
            ))}
            {shown.length === 0 && <p className="col-span-full p-3 text-sm text-slate-600">{products.length === 0 ? 'Aún no hay productos. Añádelos con «Productos» o usa el importe libre.' : 'Ningún producto coincide.'}</p>}
          </div>

          <h3 className="mb-1 mt-4 flex items-center gap-1.5 text-sm font-bold"><Wrench size={15} /> Reparaciones listas para cobrar</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ready.map((t) => (
              <button key={t.id} type="button" onClick={() => addTicket(t.id)} className="flex items-center justify-between border border-slate-400 bg-white p-2 text-left hover:bg-yellow-50">
                <span><strong className="text-sm">{t.ticket_number}</strong><span className="block text-xs text-slate-600">{[t.brand, t.model].filter(Boolean).join(' ')} · {t.customer_name ?? '—'}</span></span>
                <span className="font-bold">{Number(t.budget_amount_eur) > 0 ? euros(t.budget_amount_eur) : '—'}</span>
              </button>
            ))}
            {ready.length === 0 && <p className="text-xs text-slate-500">Ninguna reparación pendiente de recoger.</p>}
          </div>

          <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-300 pt-3" onSubmit={(e) => { e.preventDefault(); const p = Number(free.price.replace(',', '.')); if (free.name && p > 0) { add({ key: `f-${Date.now()}`, name: free.name, price: p, iva: 21 }); setFree({ name: '', price: '' }); } }}>
            <label className="text-xs font-semibold">Importe libre<input className="tpv-input !w-52" placeholder="Concepto" value={free.name} onChange={(e) => setFree({ ...free, name: e.target.value })} /></label>
            <input className="tpv-input !w-24 text-right" inputMode="decimal" placeholder="0,00" aria-label="Importe libre" value={free.price} onChange={(e) => setFree({ ...free, price: e.target.value })} />
            <button className="tpv-btn">Añadir</button>
          </form>
        </div>
      </section>

      <aside className="tpv-window flex min-h-0 flex-col p-2">
        <h2 className="mb-1 border-b border-slate-300 pb-1 text-sm font-bold">Ticket actual</h2>
        {err && <Alert>{err}</Alert>}
        <ul className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto bg-white">
          {cart.map((l) => (
            <li key={l.key} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate" title={l.name}>{l.name}</span>
              {!l.ticketId && (
                <span className="flex items-center">
                  <button type="button" aria-label="Menos" className="tpv-btn !p-1" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus size={12} /></button>
                  <span className="w-6 text-center">{l.qty}</span>
                  <button type="button" aria-label="Más" className="tpv-btn !p-1" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}><Plus size={12} /></button>
                </span>
              )}
              <span className="w-20 text-right font-semibold">{euros(l.price * l.qty)}</span>
              <button type="button" aria-label="Quitar" className="text-slate-500 hover:text-red-700" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}><Trash2 size={14} /></button>
            </li>
          ))}
          {cart.length === 0 && <li className="p-4 text-center text-sm text-slate-500">Añade productos o una reparación para cobrar.</li>}
        </ul>
        <div className="mt-2 space-y-0.5 border-t border-slate-400 pt-2 text-sm">
          <div className="flex justify-between text-slate-600"><span>Base imponible</span><span>{euros(base)}</span></div>
          <div className="flex justify-between text-slate-600"><span>IVA</span><span>{euros(total - base)}</span></div>
          <div className="flex items-baseline justify-between text-2xl font-extrabold"><span>Total</span><span>{euros(total)}</span></div>
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
          <button type="button" className="tpv-btn-yellow" disabled={!(total > 0)} onClick={() => setPaying(true)}>Cobrar {total > 0 ? euros(total) : ''}</button>
          <button type="button" className="tpv-btn" disabled={cart.length === 0} onClick={() => setCart([])}>Vaciar</button>
        </div>
      </aside>

      {paying && <CobrarDialog cart={cart} total={total} reviewUrl={reviewUrl} onClose={() => setPaying(false)} onDone={() => { setPaying(false); setCart([]); onSold(); loadReady(); loadProducts().catch(() => {}); }} />}
      {editing && <ProductEditor products={products} onClose={() => setEditing(false)} onChanged={() => loadProducts().catch(() => {})} />}
    </div>
  );
}
