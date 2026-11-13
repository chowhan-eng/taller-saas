// New repair: customer lookup by phone (existing or new), device type icons, IMEI, fault, PIN or lock pattern,
// deposit, promised date, technician. Customer data is encrypted by the server (AES-256-GCM).
import { useEffect, useState } from 'react';
import { Search, UserCheck } from 'lucide-react';
import { mod } from '../api';
import { Alert, Modal, cx, digits, useDash } from '../ui';
import { DEVICES } from './status';
import { PinInput } from './PinField';

export type Member = { user_id: string; name: string; role: string };
type Found = { id: string; full_name: string; phone_e164: string | null } | null;

const CONDITION_CHIPS = ['Pantalla rota', 'Carcasa con golpes', 'Sin batería', 'Moja / humedad', 'Sin daños visibles'];

export default function NewTicket({ team, onClose, onCreated }: { team: Member[]; onClose: () => void; onCreated: (ticketId: string) => void }) {
  const { ctx } = useDash();
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<Found | undefined>(undefined);
  const [name, setName] = useState('');
  const [device, setDevice] = useState('movil');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [imei, setImei] = useState('');
  const [fault, setFault] = useState('');
  const [acc, setAcc] = useState('');
  const [cond, setCond] = useState('');
  const [code, setCode] = useState('');
  const [deposit, setDeposit] = useState('');
  const [promised, setPromised] = useState('');
  const [tech, setTech] = useState('');
  const [consent, setConsent] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repeat, setRepeat] = useState<{ ticket_number: string; status: string }[]>([]);

  // Look the customer up as soon as the phone looks complete.
  useEffect(() => {
    const d = digits(phone);
    if (d.length < 9) { setFound(undefined); return; }
    const full = d.length === 9 ? `34${d}` : d;
    const t = setTimeout(() => {
      mod<{ customer: Found }>('reparo', ctx, 'findCustomerByPhone', { phone: full }).then((r) => setFound(r.customer)).catch(() => setFound(undefined));
    }, 350);
    return () => clearTimeout(t);
  }, [phone, ctx]);

  // Repeat-device warning (warranty): same IMEI/serial already in the shop.
  useEffect(() => {
    if (imei.replace(/\s/g, '').length < 8) { setRepeat([]); return; }
    const t = setTimeout(() => { mod<{ tickets: { ticket_number: string; status: string }[] }>('reparo', ctx, 'findBySerial', { serial: imei }).then((r) => setRepeat(r.tickets)).catch(() => {}); }, 400);
    return () => clearTimeout(t);
  }, [imei, ctx]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const d = digits(phone);
      const e164 = d ? (d.length === 9 ? `34${d}` : d) : null;
      const r = await mod<{ ticket: { id: string } }>('reparo', ctx, 'createTicket', {
        ticket: {
          ...(found ? { customerId: found.id } : { customer: { full_name: name, phone_e164: e164, wa_service_opt_in: consent && !!e164, consent_source: 'resguardo' } }),
          device_type: device, brand, model, serial_imei: imei, unlock_code: code, accessories: acc, physical_condition: cond, reported_fault: fault,
          deposit_eur: Number(deposit.replace(',', '.')) || 0, promised_at: promised ? new Date(promised).toISOString() : undefined, notify_whatsapp: consent && !!e164,
        },
      });
      if (tech) await mod('reparo', ctx, 'updateTicket', { ticketId: r.ticket.id, patch: { technician_id: tech } }).catch(() => {});
      onCreated(r.ticket.id);
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Nueva reparación" onClose={onClose} wide>
      <form onSubmit={submit} className="theme-reparo space-y-4 text-hc-ink">
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="hc-label">Teléfono del cliente</span>
            <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hc-muted" />
              <input className="hc-input pl-9" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="600 123 456" autoFocus /></div>
          </label>
          {found ? (
            <div className="flex items-end"><p className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><UserCheck size={16} /> Cliente existente: <strong>{found.full_name}</strong></p></div>
          ) : (
            <label><span className="hc-label">Nombre {found === null && <span className="normal-case text-emerald-700">· cliente nuevo</span>}</span>
              <input className="hc-input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Nombre y apellidos" /></label>
          )}
        </div>

        <div>
          <span className="hc-label">Dispositivo</span>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8" role="radiogroup" aria-label="Tipo de dispositivo">
            {DEVICES.map(({ key, label, Icon }) => (
              <button key={key} type="button" role="radio" aria-checked={device === key} onClick={() => setDevice(key)}
                className={cx('flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px]', device === key ? 'border-hc-accent bg-hc-soft font-semibold text-hc-accent' : 'border-hc-line hover:bg-hc-hover')}>
                <Icon size={22} />{label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label><span className="hc-label">Marca</span><input className="hc-input" value={brand} onChange={(e) => setBrand(e.target.value)} required placeholder="Samsung" /></label>
          <label><span className="hc-label">Modelo</span><input className="hc-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Galaxy S23" /></label>
          <label><span className="hc-label">IMEI / nº de serie</span><input className="hc-input" value={imei} onChange={(e) => setImei(e.target.value)} /></label>
        </div>
        {repeat.length > 0 && <Alert kind="warn">Este equipo ya pasó por el taller: {repeat.map((t) => `${t.ticket_number} (${t.status})`).join(', ')}. Comprueba si es una garantía.</Alert>}

        <label className="block"><span className="hc-label">Avería</span><textarea className="hc-input" rows={2} value={fault} onChange={(e) => setFault(e.target.value)} required placeholder="No carga, pantalla rota…" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="hc-label">Accesorios que deja</span><input className="hc-input" value={acc} onChange={(e) => setAcc(e.target.value)} placeholder="Funda, cargador, SIM…" /></label>
          <div><span className="hc-label">Estado físico</span><input className="hc-input" value={cond} onChange={(e) => setCond(e.target.value)} />
            <div className="mt-1 flex flex-wrap gap-1">{CONDITION_CHIPS.map((c) => <button key={c} type="button" className="rounded-full border border-hc-line px-2 py-0.5 text-[11px] hover:bg-hc-hover" onClick={() => setCond((v) => (v ? `${v}, ${c.toLowerCase()}` : c))}>{c}</button>)}</div></div>
        </div>

        <div><span className="hc-label">Código de desbloqueo (se guarda cifrado)</span><PinInput value={code} onChange={setCode} /></div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label><span className="hc-label">Señal (€)</span><input className="hc-input" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></label>
          <label><span className="hc-label">Promesa de entrega</span><input className="hc-input" type="date" value={promised} onChange={(e) => setPromised(e.target.value)} /></label>
          <label><span className="hc-label">Técnico</span>
            <select className="hc-input" value={tech} onChange={(e) => setTech(e.target.value)}><option value="">Sin asignar</option>{team.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></label>
        </div>

        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>El cliente acepta recibir avisos de su reparación por WhatsApp (se le informa en el resguardo y puede darse de baja escribiendo BAJA).</span></label>

        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" className="hc-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="hc-btn" disabled={busy}>{busy ? 'Guardando…' : 'Crear e imprimir resguardo'}</button>
        </div>
      </form>
    </Modal>
  );
}
