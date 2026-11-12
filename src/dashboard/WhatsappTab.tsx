// WhatsApp tab — port of WhatsApp Inbox Pro's 3-pane inbox (conversations · thread · customer & AI panel),
// the AI receptionist mode switch, and a connection setup screen.
import { useCallback, useEffect, useRef, useState } from 'react';
import { mod, when, type Ctx } from './api';

type Conv = { id: string; name: string | null; phone: string | null; preview: string | null; last_message_at: string; unread: boolean; unread_count: number; automation_paused: boolean; window_open: boolean };
type Msg = { id: string; direction: string; sender_type: string; body: string | null; status: string; sent_at: string; reaction_emoji?: string | null };
type Settings = { connected: boolean; trade_name?: string; wa_display_phone?: string; wa_phone_number_id?: string; ai_autoreply_mode?: string; wa_fallback_template?: string; wa_fallback_template_lang?: string; has_token?: boolean };

function Setup({ ctx, settings, onSaved }: { ctx: Ctx; settings: Settings; onSaved: () => void }) {
  const [phoneId, setPhoneId] = useState(settings.wa_phone_number_id ?? '');
  const [display, setDisplay] = useState(settings.wa_display_phone ?? '');
  const [token, setToken] = useState('');
  const [tpl, setTpl] = useState(settings.wa_fallback_template ?? '');
  const [lang, setLang] = useState(settings.wa_fallback_template_lang ?? 'es_ES');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canEdit = ctx.role === 'owner' || ctx.role === 'admin';
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await mod('whatsapp', ctx, 'saveConnection', { phoneNumberId: phoneId, displayPhone: display, accessToken: token || undefined, fallbackTemplate: tpl, fallbackLang: lang });
      setToken('');
      setMsg({ ok: true, text: 'Conexión guardada.' });
      onSaved();
    } catch (e2) { setMsg({ ok: false, text: (e2 as Error).message }); }
  }
  return (
    <form className="card" style={{ padding: 20, maxWidth: 560 }} onSubmit={save}>
      <h3 style={{ marginTop: 0 }}>Conectar tu WhatsApp</h3>
      <p className="small muted">Datos de tu número en WhatsApp Business Platform (Meta → WhatsApp → Configuración de la API). El token se guarda cifrado y nunca se vuelve a mostrar.</p>
      <label htmlFor="pnid">Identificador del número (Phone number ID)</label>
      <input id="pnid" inputMode="numeric" value={phoneId} onChange={(e) => setPhoneId(e.target.value.replace(/\D/g, ''))} disabled={!canEdit} required />
      <label htmlFor="disp">Número visible</label>
      <input id="disp" value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="+34 600 000 000" disabled={!canEdit} />
      <label htmlFor="tok">Token de acceso {settings.has_token && <span className="small muted">(ya guardado; déjalo vacío para mantenerlo)</span>}</label>
      <input id="tok" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} disabled={!canEdit} />
      <label htmlFor="tpl">Plantilla para escribir fuera de las 24 h <span className="small muted">(UTILITY aprobada, 1 variable)</span></label>
      <input id="tpl" value={tpl} onChange={(e) => setTpl(e.target.value)} placeholder="actualizacion_taller" disabled={!canEdit} />
      <label htmlFor="lang">Idioma de la plantilla</label>
      <input id="lang" value={lang} onChange={(e) => setLang(e.target.value)} disabled={!canEdit} />
      {msg && <div className={`alert ${msg.ok ? '' : 'err'}`} role="status">{msg.text}</div>}
      {canEdit ? <button className="btn">Guardar conexión</button> : <p className="small muted">Solo el titular o un administrador pueden cambiar la conexión.</p>}
      <p className="small muted">URL del webhook para Meta: <code>{location.origin}/functions/whatsappWebhook</code></p>
    </form>
  );
}

