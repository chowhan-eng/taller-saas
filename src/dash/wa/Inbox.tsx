// WhatsApp Pro inbox — 3 panes like the production app:
//   left   conversation list: search, filter tabs, unread badges, 24 h window countdown
//   centre chat: bubbles, delivery ticks (sent/delivered/read/failed), reactions, AI draft banner, composer
//   right  customer + repairs context (repairs only on Pro) and the AI summary
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, CheckCheck, Clock, Hand, Search, Send, Sparkles, Wrench, X } from 'lucide-react';
import { mod } from '../api';
import { Alert, cx, useDash, useDebounced, digits } from '../ui';
import { StatusPill } from '../reparo/status';

export type Conv = {
  id: string; name: string | null; phone: string | null; preview: string | null; last_message_at: string; unread: boolean; unread_count: number;
  automation_paused: boolean; window_open: boolean; window_expires_at: string | null; ai_requires_human: boolean; has_draft: boolean;
};
type Msg = { id: string; direction: string; sender_type: string; body: string | null; status: string; sent_at: string; message_type?: string; reaction_emoji?: string | null };
type Thread = { messages: Msg[]; draft: string | null; draft_confidence: number | null; draft_category: string | null; draft_requires_human: boolean };
type Context = {
  customer: { id: string; name: string; email: string | null; wa_opted_out: boolean; wa_service_opt_in: boolean; notes: string | null } | null;
  tickets: { id: string; ticket_number: string; status: string; brand: string; model: string; budget_amount_eur: number | null }[];
  pro: boolean;
  ai: { draft: string | null; confidence: number | null; requires_human: boolean; category: string | null; processed_at: string | null };
};

const FILTERS = [
  ['all', 'Todos'], ['unread', 'Sin leer'], ['window', 'En ventana'], ['human', 'Atiende humano'], ['ai', 'Borrador IA'],
] as const;
type Filter = (typeof FILTERS)[number][0];

const useNow = (ms = 30000) => {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
};

/** Countdown of Meta's 24 h customer-service window. Free text is only allowed while it is open. */
export function windowLeft(expires: string | null, now: number) {
  if (!expires) return { label: 'Cerrada', tone: 'closed' as const };
  const ms = Date.parse(expires) - now;
  if (!(ms > 0)) return { label: 'Cerrada', tone: 'closed' as const };
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return { label: h > 0 ? `${h} h ${m} min` : `${m} min`, tone: ms < 3600e3 ? ('red' as const) : ms < 6 * 3600e3 ? ('amber' as const) : ('green' as const) };
}
const TONE = { green: 'bg-emerald-500/20 text-emerald-300', amber: 'bg-amber-500/20 text-amber-300', red: 'bg-red-500/20 text-red-300', closed: 'bg-slate-500/20 text-slate-400' };

function Ticks({ status }: { status: string }) {
  if (status === 'read') return <CheckCheck size={14} className="text-wa-blue" aria-label="Leído" />;
  if (status === 'delivered') return <CheckCheck size={14} className="text-wa-muted" aria-label="Entregado" />;
  if (status === 'sent') return <Check size={14} className="text-wa-muted" aria-label="Enviado" />;
  if (status === 'failed') return <AlertTriangle size={14} className="text-red-400" aria-label="Fallido" />;
  if (status === 'queued') return <Clock size={13} className="text-wa-muted" aria-label="En cola" />;
  return null;
}

