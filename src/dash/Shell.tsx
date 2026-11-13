// Unified shop dashboard. One left rail switches between the three production tools, each rendered in its
// OWN theme (WhatsApp dark/green, Reparo HelloClient, TPV desktop window). Starter sees an upgrade card on
// the Pro modules; the server gates every call anyway.
import { Suspense, lazy, useEffect, useState } from 'react';
import { Calculator, MessageCircle, Wrench, Crown } from 'lucide-react';
import { callFn, isSignedIn, redirectToLogin } from '@/lib/base44';
import type { Ctx } from './api';
import { DashContext, cx, type Nav, type Tab } from './ui';

const WhatsApp = lazy(() => import('./wa/WhatsApp'));
const Reparo = lazy(() => import('./reparo/Reparo'));
const Tpv = lazy(() => import('./tpv/Tpv'));

const TABS: { key: Tab; label: string; Icon: typeof Wrench; pro: boolean }[] = [
  { key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle, pro: false },
  { key: 'reparo', label: 'Reparo', Icon: Wrench, pro: true },
  { key: 'tpv', label: 'TPV', Icon: Calculator, pro: true },
];

function Upgrade({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <section className="rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        <h2 className="mt-0 text-xl font-bold">{what} está en el plan Pro</h2>
        <p className="text-slate-600">Con Pro tienes todo lo de Starter y además:</p>
        <ul className="my-3 list-disc space-y-1 pl-5 text-slate-700">
          <li>Reparo CRM: resguardos y etiquetas 58/80 mm, clientes y reparaciones</li>
          <li>Presupuestos automáticos con tus márgenes</li>
          <li>TPV, cobros con CashDro y cierre de caja</li>
        </ul>
        <p className="text-3xl font-extrabold">79 € <span className="text-sm font-normal text-slate-500">/mes</span></p>
        <a className="mt-2 inline-block rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white" href="/onboarding/?plan=pro">Pasarme a Pro</a>
        <p className="mt-3 text-sm"><a className="text-blue-700 underline" href="/onboarding/?plan=founder">¿Quieres ser uno de los 10 talleres fundadores? 59 € el primer año →</a></p>
        <p className="text-xs text-slate-500">IVA no incluido. Sin permanencia.</p>
      </section>
    </div>
  );
}

export default function Shell() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [shop, setShop] = useState('');
  const [trial, setTrial] = useState<{ state: 'none' | 'trial' | 'expired'; days_left: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nav, setNav] = useState<Nav>(() => {
    const h = location.hash.slice(1).split('?')[0];
    return { tab: h === 'reparo' || h === 'tpv' ? h : 'whatsapp' };
  });

  useEffect(() => {
    if (!isSignedIn()) { try { redirectToLogin(); } catch { setErr('No se ha podido abrir el acceso.'); } return; }
    (async () => {
      const s = await callFn<{ tenantId: string | null }>('onboardingState', {});
      if (s.status === 401) { redirectToLogin(); return; }
      if (!s.ok) throw new Error(s.data.error);
      if (!s.data.tenantId) { location.href = '/onboarding/'; return; }
      const e = await callFn<{ plan: string; status: string; role: string; modules: string[]; trial?: { state: 'none' | 'trial' | 'expired'; days_left: number | null } }>('entitlements', { tenantId: s.data.tenantId });
      if (!e.ok) throw new Error(e.data.error);
      setCtx({ tenantId: s.data.tenantId, role: String(e.data.role), plan: String(e.data.plan) });
      setModules(e.data.modules ?? []);
      setTrial(e.data.trial ?? null);
      const w = await callFn<{ trade_name?: string }>('whatsapp', { tenantId: s.data.tenantId, action: 'settings' });
      if (w.ok) setShop(String(w.data.trade_name ?? ''));
    })().catch(() => setErr('No hemos podido cargar tu taller. Revisa la conexión y recarga la página.'));
  }, []);

  useEffect(() => { history.replaceState(null, '', `#${nav.tab}`); }, [nav.tab]);

  if (err) return <main className="p-8"><div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{err}</div></main>;
  if (!ctx) return <main className="p-8 text-slate-500">Cargando tu taller…</main>;

  const allowed = (t: Tab) => modules.includes(t);
  const isPro = ctx.plan === 'pro' || ctx.plan === 'founder';
  const body = (
    <Suspense fallback={<p className="p-6 text-slate-500">Cargando…</p>}>
      {nav.tab === 'whatsapp' && (allowed('whatsapp') ? <WhatsApp /> : <Upgrade what="WhatsApp" />)}
      {nav.tab === 'reparo' && (allowed('reparo') ? <Reparo /> : <Upgrade what="Reparo CRM" />)}
      {nav.tab === 'tpv' && (allowed('tpv') ? <Tpv /> : <Upgrade what="La caja (TPV)" />)}
    </Suspense>
  );

  return (
    <DashContext.Provider value={{ ctx, modules, shop, nav, go: setNav }}>
      <div className="flex h-screen w-full overflow-hidden bg-slate-100">
        <nav aria-label="Módulos" className="flex w-[68px] shrink-0 flex-col items-center gap-1 bg-slate-900 py-3 text-slate-300">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-xs font-extrabold text-white" title={shop}>{(shop || 'T').slice(0, 2).toUpperCase()}</div>
          {TABS.map(({ key, label, Icon, pro }) => (
            <button key={key} type="button" aria-label={label} aria-current={nav.tab === key ? 'page' : undefined} onClick={() => setNav({ tab: key })}
              className={cx('relative flex w-14 flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[11px] font-medium transition', nav.tab === key ? 'bg-white/15 text-white' : 'hover:bg-white/10')}>
              <Icon size={22} />
              {label}
              {pro && !allowed(key) && <Crown size={11} className="absolute right-1 top-1 text-amber-400" aria-label="Plan Pro" />}
            </button>
          ))}
          <div className="mt-auto px-1 text-center text-[10px] leading-tight text-slate-400">
            {ctx.plan === 'founder' ? 'Fundador' : isPro ? 'Pro' : 'Starter'}
          </div>
        </nav>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {trial?.state === 'trial' && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-emerald-700 px-4 py-1.5 text-sm text-white" role="status">
              <span>Prueba gratuita: te {trial.days_left === 1 ? 'queda 1 día' : `quedan ${trial.days_left} días`} · hasta 50 mensajes de WhatsApp.</span>
              <a className="font-semibold underline" href="/onboarding/">Elegir plan</a>
            </div>
          )}
          {trial?.state === 'expired' && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-red-700 px-4 py-2 text-sm font-medium text-white" role="alert">
              <span>Tu prueba gratuita de 14 días ha terminado: el envío de WhatsApp está bloqueado hasta que elijas un plan.</span>
              <a className="rounded bg-white px-3 py-1 font-semibold text-red-800" href="/onboarding/">Elegir plan</a>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
        </main>
      </div>
    </DashContext.Provider>
  );
}
