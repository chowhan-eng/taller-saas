// Cierre de caja wizard — Paso 1 · X (read-only report), Paso 2 · Informes (movements, retiradas, históricos),
// Paso 3 · Z (the 10 boxes, same computeCierre the server uses). Cash withdrawals live HERE, not on the Venta tab.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, FileText, History } from 'lucide-react';
import { euros, mod, uid, when } from '../api';
import { Alert, cx, useDash } from '../ui';
import { cashdro, cashdroEnabled, fromCents } from '@/lib/cashdro';
import { computeCierre, parseMoney, type SessionTotals } from '../../../base44/shared/cash.ts';
import { PrintArea } from '../reparo/print';
import type { Summary } from './Tpv';

const METHOD_LABEL: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', bizum: 'Bizum', transfer: 'Transferencia', deposit: 'Señal', voucher: 'Vale' };
const KIND: Record<string, string> = { sale: 'Venta', refund: 'Devolución', cash_in: 'Entrada', cash_out: 'Retirada' };
type Closing = { id: string; z_number: number; business_date: string; closed_at: string; sales_total_eur: number; expected_cash_eur: number; counted_cash_eur: number; difference_eur: number; withdrawn_cash_eur: number; next_day_float_eur: number; recharges_total_eur: number | null; ticket_count: number; difference_reason: string | null };

function ReportLines({ totals }: { totals: SessionTotals }) {
  const rows: [string, string][] = [
    ['Fondo inicial', euros(totals.openingFloat)], ['Tickets', String(totals.saleCount)], ['Total ventas', euros(totals.salesTotal)],
    ...Object.entries(totals.byMethod).filter(([, v]) => v !== 0).map(([k, v]) => [`  ${METHOD_LABEL[k] ?? k}`, euros(v)] as [string, string]),
    ['Devoluciones', `${totals.refundCount} · ${euros(totals.refundTotal)}`], ['Entradas de efectivo', euros(totals.cashIn)], ['Retiradas de efectivo', euros(totals.cashOut)],
    ['Efectivo esperado', euros(totals.expectedCash)],
  ];
  return <dl className="divide-y divide-slate-200 border border-slate-300 bg-white text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between px-3 py-1.5"><dt className="whitespace-pre text-slate-600">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>;
}

