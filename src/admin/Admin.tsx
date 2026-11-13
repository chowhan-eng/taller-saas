// Super-Admin Reseller Panel. The page itself shows nothing sensitive: every number comes from `adminApi`,
// which answers 403 to anyone who is not the platform owner (shop owners included).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, Ban, CheckCircle2, CircleDollarSign, ExternalLink, Gift, Lock, RefreshCw, RotateCcw, Search, Users } from 'lucide-react';
import { callFn, isSignedIn, redirectToLogin } from '@/lib/base44';
import { Alert, Modal, cx } from '../dash/ui';

type Overview = {
  paying: { founder: number; starter: number; pro: number; total: number }; trials: number; expired_trials: number; past_due: number; courtesy: number;
  mrr_eur: number; arr_eur: number; collected_total_eur: number; collected_30d_eur: number;
  founder: { cap: number; taken: number; left: number; holds: { tenant_id: string; minutes_left: number }[]; hold_minutes: number };
};
type Tenant = {
  id: string; trade_name: string; slug: string; owner_email: string | null; created_date: string; plan: string; tenant_status: string; sub_status: string | null;
  trial: boolean; trial_expired: boolean; days_left: number | null; manual_override: boolean; manual_note: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null; current_period_end: string | null;
  wa_sent: number; wa_cap: number | null; wa_reset_at: string | null;
};
type Ev = { id: string; kind: string; occurred_at: string; amount_eur: number; currency: string; status: string | null; plan: string | null; shop: string | null; detail: string | null; stripe_customer_id: string | null };
type Audit = { id: string; at: string; actor: string; action: string; tenant_id: string | null; detail: string };

const eur = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const day = (iso: string | null) => (iso ? new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const PLAN: Record<string, string> = { starter: 'Starter', pro: 'Pro', founder: 'Fundador' };
const KIND: Record<string, [string, string]> = {
  payment: ['Pago', 'bg-emerald-500/15 text-emerald-300'], payment_failed: ['Pago fallido', 'bg-red-500/15 text-red-300'], checkout_completed: ['Alta', 'bg-sky-500/15 text-sky-300'],
  subscription_created: ['Suscripción', 'bg-sky-500/15 text-sky-300'], upgrade: ['Cambio de plan', 'bg-violet-500/15 text-violet-300'], subscription_updated: ['Actualización', 'bg-slate-500/20 text-slate-300'], cancelled: ['Cancelación', 'bg-amber-500/15 text-amber-300'],
};

async function api<T extends object>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await callFn<T>('adminApi', { action, ...body });
  if (r.status === 401) { redirectToLogin(); throw new Error('Sesión caducada'); }
  if (!r.ok) throw Object.assign(new Error((r.data as { error?: string }).error ?? `Error ${r.status}`), { status: r.status });
  return r.data as T;
}

