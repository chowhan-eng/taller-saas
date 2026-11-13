// Device unlock field: PIN/password (masked, reveal for owner/admin) or Android lock pattern drawn on a 3×3 grid.
// Stored as plain text inside the encrypted unlock_code ("PATRON:1-2-5-8" for a pattern).
import { useState } from 'react';
import { Eye, EyeOff, Grid3x3, KeyRound } from 'lucide-react';
import { cx } from '../ui';

export const isPattern = (code: string) => /^PATRON:[1-9](-[1-9])*$/.test(code);
const seqOf = (code: string) => code.slice(7).split('-').map(Number);
const pos = (n: number) => ({ x: ((n - 1) % 3) * 40 + 20, y: Math.floor((n - 1) / 3) * 40 + 20 });

export function PatternView({ code, size = 120 }: { code: string; size?: number }) {
  const seq = seqOf(code);
  const pts = seq.map(pos);
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`Patrón de desbloqueo ${seq.join('-')}`} className="rounded-lg bg-slate-800">
      {pts.slice(1).map((p, i) => <line key={i} x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y} stroke="#25d366" strokeWidth="4" strokeLinecap="round" />)}
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
        const { x, y } = pos(n);
        const idx = seq.indexOf(n);
        return (
          <g key={n}>
            <circle cx={x} cy={y} r={idx >= 0 ? 8 : 5} fill={idx >= 0 ? '#25d366' : '#94a3b8'} />
            {idx >= 0 && <text x={x} y={y + 3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#0b141a">{idx + 1}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** Input: choose PIN or pattern; calls onChange with the stored string. */
export function PinInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<'pin' | 'pattern'>(isPattern(value) ? 'pattern' : 'pin');
  const seq = isPattern(value) ? seqOf(value) : [];
  const toggle = (n: number) => { if (!seq.includes(n)) onChange(`PATRON:${[...seq, n].join('-')}`); };
  return (
    <div>
      <div className="mb-2 flex gap-1.5">
        <button type="button" className={cx('inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs', mode === 'pin' ? 'border-hc-accent bg-hc-soft font-semibold' : 'border-hc-strong')} onClick={() => { setMode('pin'); if (isPattern(value)) onChange(''); }}><KeyRound size={13} /> PIN / contraseña</button>
        <button type="button" className={cx('inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs', mode === 'pattern' ? 'border-hc-accent bg-hc-soft font-semibold' : 'border-hc-strong')} onClick={() => { setMode('pattern'); if (!isPattern(value)) onChange(''); }}><Grid3x3 size={13} /> Patrón</button>
      </div>
      {mode === 'pin' ? (
        <input className="hc-input" autoComplete="off" value={isPattern(value) ? '' : value} onChange={(e) => onChange(e.target.value)} placeholder="Código de desbloqueo (opcional)" />
      ) : (
        <div className="flex items-center gap-4">
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-800 p-3" role="group" aria-label="Dibuja el patrón tocando los puntos en orden">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button key={n} type="button" aria-label={`Punto ${n}`} onClick={() => toggle(n)}
                className={cx('flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold', seq.includes(n) ? 'bg-[#25d366] text-slate-900' : 'bg-slate-600 text-slate-300 hover:bg-slate-500')}>
                {seq.includes(n) ? seq.indexOf(n) + 1 : ''}
              </button>
            ))}
          </div>
          <div className="space-y-2 text-xs text-hc-muted">
            <p>Toca los puntos en el orden del patrón.</p>
            {seq.length > 0 && <button type="button" className="hc-btn-ghost !px-2 !py-1" onClick={() => onChange('')}>Borrar patrón</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only field on the ticket: ••••••, reveal on demand (server logs it and limits it to owner/admin). */
export function PinReveal({ has, canReveal, reveal }: { has: boolean; canReveal: boolean; reveal: () => Promise<string | null> }) {
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!has) return <span className="text-hc-muted">Sin código</span>;
  if (code !== null) {
    return (
      <div className="flex items-start gap-3">
        {isPattern(code) ? <PatternView code={code} size={96} /> : <code className="rounded bg-hc-panel px-2 py-1 text-base font-bold tracking-wider">{code}</code>}
        <button type="button" className="hc-btn-ghost !px-2 !py-1" onClick={() => setCode(null)}><EyeOff size={14} /> Ocultar</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-lg tracking-widest">••••••</span>
      {canReveal
        ? <button type="button" className="hc-btn-ghost !px-2 !py-1" onClick={async () => { try { setCode((await reveal()) ?? ''); } catch (e) { setErr((e as Error).message); } }}><Eye size={14} /> Mostrar</button>
        : <span className="text-xs text-hc-muted">Solo titular o administrador</span>}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
