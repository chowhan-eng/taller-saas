// Live supplier search (Androgeek · SpainSellers · MuchoRepuesto link) and the shop's supplier accounts.
// Results come from the server's `searchParts` (the shop's own dealer login, never another shop's).
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, KeyRound, Search } from 'lucide-react';
import { euros, mod } from '../api';
import { Alert, Modal, canAdmin, cx, useDash } from '../ui';

export type LiveOffer = {
  id: string; source: string; source_name: string; sku: string; title: string; url: string; stock: string; stock_qty: number | null; net_cost_cents: number | null;
  price_note: string; estimated: boolean; tier: number; quality_label: string; is_junk: boolean; junk_reason: string;
  saved?: { price_eur: number; previous_price_eur: number | null; changed: boolean };
};
type SourceStatus = { state: 'ok' | 'empty' | 'error' | 'link'; ms: number; count: number; note: string; url: string };
type Result = { parsed: { part_type: string; brand: string; model: string }; sources: Record<string, SourceStatus>; offers: LiveOffer[] };
type Account = { configured: boolean; feed: boolean; state: string; note: string; logged_at: string | null };

const TIER = ['', 'Económica', 'Calidad', 'Original'];
const STOCK: Record<string, string> = { in_stock: 'En stock', out: 'Sin stock', low: 'Poco stock', unknown: '' };
const DOT: Record<string, string> = { ok: 'bg-emerald-500', empty: 'bg-slate-400', error: 'bg-red-500', link: 'bg-sky-500' };

