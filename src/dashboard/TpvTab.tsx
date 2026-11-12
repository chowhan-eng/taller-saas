// TPV tab — port of the live TPV: Cobrar (split payments, CashDro for cash), cash in/out, CashDro bridge
// settings, and the 10-box Cierre de Caja (Z) with live sums from the same computeCierre the server uses.
import { useCallback, useEffect, useState } from 'react';
import { euros, mod, uid, when, type Ctx } from './api';
import { cashdro, cashdroEnabled, fromCents, getCashdroConfig, isValidLanIp, saveCashdroConfig, toCents, type CashdroConfig } from '@/lib/cashdro';
import { MAX_FAILS, POLL_MS, settleSale } from '@/lib/cashdroSettle';
import { computeCierre, parseMoney, type SessionTotals } from '../../base44/shared/cash.ts';

type Summary = {
  session: Record<string, unknown> | null; totals: SessionTotals | null; movements: Record<string, unknown>[];
  previous: { next_day_float: number | null; recharges_balance: number | null; z_number: number | null } | null;
};
const METHODS: [string, string][] = [['cash', 'Efectivo'], ['card', 'Tarjeta'], ['bizum', 'Bizum'], ['transfer', 'Transferencia'], ['deposit', 'Señal'], ['voucher', 'Vale']];
const KIND: Record<string, string> = { sale: 'Venta', refund: 'Devolución', cash_in: 'Entrada', cash_out: 'Salida' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cash through the CashDro: start the sale, poll until the machine finishes, settle (port of CashDroPayDialog). */
async function cashdroCharge(amount: number, onPhase: (p: string) => void): Promise<{ ok: true; operationId: string } | { ok: false; message: string }> {
  onPhase('Cobrando en la CashDro…');
  const { operationId } = await cashdro.startSale(amount, '') as { operationId: string };
  let fails = 0;
  for (;;) {
    await sleep(POLL_MS);
    try {
      const op = await cashdro.ask(operationId) as { finished?: boolean; id?: string; canceled?: boolean; insertedCents: number; returnedCents: number };
      fails = 0;
      onPhase(`Introducido ${euros(fromCents(op.insertedCents))} de ${euros(amount)}`);
      if (op.finished) {
        const o = settleSale({ ...op, id: op.id || operationId }, toCents(amount));
        return o.kind === 'done' ? { ok: true, operationId: o.operationId } : { ok: false, message: o.kind === 'aborted' ? o.message : 'Revisa la CashDro.' };
      }
    } catch {
      if (++fails >= MAX_FAILS) onPhase('El puente CashDro no contesta. No cierres esta pantalla: la operación sigue en la máquina.');
    }
  }
}

function Cobrar({ ctx, onDone }: { ctx: Ctx; onDone: () => void }) {
  const [lines, setLines] = useState<{ method: string; amount: string }[]>([{ method: 'cash', amount: '' }]);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const total = lines.reduce((sum, l) => sum + (parseMoney(l.amount) || 0), 0);
  const update = (i: number, patch: Partial<{ method: string; amount: string }>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function charge(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setOk(null);
    const payments = lines.map((l) => ({ method: l.method, amount: parseMoney(l.amount) })).filter((p) => Number(p.amount) > 0);
    if (!payments.length) { setErr('Pon el importe.'); return; }
    const requestId = uid();
    let cashdroOperationId: string | undefined;
    try {
      const cash = payments.find((p) => p.method === 'cash');
      if (cash && !refund && cashdroEnabled()) {
        const r = await cashdroCharge(Number(cash.amount), setPhase);
        if (!r.ok) { setPhase(null); setErr(r.message); return; }
        cashdroOperationId = r.operationId;
      }
      setPhase('Guardando…');
      await mod('tpv', ctx, 'recordSale', { kind: refund ? 'refund' : 'sale', payments, reason, client_request_id: requestId, cashdro_operation_id: cashdroOperationId });
      setOk(`${refund ? 'Devolución' : 'Cobro'} de ${euros(total)} apuntado.`);
      setLines([{ method: 'cash', amount: '' }]); setReason('');
      onDone();
    } catch (e2) { setErr((e2 as Error).message); } finally { setPhase(null); }
  }
  return (
    <form className="card" style={{ padding: 16 }} onSubmit={charge}>
      <h3 style={{ marginTop: 0 }}>{refund ? 'Devolución' : 'Cobrar'}</h3>
      {lines.map((l, i) => (
        <div key={i} className="grid-form">
          <div><label>Forma de pago</label><select value={l.method} onChange={(e) => update(i, { method: e.target.value })}>{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label>Importe (€)</label><input inputMode="decimal" value={l.amount} onChange={(e) => update(i, { amount: e.target.value })} /></div>
        </div>
      ))}
      <button type="button" className="btn secondary inline" onClick={() => setLines([...lines, { method: 'card', amount: '' }])}>+ Otra forma de pago</button>
      <label htmlFor="cr">Concepto</label>
      <input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reparación 2026-000012, funda…" />
      <label className="check"><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} /><span>Es una devolución</span></label>
      <p className="price">{euros(total)}</p>
      {phase && <div className="alert" role="status">{phase}</div>}
      {err && <div className="alert err" role="alert">{err}</div>}
      {ok && <div className="alert" role="status">{ok}</div>}
      <button className="btn" disabled={!!phase || !(total > 0)}>{refund ? 'Devolver' : 'Cobrar'} {euros(total)}</button>
      {cashdroEnabled() && <p className="small muted">El efectivo se cobra en la CashDro.</p>}
    </form>
  );
}

function Movimiento({ ctx, onDone }: { ctx: Ctx; onDone: () => void }) {
  const [type, setType] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [person, setPerson] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await mod('tpv', ctx, 'movement', { type, amount, reason, person, client_request_id: uid() });
      setAmount(''); setReason(''); setPerson('');
      onDone();
    } catch (e2) { setErr((e2 as Error).message); }
  }
  return (
    <form className="card" style={{ padding: 16 }} onSubmit={save}>
      <h3 style={{ marginTop: 0 }}>Entrada / salida de efectivo</h3>
      <div className="tab-bar">
        <button type="button" className={`chip ${type === 'in' ? 'on' : ''}`} onClick={() => setType('in')}>Entrada</button>
        <button type="button" className={`chip ${type === 'out' ? 'on' : ''}`} onClick={() => setType('out')}>Salida</button>
      </div>
      <label>Importe (€)</label><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      <label>Motivo</label><input value={reason} onChange={(e) => setReason(e.target.value)} />
      {type === 'out' && (<><label>Quién se lo lleva</label><input value={person} onChange={(e) => setPerson(e.target.value)} /></>)}
      {err && <div className="alert err">{err}</div>}
      <button className="btn">Apuntar</button>
    </form>
  );
}

