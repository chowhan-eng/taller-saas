// Small shared primitives (no Radix/shadcn runtime: the look is reproduced with Tailwind classes).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Ctx } from './api';

export type Tab = 'whatsapp' | 'reparo' | 'tpv';
export type Nav = { tab: Tab; phone?: string; ticketId?: string };
export type Dash = { ctx: Ctx; modules: string[]; shop: string; go: (n: Nav) => void; nav: Nav };
export const DashContext = createContext<Dash | null>(null);
export const useDash = () => {
  const d = useContext(DashContext);
  if (!d) throw new Error('DashContext missing');
  return d;
};
export const canAdmin = (ctx: Ctx) => ctx.role === 'owner' || ctx.role === 'admin';

export function cx(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(' '); }

export function Modal({ title, onClose, children, wide, dark }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; dark?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={cx('w-full rounded-lg shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg', dark ? 'border border-wa-line bg-wa-panel text-wa-text' : 'border border-slate-300 bg-white text-slate-900')}>
        <div className={cx('flex items-center justify-between border-b px-4 py-3', dark ? 'border-wa-line' : 'border-slate-200')}>
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-black/10"><X size={18} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Alert({ kind = 'err', children }: { kind?: 'err' | 'ok' | 'warn'; children: ReactNode }) {
  const c = kind === 'err' ? 'border-red-300 bg-red-50 text-red-800' : kind === 'ok' ? 'border-green-300 bg-green-50 text-green-800' : 'border-amber-300 bg-amber-50 text-amber-900';
  return <div role={kind === 'err' ? 'alert' : 'status'} className={cx('rounded-md border px-3 py-2 text-sm', c)}>{children}</div>;
}

/** Debounced value (search boxes). */
export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
