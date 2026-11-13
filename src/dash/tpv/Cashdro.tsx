// CashDro bridge ("CashDroPuente"): connection settings (local PC or another PC by IP), live status light,
// machine levels and the float target. Config stays in THIS browser; the bridge must be on in the shop's PC.
import { useCallback, useEffect, useState } from 'react';
import { CircleDot, RefreshCw } from 'lucide-react';
import { cashdro, cashdroEnabled, fromCents, getCashdroConfig, isValidLanIp, saveCashdroConfig, type CashdroConfig } from '@/lib/cashdro';
import { euros } from '../api';
import { cx } from '../ui';

export const FLOAT_KEY = 'taller.tpv.floatTarget';
export const getFloatTarget = () => { try { return Number(localStorage.getItem(FLOAT_KEY)) || 0; } catch { return 0; } };

export type Link = 'off' | 'checking' | 'up' | 'down';
/** Polls the bridge's /health so the toolbar can show a live status light. */
export function useCashdroLink(everyMs = 10000): { link: Link; error: string | null; refresh: () => void } {
  const [link, setLink] = useState<Link>(cashdroEnabled() ? 'checking' : 'off');
  const [error, setError] = useState<string | null>(null);
  const probe = useCallback(async () => {
    if (!cashdroEnabled()) { setLink('off'); setError(null); return; }
    try { await cashdro.health(); setLink('up'); setError(null); } catch (e) { setLink('down'); setError((e as Error).message); }
  }, []);
  useEffect(() => {
    probe();
    const t = setInterval(() => { if (document.visibilityState === 'visible') probe(); }, everyMs);
    return () => clearInterval(t);
  }, [probe, everyMs]);
  return { link, error, refresh: probe };
}

export function LinkLight({ link }: { link: Link }) {
  const m = { off: ['bg-slate-400', 'CashDro apagada'], checking: ['bg-amber-400 animate-pulse', 'CashDro: comprobando'], up: ['bg-emerald-500', 'CashDro conectada'], down: ['bg-red-500', 'CashDro sin conexión'] }[link];
  return <span className="inline-flex items-center gap-1.5 text-xs" title={m[1]}><CircleDot size={13} className={cx('rounded-full text-transparent', m[0])} aria-hidden /> {m[1]}</span>;
}

type Level = { denomination?: number; value?: number; count?: number; quantity?: number };
type Levels = { totals?: { totalCents?: number; cashCents?: number }; recyclers?: Level[]; cassettes?: Level[] } & Record<string, unknown>;

export default function CashdroPanel() {
  const [c, setC] = useState<CashdroConfig>(getCashdroConfig());
  const { link, error, refresh } = useCashdroLink();
  const [levels, setLevels] = useState<Levels | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [target, setTarget] = useState(String(getFloatTarget() || ''));
  const save = (patch: Partial<CashdroConfig>) => { setC(saveCashdroConfig(patch)); setTimeout(refresh, 50); };

  async function readLevels() {
    setMsg('Consultando la CashDro…');
    try { setLevels((await cashdro.levels()) as Levels); setMsg(null); } catch (e) { setMsg((e as Error).message); }
  }
  const total = levels?.totals?.totalCents != null ? fromCents(levels.totals.totalCents) : null;
  const tgt = Number(target.replace(',', '.')) || 0;
  const rows = [...(levels?.recyclers ?? []), ...(levels?.cassettes ?? [])];

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <section className="tpv-window space-y-3 p-4">
        <div className="flex items-center justify-between"><h3 className="text-base font-bold">Puente CashDro</h3><LinkLight link={link} /></div>
        <p className="text-xs text-slate-600">La configuración se guarda solo en este navegador. El puente debe estar encendido en el PC principal de la tienda.</p>
        <label className="block text-sm font-medium">Este puesto
          <select className="tpv-input mt-1" value={c.mode} onChange={(e) => save({ mode: e.target.value as CashdroConfig['mode'] })}>
            <option value="off">Cobra el efectivo a mano</option><option value="local">Este PC tiene el puente (127.0.0.1)</option><option value="remote">Otro PC de la tienda tiene el puente</option>
          </select></label>
        {c.mode === 'remote' && (
          <label className="block text-sm font-medium">IP del PC principal
            <input className="tpv-input mt-1" value={c.mainIp} onChange={(e) => save({ mainIp: e.target.value })} placeholder="192.168.1.20" />
            {c.mainIp && !isValidLanIp(c.mainIp) && <span className="text-xs text-red-700">Debe ser una IP de la red de la tienda (192.168.x.x, 10.x.x.x…).</span>}</label>
        )}
        <label className="block text-sm font-medium">Clave del puente
          <input className="tpv-input mt-1" type="password" autoComplete="off" value={c.token} onChange={(e) => save({ token: e.target.value })} /></label>
        <label className="block text-sm font-medium">Nombre de este puesto
          <input className="tpv-input mt-1" value={c.terminalName} onChange={(e) => save({ terminalName: e.target.value })} placeholder="Mostrador" /></label>
        <div className="flex items-center gap-3">
          <button type="button" className="tpv-btn" onClick={refresh} disabled={c.mode === 'off'}><RefreshCw size={14} /> Probar conexión</button>
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      </section>

      <section className="tpv-window space-y-3 p-4">
        <h3 className="text-base font-bold">Niveles de efectivo y fondo objetivo</h3>
        <label className="block text-sm font-medium">Fondo objetivo del cajón (€)
          <input className="tpv-input mt-1" inputMode="decimal" value={target} onChange={(e) => { setTarget(e.target.value); try { localStorage.setItem(FLOAT_KEY, String(Number(e.target.value.replace(',', '.')) || 0)); } catch { /* private mode */ } }} placeholder="300,00" /></label>
        <button type="button" className="tpv-btn-primary" onClick={readLevels} disabled={c.mode === 'off'}>Consultar efectivo de la CashDro</button>
        {msg && <p className="text-sm text-slate-700">{msg}</p>}
        {total !== null && (
          <div className="space-y-2">
            <p className="text-2xl font-extrabold">{euros(total)}</p>
            {tgt > 0 && (
              <p className={cx('border px-3 py-2 text-sm font-semibold', total > tgt + 0.004 ? 'border-amber-500 bg-amber-50 text-amber-900' : total < tgt - 0.004 ? 'border-red-400 bg-red-50 text-red-800' : 'border-emerald-500 bg-emerald-50 text-emerald-800')}>
                {total > tgt + 0.004 ? `Sobran ${euros(total - tgt)}: conviene retirar efectivo.` : total < tgt - 0.004 ? `Faltan ${euros(tgt - total)} para el fondo objetivo.` : 'El cajón está en el fondo objetivo.'}
              </p>
            )}
            {rows.length > 0 && (
              <table className="w-full border border-tpv-edge bg-white text-sm">
                <thead className="bg-slate-200 text-left text-xs"><tr><th className="px-2 py-1">Denominación</th><th className="px-2 py-1 text-right">Unidades</th></tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-200"><td className="px-2 py-1">{euros(fromCents(r.denomination ?? r.value ?? 0))}</td><td className="px-2 py-1 text-right">{r.count ?? r.quantity ?? 0}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
