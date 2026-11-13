// AI receptionist control room: mode (off / shadow / live), thresholds, blocked topics and the decision log.
import { useCallback, useEffect, useState } from 'react';
import { Bot, Eye, Lock, Power, Zap } from 'lucide-react';
import { mod, when } from '../api';
import { Alert, canAdmin, cx, useDash } from '../ui';
import type { WaSettings } from './WhatsApp';

type Log = { id: string; created_date: string; customer: string | null; mode: string; decision: string; reasons: string[]; category: string | null; confidence: number | null };

export const CATEGORY_LABEL: Record<string, string> = {
  faq: 'Preguntas frecuentes', pricing: 'Precios', service: 'Servicios', policy: 'Políticas del taller', repair_status: 'Estado de una reparación',
  complaint: 'Quejas', warranty: 'Garantía', quote_negotiation: 'Negociar presupuesto', other: 'Otros / no clasificado',
};

const MODES: { key: string; title: string; text: string; Icon: typeof Power }[] = [
  { key: 'off', title: 'Apagado', text: 'La IA no hace nada. Tú contestas todo.', Icon: Power },
  { key: 'shadow', title: 'Modo prueba', text: 'Prepara respuestas y las apunta en el registro, pero NO envía nada al cliente.', Icon: Eye },
  { key: 'live', title: 'Activo', text: 'Responde sola cuando está segura y el tema está permitido. El resto te lo deja a ti.', Icon: Zap },
];

export function explain(reason: string): string {
  let m = reason.match(/^confidence_([\d.]+)_below_([\d.]+)$/);
  if (m) return `Confianza ${Math.round(+m[1] * 100)} % por debajo del mínimo (${Math.round(+m[2] * 100)} %)`;
  m = reason.match(/^category_(\w+)_blocked$/);
  if (m) return `Tema bloqueado: ${CATEGORY_LABEL[m[1]] ?? m[1]}`;
  m = reason.match(/^send_failed:(.+)$/);
  if (m) return `Fallo al enviar (${m[1]})`;
  return ({
    requires_human: 'La IA pide que conteste una persona', daily_cap_exceeded: 'Límite diario de respuestas automáticas alcanzado',
    automation_paused: 'Conversación pausada: atiende una persona', per_conversation_disabled: 'IA desactivada en esta conversación',
  } as Record<string, string>)[reason] ?? reason;
}

const DECISION: Record<string, { label: string; cls: string }> = {
  sent: { label: 'Enviada', cls: 'bg-emerald-500/20 text-emerald-300' },
  would_send: { label: 'Habría enviado', cls: 'bg-sky-500/20 text-sky-300' },
  blocked: { label: 'Bloqueada', cls: 'bg-amber-500/20 text-amber-300' },
};