export function SupplierAccounts({ onClose }: { onClose: () => void }) {
  const { ctx } = useDash();
  const admin = canAdmin(ctx);
  const [acc, setAcc] = useState<Record<string, Account> | null>(null);
  const [form, setForm] = useState({ androgeek: { email: '', password: '' }, spainsellers: { email: '', password: '', feed: '' } });
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const load = useCallback(async () => setAcc((await mod<{ accounts: Record<string, Account> }>('reparo', ctx, 'supplierStatus')).accounts), [ctx]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const say = (k: string, ok: boolean, text: string) => setMsg((m) => ({ ...m, [k]: { ok, text } }));

  async function save(source: 'androgeek' | 'spainsellers') {
    const f = form[source];
    try {
      const r = await mod<{ accounts: Record<string, Account> }>('reparo', ctx, 'saveSupplierAccount', { source, email: f.email, password: f.password, ...(source === 'spainsellers' ? { feedUrl: (f as { feed: string }).feed } : {}) });
      setAcc(r.accounts); setForm((s) => ({ ...s, [source]: { ...s[source], password: '' } })); say(source, true, 'Guardado (cifrado).');
    } catch (e) { say(source, false, (e as Error).message); }
  }
  async function remove(source: 'androgeek' | 'spainsellers') {
    try { setAcc((await mod<{ accounts: Record<string, Account> }>('reparo', ctx, 'saveSupplierAccount', { source, email: '', password: '', ...(source === 'spainsellers' ? { feedUrl: '' } : {}) })).accounts); say(source, true, 'Cuenta eliminada.'); } catch (e) { say(source, false, (e as Error).message); }
  }
  async function test(source: 'androgeek' | 'spainsellers') {
    say(source, true, 'Probando…');
    try {
      const r = await mod<{ state: string; note: string }>('reparo', ctx, 'testSupplier', { source });
      say(source, r.state === 'logged', r.state === 'logged' ? 'Conectado: verás tus precios de distribuidor.' : r.note || 'No se pudo iniciar sesión.'); await load();
    } catch (e) { say(source, false, (e as Error).message); }
  }

  const row = (source: 'androgeek' | 'spainsellers', title: string) => {
    const a = acc?.[source];
    const f = form[source];
    return (
      <section className="hc-card space-y-2 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">{title}</h3>
          <span className={cx('rounded px-2 py-0.5 text-xs font-semibold', a?.state === 'logged' ? 'bg-emerald-100 text-emerald-700' : a?.state === 'failed' ? 'bg-red-100 text-red-700' : 'bg-hc-panel text-hc-muted')}>
            {a?.state === 'logged' ? 'Conectada' : a?.state === 'failed' ? 'Error' : a?.configured ? 'Sin probar' : 'Precios de invitado'}</span></div>
        {a?.note && <p className="text-xs text-red-700">{a.note}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <label><span className="hc-label">Correo de distribuidor</span><input className="hc-input" autoComplete="off" disabled={!admin} value={f.email} onChange={(e) => setForm({ ...form, [source]: { ...f, email: e.target.value } })} placeholder={a?.configured ? '(guardado)' : ''} /></label>
          <label><span className="hc-label">Contraseña</span><input className="hc-input" type="password" autoComplete="new-password" disabled={!admin} value={f.password} onChange={(e) => setForm({ ...form, [source]: { ...f, password: e.target.value } })} placeholder={a?.configured ? '(guardada)' : ''} /></label>
        </div>
        {source === 'spainsellers' && (
          <label className="block"><span className="hc-label">CSV de tarifa (opcional, https)</span><input className="hc-input" disabled={!admin} value={(f as { feed: string }).feed} onChange={(e) => setForm({ ...form, spainsellers: { ...form.spainsellers, feed: e.target.value } })} placeholder={a?.feed ? '(guardado)' : 'https://…/tarifa.csv'} /></label>
        )}
        {admin ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="hc-btn" onClick={() => save(source)}>Guardar</button>
            <button type="button" className="hc-btn-ghost" disabled={!a?.configured} onClick={() => test(source)}>Probar</button>
            <button type="button" className="hc-btn-ghost" disabled={!a?.configured && !a?.feed} onClick={() => remove(source)}>Quitar</button>
          </div>
        ) : <p className="text-xs text-hc-muted">Solo el titular o un administrador pueden cambiar las cuentas.</p>}
        {msg[source] && <Alert kind={msg[source].ok ? 'ok' : 'err'}>{msg[source].text}</Alert>}
      </section>
    );
  };
  return (
    <Modal title="Cuentas de proveedor" onClose={onClose} wide>
      <div className="theme-reparo space-y-3 text-hc-ink">
        <p className="text-sm text-hc-muted">Con tu cuenta de distribuidor ves <strong>tus</strong> precios. Se guardan cifrados, solo este taller los usa y nunca se vuelven a mostrar. Sin cuenta se usan los precios públicos (en SpainSellers, un precio estimado).</p>
        {row('androgeek', 'Androgeek')}
        {row('spainsellers', 'SpainSellers')}
        <section className="hc-card p-3 text-sm"><h3 className="font-semibold">MuchoRepuesto</h3><p className="text-hc-muted">Su web no admite consultas automáticas: se abre en una pestaña y el precio se apunta a mano.</p></section>
      </div>
    </Modal>
  );
}

export default function SupplierSearch({ initialQuery, onUse }: { initialQuery: string; onUse: (o: LiveOffer) => void }) {
  const { ctx } = useDash();
  const [q, setQ] = useState(initialQuery);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [junk, setJunk] = useState(false);
  const [accounts, setAccounts] = useState(false);
  useEffect(() => { setQ(initialQuery); }, [initialQuery]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault(); setErr(null); setBusy(true);
    try { setRes(await mod<Result>('reparo', ctx, 'searchParts', { q })); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }
  const good = (res?.offers ?? []).filter((o) => !o.is_junk);
  const bad = (res?.offers ?? []).filter((o) => o.is_junk);
  const changed = good.filter((o) => o.saved?.changed);

  return (
    <section className="hc-card space-y-3 p-3">
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[240px] flex-1"><span className="hc-label">Buscar la pieza en los proveedores</span>
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hc-muted" /><input className="hc-input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="pantalla iphone 13" /></div></label>
        <button className="hc-btn" disabled={busy || q.trim().length < 3}>{busy ? 'Buscando…' : 'Buscar'}</button>
        <button type="button" className="hc-btn-ghost" onClick={() => setAccounts(true)}><KeyRound size={14} /> Cuentas</button>
      </form>
      {err && <Alert>{err}</Alert>}
      {res && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {Object.entries(res.sources).map(([k, s]) => (
              <span key={k} className="inline-flex items-center gap-1.5" title={s.note}>
                <span className={cx('h-2 w-2 rounded-full', DOT[s.state])} /><strong className="capitalize">{k}</strong>
                {s.state === 'link' ? <a className="inline-flex items-center gap-0.5 text-hc-accent underline" href={s.url} target="_blank" rel="noreferrer noopener">abrir web <ExternalLink size={11} /></a> : <span className="text-hc-muted">{s.state === 'error' ? s.note : `${s.count} · ${s.ms} ms`}</span>}
              </span>
            ))}
          </div>
          {changed.length > 0 && <Alert kind="warn"><AlertTriangle size={14} className="mr-1 inline" /><strong>Han cambiado de precio:</strong> {changed.slice(0, 4).map((o) => `${o.title.slice(0, 40)} (${euros(o.saved!.price_eur)} → ${euros((o.net_cost_cents ?? 0) / 100)})`).join(' · ')}</Alert>}
          <div className="hc-surface max-h-72 overflow-auto rounded-md border border-hc-line">
            <table>
              <thead><tr><th>Proveedor</th><th>Pieza</th><th>Calidad</th><th className="text-right">Coste sin IVA</th><th>Stock</th><th /></tr></thead>
              <tbody>
                {good.length === 0 && <tr><td colSpan={6} className="text-hc-muted">Ningún resultado válido para esa búsqueda.</td></tr>}
                {good.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap font-medium">{o.source_name}</td>
                    <td className="max-w-[320px]"><a className="hover:underline" href={o.url} target="_blank" rel="noreferrer noopener">{o.title}</a>
                      {o.price_note && <span className={cx('block text-[11px]', o.estimated ? 'text-amber-700' : 'text-hc-muted')}>{o.price_note}</span>}</td>
                    <td className="whitespace-nowrap text-xs"><span className="rounded bg-hc-panel px-1.5 py-0.5">{TIER[o.tier]} · {o.quality_label}</span></td>
                    <td className="whitespace-nowrap text-right font-semibold">{o.net_cost_cents != null ? euros(o.net_cost_cents / 100) : '—'}
                      {o.saved?.changed && <span className="block text-[11px] font-bold text-red-700">antes {euros(o.saved.price_eur)}</span>}</td>
                    <td className={cx('whitespace-nowrap text-xs', o.stock === 'out' ? 'text-red-700' : 'text-hc-muted')}>{STOCK[o.stock]}{o.stock_qty != null ? ` (${o.stock_qty})` : ''}</td>
                    <td><button type="button" className="hc-btn-ghost !px-2 !py-1" disabled={o.net_cost_cents == null} onClick={() => onUse(o)}>Usar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bad.length > 0 && <button type="button" className="text-xs text-hc-muted underline" onClick={() => setJunk((j) => !j)}>{junk ? 'Ocultar' : 'Ver'} {bad.length} descartados (accesorios, otros modelos…)</button>}
          {junk && <ul className="space-y-0.5 text-xs text-hc-muted">{bad.map((o) => <li key={o.id}>{o.source_name} · {o.title} — {o.junk_reason}</li>)}</ul>}
        </>
      )}
      {accounts && <SupplierAccounts onClose={() => setAccounts(false)} />}
    </section>
  );
}
