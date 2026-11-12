// Unified shop dashboard: WhatsApp (all plans), Reparo CRM and TPV (Pro). Starter sees an upgrade prompt
// on the Pro tabs instead of a broken page; the server gates every call anyway.
import { useEffect, useState } from 'react';
import { callFn, isSignedIn, redirectToLogin } from '@/lib/base44';
import type { Ctx } from '@/dashboard/api';
import WhatsappTab from '@/dashboard/WhatsappTab';
import ReparoTab from '@/dashboard/ReparoTab';
import TpvTab from '@/dashboard/TpvTab';
import '@/dashboard/dashboard.css';

type Tab = 'whatsapp' | 'reparo' | 'tpv';
const TABS: { key: Tab; label: string; pro: boolean }[] = [
  { key: 'whatsapp', label: 'WhatsApp', pro: false },
  { key: 'reparo', label: 'Reparaciones', pro: true },
  { key: 'tpv', label: 'Caja (TPV)', pro: true },
];

export function Upgrade({ what }: { what: string }) {
  return (
    <section className="card upgrade" style={{ padding: 28, maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>{what} está en el plan Pro</h2>
      <p>Con Pro tienes todo lo de Starter y además:</p>
      <ul className="ticks">
        <li>Reparo CRM: resguardos y etiquetas 58/80 mm, clientes y reparaciones</li>
        <li>Presupuestos automáticos con tus márgenes</li>
        <li>TPV, cobros con CashDro y cierre de caja</li>
      </ul>
      <p className="price">79 €<span className="small muted">/mes</span></p>
      <a className="btn" href="/onboarding/?plan=pro">Pasarme a Pro</a>
      <p className="small muted">IVA no incluido. Sin permanencia.</p>
    </section>
  );
}

export default function Dashboard() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [shop, setShop] = useState('');
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1);
    return h === 'reparo' || h === 'tpv' ? h : 'whatsapp';
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn()) { try { redirectToLogin(); } catch { setErr('No se ha podido abrir el acceso.'); } return; }
    (async () => {
      const s = await callFn<{ tenantId: string | null }>('onboardingState', {});
      if (s.status === 401) { redirectToLogin(); return; }
      if (!s.ok) throw new Error(s.data.error);
      if (!s.data.tenantId) { location.href = '/onboarding/'; return; }
      const e = await callFn<{ plan: string; status: string; role: string; modules: string[] }>('entitlements', { tenantId: s.data.tenantId });
      if (!e.ok) throw new Error(e.data.error);
      setCtx({ tenantId: s.data.tenantId, role: String(e.data.role), plan: String(e.data.plan) });
      setModules(e.data.modules ?? []);
      const w = await callFn<{ trade_name?: string }>('whatsapp', { tenantId: s.data.tenantId, action: 'settings' });
      if (w.ok) setShop(String(w.data.trade_name ?? ''));
    })().catch(() => setErr('No hemos podido cargar tu taller. Revisa la conexión y recarga la página.'));
  }, []);

  useEffect(() => { history.replaceState(null, '', `#${tab}`); }, [tab]);

  if (err) return <main className="wrap" style={{ padding: 32 }}><div className="alert err">{err}</div></main>;
  if (!ctx) return <main className="wrap" style={{ padding: 32 }}><p className="muted">Cargando tu taller…</p></main>;

  const allowed = (t: Tab) => modules.includes(t);
  return (
    <div className="dash">
      <header className="dash-top">
        <strong>{shop || 'Mi taller'}</strong>
        <nav className="dash-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}{t.pro && !allowed(t.key) ? ' · Pro' : ''}
            </button>
          ))}
        </nav>
        <span className="small muted">Plan {ctx.plan === 'pro' ? 'Pro' : 'Starter'}</span>
      </header>
      <main className="dash-body">
        {tab === 'whatsapp' && (allowed('whatsapp') ? <WhatsappTab ctx={ctx} /> : <Upgrade what="WhatsApp" />)}
        {tab === 'reparo' && (allowed('reparo') ? <ReparoTab ctx={ctx} /> : <Upgrade what="Reparaciones (Reparo CRM)" />)}
        {tab === 'tpv' && (allowed('tpv') ? <TpvTab ctx={ctx} /> : <Upgrade what="La caja (TPV)" />)}
      </main>
    </div>
  );
}
