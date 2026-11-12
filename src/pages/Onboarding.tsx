import { useEffect, useState } from 'react';
import { callFn, isSignedIn, redirectToLogin } from '@/lib/base44';
import { FOUNDER_COMMITMENT, FounderTerms, useFounderSeats } from '@/components/FounderOffer';

type Step = 1 | 2 | 3;
type Plan = 'starter' | 'pro' | 'founder';
const DPA_VERSION = 'dpa-v1-2026-11';
const NET_ERR = 'No hemos podido conectar con el servidor. Revisa tu conexión e inténtalo de nuevo en unos minutos.';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const cleanNif = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export default function Onboarding() {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // step 2
  const [tradeName, setTradeName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [nif, setNif] = useState('');
  const [isAutonomo, setIsAutonomo] = useState(true);
  const [printer, setPrinter] = useState<58 | 80>(80);
  const [dpa, setDpa] = useState(false);
  // step 3
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>('starter');
  const [commit, setCommit] = useState(false);
  const seats = useFounderSeats();
  const founderFull = seats?.left === 0;

  // Every async entry point runs through guard(): a thrown error (server unreachable, misconfigured
  // client) must surface as a message, never leave the page stuck on "Cargando…" / "Enviando…".
  function guard<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
    return (...args: A) => {
      fn(...args).catch((e) => {
        console.error(e);
        setErr(NET_ERR);
        setBusy(false);
        setLoading(false);
      });
    };
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('plan') === 'pro') setPlan('pro');
    if (q.get('plan') === 'founder') setPlan('founder');
    guard(async () => {
      if (isSignedIn()) await routeLoggedIn();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Signed in with Base44: resume at step 2 (no shop yet) or 3 (shop created, not paid). */
  async function routeLoggedIn() {
    const r = await callFn<{ tenantId: string | null }>('onboardingState', {});
    if (r.status === 401) return setStep(1); // expired token: sign in again
    if (!r.ok) throw new Error(r.data.error ?? `onboardingState ${r.status}`);
    if (r.data.tenantId) {
      setTenantId(r.data.tenantId);
      setStep(3);
    } else {
      setStep(2);
    }
  }

  function signIn() {
    setErr(null); setBusy(true);
    try {
      redirectToLogin(); // Base44 sign-in page; it returns here with ?access_token=…
    } catch (e) {
      console.error(e);
      setErr(NET_ERR);
      setBusy(false);
    }
  }

  async function createShop(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const n = cleanNif(nif);
    if (n && !/^[A-Z0-9]{9}$/.test(n)) return setErr('El NIF/CIF debe tener 9 caracteres (ej. 12345678Z o B12345678).');
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return setErr('La dirección debe tener entre 3 y 40 letras, números o guiones.');
    if (!dpa) return setErr('Necesitamos que aceptes el contrato de Encargado del Tratamiento para guardar los datos de tus clientes.');
    setBusy(true);
    // One server call: create_tenant + accept_dpa + is_autonomo (the server re-checks everything).
    const r = await callFn<{ tenantId: string }>('createTenant', {
      tradeName: tradeName.trim(), slug, nif: n || null, printerWidth: printer, isAutonomo,
      dpaAccepted: dpa, dpaVersion: DPA_VERSION,
    });
    setBusy(false);
    if (r.status === 401) return setStep(1);
    if (r.status >= 500 && r.status !== 503) return setErr('No hemos podido crear tu taller. Inténtalo de nuevo.');
    if (!r.ok || !r.data.tenantId) return setErr(r.data.error ?? 'No hemos podido crear tu taller. Inténtalo de nuevo.');
    setTenantId(r.data.tenantId);
    setStep(3);
  }

  async function checkout() {
    setErr(null); setBusy(true);
    const r = await callFn<{ url: string }>('checkout', { tenantId, plan, founderCommitment: plan === 'founder' ? commit : undefined });
    if (r.ok && r.data.url) {
      window.location.href = r.data.url;
    } else {
      setBusy(false);
      if (r.status === 401) return setStep(1);
      setErr(r.data.error ?? 'No hemos podido abrir el pago. Inténtalo de nuevo.');
    }
  }

  if (loading) return <main className="wrap" style={{ padding: '48px 16px' }}><p className="muted">Cargando…</p></main>;

  return (
    <main className="wrap" style={{ maxWidth: 560, padding: '32px 16px 64px' }}>
      <p className="small muted">Paso {step} de 3</p>
      <div className="steps" aria-hidden>{[1, 2, 3].map((s) => <div key={s} className={s <= step ? 'on' : ''} />)}</div>

      {step === 1 && (
        <section className="card" style={{ padding: 24 }}>
          <h2>Crea tu cuenta</h2>
          <p>Entra con tu email para crear tu taller. Si ya tienes cuenta, seguirás donde lo dejaste.</p>
          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn" onClick={signIn} disabled={busy}>{busy ? 'Abriendo…' : 'Entrar o crear cuenta'}</button>
        </section>
      )}

      {step === 2 && (
        <form className="card" style={{ padding: 24 }} onSubmit={guard(createShop)}>
          <h2>Tu taller</h2>
          <label htmlFor="name">Nombre comercial</label>
          <input id="name" type="text" required maxLength={120} value={tradeName}
                 onChange={(e) => { setTradeName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />

          <label htmlFor="slug">Dirección de tu panel</label>
          <input id="slug" type="text" required value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
          <p className="small muted">tallersaas.es/t/<strong>{slug || 'tu-taller'}</strong></p>

          <label htmlFor="nif">NIF / CIF <span className="small muted">(aparece en tus resguardos del plan Pro)</span></label>
          <input id="nif" type="text" maxLength={12} value={nif} onChange={(e) => setNif(e.target.value)} placeholder="12345678Z o B12345678" />

          <label>¿Cómo facturas?</label>
          <div className="choices">
            <label className={`choice ${isAutonomo ? 'on' : ''}`}><input type="radio" name="forma" checked={isAutonomo} onChange={() => setIsAutonomo(true)} />Autónomo</label>
            <label className={`choice ${!isAutonomo ? 'on' : ''}`}><input type="radio" name="forma" checked={!isAutonomo} onChange={() => setIsAutonomo(false)} />Sociedad (SL)</label>
          </div>

          <label>Ancho de tu impresora térmica</label>
          <div className="choices">
            {[58, 80].map((w) => (
              <label key={w} className={`choice ${printer === w ? 'on' : ''}`}>
                <input type="radio" name="printer" checked={printer === w} onChange={() => setPrinter(w as 58 | 80)} />{w} mm
              </label>
            ))}
          </div>
          <p className="small muted">¿No lo sabes? 80 mm es el ticket ancho de supermercado; 58 mm el estrecho de datáfono. Podrás cambiarlo.</p>

          <label className="check">
            <input type="checkbox" checked={dpa} onChange={(e) => setDpa(e.target.checked)} />
            <span>Acepto el <a href="/privacidad#encargado" target="_blank">contrato de Encargado del Tratamiento (RGPD art. 28)</a> y las condiciones del servicio.</span>
          </label>

          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn" disabled={busy || tradeName.trim().length < 2}>{busy ? 'Creando…' : 'Continuar'}</button>
        </form>
      )}

      {step === 3 && (
        <section className="card" style={{ padding: 24 }}>
          <h2>Elige tu plan</h2>
          <p className="small"><a href="/dashboard/">¿Solo quieres entrar a tu panel? Ir al panel →</a></p>
          <div className="choices" style={{ gridTemplateColumns: '1fr' }}>
            <label className={`choice founder ${plan === 'founder' ? 'on' : ''}`} style={founderFull ? { opacity: 0.55 } : undefined}>
              <input type="radio" name="plan" checked={plan === 'founder'} disabled={founderFull} onChange={() => setPlan('founder')} />
              Programa Beta Fundadores · <strong>59 € el primer año</strong>
              <span className="small" style={{ display: 'block', fontWeight: 600 }}>
                Limitado a los 10 primeros talleres{seats ? ` · ${founderFull ? 'plazas agotadas' : `quedan ${seats.left} de ${seats.cap}`}` : ''}
              </span>
              <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>Pro completo. Desde el año 2, 29 €/mes de por vida (en lugar de 79 €/mes). Cancelas cuando quieras.</span>
            </label>
            <label className={`choice ${plan === 'starter' ? 'on' : ''}`}>
              <input type="radio" name="plan" checked={plan === 'starter'} onChange={() => setPlan('starter')} />
              Starter · <strong>14 días gratis</strong>, después 39 €/mes
              <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>Solo WhatsApp: avisos automáticos, recepcionista IA y reseñas de Google.</span>
            </label>
            <label className={`choice ${plan === 'pro' ? 'on' : ''}`}>
              <input type="radio" name="plan" checked={plan === 'pro'} onChange={() => setPlan('pro')} />
              Pro · <strong>79 €/mes</strong>
              <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>Todo Starter + Reparo CRM (resguardos, etiquetas, clientes), técnicos, TPV y cierre de caja.</span>
            </label>
          </div>
          {plan === 'founder' && (
            <>
              <FounderTerms />
              <label className="check"><input type="checkbox" checked={commit} onChange={(e) => setCommit(e.target.checked)} /><span>{FOUNDER_COMMITMENT}</span></label>
            </>
          )}
          <ul className="ticks small">
            {plan === 'starter' && <li><strong>14 Días de Prueba Gratis</strong>: pedimos la tarjeta ahora y no se cobra nada si cancelas antes del día 15. Durante la prueba: hasta 50 mensajes de WhatsApp.</li>}
            <li>Sin permanencia</li>
            <li>Garantía de devolución de 30 días</li>
            <li>Pago seguro con Stripe (tarjeta o SEPA)</li>
          </ul>
          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn" onClick={guard(checkout)} disabled={busy || !tenantId || (plan === 'founder' && (!commit || founderFull))}>{busy ? 'Abriendo pago…' : plan === 'starter' ? 'Empezar mis 14 días gratis' : plan === 'founder' ? 'Reservar mi plaza de fundador · 59 €' : 'Ir al pago seguro'}</button>
        </section>
      )}
    </main>
  );
}
