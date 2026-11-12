'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Step = 1 | 2 | 3;
type Plan = 'starter' | 'pro';
const DPA_VERSION = 'dpa-v1-2026-11';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const cleanNif = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export default function Onboarding() {
  // Lazy: never construct the client during server prerender (no env at build time).
  const sb = supabaseBrowser;
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // step 1
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
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

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('plan') === 'pro') setPlan('pro');
    (async () => {
      const { data } = await sb().auth.getSession();
      const uid = data.session?.user.id;
      if (uid) await routeLoggedIn(uid);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function routeLoggedIn(uid: string) {
    const { data } = await sb().from('tenant_users').select('tenant_id').eq('user_id', uid).eq('role', 'owner').limit(1).maybeSingle();
    if (data?.tenant_id) {
      setTenantId(data.tenant_id);
      setStep(3);
    } else {
      setStep(2);
    }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    const { error } = await sb().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setErr('No hemos podido enviar el código. Revisa el email e inténtalo de nuevo.');
    else setCodeSent(true);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    const { data, error } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error || !data.user) return setErr('Código incorrecto o caducado. Pide uno nuevo.');
    await routeLoggedIn(data.user.id);
  }

  async function createShop(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const n = cleanNif(nif);
    if (n && !/^[A-Z0-9]{9}$/.test(n)) return setErr('El NIF/CIF debe tener 9 caracteres (ej. 12345678Z o B12345678).');
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return setErr('La dirección debe tener entre 3 y 40 letras, números o guiones.');
    if (!dpa) return setErr('Necesitamos que aceptes el contrato de Encargado del Tratamiento para guardar los datos de tus clientes.');
    setBusy(true);
    const { data: id, error } = await sb().rpc('create_tenant', {
      p_trade_name: tradeName.trim(), p_slug: slug, p_nif: n || null, p_printer_width: printer,
    });
    if (error || !id) {
      setBusy(false);
      if (error?.code === '23505') return setErr('Esa dirección ya existe. Prueba otra.');
      if (error?.code === '23514') return setErr('Revisa el NIF/CIF: el formato no es válido.');
      return setErr('No hemos podido crear tu taller. Inténtalo de nuevo.');
    }
    const tid = id as string;
    const [dpaRes, updRes] = await Promise.all([
      sb().rpc('accept_dpa', { p_tenant: tid, p_version: DPA_VERSION }),
      sb().from('tenants').update({ is_autonomo: isAutonomo }).eq('id', tid),
    ]);
    setBusy(false);
    if (dpaRes.error || updRes.error) return setErr('Taller creado, pero no hemos podido guardar el contrato. Vuelve a intentarlo.');
    setTenantId(tid);
    setStep(3);
  }

  async function checkout() {
    setErr(null); setBusy(true);
    const { data } = await sb().auth.getSession();
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify({ tenantId, plan }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.url) {
      window.location.href = out.url;
    } else {
      setBusy(false);
      setErr(out.error ?? 'No hemos podido abrir el pago. Inténtalo de nuevo.');
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
          {!codeSent ? (
            <form onSubmit={sendCode}>
              <label htmlFor="email">Tu email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className="small muted">Te enviamos un código de 6 dígitos. Sin contraseñas.</p>
              {err && <div className="alert err" role="alert">{err}</div>}
              <button className="btn" disabled={busy || !email.includes('@')}>{busy ? 'Enviando…' : 'Enviarme el código'}</button>
            </form>
          ) : (
            <form onSubmit={verifyCode}>
              <label htmlFor="code">Código que te hemos enviado a {email}</label>
              <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={10} required
                     value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              {err && <div className="alert err" role="alert">{err}</div>}
              <button className="btn" disabled={busy || code.length < 6}>{busy ? 'Comprobando…' : 'Continuar'}</button>
              <p className="small"><button type="button" className="btn secondary" onClick={() => setCodeSent(false)}>Cambiar email</button></p>
            </form>
          )}
        </section>
      )}

      {step === 2 && (
        <form className="card" style={{ padding: 24 }} onSubmit={createShop}>
          <h2>Tu taller</h2>
          <label htmlFor="name">Nombre comercial</label>
          <input id="name" type="text" required maxLength={120} value={tradeName}
                 onChange={(e) => { setTradeName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />

          <label htmlFor="slug">Dirección de tu panel</label>
          <input id="slug" type="text" required value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
          <p className="small muted">tallersaas.es/t/<strong>{slug || 'tu-taller'}</strong></p>

          <label htmlFor="nif">NIF / CIF <span className="small muted">(sale impreso en tu resguardo)</span></label>
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
          <div className="choices" style={{ gridTemplateColumns: '1fr' }}>
            <label className={`choice ${plan === 'starter' ? 'on' : ''}`}>
              <input type="radio" name="plan" checked={plan === 'starter'} onChange={() => setPlan('starter')} />
              Starter · <strong>29 €/mes</strong>
              <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>Resguardos, etiquetas, avisos de WhatsApp y reseñas.</span>
            </label>
            <label className={`choice ${plan === 'pro' ? 'on' : ''}`}>
              <input type="radio" name="plan" checked={plan === 'pro'} onChange={() => setPlan('pro')} />
              Pro · <strong>69 €/mes</strong>
              <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>Todo Starter + técnicos, asistente IA, TPV y cierre de caja.</span>
            </label>
          </div>
          <ul className="ticks small">
            <li>Sin permanencia</li>
            <li>Garantía de devolución de 30 días</li>
            <li>Pago seguro con Stripe (tarjeta o SEPA)</li>
          </ul>
          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn" onClick={checkout} disabled={busy || !tenantId}>{busy ? 'Abriendo pago…' : 'Ir al pago seguro'}</button>
        </section>
      )}
    </main>
  );
}
