// Reparo CRM (HelloClient look): ticket table and board, status counters, search, technician filter,
// infinite scroll in blocks of 20 (the same page size for the list AND for search results).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KanbanSquare, List, MessageCircle, Plus, Search, Tag, UserRound } from 'lucide-react';
import { euros, mod, when } from '../api';
import { Alert, cx, useDash, useDebounced } from '../ui';
import { DeviceIcon, STATUS } from './status';
import NewTicket, { type Member } from './NewTicket';
import TicketDrawer, { StatusSelect } from './TicketDrawer';
import PriceCatalog from './PriceCatalog';
import { PrintDialog, type Shop } from './print';

export const PAGE = 20;
type Row = {
  id: string; ticket_number: string; status: string; device_type: string; brand: string; model: string | null; budget_status: string; budget_amount_eur: number | null;
  promised_at: string | null; technician_id: string | null; has_unlock_code: boolean; tpv_paid_total_eur: number | null; created_date: string;
  customer_name: string | null; customer_phone: string | null;
};
type Page = { tickets: Row[]; total: number; counts: Record<string, number> };

const BOARD = ['recibido', 'diagnostico', 'presupuesto_enviado', 'presupuesto_aceptado', 'esperando_pieza', 'en_reparacion', 'listo_recoger'];

export default function Reparo() {
  const { ctx, nav, go } = useDash();
  const [view, setView] = useState<'list' | 'board' | 'prices'>('list');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [status, setStatus] = useState('');
  const [tech, setTech] = useState('');
  const [closed, setClosed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [team, setTeam] = useState<Member[]>([]);
  const [shop, setShop] = useState<Shop>({});
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [printNew, setPrintNew] = useState<{ t: Record<string, unknown>; c: Record<string, unknown> | null } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const limit = view === 'board' ? 200 : PAGE;

  const fetchPage = useCallback(async (offset: number, reset: boolean) => {
    const id = ++reqId.current;
    setLoading(true); setErr(null);
    try {
      const r = await mod<Page>('reparo', ctx, 'listTickets', { offset, limit, q: dq, status: status || undefined, technicianId: tech || undefined, open: !closed });
      if (id !== reqId.current) return; // a newer search superseded this one
      setRows((prev) => (reset ? r.tickets : [...prev, ...r.tickets]));
      setTotal(r.total); setCounts(r.counts);
    } catch (e) { if (id === reqId.current) setErr((e as Error).message); } finally { if (id === reqId.current) setLoading(false); }
  }, [ctx, dq, status, tech, closed, limit]);

  useEffect(() => { if (view !== 'prices') fetchPage(0, true); }, [fetchPage, view]);
  useEffect(() => {
    mod<{ team: Member[] }>('reparo', ctx, 'team').then((r) => setTeam(r.team)).catch(() => {});
    mod<{ shop: Shop }>('reparo', ctx, 'shop').then((r) => setShop(r.shop)).catch(() => {});
  }, [ctx]);
  useEffect(() => { if (nav.ticketId) setOpen(nav.ticketId); }, [nav.ticketId]);

  // Infinite scroll: when the sentinel enters the viewport, load the next 20.
  useEffect(() => {
    if (view !== 'list') return;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !loading && rows.length < total) fetchPage(rows.length, false); }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [view, loading, rows.length, total, fetchPage]);

  const techName = useMemo(() => new Map(team.map((m) => [m.user_id, m.name])), [team]);
  const setStatusOf = async (id: string, s: string) => {
    try { await mod('reparo', ctx, 'setStatus', { ticketId: id, status: s }); await fetchPage(0, true); } catch (e) { setErr((e as Error).message); }
  };
  const openTotal = Object.values(counts).reduce((a, b) => a + b, 0);

  const WhatsAppBtn = ({ phone }: { phone: string | null }) => phone ? (
    <button type="button" aria-label="Abrir conversación de WhatsApp" title="Abrir conversación de WhatsApp" onClick={(e) => { e.stopPropagation(); go({ tab: 'whatsapp', phone }); }}
      className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"><MessageCircle size={13} /> +{phone}</button>
  ) : <span className="text-hc-muted">—</span>;

  return (
    <div className="theme-reparo flex h-full flex-col bg-hc-page text-hc-ink">
      <header className="flex flex-wrap items-center gap-3 border-b border-hc-line bg-hc-card px-5 py-3">
        <h1 className="text-xl font-bold">Reparaciones</h1>
        <nav className="flex gap-1" role="tablist">
          {([['list', 'Tabla', List], ['board', 'Tablero', KanbanSquare], ['prices', 'Catálogo de precios', Tag]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium', view === k ? 'bg-hc-soft text-hc-accent' : 'text-hc-muted hover:bg-hc-hover')}><Icon size={15} /> {label}</button>
          ))}
        </nav>
        <button type="button" className="hc-btn ml-auto" onClick={() => setCreating(true)}><Plus size={15} /> Nueva reparación</button>
      </header>

      {view === 'prices' ? <div className="min-h-0 flex-1 overflow-y-auto"><PriceCatalog /></div> : (
        <>
          <div className="space-y-2.5 border-b border-hc-line bg-hc-card px-5 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[260px] flex-1 sm:max-w-md">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-hc-muted" />
                <input className="hc-input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nº, cliente, teléfono, marca o modelo" aria-label="Buscar reparaciones" />
              </div>
              <label className="flex items-center gap-1.5 text-sm text-hc-muted"><UserRound size={15} />
                <select className="hc-input !w-auto !py-1.5" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Técnico"><option value="">Todos los técnicos</option>{team.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></label>
              <label className="flex items-center gap-1.5 text-sm text-hc-muted"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Incluir cerrados</label>
              <span className="ml-auto text-sm text-hc-muted">{total} resultado{total === 1 ? '' : 's'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Estado">
              <button type="button" role="tab" aria-selected={status === ''} onClick={() => setStatus('')} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', status === '' ? 'border-hc-accent bg-hc-soft text-hc-accent' : 'border-hc-line text-hc-muted hover:bg-hc-hover')}>Todos ({openTotal})</button>
              {Object.entries(STATUS).filter(([k]) => closed || !['entregado', 'cancelado', 'no_reparable'].includes(k)).map(([k, s]) => (
                <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => setStatus(status === k ? '' : k)}
                  className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold', status === k ? 'border-hc-accent bg-hc-soft' : 'border-hc-line hover:bg-hc-hover')}>
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}{counts[k] ? ` (${counts[k]})` : ''}
                </button>
              ))}
            </div>
          </div>
          {err && <div className="px-5 pt-3"><Alert>{err}</Alert></div>}

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {view === 'list' ? (
              <div className="hc-card hc-surface overflow-x-auto">
                <table>
                  <thead><tr><th>Nº</th><th>Equipo</th><th>Cliente</th><th>Teléfono</th><th>Estado</th><th>Técnico</th><th className="text-right">Presupuesto</th><th>Entrada</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)}>
                        <td className="whitespace-nowrap font-semibold text-hc-accent">{r.ticket_number}{r.has_unlock_code && <span className="ml-1 text-xs text-hc-muted" title="Tiene código de desbloqueo">🔒</span>}</td>
                        <td><span className="flex items-center gap-2"><span className="text-hc-muted"><DeviceIcon type={r.device_type} size={17} /></span>{[r.brand, r.model].filter(Boolean).join(' ')}</span></td>
                        <td>{r.customer_name ?? '—'}</td>
                        <td><WhatsAppBtn phone={r.customer_phone} /></td>
                        <td onClick={(e) => e.stopPropagation()}><StatusSelect value={r.status} onChange={(s) => setStatusOf(r.id, s)} /></td>
                        <td>{r.technician_id ? (techName.get(r.technician_id) ?? '—') : <span className="text-hc-muted">Sin asignar</span>}</td>
                        <td className="whitespace-nowrap text-right">{Number(r.budget_amount_eur) > 0 ? euros(r.budget_amount_eur) : <span className="text-hc-muted">—</span>}</td>
                        <td className="whitespace-nowrap text-hc-muted">{when(r.created_date)}</td>
                      </tr>
                    ))}
                    {!loading && rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-hc-muted">{dq ? 'Ninguna reparación coincide con la búsqueda.' : 'Todavía no hay reparaciones. Crea la primera con «Nueva reparación».'}</td></tr>}
                  </tbody>
                </table>
                <div ref={sentinel} className="h-px" />
                {loading && <p className="p-3 text-center text-sm text-hc-muted">Cargando…</p>}
                {!loading && rows.length > 0 && rows.length >= total && <p className="p-3 text-center text-xs text-hc-muted">Fin de la lista · {total} reparaciones</p>}
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {BOARD.filter((s) => !status || s === status).map((s) => {
                  const col = rows.filter((r) => r.status === s);
                  return (
                    <section key={s} className="w-72 shrink-0">
                      <h3 className="mb-2 flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm font-semibold text-white" style={{ background: STATUS[s].color }}>{STATUS[s].label}<span className="rounded bg-white/25 px-1.5 text-xs">{col.length}</span></h3>
                      <div className="space-y-2">
                        {col.map((r) => (
                          <button key={r.id} type="button" onClick={() => setOpen(r.id)} className="hc-card block w-full p-3 text-left hover:shadow-md">
                            <span className="flex items-center justify-between"><strong className="text-hc-accent">{r.ticket_number}</strong><span className="text-hc-muted"><DeviceIcon type={r.device_type} size={16} /></span></span>
                            <span className="mt-1 block text-sm font-medium">{[r.brand, r.model].filter(Boolean).join(' ')}</span>
                            <span className="block text-xs text-hc-muted">{r.customer_name ?? '—'}</span>
                            <span className="mt-1.5 flex items-center justify-between text-xs"><span className="text-hc-muted">{r.technician_id ? techName.get(r.technician_id) : 'Sin asignar'}</span>{Number(r.budget_amount_eur) > 0 && <strong>{euros(r.budget_amount_eur)}</strong>}</span>
                          </button>
                        ))}
                        {col.length === 0 && <p className="rounded-md border border-dashed border-hc-line p-3 text-center text-xs text-hc-muted">Vacío</p>}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {open && <TicketDrawer ticketId={open} team={team} shop={shop} onClose={() => { setOpen(null); if (nav.ticketId) go({ tab: 'reparo' }); }} onChanged={() => fetchPage(0, true)} />}
      {creating && (
        <NewTicket team={team} onClose={() => setCreating(false)} onCreated={async (id) => {
          setCreating(false);
          await fetchPage(0, true);
          const r = await mod<{ ticket: Record<string, unknown>; customer: Record<string, unknown> | null }>('reparo', ctx, 'getTicket', { ticketId: id }).catch(() => null);
          if (r) setPrintNew({ t: r.ticket, c: r.customer });
        }} />
      )}
      {printNew && <PrintDialog shop={shop} t={printNew.t} c={printNew.c} onClose={() => { const id = String(printNew.t.id); setPrintNew(null); setOpen(id); }} />}
    </div>
  );
}
