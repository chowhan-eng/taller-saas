// TPV module in the Doscar / Informática Torrent desktop-window look: Venta · Caja · Cierre de caja · CashDro.
// Everything goes through the gated `tpv` function (active Pro plan + counter roles).
import { useCallback, useEffect, useState } from 'react';
import { mod, euros, when, uid } from '../api';
import { Alert, cx, useDash } from '../ui';
import type { SessionTotals } from '../../../base44/shared/cash.ts';
import Venta from './Venta';
import Cierre from './Cierre';
import Devoluciones from './Devoluciones';
import CashdroPanel, { LinkLight, useCashdroLink } from './Cashdro';

export type Summary = {
  session: Record<string, unknown> | null; totals: SessionTotals | null; movements: Record<string, unknown>[];
  previous: { next_day_float: number | null; recharges_balance: number | null; z_number: number | null } | null;
};
type TabKey = 'venta' | 'devoluciones' | 'caja' | 'cierre' | 'cashdro';
const TABS: [TabKey, string][] = [['venta', 'Venta'], ['devoluciones', 'Devoluciones'], ['caja', 'Caja'], ['cierre', 'Cierre de caja'], ['cashdro', 'CashDro']];
const KIND: Record<string, string> = { sale: 'Venta', refund: 'Devolución', cash_in: 'Entrada', cash_out: 'Salida' };
const METHOD: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', bizum: 'Bizum', transfer: 'Transferencia', deposit: 'Señal', voucher: 'Vale' };

function CajaPanel({ s, reload }: { s: Summary; reload: () => void }) {
  const { ctx } = useDash();
  const t = s.totals!;
  const [m, setM] = useState({ type: 'out' as 'in' | 'out', amount: '', person: '', reason: '' });
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { await mod('tpv', ctx, 'movement', { type: m.type, amount: m.amount, reason: m.reason, person: m.person, client_request_id: uid() }); setM({ ...m, amount: '', reason: '', person: '' }); reload(); }
    catch (e2) { setErr((e2 as Error).message); }
  }
  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[360px_1fr]">
      <div className="space-y-3">
        <section className="tpv-window p-3">
          <h3 className="mb-2 text-sm font-bold">Resumen de la caja</h3>
          <dl className="space-y-1 text-sm">
            {[['Fondo inicial', euros(t.openingFloat)], ['Ventas', euros(t.salesTotal)], ...Object.entries(t.byMethod).filter(([, v]) => v !== 0).map(([k, v]) => [`· ${METHOD[k] ?? k}`, euros(v)]), ['Entradas', euros(t.cashIn)], ['Salidas', euros(t.cashOut)]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><dt className="text-slate-600">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
            <div className="flex justify-between border-t border-slate-400 pt-1 text-base font-bold"><dt>Efectivo esperado</dt><dd>{euros(t.expectedCash)}</dd></div>
          </dl>
        </section>
        <form onSubmit={save} className="tpv-window space-y-2 p-3">
          <h3 className="text-sm font-bold">Entrada / salida de efectivo</h3>
          <div className="flex gap-1">{(['out', 'in'] as const).map((k) => <button key={k} type="button" aria-pressed={m.type === k} className={cx('tpv-btn flex-1', m.type === k && '!bg-tpv-slate !from-tpv-slate !to-tpv-slate !text-white')} onClick={() => setM({ ...m, type: k })}>{k === 'out' ? 'Salida' : 'Entrada'}</button>)}</div>
          <input className="tpv-input" inputMode="decimal" placeholder="Importe €" value={m.amount} onChange={(e) => setM({ ...m, amount: e.target.value })} required />
          <input className="tpv-input" placeholder="Motivo" value={m.reason} onChange={(e) => setM({ ...m, reason: e.target.value })} />
          {m.type === 'out' && <input className="tpv-input" placeholder="Quién se lo lleva" value={m.person} onChange={(e) => setM({ ...m, person: e.target.value })} />}
          {err && <Alert>{err}</Alert>}
          <button className="tpv-btn-primary w-full">Apuntar</button>
        </form>
      </div>
      <section className="tpv-window min-h-0 p-3">
        <h3 className="mb-2 text-sm font-bold">Movimientos</h3>
        <div className="max-h-[60vh] overflow-y-auto border border-slate-300 bg-white">
          <table className="w-full text-sm"><thead className="sticky top-0 bg-slate-200 text-left text-xs"><tr><th className="px-2 py-1">Hora</th><th>Tipo</th><th>Pago</th><th className="text-right">Importe</th><th className="px-2">Concepto</th></tr></thead>
            <tbody>
              {s.movements.slice().reverse().map((x) => (
                <tr key={String(x.id)} className="border-t border-slate-200"><td className="whitespace-nowrap px-2 py-1 text-xs text-slate-500">{when(x.created_date)}</td><td>{KIND[String(x.kind)] ?? String(x.kind)}</td><td>{METHOD[String(x.method)] ?? String(x.method)}</td>
                  <td className={cx('text-right font-semibold', x.kind === 'refund' || x.kind === 'cash_out' ? 'text-red-700' : '')}>{euros(x.amount_eur)}</td><td className="px-2 text-xs text-slate-500">{String(x.reason ?? '')}</td></tr>
              ))}
              {s.movements.length === 0 && <tr><td colSpan={5} className="p-3 text-slate-500">Todavía no hay movimientos.</td></tr>}
            </tbody></table>
        </div>
      </section>
    </div>
  );
}

