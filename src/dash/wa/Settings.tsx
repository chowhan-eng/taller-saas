// WhatsApp settings: Meta connection, opening hours, daily cap, Google review link, trial quota and the
// emergency pause. Tokens are write-only (stored encrypted, never shown again).
import { useState } from 'react';
import { OctagonAlert, Plug } from 'lucide-react';
import { mod } from '../api';
import { Alert, canAdmin, cx, useDash } from '../ui';
import type { Quota, WaSettings } from './WhatsApp';

const DAYS: [string, string][] = [['mon', 'Lunes'], ['tue', 'Martes'], ['wed', 'Miércoles'], ['thu', 'Jueves'], ['fri', 'Viernes'], ['sat', 'Sábado'], ['sun', 'Domingo']];
type Hours = Record<string, [string, string][]>;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 rounded-xl border border-wa-line bg-wa-panel p-4"><h3 className="font-semibold">{title}</h3>{children}</section>;
}

export function QuotaBar({ quota }: { quota: Quota | null }) {
  if (!quota || !quota.ok || !quota.trial) return null;
  const used = quota.usedInTrial ?? 0, total = used + (quota.remainingInTrial ?? 0);
  const pct = Math.min(100, Math.round((used / Math.max(1, total)) * 100));
  return (
    <div className="min-w-[180px]" title="Mensajes de WhatsApp de la prueba gratuita">
      <div className="flex justify-between text-[11px] text-wa-muted"><span>Prueba gratuita</span><span>{used}/{total}</span></div>
      <div className="h-1.5 overflow-hidden rounded bg-wa-line"><div className={cx('h-full', pct >= 90 ? 'bg-red-400' : pct >= 70 ? 'bg-amber-400' : 'bg-wa-green')} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function Settings({ settings, quota, onSaved }: { settings: WaSettings; quota: Quota | null; onSaved: () => void }) {
  const { ctx } = useDash();
  const admin = canAdmin(ctx);
  const [phoneId, setPhoneId] = useState(settings.wa_phone_number_id ?? '');
  const [display, setDisplay] = useState(settings.wa_display_phone ?? '');
  const [token, setToken] = useState('');
  const [tpl, setTpl] = useState(settings.wa_fallback_template ?? '');
  const [lang, setLang] = useState(settings.wa_fallback_template_lang ?? 'es_ES');
  const [hours, setHours] = useState<Hours>(() => {
    const base = (settings.opening_hours ?? {}) as Hours;
    return Object.fromEntries(DAYS.map(([k]) => [k, Array.isArray(base[k]) ? base[k].map((r) => [r[0], r[1]] as [string, string]) : []]));
  });
  const [cap, setCap] = useState(String(settings.wa_daily_cap ?? 250));
  const [review, setReview] = useState(settings.google_review_url ?? '');
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const say = (k: string, ok: boolean, text: string) => setMsg((m) => ({ ...m, [k]: { ok, text } }));

  async function saveConn(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mod('whatsapp', ctx, 'saveConnection', { phoneNumberId: phoneId, displayPhone: display, accessToken: token || undefined, fallbackTemplate: tpl, fallbackLang: lang });
      setToken(''); say('conn', true, 'Conexión guardada.'); onSaved();
    } catch (e2) { say('conn', false, (e2 as Error).message); }
  }
  async function saveOther(key: string, settingsPatch: Record<string, unknown>) {
    try { await mod('whatsapp', ctx, 'saveSettings', { settings: settingsPatch }); say(key, true, 'Guardado.'); onSaved(); } catch (e) { say(key, false, (e as Error).message); }
  }
  async function togglePause() {
    try { await mod('whatsapp', ctx, 'setPaused', { paused: !settings.wa_paused }); onSaved(); } catch (e) { say('pause', false, (e as Error).message); }
  }
  const setRange = (d: string, i: number, j: 0 | 1, v: string) => setHours((h) => ({ ...h, [d]: h[d].map((r, x) => (x === i ? (j === 0 ? [v, r[1]] : [r[0], v]) : r) as [string, string]) }));
  const Msg = ({ k }: { k: string }) => (msg[k] ? <Alert kind={msg[k].ok ? 'ok' : 'err'}>{msg[k].text}</Alert> : null);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-2">
        <Card title="Envíos de emergencia">
          <p className="text-sm text-wa-muted">Si algo va mal, este botón detiene TODO lo que sale por tu WhatsApp (avisos, respuestas de la IA y mensajes manuales) hasta que lo reactives.</p>
          <button type="button" disabled={!admin} onClick={togglePause}
            className={cx('inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-bold', settings.wa_paused ? 'bg-wa-green text-wa-dark' : 'bg-red-600 text-white hover:bg-red-500', !admin && 'opacity-50')}>
            <OctagonAlert size={18} /> {settings.wa_paused ? 'Envíos PAUSADOS · Reanudar' : 'Pausar todos los envíos'}
          </button>
          <Msg k="pause" />
          {quota && !quota.ok && <Alert kind="warn">{quota.error}</Alert>}
          <QuotaBar quota={quota} />
          <label className="block text-sm">Límite diario de mensajes
            <div className="mt-1 flex gap-2">
              <input className="wa-input" inputMode="numeric" value={cap} disabled={!admin} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} />
              {admin && <button type="button" className="wa-btn" onClick={() => saveOther('cap', { wa_daily_cap: Number(cap) })}>Guardar</button>}
            </div>
          </label>
          <Msg k="cap" />
        </Card>

        <form onSubmit={saveConn} className="contents">
          <Card title="Conexión con WhatsApp Business">
            <p className="flex items-center gap-2 text-xs text-wa-muted"><Plug size={14} className={settings.connected ? 'text-wa-green' : 'text-amber-300'} /> {settings.connected ? `Conectado${settings.wa_display_phone ? ` · ${settings.wa_display_phone}` : ''}` : 'Sin conectar'}{settings.wa_quality_rating ? ` · calidad ${settings.wa_quality_rating}` : ''}</p>
            <label className="block text-sm">Identificador del número (Phone number ID)
              <input className="wa-input mt-1" inputMode="numeric" value={phoneId} disabled={!admin} onChange={(e) => setPhoneId(e.target.value.replace(/\D/g, ''))} required />
            </label>
            <label className="block text-sm">Número visible
              <input className="wa-input mt-1" value={display} disabled={!admin} onChange={(e) => setDisplay(e.target.value)} placeholder="+34 600 000 000" />
            </label>
            <label className="block text-sm">Token de acceso {settings.has_token && <span className="text-xs text-wa-muted">(guardado cifrado; vacío para mantenerlo)</span>}
              <input className="wa-input mt-1" type="password" autoComplete="off" value={token} disabled={!admin} onChange={(e) => setToken(e.target.value)} />
            </label>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <label className="block text-sm">Plantilla fuera de las 24 h
                <input className="wa-input mt-1" value={tpl} disabled={!admin} onChange={(e) => setTpl(e.target.value)} placeholder="actualizacion_taller" />
              </label>
              <label className="block text-sm">Idioma
                <input className="wa-input mt-1" value={lang} disabled={!admin} onChange={(e) => setLang(e.target.value)} />
              </label>
            </div>
            {admin ? <button className="wa-btn">Guardar conexión</button> : <p className="text-xs text-wa-muted">Solo el titular o un administrador pueden cambiar la conexión.</p>}
            <Msg k="conn" />
            <p className="text-xs text-wa-muted">URL del webhook para Meta: <code className="select-all break-all">{location.origin}/functions/whatsappWebhook</code></p>
          </Card>
        </form>

        <Card title="Horario de atención">
          <p className="text-xs text-wa-muted">Fuera de este horario los avisos esperan a que abras. Hasta 3 tramos por día; deja un día vacío para marcarlo cerrado.</p>
          <div className="space-y-1.5">
            {DAYS.map(([k, label]) => (
              <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-20 shrink-0 text-wa-muted">{label}</span>
                {hours[k].length === 0 && <span className="text-xs text-wa-muted">Cerrado</span>}
                {hours[k].map((r, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <input type="time" className="wa-input !w-[104px] !px-2 !py-1" value={r[0]} disabled={!admin} onChange={(e) => setRange(k, i, 0, e.target.value)} />–
                    <input type="time" className="wa-input !w-[104px] !px-2 !py-1" value={r[1]} disabled={!admin} onChange={(e) => setRange(k, i, 1, e.target.value)} />
                    {admin && <button type="button" aria-label="Quitar tramo" className="text-wa-muted hover:text-red-300" onClick={() => setHours((h) => ({ ...h, [k]: h[k].filter((_, x) => x !== i) }))}>✕</button>}
                  </span>
                ))}
                {admin && hours[k].length < 3 && <button type="button" className="text-xs text-wa-green hover:underline" onClick={() => setHours((h) => ({ ...h, [k]: [...h[k], ['10:00', '14:00']] }))}>+ tramo</button>}
              </div>
            ))}
          </div>
          {admin && <button type="button" className="wa-btn" onClick={() => saveOther('hours', { opening_hours: hours })}>Guardar horario</button>}
          <Msg k="hours" />
        </Card>

        <Card title="Reseñas de Google">
          <p className="text-xs text-wa-muted">Enlace directo a tu ficha de Google. Se envía al entregar la reparación.</p>
          <input className="wa-input" value={review} disabled={!admin} onChange={(e) => setReview(e.target.value)} placeholder="https://g.page/r/…/review" />
          {admin && <button type="button" className="wa-btn" onClick={() => saveOther('review', { google_review_url: review })}>Guardar enlace</button>}
          <Msg k="review" />
        </Card>
      </div>
    </div>
  );
}