const initials = (c: Conv) => (c.name || c.phone || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const asDate = (iso: string) => new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
const dayLabel = (iso: string) => asDate(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const hhmm = (iso: string) => asDate(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

export default function Inbox({ openPhone, templateName }: { openPhone?: string; templateName?: string | null }) {
  const { ctx, go } = useDash();
  const now = useNow();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [info, setInfo] = useState<Context | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hideDraft, setHideDraft] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q, 150);

  const loadConvs = useCallback(async () => {
    setConvs((await mod<{ conversations: Conv[] }>('whatsapp', ctx, 'listConversations', { limit: 100 })).conversations);
  }, [ctx]);
  const loadThread = useCallback(async (id: string, markRead = true) => {
    setThread(await mod<Thread>('whatsapp', ctx, 'getMessages', { conversationId: id }));
    if (markRead) await mod('whatsapp', ctx, 'markRead', { conversationId: id }).catch(() => {});
  }, [ctx]);
  const loadInfo = useCallback(async (id: string) => {
    setInfo(await mod<Context>('whatsapp', ctx, 'customerContext', { conversationId: id }).catch(() => null));
  }, [ctx]);

  useEffect(() => {
    loadConvs().catch((e) => setErr((e as Error).message));
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadConvs().catch(() => {}); }, 15000);
    return () => clearInterval(t);
  }, [loadConvs]);

  // Deep link from a Reparo ticket: open the conversation with that phone.
  useEffect(() => {
    if (!openPhone) return;
    mod<{ conversationId: string | null }>('whatsapp', ctx, 'openByPhone', { phone: openPhone })
      .then((r) => { if (r.conversationId) setSel(r.conversationId); else setErr('Este cliente todavía no tiene conversación de WhatsApp.'); })
      .catch((e) => setErr((e as Error).message));
  }, [openPhone, ctx]);

  useEffect(() => {
    if (!sel) { setThread(null); setInfo(null); return; }
    setHideDraft(null);
    loadThread(sel).then(() => loadConvs()).catch((e) => setErr((e as Error).message));
    loadInfo(sel);
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadThread(sel, false).catch(() => {}); }, 10000);
    return () => clearInterval(t);
  }, [sel, loadThread, loadInfo, loadConvs]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.length, sel]);

  const conv = convs.find((c) => c.id === sel) ?? null;
  const win = windowLeft(conv?.window_expires_at ?? null, now);

  const shown = useMemo(() => {
    const s = dq.trim().toLowerCase();
    const sd = digits(dq);
    return convs.filter((c) => {
      if (filter === 'unread' && !c.unread) return false;
      if (filter === 'window' && !(c.window_expires_at && Date.parse(c.window_expires_at) > now)) return false;
      if (filter === 'human' && !c.automation_paused) return false;
      if (filter === 'ai' && !c.has_draft) return false;
      if (!s) return true;
      return (c.name ?? '').toLowerCase().includes(s) || (c.preview ?? '').toLowerCase().includes(s) || (sd.length >= 3 && digits(c.phone).includes(sd));
    });
  }, [convs, dq, filter, now]);
  const unreadTotal = convs.reduce((n, c) => n + (c.unread ? 1 : 0), 0);

  async function send(body: string) {
    if (!sel || !body.trim()) return;
    setBusy(true); setErr(null);
    try {
      await mod('whatsapp', ctx, 'send', { conversationId: sel, text: body });
      setText('');
      await loadThread(sel, false);
      await loadConvs();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function regenerate() {
    if (!sel) return;
    setBusy(true); setErr(null);
    try {
      await mod('whatsapp', ctx, 'draft', { conversationId: sel, agentInput: text || undefined });
      setHideDraft(null);
      await loadThread(sel, false);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function pause(p: boolean) {
    if (!sel) return;
    await mod('whatsapp', ctx, 'pause', { conversationId: sel, paused: p }).catch((e) => setErr((e as Error).message));
    await loadConvs();
  }

  // Group messages by day for the separators.
  const days = useMemo(() => {
    const out: { day: string; items: Msg[] }[] = [];
    for (const m of thread?.messages ?? []) {
      const d = dayLabel(m.sent_at);
      if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, items: [] });
      out[out.length - 1].items.push(m);
    }
    return out;
  }, [thread]);

  const draftVisible = !!thread?.draft && thread.draft !== hideDraft && !text.trim();
  const conf = thread?.draft_confidence;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]">
      {/* ───────── left: list ───────── */}
      <aside className={cx('flex min-h-0 flex-col border-r border-wa-line bg-wa-panel', sel && 'max-md:hidden')}>
        <div className="space-y-2 p-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-wa-muted" />
            <input className="wa-input pl-9" placeholder="Buscar nombre, teléfono o mensaje" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar conversación" />
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtros">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={cx('rounded-full px-2.5 py-1 text-xs font-medium', filter === k ? 'bg-wa-green text-wa-dark' : 'bg-wa-raised text-wa-muted hover:text-wa-text')}>
                {label}{k === 'unread' && unreadTotal > 0 ? ` (${unreadTotal})` : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 && <p className="p-4 text-sm text-wa-muted">{convs.length === 0 ? 'Aún no hay conversaciones. Cuando un cliente te escriba aparecerá aquí.' : 'Ninguna conversación coincide.'}</p>}
          {shown.map((c) => {
            const w = windowLeft(c.window_expires_at, now);
            return (
              <button key={c.id} type="button" onClick={() => setSel(c.id)}
                className={cx('flex w-full items-start gap-3 border-b border-wa-line/60 px-3 py-3 text-left hover:bg-wa-raised', sel === c.id && 'bg-wa-raised')}>
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-line text-sm font-bold text-wa-text">{initials(c)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cx('truncate text-sm', c.unread ? 'font-bold' : 'font-medium')}>{c.name || (c.phone ? `+${c.phone}` : 'Cliente')}</span>
                    <span className="shrink-0 text-[11px] text-wa-muted">{c.last_message_at ? hhmm(c.last_message_at) : ''}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className={cx('truncate text-xs', c.unread ? 'text-wa-text' : 'text-wa-muted')}>{c.preview}</span>
                    {c.unread && c.unread_count > 0 && <span className="ml-auto shrink-0 rounded-full bg-wa-green px-1.5 text-[11px] font-bold text-wa-dark">{c.unread_count}</span>}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold', TONE[w.tone])}><Clock size={10} /> {w.label}</span>
                    {c.automation_paused && <span className="inline-flex items-center gap-1 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300"><Hand size={10} /> Humano</span>}
                    {c.has_draft && <span className="inline-flex items-center gap-1 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300"><Bot size={10} /> Borrador</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ───────── centre: chat ───────── */}
      <section className={cx('flex min-h-0 flex-col bg-wa-dark', !sel && 'max-md:hidden')}>
        {!conv ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-wa-muted"><Send size={36} /><p>Elige una conversación</p></div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-wa-line bg-wa-raised px-4 py-2.5">
              <button type="button" className="text-wa-muted md:hidden" onClick={() => setSel(null)} aria-label="Volver">←</button>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-wa-line text-sm font-bold">{initials(conv)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{conv.name || 'Cliente'}</div>
                <div className="text-xs text-wa-muted">{conv.phone ? `+${conv.phone}` : ''}</div>
              </div>
              <span className={cx('inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold', TONE[win.tone])} title="Ventana de 24 h de WhatsApp"><Clock size={12} /> {win.tone === 'closed' ? 'Ventana cerrada' : `Ventana ${win.label}`}</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-wa-muted">
                <input type="checkbox" checked={conv.automation_paused} onChange={(e) => pause(e.target.checked)} className="accent-[#25d366]" /> Atiendo yo
              </label>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.025) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
              {days.map((d) => (
                <div key={d.day}>
                  <div className="my-3 text-center"><span className="rounded-lg bg-wa-raised px-3 py-1 text-[11px] capitalize text-wa-muted">{d.day}</span></div>
                  {d.items.map((m) => {
                    const mine = m.direction !== 'inbound';
                    return (
                      <div key={m.id} className={cx('mb-1.5 flex', mine ? 'justify-end' : 'justify-start', m.reaction_emoji && 'mb-4')}>
                        <div className={cx('relative max-w-[78%] rounded-lg px-3 py-1.5 text-sm shadow', mine ? 'rounded-tr-none bg-wa-out' : 'rounded-tl-none bg-wa-raised', m.status === 'failed' && 'ring-1 ring-red-500/60')}>
                          {m.sender_type === 'ai_bot' && <div className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase text-violet-300"><Bot size={11} /> Recepcionista IA</div>}
                          <div className="whitespace-pre-wrap break-words">
                            {m.status === 'blocked_opt_out' ? <em className="text-wa-muted">— bloqueado: el cliente pidió la BAJA —</em> : (m.body || <em className="text-wa-muted">[{m.message_type ?? 'mensaje'}]</em>)}
                          </div>
                          <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-wa-muted">
                            {hhmm(m.sent_at)} {mine && <Ticks status={m.status} />}
                          </div>
                          {m.reaction_emoji && <span className="absolute -bottom-3 right-2 rounded-full bg-wa-raised px-1.5 text-sm shadow ring-1 ring-wa-line">{m.reaction_emoji}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={bottom} />
            </div>

            {draftVisible && (
              <div className="border-t border-violet-500/40 bg-violet-950/40 px-4 py-2.5">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 font-semibold text-violet-300"><Sparkles size={13} /> Borrador de la IA</span>
                  {conf != null && <span className={cx('rounded px-1.5 py-0.5 font-semibold', conf >= 0.8 ? 'bg-emerald-500/20 text-emerald-300' : conf >= 0.5 ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300')}>Confianza {Math.round(conf * 100)} %</span>}
                  {thread?.draft_category && <span className="rounded bg-wa-line px-1.5 py-0.5 text-wa-muted">{thread.draft_category}</span>}
                  {thread?.draft_requires_human && <span className="inline-flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 font-semibold text-red-300"><AlertTriangle size={11} /> Requiere persona</span>}
                </div>
                <p className="whitespace-pre-wrap text-sm">{thread?.draft}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="wa-btn" disabled={busy} onClick={() => send(thread!.draft!)}><Send size={14} /> Aprobar y enviar</button>
                  <button type="button" className="wa-btn-ghost" onClick={() => setText(thread!.draft!)}>Editar</button>
                  <button type="button" className="wa-btn-ghost" disabled={busy} onClick={regenerate}>Regenerar</button>
                  <button type="button" className="wa-btn-ghost" onClick={() => setHideDraft(thread!.draft)}><X size={14} /> Descartar</button>
                </div>
              </div>
            )}

            {err && <div className="px-4 pt-2"><Alert>{err}</Alert></div>}
            <form className="border-t border-wa-line bg-wa-raised px-3 py-2.5" onSubmit={(e) => { e.preventDefault(); send(text); }}>
              <div className="mb-1.5 flex items-center gap-2 text-[11px]">
                <span className={cx('rounded-full px-2 py-0.5 font-semibold', win.tone === 'closed' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300')}>
                  {win.tone === 'closed' ? `Plantilla${templateName ? ` «${templateName}»` : ''} · fuera de las 24 h` : 'Texto libre · ventana abierta'}
                </span>
                <button type="button" className="ml-auto inline-flex items-center gap-1 text-violet-300 hover:underline" disabled={busy} onClick={regenerate}><Sparkles size={12} /> {text ? 'Mejorar con IA' : 'Sugerir con IA'}</button>
              </div>
              <div className="flex items-end gap-2">
                <textarea rows={2} className="wa-input resize-none" value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
                  placeholder={win.tone === 'closed' ? 'La ventana está cerrada: tu texto se enviará dentro de la plantilla aprobada' : 'Escribe un mensaje…'} />
                <button className="wa-btn h-10" disabled={busy || !text.trim()} aria-label="Enviar"><Send size={16} /> {win.tone === 'closed' ? 'Plantilla' : 'Enviar'}</button>
              </div>
            </form>
          </>
        )}
      </section>

      {/* ───────── right: context ───────── */}
      <aside className="hidden min-h-0 overflow-y-auto border-l border-wa-line bg-wa-panel p-4 xl:block">
        {conv && (
          <div className="space-y-4 text-sm">
            <div className="text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-wa-line text-xl font-bold">{initials(conv)}</span>
              <h3 className="mt-2 text-base font-semibold">{info?.customer?.name || conv.name || 'Cliente'}</h3>
              <p className="text-wa-muted">{conv.phone ? `+${conv.phone}` : ''}</p>
              {info?.customer?.email && <p className="text-xs text-wa-muted">{info.customer.email}</p>}
            </div>
            {info?.customer?.wa_opted_out && <Alert kind="warn">Este cliente pidió la BAJA: no se le puede escribir.</Alert>}
            {info && !info.customer && <p className="rounded-lg bg-wa-raised p-3 text-xs text-wa-muted">Este número todavía no es un cliente en tu CRM.</p>}
            {info?.customer?.notes && <p className="rounded-lg bg-wa-raised p-3 text-xs">{info.customer.notes}</p>}

            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-wa-muted"><Wrench size={13} /> Reparaciones</h4>
              {info && !info.pro && <p className="rounded-lg bg-wa-raised p-3 text-xs text-wa-muted">Las reparaciones del cliente se ven con el plan Pro.</p>}
              {info?.pro && info.tickets.length === 0 && <p className="text-xs text-wa-muted">Sin reparaciones.</p>}
              {info?.pro && info.tickets.map((t) => (
                <button key={t.id} type="button" onClick={() => go({ tab: 'reparo', ticketId: t.id })} className="mb-1.5 block w-full rounded-lg bg-wa-raised p-2.5 text-left hover:bg-wa-line">
                  <span className="flex items-center justify-between gap-2"><strong className="text-xs">{t.ticket_number}</strong><StatusPill status={t.status} small /></span>
                  <span className="mt-1 block truncate text-xs text-wa-muted">{[t.brand, t.model].filter(Boolean).join(' ')}{t.budget_amount_eur ? ` · ${t.budget_amount_eur} €` : ''}</span>
                </button>
              ))}
            </div>

            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-wa-muted"><Bot size={13} /> Recepcionista IA</h4>
              <div className="rounded-lg bg-wa-raised p-3 text-xs">
                {info?.ai.confidence != null ? (
                  <>
                    <div className="mb-1 flex items-center justify-between"><span>Confianza</span><strong>{Math.round(info.ai.confidence * 100)} %</strong></div>
                    <div className="h-1.5 overflow-hidden rounded bg-wa-line"><div className="h-full bg-wa-green" style={{ width: `${Math.round(info.ai.confidence * 100)}%` }} /></div>
                    <div className="mt-2 flex justify-between text-wa-muted"><span>Tema</span><span>{info.ai.category ?? '—'}</span></div>
                    {info.ai.requires_human && <div className="mt-1 font-semibold text-red-300">Requiere persona</div>}
                  </>
                ) : <span className="text-wa-muted">Aún no hay borrador para esta conversación.</span>}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
