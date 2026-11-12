'use client';
import Script from 'next/script';
import { useState } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'ok'; note?: string } | { kind: 'err'; msg: string };

export default function DemoSimulator() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [consentDemo, setConsentDemo] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setState({ kind: 'sending' });
    try {
      const res = await fetch('/api/demo/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: fd.get('phone'),
          shop: fd.get('shop'),
          consentDemo: fd.get('consentDemo') === 'on',
          consentCall: fd.get('consentCall') === 'on',
          turnstileToken: fd.get('cf-turnstile-response') ?? '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setState({ kind: 'ok', note: data.note });
      else setState({ kind: 'err', msg: data.error ?? 'No hemos podido enviarlo ahora. Inténtalo en unos minutos.' });
    } catch {
      setState({ kind: 'err', msg: 'Sin conexión. Inténtalo de nuevo.' });
    }
  }

  if (state.kind === 'ok') {
    return (
      <div className="card" id="demo" aria-live="polite">
        <h3>📲 Mira tu WhatsApp</h3>
        <p>{state.note ?? 'Así lo verá tu cliente cuando su iPhone esté listo.'}</p>
        <p className="muted">¿Te imaginas no tener que coger el teléfono para esto nunca más?</p>
        <a className="btn" href="/onboarding">Quiero esto en mi taller →</a>
      </div>
    );
  }

  return (
    <form className="card" id="demo" onSubmit={onSubmit} noValidate>
      {SITE_KEY && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />}
      <h3>Recibe ahora el aviso que recibirían tus clientes</h3>

      <label htmlFor="phone">Tu móvil</label>
      <div className="phone">
        <span>+34</span>
        <input id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel-national"
               placeholder="6__ ___ ___" required />
      </div>

      <label htmlFor="shop">Nombre de tu taller <span className="muted small">(sale en el mensaje)</span></label>
      <input id="shop" name="shop" type="text" maxLength={40} placeholder="Reparaciones Ejemplo" />

      <label className="check">
        <input type="checkbox" name="consentDemo" checked={consentDemo} onChange={(e) => setConsentDemo(e.target.checked)} />
        <span><strong>Quiero recibir un único WhatsApp de demostración en este número.</strong> (obligatoria)</span>
      </label>
      <label className="check">
        <input type="checkbox" name="consentCall" />
        <span>Acepto que me llamen para enseñarme el programa (opcional; una persona o un asistente de voz con IA identificado como tal).</span>
      </label>

      {SITE_KEY && <div className="cf-turnstile" data-sitekey={SITE_KEY} data-language="es" style={{ margin: '12px 0' }} />}

      {state.kind === 'err' && <div className="alert err" role="alert">{state.msg}</div>}

      <button className="btn" type="submit" disabled={!consentDemo || state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Enviando…' : 'Enviarme el WhatsApp de prueba'}
      </button>
      <p className="small muted">
        Usamos tu número solo para esta demo y, si marcas la segunda casilla, para una llamada. Puedes oponerte en cualquier
        momento. <a href="/privacidad">Política de privacidad</a>
      </p>
    </form>
  );
}