function AiMode({ ctx, mode, onChange }: { ctx: Ctx; mode: string; onChange: (m: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const canEdit = ctx.role === 'owner' || ctx.role === 'admin';
  const set = async (m: string) => {
    setErr(null);
    try { await mod('whatsapp', ctx, 'setAiMode', { mode: m }); onChange(m); } catch (e) { setErr((e as Error).message); }
  };
  const label: Record<string, string> = { off: 'Apagado', shadow: 'Modo prueba (no envía)', live: 'Activo (responde solo)' };
  return (
    <div className="ai-mode">
      <span className="small"><strong>Recepcionista IA:</strong></span>
      {(['off', 'shadow', 'live'] as const).map((m) => (
        <button key={m} type="button" className={`chip ${mode === m ? 'on' : ''}`} disabled={!canEdit} onClick={() => set(m)}>{label[m]}</button>
      ))}
      {err && <span className="small" style={{ color: '#b00020' }}>{err}</span>}
    </div>
  );
}

export default function WhatsappTab({ ctx }: { ctx: Ctx }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<'inbox' | 'setup'>('inbox');
  const [convs, setConvs] = useState<Conv[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [text, setText] = useState('');
  const [quota, setQuota] = useState<{ remainingInTrial?: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadSettings = useCallback(async () => {
    const s = await mod<Settings>('whatsapp', ctx, 'settings');
    setSettings(s);
    if (!s.connected) setView('setup');
  }, [ctx]);
  const loadConvs = useCallback(async () => {
    setConvs((await mod<{ conversations: Conv[] }>('whatsapp', ctx, 'listConversations')).conversations);
  }, [ctx]);
  const loadThread = useCallback(async (id: string) => {
    const r = await mod<{ messages: Msg[]; draft: string | null }>('whatsapp', ctx, 'getMessages', { conversationId: id });
    setMsgs(r.messages);
    setDraft(r.draft ?? '');
    await mod('whatsapp', ctx, 'markRead', { conversationId: id }).catch(() => {});
  }, [ctx]);

  useEffect(() => {
    loadSettings().then(loadConvs).catch((e) => setErr((e as Error).message));
    mod<{ remainingInTrial?: number | null }>('whatsapp', ctx, 'quota').then(setQuota).catch(() => {});
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadConvs().catch(() => {}); }, 20000);
    return () => clearInterval(t);
  }, [ctx, loadSettings, loadConvs]);
  useEffect(() => { if (sel) loadThread(sel).catch((e) => setErr((e as Error).message)); }, [sel, loadThread]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const conv = convs.find((c) => c.id === sel) ?? null;

  async function send(body: string) {
    if (!sel || !body.trim()) return;
    setBusy(true); setErr(null);
    try {
      await mod('whatsapp', ctx, 'send', { conversationId: sel, text: body });
      setText('');
      await loadThread(sel);
      await loadConvs();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function aiDraft() {
    if (!sel) return;
    setBusy(true); setErr(null);
    try { setDraft((await mod<{ draft: { reply: string } }>('whatsapp', ctx, 'draft', { conversationId: sel, agentInput: text || undefined })).draft.reply); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function pause(p: boolean) {
    if (!sel) return;
    await mod('whatsapp', ctx, 'pause', { conversationId: sel, paused: p }).catch((e) => setErr((e as Error).message));
    await loadConvs();
  }

  if (!settings) return <p className="muted">{err ?? 'Cargando WhatsApp…'}</p>;
  return (
    <div>
      <div className="tab-bar">
        <button className={`chip ${view === 'inbox' ? 'on' : ''}`} onClick={() => setView('inbox')} disabled={!settings.connected}>Bandeja</button>
        <button className={`chip ${view === 'setup' ? 'on' : ''}`} onClick={() => setView('setup')}>Conexión</button>
        <AiMode ctx={ctx} mode={settings.ai_autoreply_mode ?? 'off'} onChange={(m) => setSettings({ ...settings, ai_autoreply_mode: m })} />
        {quota?.remainingInTrial != null && <span className="small muted">Prueba: quedan {quota.remainingInTrial} mensajes</span>}
      </div>
      {err && <div className="alert err" role="alert">{err}</div>}
      {view === 'setup' && <Setup ctx={ctx} settings={settings} onSaved={() => { loadSettings().then(loadConvs).catch(() => {}); }} />}
      {view === 'inbox' && (
        <div className="inbox">
          <aside className="pane list">
            {convs.length === 0 && <p className="small muted" style={{ padding: 12 }}>Aún no hay conversaciones. Cuando un cliente te escriba aparecerá aquí.</p>}
            {convs.map((c) => (
              <button key={c.id} className={`conv ${sel === c.id ? 'on' : ''}`} onClick={() => setSel(c.id)}>
                <strong>{c.name || (c.phone ? `+${c.phone}` : 'Cliente')}</strong>
                {c.unread && <span className="badge">{c.unread_count}</span>}
                <span className="small muted">{c.preview}</span>
                <span className="small muted">{when(c.last_message_at)}</span>
              </button>
            ))}
          </aside>
          <section className="pane thread">
            {!conv ? <p className="muted" style={{ padding: 16 }}>Elige una conversación.</p> : (
              <>
                <div className="msgs">
                  {msgs.map((m) => (
                    <div key={m.id} className={`bubble ${m.direction === 'inbound' ? 'in' : 'out'} ${m.sender_type === 'ai_bot' ? 'ai' : ''}`}>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.status === 'blocked_opt_out' ? '— bloqueado: el cliente pidió la BAJA —' : m.body}</div>
                      <div className="small muted">{m.sender_type === 'ai_bot' ? 'IA · ' : ''}{when(m.sent_at)}{m.direction === 'outbound' ? ` · ${m.status}` : ''}{m.reaction_emoji ? ` · ${m.reaction_emoji}` : ''}</div>
                    </div>
                  ))}
                  <div ref={bottom} />
                </div>
                <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
                  <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={conv.window_open ? 'Escribe un mensaje…' : 'Ventana de 24 h cerrada: se enviará con la plantilla'} />
                  <button className="btn inline" disabled={busy || !text.trim()}>{busy ? 'Enviando…' : 'Enviar'}</button>
                </form>
              </>
            )}
          </section>
          <aside className="pane side">
            {conv && (
              <>
                <h4 style={{ marginTop: 0 }}>{conv.name || 'Cliente'}</h4>
                <p className="small">{conv.phone ? `+${conv.phone}` : ''}</p>
                <p className="small muted">{conv.window_open ? 'Ventana de 24 h abierta' : 'Fuera de la ventana de 24 h'}</p>
                <label className="check"><input type="checkbox" checked={conv.automation_paused} onChange={(e) => pause(e.target.checked)} /><span>Atiendo yo (pausar la IA)</span></label>
                <button type="button" className="btn secondary" disabled={busy} onClick={aiDraft}>{text ? 'Mejorar mi borrador con IA' : 'Sugerir respuesta con IA'}</button>
                {draft && (
                  <div className="card" style={{ padding: 10, marginTop: 8 }}>
                    <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{draft}</p>
                    <button type="button" className="btn inline" onClick={() => setText(draft)}>Usar</button>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
