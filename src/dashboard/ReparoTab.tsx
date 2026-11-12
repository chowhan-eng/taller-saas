// Reparo CRM tab — ticket list with infinite scroll, new-ticket form, ticket detail with status, budget,
// auto-quote builder, unlock code and 58/80 mm printing. Port of the live Reparo Tickets/Presupuestar flow.
import { useCallback, useEffect, useRef, useState } from 'react';
import { euros, mod, when, type Ctx } from './api';
import { Etiqueta, PrintArea, Resguardo, type Shop } from './Print';

const STATUS: Record<string, string> = {
  recibido: 'Recibido', diagnostico: 'En diagnóstico', presupuesto_enviado: 'Presupuesto enviado', presupuesto_aceptado: 'Presupuesto aceptado',
  presupuesto_rechazado: 'Presupuesto rechazado', esperando_pieza: 'Esperando pieza', en_reparacion: 'En reparación', listo_recoger: 'Listo para recoger',
  entregado: 'Entregado', no_reparable: 'No reparable', cancelado: 'Cancelado',
};
const DEVICE_LABEL: Record<string, string> = { movil: 'Móvil', tablet: 'Tablet', portatil: 'Portátil', sobremesa: 'Sobremesa', consola: 'Consola', mando: 'Mando', smartwatch: 'Reloj', otro: 'Otro' };
const PART_LABEL: Record<string, string> = { screen: 'Pantalla', battery: 'Batería', charging_port: 'Conector de carga', back_cover: 'Tapa trasera', camera: 'Cámara', speaker: 'Altavoz', keyboard: 'Teclado', keyboard_riveted: 'Teclado remachado', hinges: 'Bisagras', fan: 'Ventilador', hdmi: 'HDMI', joystick: 'Joystick', other: 'Otra' };
const PAGE = 30;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const e164 = (raw: string) => { const d = raw.replace(/\D/g, ''); return d ? (d.length === 9 ? `34${d}` : d) : null; };

type Row = Record<string, unknown> & { id: string };

