// Sign-in pages — port of the live Reparo app's Login / Register / ForgotPassword / ResetPassword
// (email + password with an emailed 6-digit code, Google, password reset), in Spanish and on the same
// paths, because Base44's redirectToLogin() and its reset-password e-mails point at them.
import { useState, type FormEvent, type ReactNode } from 'react';
import { base44, storeToken } from '@/lib/base44';

const NET_ERR = 'No hemos podido conectar con el servidor. Revisa tu conexión e inténtalo de nuevo en unos minutos.';

/**
 * Where to go after signing in: ?returnTo=/path or the SDK's ?from_url=<full URL>, same origin only.
 * Port of Reparo safeReturnTo(): a value like /.//evil.com or /\evil.com parses same-origin but becomes a
 * protocol-relative //evil.com when assigned to location.href, so the path must have exactly one leading slash.
 */
export function safeReturnTo(search = window.location.search, origin = window.location.origin): string {
  const q = new URLSearchParams(search);
  const raw = q.get('returnTo') || q.get('from_url');
  if (!raw) return '/onboarding/';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return '/onboarding/';
    for (const p of ['access_token', 'clear_access_token', 'app_id', 'app_base_url', 'functions_version', 'from_url']) url.searchParams.delete(p);
    const path = url.pathname + url.search;
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/onboarding/';
    return path;
  } catch {
    return '/onboarding/';
  }
}

const withReturn = (path: string) => {
  const r = safeReturnTo();
  return r === '/onboarding/' ? path : `${path}?returnTo=${encodeURIComponent(r)}`;
};

const msg = (e: unknown, fallback: string) => {
  const m = (e as { message?: string; response?: { data?: { message?: string; detail?: string } } }) ?? {};
  const text = m.response?.data?.message || m.response?.data?.detail || m.message || '';
  if (/network|fetch/i.test(text)) return NET_ERR;
  return text && text.length < 200 ? text : fallback;
};

function Shell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="wrap" style={{ maxWidth: 440, padding: '40px 16px 64px' }}>
      <p className="small"><a href="/">← Taller SaaS</a></p>
      <section className="card" style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </section>
      {footer && <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>{footer}</p>}
    </main>
  );
}

function GoogleButton({ label }: { label: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn secondary" style={{ width: '100%' }}
              onClick={() => { try { base44().auth.loginWithProvider('google', safeReturnTo()); } catch (e) { setErr(msg(e, NET_ERR)); } }}>
        {label}
      </button>
      {err && <div className="alert err" role="alert">{err}</div>}
      <p className="small muted" style={{ textAlign: 'center', margin: '16px 0 8px' }}>o con tu email</p>
    </>
  );
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await base44().auth.loginViaEmailPassword(email.trim(), password) as { access_token?: string } | undefined;
      if (r?.access_token) storeToken(r.access_token);
      window.location.href = safeReturnTo();
    } catch (e2) {
      setErr(msg(e2, 'Email o contraseña incorrectos.'));
      setBusy(false);
    }
  }

  return (
    <Shell title="Entrar" subtitle="Accede a tu taller." footer={<>¿No tienes cuenta? <a href={withReturn('/register/')}>Crear cuenta</a></>}>
      <GoogleButton label="Entrar con Google" />
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="small"><a href="/forgot-password/">¿Has olvidado la contraseña?</a></p>
        {err && <div className="alert err" role="alert">{err}</div>}
        <button className="btn" disabled={busy || !email.includes('@') || !password}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </Shell>
  );
}

export function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirm) return setErr('Las contraseñas no coinciden.');
    setBusy(true);
    try {
      await base44().auth.register({ email: email.trim(), password });
      setStep('code');
    } catch (e2) {
      setErr(msg(e2, 'No hemos podido crear la cuenta. Inténtalo de nuevo.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await base44().auth.verifyOtp({ email: email.trim(), otpCode: code.trim() }) as { access_token?: string } | undefined;
      if (r?.access_token) storeToken(r.access_token);
      window.location.href = safeReturnTo();
    } catch (e2) {
      setErr(msg(e2, 'Código incorrecto o caducado.'));
      setBusy(false);
    }
  }

  async function resend() {
    setErr(null); setInfo(null);
    try {
      await base44().auth.resendOtp(email.trim());
      setInfo('Te hemos enviado un código nuevo.');
    } catch (e2) {
      setErr(msg(e2, 'No hemos podido reenviar el código.'));
    }
  }

  if (step === 'code') {
    return (
      <Shell title="Confirma tu email" subtitle={`Hemos enviado un código de 6 dígitos a ${email}.`}>
        <form onSubmit={verify}>
          <label htmlFor="code">Código</label>
          <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required
                 value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          {err && <div className="alert err" role="alert">{err}</div>}
          {info && <div className="alert" role="status">{info}</div>}
          <button className="btn" disabled={busy || code.length < 6}>{busy ? 'Comprobando…' : 'Confirmar'}</button>
          <p className="small">¿No te ha llegado? <button type="button" className="btn secondary inline" onClick={resend}>Reenviar código</button></p>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="Crear cuenta" subtitle="Para dar de alta tu taller." footer={<>¿Ya tienes cuenta? <a href={withReturn('/login/')}>Entrar</a></>}>
      <GoogleButton label="Continuar con Google" />
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Contraseña <span className="small muted">(mínimo 8 caracteres)</span></label>
        <input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <label htmlFor="confirm">Repite la contraseña</label>
        <input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <div className="alert err" role="alert">{err}</div>}
        <button className="btn" disabled={busy || !email.includes('@')}>{busy ? 'Creando cuenta…' : 'Crear cuenta'}</button>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await base44().auth.resetPasswordRequest(email.trim()); } catch { /* same answer whether or not the account exists */ }
    setBusy(false);
    setSent(true);
  }

  return (
    <Shell title="Recuperar contraseña" subtitle="Te enviamos un enlace para crear una nueva." footer={<a href="/login/">← Volver a entrar</a>}>
      {sent ? (
        <p>Si existe una cuenta con ese email, en unos minutos recibirás el enlace para cambiar la contraseña.</p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" disabled={busy || !email.includes('@')}>{busy ? 'Enviando…' : 'Enviar enlace'}</button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const resetToken = new URLSearchParams(window.location.search).get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirm) return setErr('Las contraseñas no coinciden.');
    setBusy(true);
    try {
      await base44().auth.resetPassword({ resetToken: String(resetToken), newPassword: password });
      window.location.href = '/login/';
    } catch (e2) {
      setErr(msg(e2, 'No hemos podido cambiar la contraseña. Pide un enlace nuevo.'));
      setBusy(false);
    }
  }

  if (!resetToken) {
    return (
      <Shell title="Enlace no válido" footer={<a href="/forgot-password/">Pedir un enlace nuevo</a>}>
        <p>El enlace está incompleto o ha caducado.</p>
      </Shell>
    );
  }
  return (
    <Shell title="Nueva contraseña">
      <form onSubmit={submit}>
        <label htmlFor="password">Nueva contraseña</label>
        <input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <label htmlFor="confirm">Repite la contraseña</label>
        <input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <div className="alert err" role="alert">{err}</div>}
        <button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
      </form>
    </Shell>
  );
}
