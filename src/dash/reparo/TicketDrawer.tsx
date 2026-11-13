// Ticket detail drawer: status select (grouped), customer with 1-click WhatsApp deep link, device data,
// technician, PIN/pattern reveal, budget + Presupuestar, TPV charge, history and 58/80 mm printing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Banknote, CalendarClock, ChevronDown, MessageCircle, Printer, Tag, X } from 'lucide-react';
import { euros, mod, when } from '../api';
import { Alert, canAdmin, useDash } from '../ui';
import { DeviceIcon, GROUPS, STATUS, StatusPill } from './status';
import { PinReveal } from './PinField';
import { PrintDialog, type Shop } from './print';
import Presupuestar from './Presupuestar';
import type { Member } from './NewTicket';

type Ticket = Record<string, unknown> & { id: string };
type Detail = { ticket: Ticket; customer: Record<string, unknown> | null; events: { id: string; from_status: string | null; to_status: string; note: string | null; created_date: string }[] };

export function StatusSelect({ value, onChange, disabled }: { value: string; onChange: (s: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 disabled:opacity-60">
        <StatusPill status={value} /><ChevronDown size={14} className="text-hc-muted" />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-hc-line bg-hc-card p-1 shadow-xl">
          {GROUPS.map(([g, list]) => (
            <div key={g}>
              <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-hc-muted">{g}</p>
              {list.map((s) => (
                <button key={s} type="button" role="option" aria-selected={s === value} onClick={() => { setOpen(false); if (s !== value) onChange(s); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-hc-hover">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS[s].color }} />{STATUS[s].label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[120px_1fr] gap-2 border-b border-hc-line py-2 text-sm"><dt className="text-hc-muted">{k}</dt><dd className="min-w-0 break-words">{children}</dd></div>
);

export default function TicketDrawer({ ticketId, team, shop, onClose, onChanged }: { ticketId: string; team: Member[]; shop: Shop; onClose: () => void; onChanged: () => void }) {
  const { ctx, go } = useDash();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [diag, setDiag] = useState('');
  const [print, setPrint] = useState<null | 'resguardo' | 'etiqueta'>(null);
  const [quote, setQuote] = useState(false);
  const [printMenu, setPrintMenu] = useState(false);

  const load = useCallback(async () => {
    const r = await mod<Detail>('reparo', ctx, 'getTicket', { ticketId });
    setD(r);
    setDiag(String(r.ticket.diagnosis ?? ''));
  }, [ctx, ticketId]);
  useEffect(() => { setD(null); load().catch((e) => setErr((e as Error).message)); }, [load]);

  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await load(); onChanged(); } catch (e) { setErr((e as Error).message); } };
  const t = d?.ticket, c = d?.customer;
  const phone = c?.phone_e164 ? String(c.phone_e164) : '';
  const status = String(t?.status ?? '');
  const closed = ['entregado', 'cancelado', 'no_reparable'].includes(status);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="theme-reparo fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-hc-line bg-hc-page text-hc-ink shadow-2xl" role="dialog" aria-label="Detalle de reparación">
        <header className="flex items-center gap-3 border-b border-hc-line bg-hc-card px-4 py-3">
          {t && <span className="text-hc-accent"><DeviceIcon type={String(t.device_type)} size={26} /></span>}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold">{String(t?.ticket_number ?? 'Cargando…')}</h2>
            <p className="truncate text-sm text-hc-muted">{[t?.brand, t?.model].filter(Boolean).map(String).join(' ')}</p>
          </div>
          {t && <StatusSelect value={status} onChange={(s) => run(() => mod('reparo', ctx, 'setStatus', { ticketId, status: s }))} />}
          <button type="button" aria-label="Cerrar" className="rounded p-1 hover:bg-hc-hover" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {err && <Alert>{err}</Alert>}
          {!d && !err && <p className="text-hc-muted">Cargando…</p>}
          {t && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {phone && <button type="button" className="hc-btn" onClick={() => go({ tab: 'whatsapp', phone })}><MessageCircle size={15} /> Abrir en WhatsApp</button>}
                <div className="relative">
                  <button type="button" className="hc-btn-ghost" onClick={() => setPrintMenu((o) => !o)}><Printer size={15} /> Imprimir <ChevronDown size={13} /></button>
                  {printMenu && (
                    <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border border-hc-line bg-hc-card p-1 shadow-xl">
                      <button type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-hc-hover" onClick={() => { setPrintMenu(false); setPrint('resguardo'); }}>Resguardo de depósito</button>
                      <button type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-hc-hover" onClick={() => { setPrintMenu(false); setPrint('etiqueta'); }}>Etiqueta adhesiva</button>
                    </div>
                  )}
                </div>
                {!closed && <button type="button" className="hc-btn-ghost" onClick={() => go({ tab: 'tpv', ticketId })}><Banknote size={15} /> Cobrar en TPV</button>}
              </div>

              <dl className="hc-card px-4 py-1">
                <Row k="Cliente">
                  <strong>{String(c?.full_name ?? '—')}</strong>
                  {phone && <span className="ml-2 text-hc-muted">+{phone}</span>}
                  {c?.email ? <div className="text-xs text-hc-muted">{String(c.email)}</div> : null}
                  {c && c.wa_opted_out === true && <div className="text-xs font-semibold text-red-600">Pidió la BAJA: sin avisos</div>}
                </Row>
                <Row k="Avería">{String(t.reported_fault ?? '')}</Row>
                {t.serial_imei ? <Row k="IMEI / serie"><code>{String(t.serial_imei)}</code></Row> : null}
                {t.accessories ? <Row k="Accesorios">{String(t.accessories)}</Row> : null}
                {t.physical_condition ? <Row k="Estado físico">{String(t.physical_condition)}</Row> : null}
                <Row k="Código"><PinReveal has={t.has_unlock_code === true} canReveal={canAdmin(ctx)} reveal={async () => (await mod<{ code: string | null }>('reparo', ctx, 'revealUnlockCode', { ticketId })).code} /></Row>
                <Row k="Entrada">{when(t.created_date)}</Row>
                <Row k="Promesa"><span className="inline-flex items-center gap-1"><CalendarClock size={14} className="text-hc-muted" />
                  <input type="date" className="hc-input !w-auto !py-1" value={t.promised_at ? String(t.promised_at).slice(0, 10) : ''} onChange={(e) => run(() => mod('reparo', ctx, 'updateTicket', { ticketId, patch: { promised_at: e.target.value ? new Date(e.target.value).toISOString() : null } }))} /></span></Row>
                <Row k="Técnico">
                  <select className="hc-input !w-auto !py-1" value={String(t.technician_id ?? '')} onChange={(e) => run(() => mod('reparo', ctx, 'updateTicket', { ticketId, patch: { technician_id: e.target.value || null } }))}>
                    <option value="">Sin asignar</option>{team.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
                  </select>
                </Row>
              </dl>

              <section className="hc-card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 font-semibold"><Tag size={15} /> Presupuesto</h3>
                  <span className="rounded bg-hc-panel px-2 py-0.5 text-xs font-semibold">{String(t.budget_status ?? 'pendiente')}</span>
                </div>
                <p className="text-2xl font-extrabold">{Number(t.budget_amount_eur) > 0 ? euros(t.budget_amount_eur) : <span className="text-base font-normal text-hc-muted">Sin presupuesto</span>}</p>
                {Number(t.deposit_eur) > 0 && <p className="text-sm text-hc-muted">Señal entregada: {euros(t.deposit_eur)}</p>}
                {Number(t.tpv_paid_total_eur) > 0 && <p className="text-sm font-semibold text-emerald-700">Cobrado en TPV: {euros(t.tpv_paid_total_eur)}</p>}
                {Array.isArray(t.offer_items) && (t.offer_items as { title: string; price: number }[]).length > 0 && (
                  <ul className="mt-2 divide-y divide-hc-line text-sm">{(t.offer_items as { title: string; price: number }[]).map((o, i) => <li key={i} className="flex justify-between py-1"><span>{o.title}</span><span>{euros(o.price)}</span></li>)}</ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="hc-btn" onClick={() => setQuote(true)}>Presupuestar</button>
                  {t.budget_status === 'enviado' && <>
                    <button type="button" className="hc-btn-ghost" onClick={() => run(() => mod('reparo', ctx, 'setBudget', { ticketId, status: 'aceptado' }))}>Aceptado</button>
                    <button type="button" className="hc-btn-ghost" onClick={() => run(() => mod('reparo', ctx, 'setBudget', { ticketId, status: 'rechazado' }))}>Rechazado</button>
                  </>}
                </div>
              </section>

              <section>
                <label className="hc-label" htmlFor="diag">Diagnóstico del técnico</label>
                <textarea id="diag" className="hc-input" rows={3} value={diag} onChange={(e) => setDiag(e.target.value)} />
                <button type="button" className="hc-btn-ghost mt-2" disabled={diag === String(t.diagnosis ?? '')} onClick={() => run(() => mod('reparo', ctx, 'updateTicket', { ticketId, patch: { diagnosis: diag } }))}>Guardar diagnóstico</button>
              </section>

              {t.warranty_until ? <p className="rounded-md bg-hc-panel p-3 text-sm">Garantía hasta el <strong>{new Date(String(t.warranty_until)).toLocaleDateString('es-ES')}</strong>.</p> : null}

              <section>
                <h3 className="mb-2 font-semibold">Historial</h3>
                <ol className="space-y-2 border-l-2 border-hc-line pl-4">
                  {[...(d?.events ?? [])].reverse().map((e) => (
                    <li key={e.id} className="relative text-sm">
                      <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: STATUS[e.to_status]?.color ?? '#64748b' }} />
                      <div className="flex flex-wrap items-center gap-2"><StatusPill status={e.to_status} small /><span className="text-xs text-hc-muted">{when(e.created_date)}</span></div>
                      {e.note && <p className="text-xs text-hc-muted">{e.note}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )}
        </div>
      </aside>
      {print && t && <PrintDialog shop={shop} t={t} c={c ?? null} initial={print} onClose={() => setPrint(null)} />}
      {quote && t && <Presupuestar ticket={t} onClose={() => setQuote(false)} onApplied={() => { load().catch(() => {}); onChanged(); }} />}
    </>
  );
}
