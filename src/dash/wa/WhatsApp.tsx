// WhatsApp module shell: sub-navigation (Bandeja · Recepcionista IA · Ajustes), emergency-pause banner and
// the trial quota bar, in the production WhatsApp Inbox Pro look (deep green header, dark chat surfaces).
import { useCallback, useEffect, useState } from 'react';
import { Bot, Inbox as InboxIcon, OctagonAlert, Settings as Cog } from 'lucide-react';
import { mod } from '../api';
import { cx, useDash } from '../ui';
import Inbox from './Inbox';
import AiPanel from './AiPanel';
import Settings, { QuotaBar } from './Settings';

export type WaSettings = {
  connected: boolean; trade_name?: string; wa_display_phone?: string; wa_phone_number_id?: string; ai_autoreply_mode?: string; wa_fallback_template?: string;
  wa_fallback_template_lang?: string; has_token?: boolean; wa_paused?: boolean; wa_quality_rating?: string | null; google_review_url?: string | null;
  opening_hours?: Record<string, [string, string][]> | null; ai_min_confidence?: number; ai_daily_cap?: number; ai_persona_prompt?: string; wa_daily_cap?: number;
  ai_blocked_categories?: string[]; built_in_blocked_categories?: string[]; categories?: string[];
};
export type Quota = { ok: boolean; trial?: boolean; usedInTrial?: number; remainingInTrial?: number | null; error?: string; reason?: string };
type View = 'inbox' | 'ai' | 'settings';

export default function WhatsApp() {
  const { ctx, nav } = useDash();
  const [settings, setSettings] = useState<WaSettings | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [view, setView] = useState<View>('inbox');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await mod<WaSettings>('whatsapp', ctx, 'settings');
    setSettings(s);
    setQuota(await mod<Quota>('whatsapp', ctx, 'quota').catch(() => null));
    return s;
  }, [ctx]);

  useEffect(() => {
    load().then((s) => { if (!s.connected) setView('settings'); }).catch((e) => setErr((e as Error).message));
  }, [load]);

  if (!settings) return <div className="theme-wa h-full p-6 text-wa-muted">{err ?? 'Cargando WhatsApp…'}</div>;

  const TABS: [View, string, typeof Cog][] = [['inbox', 'Bandeja', InboxIcon], ['ai', 'Recepcionista IA', Bot], ['settings', 'Ajustes', Cog]];
  return (
    <div className="theme-wa flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-wa-deep px-4 py-2.5">
        <h1 className="text-base font-bold text-white">WhatsApp <span className="text-wa-green">Pro</span></h1>
        <nav className="flex gap-1" role="tablist" aria-label="WhatsApp">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} disabled={k === 'inbox' && !settings.connected} onClick={() => setView(k)}
              className={cx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40', view === k ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10')}>
              <Icon size={15} /> {label}
              {k === 'ai' && settings.ai_autoreply_mode && settings.ai_autoreply_mode !== 'off' && (
                <span className={cx('ml-1 rounded px-1.5 text-[10px] font-bold uppercase', settings.ai_autoreply_mode === 'live' ? 'bg-wa-green text-wa-dark' : 'bg-sky-400 text-slate-900')}>{settings.ai_autoreply_mode === 'live' ? 'Activa' : 'Prueba'}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="ml-auto"><QuotaBar quota={quota} /></div>
      </header>
      {settings.wa_paused && (
        <div className="flex items-center gap-2 bg-red-600 px-4 py-1.5 text-sm font-semibold text-white" role="alert"><OctagonAlert size={16} /> Los envíos están pausados: no sale ningún mensaje. Reanúdalos en Ajustes.</div>
      )}
      {quota && !quota.ok && (quota.reason === 'trial_expired' || quota.reason === 'no_plan' || quota.reason === 'trial_cap') && (
        <div className="flex flex-wrap items-center gap-3 bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white" role="alert">
          <span>{quota.error}</span><a className="rounded bg-white px-3 py-0.5 text-amber-800" href="/onboarding/">Elegir plan</a>
        </div>
      )}
      {err && <div className="bg-red-900/60 px-4 py-1.5 text-sm text-red-100" role="alert">{err}</div>}
      <div className="min-h-0 flex-1">
        {view === 'inbox' && <Inbox openPhone={nav.phone} templateName={settings.wa_fallback_template} />}
        {view === 'ai' && <AiPanel settings={settings} onChange={() => { load().catch(() => {}); }} />}
        {view === 'settings' && <Settings settings={settings} quota={quota} onSaved={() => { load().catch(() => {}); }} />}
      </div>
    </div>
  );
}