function Kpi({ label, value, sub, Icon, tone = 'text-white' }: { label: string; value: string; sub?: string; Icon: typeof Users; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-400">{label}<Icon size={15} /></div>
      <div className={cx('mt-2 text-2xl font-bold tabular-nums', tone)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function StatusBadge({ t }: { t: Tenant }) {
  const s = t.tenant_status === 'suspended' ? ['Suspendido', 'bg-red-500/15 text-red-300'] : t.trial_expired ? ['Prueba vencida', 'bg-amber-500/15 text-amber-300'] : t.trial ? [t.days_left != null ? `Prueba · ${t.days_left} d` : 'Prueba', 'bg-sky-500/15 text-sky-300'] : t.sub_status === 'active' ? ['Activa', 'bg-emerald-500/15 text-emerald-300']
    : t.sub_status === 'past_due' ? ['Impago', 'bg-amber-500/15 text-amber-300'] : [t.sub_status ?? t.tenant_status, 'bg-slate-500/20 text-slate-300'];
  return <span className={cx('rounded px-2 py-0.5 text-xs font-semibold', s[1])}>{s[0]}</span>;
}

export default function Admin() {
  const [state, setState] = useState<'loading' | 'forbidden' | 'ok' | 'error'>('loading');
  const [email, setEmail] = useState('');
  const [ov, setOv] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stripeBase, setStripeBase] = useState('https://dashboard.stripe.com');
  const [events, setEvents] = useState<Ev[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [edit, setEdit] = useState<Tenant | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api<{ email: string }>('whoami');
      setEmail(me.email);
      const [o, t, e, a] = await Promise.all([api<Overview>('overview'), api<{ tenants: Tenant[]; stripe_base?: string }>('tenants'), api<{ events: Ev[] }>('events'), api<{ audit: Audit[] }>('audit')]);
      setOv(o); setTenants(t.tenants); if (t.stripe_base) setStripeBase(t.stripe_base); setEvents(e.events); setAudit(a.audit); setState('ok');
    } catch (e) { setState((e as { status?: number }).status === 403 ? 'forbidden' : 'error'); if ((e as { status?: number }).status !== 403) setMsg({ ok: false, text: (e as Error).message }); }
  }, []);
  useEffect(() => { if (!isSignedIn()) { try { redirectToLogin(); } catch { setState('error'); } return; } load(); }, [load]);

  async function act(action: string, body: Record<string, unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await api(action, body); setMsg({ ok: true, text: ok }); setEdit(null); await load(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true); setMsg(null);
    try { const r = await api<{ paid: number; failed: number; added: number }>('syncStripe'); setMsg({ ok: true, text: `Stripe sincronizado: ${r.paid} pagos, ${r.failed} fallidos, ${r.added} nuevos en el feed.` }); await load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  const rows = useMemo(() => tenants.filter((t) => {
    if (filter === 'trial' && !t.trial) return false;
    if (filter === 'paying' && !(t.sub_status === 'active' && !t.manual_override)) return false;
    if (filter === 'courtesy' && !t.manual_override) return false;
    if (filter === 'issues' && !(t.sub_status === 'past_due' || t.tenant_status === 'suspended')) return false;
    const s = q.trim().toLowerCase();
    return !s || [t.trade_name, t.owner_email, t.slug, t.stripe_customer_id].some((v) => String(v ?? '').toLowerCase().includes(s));
  }), [tenants, q, filter]);

  if (state === 'loading') return <main className="min-h-screen bg-slate-950 p-8 text-slate-400">Comprobando acceso…</main>;
  if (state === 'forbidden') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-200">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <Lock className="mx-auto mb-3 text-slate-400" size={34} />
          <h1 className="text-xl font-bold">403 · Acceso restringido</h1>
          <p className="mt-2 text-sm text-slate-400">Esta zona es solo para el titular de la plataforma. Tu panel de taller está en <a className="text-emerald-300 underline" href="/dashboard/index.html">/dashboard</a>.</p>
        </div>
      </main>
    );
  }
  if (state === 'error') return <main className="min-h-screen bg-slate-950 p-8"><Alert>{msg?.text ?? 'No se ha podido cargar el panel.'}</Alert></main>;

  const o = ov!;
  const stripeLink = (kind: 'customers' | 'subscriptions', id: string | null) => (id ? <a className="inline-flex items-center gap-0.5 text-sky-300 hover:underline" href={`${stripeBase}/${kind}/${id}`} target="_blank" rel="noreferrer noopener">{id.slice(0, 14)}…<ExternalLink size={11} /></a> : <span className="text-slate-600">—</span>);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-white/10 bg-slate-950/90 px-5 py-3 backdrop-blur">
        <h1 className="text-lg font-bold text-white">Taller SaaS <span className="text-emerald-400">· Admin</span></h1>
        <span className="text-xs text-slate-400">{email}</span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={sync} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"><RefreshCw size={14} /> Sincronizar Stripe</button>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">Actualizar</button>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] space-y-6 p-5">
        {msg && <Alert kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert>}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="MRR" value={eur(o.mrr_eur)} sub={`ARR ≈ ${eur(o.arr_eur)} · solo talleres que pagan`} Icon={CircleDollarSign} tone="text-emerald-300" />
          <Kpi label="Cobrado en total" value={eur(o.collected_total_eur)} sub={`${eur(o.collected_30d_eur)} en los últimos 30 días`} Icon={Activity} />
          <Kpi label="Talleres de pago" value={String(o.paying.total)} sub={`${o.paying.founder} Fundador · ${o.paying.starter} Starter · ${o.paying.pro} Pro`} Icon={Users} />
          <Kpi label="Pruebas gratis" value={String(o.trials)} sub={`${o.expired_trials} vencidas · ${o.past_due} en impago · ${o.courtesy} de cortesía`} Icon={Gift} tone={o.past_due ? 'text-amber-300' : 'text-white'} />
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-white">Plazas de Fundador · <span className="tabular-nums">{o.founder.taken} / {o.founder.cap}</span></h2>
            <span className="text-xs text-slate-400">{o.founder.left} libres · reservas de checkout de {o.founder.hold_minutes} min</span>
          </div>
          <div className="mt-3 flex gap-1.5" role="img" aria-label={`${o.founder.taken} de ${o.founder.cap} plazas ocupadas`}>
            {Array.from({ length: o.founder.cap }, (_, i) => <span key={i} className={cx('h-3 flex-1 rounded', i < o.founder.taken ? 'bg-emerald-400' : 'bg-white/10')} />)}
          </div>
          {o.founder.holds.length > 0 && <p className="mt-2 text-xs text-amber-300">{o.founder.holds.length} checkout{o.founder.holds.length > 1 ? 's' : ''} en curso reservando plaza: {o.founder.holds.map((h) => `${tenants.find((t) => t.id === h.tenant_id)?.trade_name ?? h.tenant_id} (${h.minutes_left} min)`).join(' · ')}</p>}
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-white">Talleres ({rows.length})</h2>
            <div className="relative ml-auto w-64"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-9 pr-3 text-sm outline-none placeholder:text-slate-500 focus:border-emerald-400" placeholder="Nombre, correo o id de Stripe" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            {[['all', 'Todos'], ['paying', 'De pago'], ['trial', 'Prueba'], ['courtesy', 'Cortesía'], ['issues', 'Con problemas']].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cx('rounded-full px-3 py-1 text-xs font-medium', filter === k ? 'bg-emerald-400 text-slate-950' : 'bg-white/10 text-slate-300 hover:bg-white/15')}>{l}</button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400"><tr>
                <th className="px-3 py-2">Taller</th><th>Propietario</th><th>Plan</th><th>Estado</th><th>Cliente Stripe</th><th>Suscripción</th><th>WhatsApp (prueba)</th><th>Alta</th><th className="px-3" />
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-slate-500">Ningún taller coincide.</td></tr>}
                {rows.map((t) => (
                  <tr key={t.id} className="border-t border-white/10 align-middle hover:bg-white/[0.03]">
                    <td className="px-3 py-2.5"><div className="font-medium text-white">{t.trade_name}</div><div className="text-xs text-slate-500">{t.slug}</div></td>
                    <td className="text-slate-300">{t.owner_email ?? '—'}</td>
                    <td><span className="font-medium">{PLAN[t.plan] ?? t.plan}</span>{t.manual_override && <span title={t.manual_note ?? ''} className="ml-1.5 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-300">cortesía</span>}</td>
                    <td><StatusBadge t={t} /></td>
                    <td className="text-xs">{stripeLink('customers', t.stripe_customer_id)}</td>
                    <td className="text-xs">{stripeLink('subscriptions', t.stripe_subscription_id)}</td>
                    <td className="min-w-[150px]">
                      {t.wa_cap != null ? (
                        <div title={t.wa_reset_at ? `Cuota reiniciada el ${day(t.wa_reset_at)}` : ''}><div className="flex justify-between text-xs"><span>{t.wa_sent} / {t.wa_cap}</span>{t.wa_sent >= t.wa_cap && <span className="font-bold text-red-300">tope</span>}</div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10"><div className={cx('h-full', t.wa_sent >= t.wa_cap ? 'bg-red-400' : t.wa_sent >= t.wa_cap * 0.8 ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${Math.min(100, (t.wa_sent / t.wa_cap) * 100)}%` }} /></div></div>
                      ) : <span className="text-xs text-slate-400">{t.wa_sent} enviados</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-400">{day(t.created_date)}</td>
                    <td className="px-3 text-right"><button type="button" onClick={() => setEdit(t)} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/10">Gestionar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-semibold text-white">Ventas y eventos de Stripe</h2>
          <p className="mb-2 text-xs text-slate-500">Llegan del webhook (<code>invoice.paid</code>, <code>invoice.payment_failed</code>, <code>customer.subscription.*</code>, <code>checkout.session.completed</code>). Para el histórico anterior usa «Sincronizar Stripe».</p>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400"><tr><th className="px-3 py-2">Cuándo</th><th>Evento</th><th>Taller</th><th>Plan</th><th className="text-right">Importe</th><th className="px-3">Detalle</th></tr></thead>
              <tbody>
                {events.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-slate-500">Todavía no hay eventos. Cuando Stripe envíe el primero aparecerá aquí.</td></tr>}
                {events.map((e) => {
                  const k = KIND[e.kind] ?? [e.kind, 'bg-slate-500/20 text-slate-300'];
                  return (
                    <tr key={e.id} className="border-t border-white/10">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{day(e.occurred_at)}</td>
                      <td><span className={cx('rounded px-2 py-0.5 text-xs font-semibold', k[1])}>{k[0]}</span></td>
                      <td>{e.shop ?? <span className="text-slate-600">—</span>}</td><td>{e.plan ? PLAN[e.plan] ?? e.plan : '—'}</td>
                      <td className={cx('text-right font-semibold tabular-nums', e.kind === 'payment' && 'text-emerald-300', e.kind === 'payment_failed' && 'text-red-300')}>{e.amount_eur ? eur(e.amount_eur) : '—'}</td>
                      <td className="px-3 text-xs text-slate-400">{e.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <details className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-white">Registro de acciones del administrador ({audit.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {audit.map((a) => <li key={a.id}><span className="text-slate-500">{day(a.at)}</span> · <strong className="text-slate-300">{a.action}</strong> · {tenants.find((t) => t.id === a.tenant_id)?.trade_name ?? a.tenant_id ?? ''} · {a.detail}</li>)}
            {audit.length === 0 && <li>Sin acciones todavía.</li>}
          </ul>
        </details>
      </div>

      {edit && <ManageModal t={edit} busy={busy} onClose={() => setEdit(null)} onAct={act} />}
    </main>
  );
}

function ManageModal({ t, busy, onClose, onAct }: { t: Tenant; busy: boolean; onClose: () => void; onAct: (action: string, body: Record<string, unknown>, ok: string) => void }) {
  const [plan, setPlan] = useState(t.plan === 'starter' ? 'pro' : t.plan);
  const [note, setNote] = useState('');
  const suspended = t.tenant_status === 'suspended';
  return (
    <Modal title={`Gestionar · ${t.trade_name}`} onClose={onClose} dark wide>
      <div className="space-y-5 text-sm text-slate-200">
        <p className="text-xs text-slate-400">{t.owner_email ?? 'sin propietario'} · plan actual <strong>{PLAN[t.plan] ?? t.plan}</strong>{t.manual_override ? ' (cortesía)' : ''} · {t.sub_status ?? 'sin suscripción'}</p>

        <section className="space-y-2 rounded-lg border border-white/10 p-3">
          <h3 className="flex items-center gap-1.5 font-semibold"><ArrowUpRight size={15} /> Conceder o cambiar plan</h3>
          <p className="text-xs text-slate-400">Se activa al instante sin pasar por Stripe y Stripe deja de modificarlo hasta que lo quites. Fundador respeta el tope de 10 plazas.</p>
          <div className="flex flex-wrap gap-2">
            <select className="rounded-lg border border-white/15 bg-slate-900 px-3 py-2" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">
              <option value="starter">Starter</option><option value="pro">Pro</option><option value="founder">Fundador</option>
            </select>
            <input className="min-w-[200px] flex-1 rounded-lg border border-white/15 bg-slate-900 px-3 py-2 placeholder:text-slate-500" placeholder="Motivo (ej. demo, amigo, compensación)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            <button type="button" disabled={busy} onClick={() => onAct('setPlan', { tenantId: t.id, plan, note }, `Plan ${PLAN[plan]} concedido a ${t.trade_name}.`)} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">Aplicar</button>
          </div>
          {t.manual_override && <button type="button" disabled={busy} onClick={() => onAct('clearOverride', { tenantId: t.id }, 'Vuelve a depender de Stripe.')} className="text-xs text-violet-300 underline">Quitar la cortesía (que vuelva a mandar Stripe)</button>}
        </section>

        <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 p-3">
          <div><h3 className="flex items-center gap-1.5 font-semibold"><RotateCcw size={15} /> Cuota de WhatsApp de la prueba</h3><p className="text-xs text-slate-400">{t.wa_cap != null ? `${t.wa_sent} de ${t.wa_cap} usados.` : 'Este taller no está en prueba: la cuota solo limita las pruebas.'} Reiniciarla vuelve a contar desde cero.</p></div>
          <button type="button" disabled={busy} onClick={() => onAct('resetQuota', { tenantId: t.id }, `Cuota de ${t.trade_name} reiniciada.`)} className="rounded-lg border border-white/15 px-4 py-2 font-medium hover:bg-white/10 disabled:opacity-50">Reiniciar cuota</button>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 p-3">
          <div><h3 className="flex items-center gap-1.5 font-semibold">{suspended ? <CheckCircle2 size={15} /> : <Ban size={15} />} {suspended ? 'Taller suspendido' : 'Suspender taller'}</h3><p className="text-xs text-slate-400">{suspended ? 'Sin acceso a ningún módulo. Reactivarlo le devuelve el acceso de su plan.' : 'Bloquea todos sus módulos al instante (no borra datos).'}</p></div>
          <button type="button" disabled={busy} onClick={() => { if (suspended || window.confirm(`¿Suspender «${t.trade_name}»? Perderá el acceso de inmediato.`)) onAct('setStatus', { tenantId: t.id, status: suspended ? 'active' : 'suspended' }, suspended ? 'Taller reactivado.' : 'Taller suspendido.'); }} className={cx('rounded-lg px-4 py-2 font-semibold disabled:opacity-50', suspended ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-red-600 text-white hover:bg-red-500')}>{suspended ? 'Reactivar' : 'Suspender'}</button>
        </section>
        {t.sub_status === 'past_due' && <p className="flex items-center gap-1.5 text-xs text-amber-300"><AlertTriangle size={13} /> Este taller tiene un pago pendiente en Stripe.</p>}
      </div>
    </Modal>
  );
}