function CashdroSettings() {
  const [c, setC] = useState<CashdroConfig>(getCashdroConfig());
  const [test, setTest] = useState<string | null>(null);
  const save = (patch: Partial<CashdroConfig>) => setC(saveCashdroConfig(patch));
  async function probe() {
    setTest('Probando…');
    try { await cashdro.health(c); setTest('El puente CashDro responde.'); } catch (e) { setTest((e as Error).message); }
  }
  return (
    <div className="card" style={{ padding: 16, maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>CashDro</h3>
      <p className="small muted">Se guarda solo en este navegador. El «Puente CashDro» debe estar encendido en el PC principal de la tienda.</p>
      <label>Este puesto</label>
      <select value={c.mode} onChange={(e) => save({ mode: e.target.value as CashdroConfig['mode'] })}>
        <option value="off">Cobra el efectivo a mano</option>
        <option value="local">Este PC tiene el puente</option>
        <option value="remote">Otro PC de la tienda tiene el puente</option>
      </select>
      {c.mode === 'remote' && (
        <>
          <label>IP del PC principal</label><input value={c.mainIp} onChange={(e) => save({ mainIp: e.target.value })} placeholder="192.168.1.20" />
          {c.mainIp && !isValidLanIp(c.mainIp) && <div className="alert err">Debe ser una IP de la red de la tienda (192.168.x.x, 10.x.x.x…).</div>}
        </>
      )}
      <label>Clave del puente</label><input type="password" autoComplete="off" value={c.token} onChange={(e) => save({ token: e.target.value })} />
      <label>Nombre de este puesto</label><input value={c.terminalName} onChange={(e) => save({ terminalName: e.target.value })} placeholder="Mostrador" />
      <button type="button" className="btn secondary inline" onClick={probe} disabled={c.mode === 'off'}>Probar conexión</button>
      {test && <p className="small">{test}</p>}
    </div>
  );
}

function Cierre({ ctx, s, onClosed }: { ctx: Ctx; s: Summary; onClosed: (z: Record<string, unknown>) => void }) {
  const totals = s.totals as SessionTotals;
  const [v, setV] = useState({
    fondo: String(s.previous?.next_day_float ?? totals.openingFloat ?? 0).replace('.', ','),
    tarjeta: String(totals.byMethod.card).replace('.', ','),
    real: '', retirado: '', recargas: '', saldo: '', motivo: '',
  });
  const [cashdroReport, setCashdroReport] = useState<Record<string, unknown> | null>(null);
  const [cutoff] = useState(() => new Date().toISOString());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = (x: string) => { const p = parseMoney(x); return p === null || Number.isNaN(p) ? null : p; };
  const c = computeCierre(totals, { fondo: n(v.fondo) ?? 0, tarjeta: n(v.tarjeta) ?? 0, real: n(v.real), retirado: n(v.retirado) ?? 0 });
  const box = (k: keyof typeof v, label: string, hint?: string) => (
    <div><label>{label}</label><input inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />{hint && <span className="small muted">{hint}</span>}</div>
  );
  async function readCashdro() {
    setErr(null);
    try {
      const lv = await cashdro.levels() as Record<string, unknown> & { totals?: { totalCents?: number } };
      setCashdroReport(lv);
      if (lv.totals?.totalCents != null) setV({ ...v, real: String(fromCents(lv.totals.totalCents)).replace('.', ',') });
    } catch (e) { setErr((e as Error).message); }
  }
  async function close() {
    setErr(null); setBusy(true);
    try {
      const z = await mod<Record<string, unknown>>('tpv', ctx, 'close', {
        counted_cash: v.real, opening_float: v.fondo, card_total: v.tarjeta, withdrawn_cash: v.retirado || undefined,
        recharges_total: v.recargas || undefined, recharges_balance: v.saldo || undefined, difference_reason: v.motivo || undefined,
        cutoff_at: cutoff, cashdro_report: cashdroReport ?? undefined,
      });
      onClosed(z);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const tone = c.diferencia === null || Math.abs(c.diferencia) < 0.005 ? '' : c.diferencia < 0 ? 'neg' : 'pos';
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Cierre de caja (Z)</h3>
      <div className="grid-form cierre">
        {box('fondo', '1. Fondo de caja de ayer')}
        <div><label>2. Total ventas</label><input value={euros(c.ventas)} readOnly /></div>
        {box('tarjeta', '3. Total con tarjeta', 'Corrígelo si el datáfono falló')}
        <div><label>4. Efectivo esperado</label><input value={euros(c.esperado)} readOnly /><span className="small muted">Bizum, transferencias, señales y vales: {euros(c.otherNonCash)}</span></div>
        {box('real', '5. Efectivo real contado')}
        <div><label>6. Diferencia</label><input className={tone} value={c.diferencia === null ? '' : euros(c.diferencia)} readOnly /></div>
        {box('retirado', '7. Efectivo retirado')}
        <div><label>8. Fondo para mañana</label><input value={c.manana === null ? '' : euros(c.manana)} readOnly /></div>
        {box('recargas', '9. Total recargas del día')}
        {box('saldo', '10. Saldo restante de recargas', s.previous?.recharges_balance != null ? `Ayer: ${euros(s.previous.recharges_balance)}` : undefined)}
      </div>
      {c.diferencia !== null && Math.abs(c.diferencia) >= 0.005 && (<><label>Motivo de la diferencia</label><input value={v.motivo} onChange={(e) => setV({ ...v, motivo: e.target.value })} /></>)}
      <div className="btn-row">
        {cashdroEnabled() && <button type="button" className="btn secondary inline" onClick={readCashdro}>Leer efectivo de la CashDro</button>}
        <button type="button" className="btn inline" onClick={close} disabled={busy || n(v.real) === null}>{busy ? 'Cerrando…' : 'Cerrar caja (Z)'}</button>
      </div>
      <p className="small muted">Lo que se cobre después de empezar el cierre ({when(cutoff)}) pasa a la caja de mañana.</p>
      {err && <div className="alert err">{err}</div>}
    </div>
  );
}

export default function TpvTab({ ctx }: { ctx: Ctx }) {
  const [s, setS] = useState<Summary | null>(null);
  const [view, setView] = useState<'cobrar' | 'movimiento' | 'cierre' | 'cashdro'>('cobrar');
  const [float, setFloat] = useState('');
  const [z, setZ] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { setS(await mod<Summary>('tpv', ctx, 'summary')); }, [ctx]);
  useEffect(() => { load().catch((e) => setErr((e as Error).message)); }, [load]);

  async function open(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { await mod('tpv', ctx, 'openSession', { opening_float: float || undefined }); setZ(null); await load(); } catch (e2) { setErr((e2 as Error).message); }
  }
  const reload = () => { load().catch((e) => setErr((e as Error).message)); };
  if (!s) return <p className="muted">{err ?? 'Cargando la caja…'}</p>;
  const views = { cobrar: 'Cobrar', movimiento: 'Entradas / salidas', cierre: 'Cierre de caja', cashdro: 'CashDro' } as const;
  return (
    <div>
      {err && <div className="alert err">{err}</div>}
      {z && <div className="alert" role="status">Caja cerrada · Z {String(z.z_number)} · diferencia {euros(z.difference)} · fondo para mañana {euros(z.next_day_float)}</div>}
      {!s.session ? (
        <div className="tpv-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <form className="card" style={{ padding: 16, maxWidth: 420 }} onSubmit={open}>
            <h3 style={{ marginTop: 0 }}>Abrir caja</h3>
            <label>Fondo inicial (€)</label>
            <input inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder={s.previous?.next_day_float != null ? `Fondo de ayer: ${euros(s.previous.next_day_float)}` : '0,00'} />
            <button className="btn">Abrir caja</button>
          </form>
          <CashdroSettings />
        </div>
      ) : (
        <>
          <div className="tab-bar">
            {(Object.keys(views) as (keyof typeof views)[]).map((k) => (
              <button key={k} className={`chip ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>{views[k]}</button>
            ))}
            <span className="small muted">Caja abierta {when(s.session.opened_at)} · ventas {euros(s.totals?.salesTotal)} · efectivo esperado {euros(s.totals?.expectedCash)}</span>
          </div>
          <div className="tpv-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(300px, 520px) 1fr' }}>
            <div>
              {view === 'cobrar' && <Cobrar ctx={ctx} onDone={reload} />}
              {view === 'movimiento' && <Movimiento ctx={ctx} onDone={reload} />}
              {view === 'cierre' && <Cierre ctx={ctx} s={s} onClosed={(r) => { setZ(r); setView('cobrar'); reload(); }} />}
              {view === 'cashdro' && <CashdroSettings />}
            </div>
            <div className="card" style={{ padding: 12 }}>
              <h4 style={{ marginTop: 0 }}>Movimientos de esta caja</h4>
              <ul className="small" style={{ paddingLeft: 16 }}>
                {s.movements.slice().reverse().map((m) => (
                  <li key={String(m.id)}>{when(m.created_date)} · {KIND[String(m.kind)] ?? String(m.kind)} · {METHODS.find(([k]) => k === m.method)?.[1]} · {euros(m.amount_eur)}{m.reason ? ` · ${String(m.reason)}` : ''}</li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
