// "Cobrar" dialog: payment split Efectivo / Tarjeta (+ Bizum), cash through the CashDro when the bridge is on,
// and the Google-review prompt (QR + daily counter) shown for at least 2 seconds when the charge completes.
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Banknote, CreditCard, Smartphone, Star } from 'lucide-react';
import { euros, mod, uid } from '../api';
import { Alert, Modal, cx, useDash } from '../ui';
import { cashdro, cashdroEnabled, fromCents, toCents } from '@/lib/cashdro';
import { MAX_FAILS, POLL_MS, settleSale } from '@/lib/cashdroSettle';
import { parseMoney } from '../../../base44/shared/cash.ts';

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

const todayKey = () => `taller.tpv.reviews.${new Date().toISOString().slice(0, 10)}`;
export const reviewsToday = () => { try { return Number(localStorage.getItem(todayKey())) || 0; } catch { return 0; } };

/** Strip with the shop's Google-review QR and today's counter. */
export function ReviewPrompt({ url, count }: { url: string | null; count: number }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { if (url) QRCode.toDataURL(url, { margin: 1, width: 160 }).then(setQr).catch(() => setQr(null)); }, [url]);
  return (
    <div className="flex items-center gap-4 border-2 border-yellow-500 bg-tpv-yellow/30 p-3">
      {qr ? <img src={qr} alt="QR de la reseña de Google" className="h-28 w-28 bg-white p-1" /> : <div className="flex h-28 w-28 items-center justify-center bg-white text-yellow-500"><Star size={40} /></div>}
      <div className="text-sm">
        <p className="flex items-center gap-1.5 text-base font-bold"><Star size={18} className="fill-yellow-400 text-yellow-500" /> ¿Nos dejas una reseña en Google?</p>
        <p className="mt-1 text-slate-700">{url ? 'Enséñale el QR al cliente: son 10 segundos.' : 'Pon el enlace de reseñas en WhatsApp → Ajustes para que salga aquí el QR.'}</p>
        <p className="mt-1 text-xs font-semibold text-slate-600">Reseñas pedidas hoy: {count}</p>
      </div>
    </div>
  );
}

export type Cart = { key: string; name: string; price: number; qty: number; iva: number; ticketId?: string; productId?: string }[];
type Method = 'cash' | 'card' | 'bizum';