function NewTicket({ ctx, onCreated }: { ctx: Ctx; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ full_name: '', phone: '', device_type: 'movil', brand: '', model: '', serial_imei: '', unlock_code: '', reported_fault: '', accessories: '', physical_condition: '', deposit_eur: '', service: true, marketing: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  async function lookup() {
    setKnown(null);
    const phone = e164(f.phone);
    if (!phone || phone.length < 11) return;
    const r = await mod<{ customer: { id: string; full_name: string } | null }>('reparo', ctx, 'findCustomerByPhone', { phone }).catch(() => null);
    if (r?.customer) { setKnown(r.customer.id); setF((x) => ({ ...x, full_name: r.customer!.full_name })); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await mod<{ ticket: Row }>('reparo', ctx, 'createTicket', {
        ticket: {
          ...(known ? { customerId: known } : { customer: { full_name: f.full_name, phone_e164: e164(f.phone), wa_service_opt_in: f.service, wa_marketing_opt_in: f.marketing, consent_source: 'mostrador_firma' } }),
          device_type: f.device_type, brand: f.brand, model: f.model, serial_imei: f.serial_imei, unlock_code: f.unlock_code,
          reported_fault: f.reported_fault, accessories: f.accessories, physical_condition: f.physical_condition, deposit_eur: Number(f.deposit_eur.replace(',', '.')) || 0,
        },
      });
      onCreated(r.ticket.id);
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="card grid-form" style={{ padding: 20 }} onSubmit={submit}>
      <h3 style={{ marginTop: 0, gridColumn: '1 / -1' }}>Nuevo resguardo</h3>
      <div><label htmlFor="ph">Teléfono del cliente</label><input id="ph" inputMode="tel" value={f.phone} onChange={set('phone')} onBlur={lookup} /></div>
      <div><label htmlFor="nm">Nombre {known && <span className="small muted">(cliente ya conocido)</span>}</label><input id="nm" value={f.full_name} onChange={set('full_name')} required={!known} disabled={!!known} /></div>
      <div><label htmlFor="dt">Tipo</label><select id="dt" value={f.device_type} onChange={set('device_type')}>{Object.entries(DEVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div><label htmlFor="br">Marca</label><input id="br" value={f.brand} onChange={set('brand')} required /></div>
      <div><label htmlFor="md">Modelo</label><input id="md" value={f.model} onChange={set('model')} /></div>
      <div><label htmlFor="im">IMEI / nº de serie</label><input id="im" value={f.serial_imei} onChange={set('serial_imei')} /></div>
      <div><label htmlFor="pin">Código / patrón de desbloqueo</label><input id="pin" value={f.unlock_code} onChange={set('unlock_code')} autoComplete="off" placeholder="Se guarda cifrado" /></div>
      <div><label htmlFor="dp">Señal (€)</label><input id="dp" inputMode="decimal" value={f.deposit_eur} onChange={set('deposit_eur')} /></div>
      <div style={{ gridColumn: '1 / -1' }}><label htmlFor="ft">Avería</label><textarea id="ft" rows={2} value={f.reported_fault} onChange={set('reported_fault')} required /></div>
      <div><label htmlFor="ac">Accesorios</label><input id="ac" value={f.accessories} onChange={set('accessories')} placeholder="cargador, funda…" /></div>
      <div><label htmlFor="pc">Estado físico</label><input id="pc" value={f.physical_condition} onChange={set('physical_condition')} placeholder="pantalla rajada…" /></div>
      {!known && (
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="check"><input type="checkbox" checked={f.service} onChange={set('service')} /><span>El cliente acepta recibir por WhatsApp los avisos de su reparación.</span></label>
          <label className="check"><input type="checkbox" checked={f.marketing} onChange={set('marketing')} /><span>Acepta que le pidamos una reseña al entregar.</span></label>
        </div>
      )}
      {err && <div className="alert err" role="alert" style={{ gridColumn: '1 / -1' }}>{err}</div>}
      <button className="btn" disabled={busy} style={{ gridColumn: '1 / -1' }}>{busy ? 'Guardando…' : 'Crear resguardo'}</button>
    </form>
  );
}

function QuoteBuilder({ ctx, ticket, onApplied }: { ctx: Ctx; ticket: Row; onApplied: (message: string) => void }) {
  const [q, setQ] = useState({ price: '', taxMode: 'gross', partType: 'screen', shipping: '', partTitle: '', qualityLabel: '', tier: '1' });
  const [opt, setOpt] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cents = (v: string) => Math.round((Number(v.replace(',', '.')) || 0) * 100);
  async function calc() {
    setErr(null);
    try {
      const category = ['movil', 'tablet', 'portatil', 'sobremesa', 'consola'].includes(s(ticket.device_type)) ? ticket.device_type : 'movil';
      const r = await mod<{ option: Record<string, unknown> }>('reparo', ctx, 'quote', { quote: {
        priceCents: cents(q.price), taxMode: q.taxMode, category, partType: q.partType, shippingCents: cents(q.shipping),
        partTitle: q.partTitle, qualityLabel: q.qualityLabel, tier: Number(q.tier),
      } });
      setOpt(r.option);
    } catch (e) { setErr((e as Error).message); }
  }
  async function apply() {
    if (!opt) return;
    try { onApplied((await mod<{ message: string }>('reparo', ctx, 'applyQuote', { ticketId: ticket.id, options: [opt] })).message); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="card" style={{ padding: 14 }}>
      <h4 style={{ marginTop: 0 }}>Presupuesto automático</h4>
      <div className="grid-form">
        <div><label htmlFor="qp">Precio de la pieza (€)</label><input id="qp" inputMode="decimal" value={q.price} onChange={(e) => setQ({ ...q, price: e.target.value })} /></div>
        <div><label htmlFor="qt">El precio es</label><select id="qt" value={q.taxMode} onChange={(e) => setQ({ ...q, taxMode: e.target.value })}><option value="gross">con IVA</option><option value="net">sin IVA</option></select></div>
        <div><label htmlFor="qk">Pieza</label><select id="qk" value={q.partType} onChange={(e) => setQ({ ...q, partType: e.target.value })}>{Object.entries(PART_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label htmlFor="qs">Portes (€)</label><input id="qs" inputMode="decimal" value={q.shipping} onChange={(e) => setQ({ ...q, shipping: e.target.value })} /></div>
        <div><label htmlFor="qn">Descripción de la pieza</label><input id="qn" value={q.partTitle} onChange={(e) => setQ({ ...q, partTitle: e.target.value })} /></div>
        <div><label htmlFor="qq">Calidad</label><select id="qq" value={q.tier} onChange={(e) => setQ({ ...q, tier: e.target.value })}><option value="1">Económica</option><option value="2">Alta calidad</option><option value="3">Original</option></select></div>
      </div>
      <button type="button" className="btn secondary inline" onClick={calc} disabled={!(cents(q.price) > 0)}>Calcular</button>
      {opt && (
        <div style={{ marginTop: 10 }}>
          <p><strong>PVP {euros(Number(opt.pvp_cents) / 100)}</strong> <span className="small muted">({s(opt.labor_label)} · coste {euros(Number(opt.net_cost_cents) / 100)} · margen {s(opt.margin_pct)} % · beneficio {euros(Number(opt.profit_cents) / 100)})</span></p>
          <button type="button" className="btn inline" onClick={apply}>Poner este presupuesto</button>
        </div>
      )}
      {err && <div className="alert err">{err}</div>}
    </div>
  );
}

function Detail({ ctx, id, shop, onChanged }: { ctx: Ctx; id: string; shop: Shop; onChanged: () => void }) {
  const [d, setD] = useState<{ ticket: Row; customer: Row | null; events: Row[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [quoteMsg, setQuoteMsg] = useState<string | null>(null);
  const [printing, setPrinting] = useState<'resguardo' | 'etiqueta' | null>(null);
  const load = useCallback(async () => {
    const r = await mod<{ ticket: Row; customer: Row | null; events: Row[] }>('reparo', ctx, 'getTicket', { ticketId: id });
    setD(r);
    setAmount(r.ticket.budget_amount_eur ? s(r.ticket.budget_amount_eur).replace('.', ',') : '');
  }, [ctx, id]);
  useEffect(() => { setCode(null); setQuoteMsg(null); load().catch((e) => setErr((e as Error).message)); }, [load]);
  const donePrint = useCallback(() => setPrinting(null), []);
  const act = async (action: string, body: Record<string, unknown>) => {
    setErr(null);
    try { await mod('reparo', ctx, action, { ticketId: id, ...body }); await load(); onChanged(); } catch (e) { setErr((e as Error).message); }
  };
  if (!d) return <p className="muted">{err ?? 'Cargando…'}</p>;
  const t = d.ticket;
  const width = Number(shop.printer_width_mm) === 58 ? 58 : 80;
  return (
    <div className="detail">
      <div className="row-between">
        <h3 style={{ margin: 0 }}>{s(t.ticket_number)} · {[t.brand, t.model].filter(Boolean).map(s).join(' ')}</h3>
        <div className="btn-row">
          <button className="btn secondary inline" onClick={() => setPrinting('resguardo')}>Imprimir resguardo ({width} mm)</button>
          <button className="btn secondary inline" onClick={() => setPrinting('etiqueta')}>Etiqueta</button>
        </div>
      </div>
      {err && <div className="alert err">{err}</div>}
      <p><strong>{s(d.customer?.full_name)}</strong> {d.customer?.phone_e164 ? `· +${s(d.customer.phone_e164)}` : ''}</p>
      <p className="small">{s(t.reported_fault)}</p>
      <div className="grid-form">
        <div>
          <label htmlFor="st">Estado</label>
          <select id="st" value={s(t.status)} onChange={(e) => act('setStatus', { status: e.target.value })}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ba">Presupuesto (€, IVA incl.)</label>
          <input id="ba" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
      <p className="small muted">Presupuesto: {s(t.budget_status)}{t.budget_sent_at ? ` · enviado ${when(t.budget_sent_at)}` : ''}</p>
      <div className="btn-row">
        <button className="btn secondary inline" onClick={() => act('setBudget', { status: 'enviado', amountEur: Number(amount.replace(',', '.')) })}>Enviar presupuesto</button>
        <button className="btn secondary inline" onClick={() => act('setBudget', { status: 'aceptado' })}>Aceptado</button>
        <button className="btn secondary inline" onClick={() => act('setBudget', { status: 'rechazado' })}>Rechazado</button>
        {t.has_unlock_code === true && (ctx.role === 'owner' || ctx.role === 'admin') && (
          <button className="btn secondary inline" onClick={async () => setCode((await mod<{ code: string }>('reparo', ctx, 'revealUnlockCode', { ticketId: id })).code)}>Ver código</button>
        )}
      </div>
      {code && <p><strong>Código:</strong> <code>{code}</code> <span className="small muted">(consulta registrada)</span></p>}
      <QuoteBuilder ctx={ctx} ticket={t} onApplied={(m) => { setQuoteMsg(m); load(); onChanged(); }} />
      {quoteMsg && (
        <div className="card" style={{ padding: 10 }}>
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{quoteMsg}</p>
          <button className="btn secondary inline" onClick={() => navigator.clipboard?.writeText(quoteMsg)}>Copiar mensaje</button>
          <span className="small muted"> Pulsa «Enviar presupuesto» para que salga por WhatsApp con la plantilla.</span>
        </div>
      )}
      <h4>Historial</h4>
      <ul className="small">{d.events.map((e) => <li key={e.id}>{when(e.created_date)} · {STATUS[s(e.to_status)] ?? s(e.to_status)}{e.note ? ` · ${s(e.note)}` : ''}</li>)}</ul>
      {printing && (
        <PrintArea widthMm={printing === 'etiqueta' ? 58 : width} onDone={donePrint}>
          {printing === 'resguardo' ? <Resguardo shop={shop} t={t} c={d.customer} /> : <Etiqueta t={t} c={d.customer} />}
        </PrintArea>
      )}
    </div>
  );
}

export default function ReparoTab({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [shop, setShop] = useState<Shop>({});
  const [err, setErr] = useState<string | null>(null);
  const loading = useRef(false);
  const count = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async (reset = false) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const offset = reset ? 0 : count.current;
      const r = await mod<{ tickets: Row[] }>('reparo', ctx, 'listTickets', { open, limit: PAGE, offset });
      setRows((prev) => {
        const next = reset ? r.tickets : [...prev, ...r.tickets];
        count.current = next.length;
        return next;
      });
      setDone(r.tickets.length < PAGE);
    } catch (e) { setErr((e as Error).message); } finally { loading.current = false; }
  }, [ctx, open]);

  useEffect(() => { mod<{ shop: Shop }>('reparo', ctx, 'shop').then((r) => setShop(r.shop)).catch(() => {}); }, [ctx]);
  useEffect(() => { setDone(false); loadMore(true); }, [loadMore]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) loadMore(); });
    io.observe(el);
    return () => io.disconnect();
  }, [done, loadMore]);

  return (
    <div className="reparo">
      <aside className="pane list">
        <div className="tab-bar" style={{ padding: 8, margin: 0 }}>
          <button className="btn inline" onClick={() => { setCreating(true); setSel(null); }}>+ Nuevo</button>
          <button className={`chip ${open ? 'on' : ''}`} onClick={() => setOpen(true)}>Abiertos</button>
          <button className={`chip ${!open ? 'on' : ''}`} onClick={() => setOpen(false)}>Todos</button>
        </div>
        {err && <div className="alert err">{err}</div>}
        {rows.map((t) => (
          <button key={t.id} className={`conv ${sel === t.id ? 'on' : ''}`} onClick={() => { setSel(t.id); setCreating(false); }}>
            <strong>{s(t.ticket_number)}</strong> <span className="small">{STATUS[s(t.status)]}</span>
            <span className="small">{s(t.customer_name)} · {[t.brand, t.model].filter(Boolean).map(s).join(' ')}</span>
            <span className="small muted">{when(t.created_date)}{t.budget_amount_eur ? ` · ${euros(t.budget_amount_eur)}` : ''}</span>
          </button>
        ))}
        {!done && <div ref={sentinel} className="small muted" style={{ padding: 10 }}>Cargando más…</div>}
        {done && rows.length === 0 && <p className="small muted" style={{ padding: 10 }}>No hay tickets todavía.</p>}
      </aside>
      <section className="pane main">
        {creating && <NewTicket ctx={ctx} onCreated={(id) => { setCreating(false); setSel(id); loadMore(true); }} />}
        {!creating && sel && <Detail ctx={ctx} id={sel} shop={shop} onChanged={() => loadMore(true)} />}
        {!creating && !sel && <p className="muted">Elige un ticket o crea uno nuevo.</p>}
      </section>
    </div>
  );
}