export default function Cierre({ s, onClosed, reload }: { s: Summary; onClosed: (z: Record<string, unknown>) => void; reload: () => void }) {
  const { ctx } = useDash();
  const totals = s.totals as SessionTotals;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showX, setShowX] = useState(false);
  const [v, setV] = useState({ fondo: String(s.previous?.next_day_float ?? totals.openingFloat ?? 0).replace('.', ','), tarjeta: String(totals.byMethod.card).replace('.', ','), real: '', retirado: '', recargas: '', saldo: '', motivo: '' });
  const [cashdroReport, setCashdroReport] = useState<Record<string, unknown> | null>(null);
  const [cutoff] = useState(() => new Date().toISOString());
  const [printZ, setPrintZ] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Closing[] | null>(null);
  const [showHist, setShowHist] = useState(false);
  const [zPrint, setZPrint] = useState<Record<string, unknown> | null>(null);
  const [mov, setMov] = useState({ type: 'out' as 'in' | 'out', amount: '', person: '', reason: '' });

  const n = (x: string) => { const p = parseMoney(x); return p === null || Number.isNaN(p) ? null : p; };
  const c = computeCierre(totals, { fondo: n(v.fondo) ?? 0, tarjeta: n(v.tarjeta) ?? 0, real: n(v.real), retirado: n(v.retirado) ?? 0 });
  const withdrawals = useMemo(() => s.movements.filter((m) => m.kind === 'cash_out' || m.kind === 'cash_in'), [s.movements]);

  const loadHistory = useCallback(async () => setHistory((await mod<{ closings: Closing[] }>('tpv', ctx, 'history')).closings), [ctx]);
  useEffect(() => { if (step === 2 && showHist && history === null) loadHistory().catch(() => setHistory([])); }, [step, showHist, history, loadHistory]);

  async function saveMovement(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await mod('tpv', ctx, 'movement', { type: mov.type, amount: mov.amount, reason: mov.reason, person: mov.person, client_request_id: uid() });
      setMov({ ...mov, amount: '', reason: '', person: '' }); reload();
    } catch (e2) { setErr((e2 as Error).message); }
  }
  async function readCashdro() {
    setErr(null);
    try {
      const lv = await cashdro.levels() as Record<string, unknown> & { totals?: { totalCents?: number } };
      setCashdroReport(lv);
      if (lv.totals?.totalCents != null) setV((x) => ({ ...x, real: String(fromCents(lv.totals!.totalCents)).replace('.', ',') }));
    } catch (e) { setErr((e as Error).message); }
  }
  async function cassette() {
    setErr(null);
    try { await cashdro.startCassetteWithdrawal(''); setErr(null); } catch (e) { setErr((e as Error).message); }
  }
  async function close() {
    setErr(null); setBusy(true);
    try {
      const z = await mod<Record<string, unknown>>('tpv', ctx, 'close', {
        counted_cash: v.real, opening_float: v.fondo, card_total: v.tarjeta, withdrawn_cash: v.retirado || undefined,
        recharges_total: v.recargas || undefined, recharges_balance: v.saldo || undefined, difference_reason: v.motivo || undefined, cutoff_at: cutoff, cashdro_report: cashdroReport ?? undefined,
      });
      if (printZ) setZPrint(z);
      onClosed(z);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const box = (k: keyof typeof v, label: string, hint?: string) => (
    <label className="block text-sm font-medium">{label}<input className="tpv-input mt-1" inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />{hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}</label>
  );
  const ro = (label: string, value: string, tone = '', hint?: string) => (
    <div className="text-sm font-medium">{label}<input readOnly className={cx('tpv-input mt-1 bg-slate-100 font-bold', tone)} value={value} />{hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}</div>
  );
  const tone = c.diferencia === null || Math.abs(c.diferencia) < 0.005 ? '' : c.diferencia < 0 ? 'text-red-700' : 'text-amber-700';
  const STEPS = [[1, 'Paso 1 · X'], [2, 'Paso 2 · Informes'], [3, 'Paso 3 · Z']] as const;

  return (
    <div className="p-3">
      <ol className="mb-3 flex flex-wrap gap-1" aria-label="Pasos del cierre">
        {STEPS.map(([k, label]) => <li key={k}><button type="button" className="tpv-tab" aria-selected={step === k} onClick={() => setStep(k)}>{label}</button></li>)}
      </ol>
      {err && <div className="mb-2"><Alert>{err}</Alert></div>}

      {step === 1 && (
        <section className="tpv-window max-w-xl space-y-3 p-4">
          <h3 className="text-base font-bold">Informe X</h3>
          <p className="text-sm text-slate-600">Es una foto de cómo va la caja ahora. No cierra nada y puedes sacarlo las veces que quieras.</p>
          <button type="button" className="tpv-btn-primary" onClick={() => setShowX((x) => !x)}><FileText size={15} /> {showX ? 'Ocultar informe X' : 'Mostrar informe X'}</button>
          {showX && <ReportLines totals={totals} />}
          <div><button type="button" className="tpv-btn-yellow" onClick={() => setStep(2)}>Siguiente: informes →</button></div>
        </section>
      )}

      {step === 2 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="tpv-window space-y-3 p-4">
            <h3 className="text-base font-bold">Movimientos de esta caja</h3>
            <div className="max-h-72 overflow-y-auto border border-slate-300 bg-white">
              <table className="w-full text-sm"><tbody>
                {s.movements.slice().reverse().map((m) => (
                  <tr key={String(m.id)} className="border-b border-slate-200">
                    <td className="px-2 py-1 text-xs text-slate-500">{when(m.created_date)}</td><td className="px-2">{KIND[String(m.kind)] ?? String(m.kind)}</td>
                    <td className="px-2 text-slate-600">{METHOD_LABEL[String(m.method)] ?? String(m.method)}</td>
                    <td className={cx('px-2 text-right font-semibold', m.kind === 'refund' || m.kind === 'cash_out' ? 'text-red-700' : '')}>{euros(m.amount_eur)}</td>
                    <td className="px-2 text-xs text-slate-500">{String(m.reason ?? '')}</td>
                  </tr>
                ))}
                {s.movements.length === 0 && <tr><td className="p-3 text-slate-500">Aún no hay movimientos.</td></tr>}
              </tbody></table>
            </div>
            <ReportLines totals={totals} />
          </section>

          <section className="tpv-window space-y-3 p-4">
            <h3 className="flex items-center gap-1.5 text-base font-bold"><Banknote size={17} /> Retiradas y entradas de efectivo</h3>
            <form onSubmit={saveMovement} className="grid gap-2 sm:grid-cols-2">
              <div className="flex gap-1 sm:col-span-2">
                {(['out', 'in'] as const).map((t) => <button key={t} type="button" aria-pressed={mov.type === t} className={cx('tpv-btn flex-1', mov.type === t && '!bg-tpv-slate !from-tpv-slate !to-tpv-slate !text-white')} onClick={() => setMov({ ...mov, type: t })}>{t === 'out' ? 'Retirada' : 'Entrada'}</button>)}
              </div>
              <label className="text-xs font-semibold">Importe (€)<input className="tpv-input" inputMode="decimal" value={mov.amount} onChange={(e) => setMov({ ...mov, amount: e.target.value })} required /></label>
              <label className="text-xs font-semibold">{mov.type === 'out' ? 'Quién se lo lleva' : 'Quién lo mete'}<input className="tpv-input" value={mov.person} onChange={(e) => setMov({ ...mov, person: e.target.value })} /></label>
              <label className="text-xs font-semibold sm:col-span-2">Motivo<input className="tpv-input" value={mov.reason} onChange={(e) => setMov({ ...mov, reason: e.target.value })} placeholder="Ingreso en el banco, cambio…" /></label>
              <button className="tpv-btn-primary sm:col-span-2">Apuntar</button>
            </form>
            <ul className="divide-y divide-slate-200 border border-slate-300 bg-white text-sm">
              {withdrawals.length === 0 && <li className="p-2 text-slate-500">Sin retiradas ni entradas hoy.</li>}
              {withdrawals.map((m) => <li key={String(m.id)} className="flex justify-between px-2 py-1"><span>{when(m.created_date)} · {KIND[String(m.kind)]} · {String(m.reason ?? '')}</span><strong className={m.kind === 'cash_out' ? 'text-red-700' : ''}>{euros(m.amount_eur)}</strong></li>)}
            </ul>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-300 pt-3">
              <button type="button" className="tpv-btn" aria-pressed={showHist} onClick={() => setShowHist((x) => !x)}><History size={14} /> {showHist ? 'Ocultar históricos' : 'Mostrar históricos'}</button>
              <button type="button" className="tpv-btn-yellow ml-auto" onClick={() => setStep(3)}>Siguiente: Z →</button>
            </div>
            {showHist && history === null && <p className="text-sm text-slate-500">Cargando históricos…</p>}
            {showHist && history !== null && (
              <div className="max-h-60 overflow-y-auto border border-slate-300 bg-white">
                <table className="w-full text-xs"><thead className="bg-slate-200 text-left"><tr><th className="px-2 py-1">Z</th><th>Fecha</th><th className="text-right">Ventas</th><th className="text-right">Contado</th><th className="text-right">Dif.</th><th className="px-2 text-right">Retirado</th></tr></thead>
                  <tbody>{history.map((h) => (
                    <tr key={h.id} className="border-t border-slate-200"><td className="px-2 py-1 font-bold">{h.z_number}</td><td>{h.business_date}</td><td className="text-right">{euros(h.sales_total_eur)}</td><td className="text-right">{euros(h.counted_cash_eur)}</td>
                      <td className={cx('text-right font-semibold', Math.abs(Number(h.difference_eur)) >= 0.005 ? 'text-red-700' : '')}>{euros(h.difference_eur)}</td><td className="px-2 text-right">{euros(h.withdrawn_cash_eur)}</td></tr>
                  ))}{history.length === 0 && <tr><td colSpan={6} className="p-2 text-slate-500">Todavía no hay cierres anteriores.</td></tr>}</tbody></table>
              </div>
            )}
          </section>
        </div>
      )}

      {step === 3 && (
        <section className="tpv-window max-w-4xl space-y-3 p-4">
          <h3 className="text-base font-bold">Cierre Z</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {box('fondo', '1. Fondo de caja de ayer')}
            {ro('2. Total ventas', euros(c.ventas))}
            {box('tarjeta', '3. Total cobrado con tarjeta', 'Corrígelo si el datáfono dice otra cosa')}
            {ro('4. Efectivo esperado', euros(c.esperado), '', `Bizum, transferencias, señales y vales: ${euros(c.otherNonCash)}`)}
            {box('real', '5. Efectivo real contado')}
            {ro('6. Diferencia', c.diferencia === null ? '' : euros(c.diferencia), tone)}
            {box('retirado', '7. Efectivo retirado (al banco)')}
            {ro('8. Fondo para mañana', c.manana === null ? '' : euros(c.manana))}
            {box('recargas', '9. Disashop · total recargas del día', 'Independiente de la caja de efectivo')}
            {box('saldo', '10. Disashop · saldo restante', s.previous?.recharges_balance != null ? `Ayer: ${euros(s.previous.recharges_balance)}` : undefined)}
          </div>
          {c.diferencia !== null && Math.abs(c.diferencia) >= 0.005 && <label className="block text-sm font-medium">Motivo de la diferencia<input className="tpv-input mt-1" value={v.motivo} onChange={(e) => setV({ ...v, motivo: e.target.value })} /></label>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={printZ} onChange={(e) => setPrintZ(e.target.checked)} /> Imprimir Z al cerrar</label>
          <div className="flex flex-wrap gap-2 border-t border-slate-300 pt-3">
            {cashdroEnabled() && <>
              <button type="button" className="tpv-btn" onClick={readCashdro}>Leer efectivo de la CashDro</button>
              <button type="button" className="tpv-btn" onClick={cassette}>Preparar retirada del cajetín</button>
            </>}
            <button type="button" className="tpv-btn-yellow ml-auto" disabled={busy || n(v.real) === null} onClick={close}>{busy ? 'Cerrando…' : 'Cerrar caja (Z)'}</button>
            <button type="button" className="tpv-btn" onClick={() => setStep(2)}>Salir</button>
          </div>
          <p className="text-xs text-slate-500">Lo que se cobre después de empezar el cierre ({when(cutoff)}) pasa a la caja de mañana.</p>
        </section>
      )}

      {zPrint && (
        <PrintArea widthMm={80} onDone={() => setZPrint(null)}>
          <div className="ticket">
            <div className="t-center"><strong>CIERRE Z Nº {String(zPrint.z_number)}</strong></div>
            <div className="t-center">{new Date().toLocaleString('es-ES')}</div><hr />
            <div>Ventas: {euros(c.ventas)}</div><div>Tarjeta: {euros(n(v.tarjeta) ?? 0)}</div><div>Esperado: {euros(c.esperado)}</div>
            <div>Contado: {euros(n(v.real) ?? 0)}</div><div>Diferencia: {c.diferencia === null ? '—' : euros(c.diferencia)}</div>
            <div>Retirado: {euros(n(v.retirado) ?? 0)}</div><div>Fondo mañana: {c.manana === null ? '—' : euros(c.manana)}</div>
            {v.recargas && <div>Disashop recargas: {euros(n(v.recargas) ?? 0)}</div>}
            <hr /><div className="t-small">Informe de cierre de caja. No es una factura.</div>
          </div>
        </PrintArea>
      )}
    </div>
  );
}