export default function CobrarDialog({ cart, total, reviewUrl, onClose, onDone }: { cart: Cart; total: number; reviewUrl: string | null; onClose: () => void; onDone: () => void }) {
  const { ctx } = useDash();
  const [amounts, setAmounts] = useState<Record<Method, string>>({ cash: '', card: '', bizum: '' });
  const [given, setGiven] = useState('');
  const [phase, setPhase] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [canContinue, setCanContinue] = useState(false);
  const [count, setCount] = useState(reviewsToday());
  const useMachine = cashdroEnabled();
  const requestId = useRef(uid()); // same id on a retry: the server never records the sale (or takes stock out) twice

  const val = (m: Method) => { const p = parseMoney(amounts[m]); return p === null || Number.isNaN(p) ? 0 : p; };
  const paid = Math.round((val('cash') + val('card') + val('bizum')) * 100) / 100;
  const remaining = Math.round((total - paid) * 100) / 100;
  const cashGiven = parseMoney(given);
  const change = !useMachine && val('cash') > 0 && cashGiven != null && !Number.isNaN(cashGiven) ? Math.max(0, Math.round((cashGiven - val('cash')) * 100) / 100) : null;
  const tickets = useMemo(() => [...new Set(cart.filter((l) => l.ticketId).map((l) => l.ticketId as string))], [cart]);
  const only = (m: Method) => setAmounts({ cash: '', card: '', bizum: '', [m]: String(total).replace('.', ',') });

  // After the charge: show the review prompt for 2 s before the "Continuar" button is enabled.
  useEffect(() => {
    if (!done) return;
    const n = reviewsToday() + 1;
    try { localStorage.setItem(todayKey(), String(n)); } catch { /* private mode */ }
    setCount(n);
    const t = setTimeout(() => setCanContinue(true), 2000);
    const auto = setTimeout(onDone, 12000);
    return () => { clearTimeout(t); clearTimeout(auto); };
  }, [done, onDone]);

  async function charge() {
    setErr(null);
    if (Math.abs(remaining) > 0.004) { setErr(remaining > 0 ? `Faltan ${euros(remaining)} por cobrar.` : `Te pasas ${euros(-remaining)}.`); return; }
    const payments = (['cash', 'card', 'bizum'] as Method[]).map((m) => ({ method: m, amount: val(m) })).filter((p) => p.amount > 0);
    let cashdroOperationId: string | undefined;
    try {
      const cash = payments.find((p) => p.method === 'cash');
      if (cash && useMachine) {
        const r = await cashdroCharge(cash.amount, setPhase);
        if (!r.ok) { setPhase(null); setErr(r.message); return; }
        cashdroOperationId = r.operationId;
      }
      setPhase('Guardando…');
      const reason = cart.map((l) => `${l.qty}× ${l.name}`).join(', ').slice(0, 190);
      // A sale that pays repair tickets is recorded once per ticket so each ticket shows what it paid.
      await mod('tpv', ctx, 'recordSale', { kind: 'sale', payments, reason, client_request_id: requestId.current, cashdro_operation_id: cashdroOperationId, ticketId: tickets.length === 1 ? tickets[0] : undefined,
        lines: cart.map((l) => ({ product_id: l.productId, ticket_id: l.ticketId, name: l.name, qty: l.qty, unit_price_eur: l.price, iva_pct: l.iva })) });
      setDone(true);
    } catch (e) { setErr((e as Error).message); } finally { setPhase(null); }
  }

  if (done) {
    return (
      <Modal title="Cobro completado" onClose={() => { if (canContinue) onDone(); }}>
        <div className="space-y-3">
          <p className="text-lg font-bold text-emerald-700">✔ {euros(total)} cobrados</p>
          {change != null && change > 0 && <p className="text-sm">Cambio entregado: <strong>{euros(change)}</strong></p>}
          <ReviewPrompt url={reviewUrl} count={count} />
          <button type="button" className="tpv-btn-yellow w-full" disabled={!canContinue} onClick={onDone}>{canContinue ? 'Continuar' : 'Un momento…'}</button>
        </div>
      </Modal>
    );
  }

  const Field = ({ m, label, Icon }: { m: Method; label: string; Icon: typeof Banknote }) => (
    <div className="flex items-center gap-2">
      <button type="button" className="tpv-btn w-36 justify-start" onClick={() => only(m)}><Icon size={16} /> {label}</button>
      <input className="tpv-input text-right text-lg font-semibold" inputMode="decimal" value={amounts[m]} onChange={(e) => setAmounts({ ...amounts, [m]: e.target.value })} placeholder="0,00" />
    </div>
  );
  return (
    <Modal title="Cobrar" onClose={() => { if (!phase) onClose(); }}>
      <div className="theme-tpv space-y-3 bg-transparent">
        <div className="flex items-baseline justify-between border-b border-slate-300 pb-2"><span className="text-sm">Total a cobrar</span><span className="text-3xl font-extrabold">{euros(total)}</span></div>
        <Field m="cash" label="Efectivo" Icon={Banknote} />
        <Field m="card" label="Tarjeta" Icon={CreditCard} />
        <Field m="bizum" label="Bizum" Icon={Smartphone} />
        {!useMachine && val('cash') > 0 && (
          <label className="flex items-center gap-2 text-sm">Entregado (€)<input className="tpv-input !w-28 text-right" inputMode="decimal" value={given} onChange={(e) => setGiven(e.target.value)} />
            {change != null && <span className="font-bold text-emerald-700">Cambio {euros(change)}</span>}</label>
        )}
        <div className={cx('flex justify-between border px-3 py-2 text-sm font-semibold', Math.abs(remaining) < 0.005 ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-amber-500 bg-amber-50 text-amber-900')}>
          <span>{remaining > 0.004 ? 'Falta por cobrar' : remaining < -0.004 ? 'Te pasas' : 'Importe completo'}</span><span>{euros(Math.abs(remaining))}</span>
        </div>
        {useMachine && <p className="text-xs text-slate-600">El efectivo se cobra en la CashDro.</p>}
        {phase && <Alert kind="ok">{phase}</Alert>}
        {err && <Alert>{err}</Alert>}
        <button type="button" className="tpv-btn-yellow w-full" disabled={!!phase || !(total > 0)} onClick={charge}>Cobrar {euros(total)}</button>
      </div>
    </Modal>
  );
}