export default function AiPanel({ settings, onChange }: { settings: WaSettings; onChange: () => void }) {
  const { ctx } = useDash();
  const admin = canAdmin(ctx);
  const [mode, setMode] = useState(settings.ai_autoreply_mode ?? 'off');
  const [conf, setConf] = useState(Math.round((settings.ai_min_confidence ?? 0.8) * 100));
  const [cap, setCap] = useState(String(settings.ai_daily_cap ?? 50));
  const [persona, setPersona] = useState(settings.ai_persona_prompt ?? '');
  const [extra, setExtra] = useState<string[]>(settings.ai_blocked_categories ?? []);
  const [log, setLog] = useState<Log[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'sent' | 'would_send' | 'blocked'>('all');

  const loadLog = useCallback(async () => setLog((await mod<{ log: Log[] }>('whatsapp', ctx, 'aiLog')).log), [ctx]);
  useEffect(() => { loadLog().catch((e) => setMsg({ ok: false, text: (e as Error).message })); }, [loadLog]);

  async function pick(m: string) {
    setMsg(null);
    try { await mod('whatsapp', ctx, 'setAiMode', { mode: m }); setMode(m); onChange(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  async function save() {
    setMsg(null);
    try {
      await mod('whatsapp', ctx, 'saveSettings', { settings: { ai_min_confidence: conf / 100, ai_daily_cap: Number(cap), ai_persona_prompt: persona, ai_blocked_categories: extra } });
      setMsg({ ok: true, text: 'Reglas guardadas.' }); onChange();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  const toggleExtra = (c: string) => setExtra((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]));
  const builtIn = settings.built_in_blocked_categories ?? [];
  const optional = (settings.categories ?? []).filter((c) => !builtIn.includes(c));
  const rows = (log ?? []).filter((l) => filter === 'all' || l.decision === filter);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-5xl space-y-6">
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Bot size={20} className="text-wa-green" /> Recepcionista IA</h2>
          <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Modo de la recepcionista">
            {MODES.map(({ key, title, text, Icon }) => (
              <button key={key} type="button" role="radio" aria-checked={mode === key} disabled={!admin} onClick={() => pick(key)}
                className={cx('rounded-xl border p-4 text-left transition', mode === key ? 'border-wa-green bg-wa-green/10' : 'border-wa-line bg-wa-panel hover:bg-wa-raised', !admin && 'opacity-60')}>
                <span className="flex items-center gap-2 font-semibold"><Icon size={18} className={mode === key ? 'text-wa-green' : 'text-wa-muted'} /> {title}</span>
                <span className="mt-1 block text-xs text-wa-muted">{text}</span>
              </button>
            ))}
          </div>
          {!admin && <p className="mt-2 text-xs text-wa-muted">Solo el titular o un administrador pueden cambiar la IA.</p>}
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-wa-line bg-wa-panel p-4">
            <h3 className="font-semibold">Reglas de seguridad</h3>
            <label className="block text-sm">Confianza mínima para responder sola: <strong>{conf} %</strong>
              <input type="range" min={0} max={100} step={5} value={conf} disabled={!admin} onChange={(e) => setConf(+e.target.value)} className="mt-1 w-full accent-[#25d366]" />
            </label>
            <label className="block text-sm">Respuestas automáticas máximas al día
              <input className="wa-input mt-1" inputMode="numeric" value={cap} disabled={!admin} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="block text-sm">Personalidad y consignas <span className="text-xs text-wa-muted">(opcional)</span>
              <textarea rows={4} className="wa-input mt-1" value={persona} maxLength={2000} disabled={!admin} onChange={(e) => setPersona(e.target.value)} placeholder="Eres el asistente de mi taller. Tutea al cliente, sé breve y nunca prometas plazos." />
            </label>
          </div>
          <div className="space-y-3 rounded-xl border border-wa-line bg-wa-panel p-4">
            <h3 className="font-semibold">Temas que la IA nunca contesta sola</h3>
            <p className="text-xs text-wa-muted">Estos cuatro están siempre bloqueados por seguridad y no se pueden quitar. Si el cliente escribe sobre ellos, te lo deja a ti.</p>
            <div className="flex flex-wrap gap-1.5">
              {builtIn.map((c) => <span key={c} className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300"><Lock size={11} /> {CATEGORY_LABEL[c] ?? c}</span>)}
            </div>
            <p className="pt-1 text-xs text-wa-muted">Bloquear además:</p>
            <div className="flex flex-wrap gap-1.5">
              {optional.map((c) => (
                <button key={c} type="button" disabled={!admin} aria-pressed={extra.includes(c)} onClick={() => toggleExtra(c)}
                  className={cx('rounded-full px-2.5 py-1 text-xs font-medium', extra.includes(c) ? 'bg-amber-500/25 text-amber-200' : 'bg-wa-raised text-wa-muted hover:text-wa-text')}>
                  {extra.includes(c) ? '✓ ' : ''}{CATEGORY_LABEL[c] ?? c}
                </button>
              ))}
            </div>
          </div>
        </section>
        <div className="flex items-center gap-3">
          {admin && <button type="button" className="wa-btn" onClick={save}>Guardar reglas</button>}
          {msg && <Alert kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert>}
        </div>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">Registro de decisiones</h3>
            <span className="text-xs text-wa-muted">No guarda el texto de los mensajes, solo qué decidió y por qué.</span>
            <div className="ml-auto flex gap-1.5">
              {(['all', 'sent', 'would_send', 'blocked'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cx('rounded-full px-2.5 py-1 text-xs', filter === k ? 'bg-wa-green text-wa-dark font-semibold' : 'bg-wa-raised text-wa-muted')}>
                  {k === 'all' ? 'Todas' : DECISION[k].label}
                </button>
              ))}
              <button type="button" className="wa-btn-ghost !px-2 !py-1 text-xs" onClick={() => loadLog()}>Actualizar</button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-wa-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-wa-raised text-xs uppercase text-wa-muted"><tr><th className="px-3 py-2">Cuándo</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Decisión</th><th className="px-3 py-2">Tema</th><th className="px-3 py-2">Confianza</th><th className="px-3 py-2">Motivo</th></tr></thead>
              <tbody>
                {log === null && <tr><td colSpan={6} className="px-3 py-4 text-wa-muted">Cargando…</td></tr>}
                {log !== null && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-wa-muted">Todavía no hay decisiones registradas.</td></tr>}
                {rows.map((l) => (
                  <tr key={l.id} className="border-t border-wa-line align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-wa-muted">{when(l.created_date)}</td>
                    <td className="px-3 py-2">{l.customer ?? '—'}</td>
                    <td className="px-3 py-2"><span className={cx('rounded px-2 py-0.5 text-xs font-semibold', (DECISION[l.decision] ?? DECISION.blocked).cls)}>{(DECISION[l.decision] ?? { label: l.decision }).label}</span></td>
                    <td className="px-3 py-2 text-xs">{CATEGORY_LABEL[l.category ?? ''] ?? l.category ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{l.confidence != null ? `${Math.round(l.confidence * 100)} %` : '—'}</td>
                    <td className="px-3 py-2 text-xs text-wa-muted">{l.reasons.length ? l.reasons.map(explain).join(' · ') : 'Cumplía todas las reglas'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