export default function Tpv() {
  const { ctx } = useDash();
  const [s, setS] = useState<Summary | null>(null);
  const [tab, setTab] = useState<TabKey>('venta');
  const [float, setFloat] = useState('');
  const [z, setZ] = useState<Record<string, unknown> | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { link } = useCashdroLink();

  const load = useCallback(async () => setS(await mod<Summary>('tpv', ctx, 'summary')), [ctx]);
  useEffect(() => { load().catch((e) => setErr((e as Error).message)); }, [load]);
  useEffect(() => { mod<{ google_review_url?: string | null }>('whatsapp', ctx, 'settings').then((r) => setReviewUrl(r.google_review_url || null)).catch(() => {}); }, [ctx]);
  const reload = useCallback(() => { load().catch((e) => setErr((e as Error).message)); }, [load]);

  async function open(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { await mod('tpv', ctx, 'openSession', { opening_float: float || undefined }); setZ(null); await load(); } catch (e2) { setErr((e2 as Error).message); }
  }
  if (!s) return <div className="theme-tpv h-full p-6">{err ?? 'Cargando la caja…'}</div>;

  const iso = String(s.session?.opened_at ?? '');
  const opened = iso ? new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <div className="theme-tpv flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-tpv-slate px-4 py-2 text-sm text-white">
        <strong className="text-base">TPV</strong>
        <span>Cajero: <strong>Caja 1</strong></span>
        {s.session ? <span>Caja abierta a las <strong>{opened}</strong></span> : <span className="text-yellow-300">Caja cerrada</span>}
        {s.totals && <span>Efectivo esperado: <strong>{euros(s.totals.expectedCash)}</strong></span>}
        <span className="ml-auto text-white"><LinkLight link={link} /></span>
      </header>
      {z && <div className="px-3 pt-2"><Alert kind="ok">Caja cerrada · Z {String(z.z_number)} · diferencia {euros(z.difference)} · fondo para mañana {euros(z.next_day_float)}</Alert></div>}
      {err && <div className="px-3 pt-2"><Alert>{err}</Alert></div>}

      {!s.session ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto mt-6 grid max-w-3xl gap-4 p-3 md:grid-cols-2">
            <form className="tpv-window space-y-3 p-4" onSubmit={open}>
              <h2 className="text-base font-bold">Abrir caja</h2>
              <label className="block text-sm font-medium">Fondo inicial (€)
                <input className="tpv-input mt-1 text-lg" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder={s.previous?.next_day_float != null ? `Fondo de ayer: ${euros(s.previous.next_day_float)}` : '0,00'} /></label>
              <button className="tpv-btn-yellow w-full">Abrir caja</button>
            </form>
            <div className="tpv-window p-4 text-sm text-slate-600"><p>Abre la caja para cobrar. Si no escribes fondo, se usa el «fondo para mañana» del último cierre.</p></div>
          </div>
          <CashdroPanel />
        </div>
      ) : (
        <>
          <nav className="flex gap-1 border-b border-tpv-edge bg-slate-300 px-3 pt-2" role="tablist">
            {TABS.map(([k, label]) => <button key={k} type="button" role="tab" className="tpv-tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'venta' && <Venta reviewUrl={reviewUrl} onSold={reload} />}
            {tab === 'devoluciones' && <Devoluciones onDone={reload} />}
            {tab === 'caja' && s.totals && <CajaPanel s={s} reload={reload} />}
            {tab === 'cierre' && s.totals && <Cierre s={s} reload={reload} onClosed={(r) => { setZ(r); setTab('venta'); reload(); }} />}
            {tab === 'cashdro' && <CashdroPanel />}
          </div>
        </>
      )}
    </div>
  );
}
