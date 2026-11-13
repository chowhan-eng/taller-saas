// 58 mm / 80 mm thermal printing: resguardo (deposit receipt) and sticky label, with an on-screen paper
// preview before printing. The printable node is portaled to <body> and shown only by @media print.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { Modal, cx } from '../ui';

export type Shop = { trade_name?: string; nif?: string | null; address_line?: string | null; city?: string | null; postal_code?: string | null; phone?: string | null; ticket_footer?: string | null; printer_width_mm?: number };
type T = Record<string, unknown>;
type C = Record<string, unknown> | null;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function setPageSize(widthMm: number) {
  let style = document.getElementById('print-page') as HTMLStyleElement | null;
  if (!style) { style = document.createElement('style'); style.id = 'print-page'; document.head.appendChild(style); }
  style.textContent = `@page { size: ${widthMm}mm auto; margin: 2mm; }`;
}

export function PrintArea({ children, widthMm, onDone }: { children: ReactNode; widthMm: number; onDone: () => void }) {
  useEffect(() => {
    const after = () => onDone();
    window.addEventListener('afterprint', after);
    setPageSize(widthMm);
    const t = setTimeout(() => window.print(), 80);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, [widthMm, onDone]);
  return createPortal(<div className="print-area" style={{ width: `${widthMm - 4}mm` }}>{children}</div>, document.body);
}

export function Resguardo({ shop, t, c }: { shop: Shop; t: T; c: C }) {
  const created = s(t.created_date);
  const date = created ? new Date(/[zZ]$/.test(created) ? created : `${created}Z`).toLocaleString('es-ES') : '';
  return (
    <div className="ticket">
      <div className="t-center"><strong>{shop.trade_name}</strong></div>
      {shop.nif && <div className="t-center">NIF {shop.nif}</div>}
      {(shop.address_line || shop.city) && <div className="t-center">{[shop.address_line, shop.postal_code, shop.city].filter(Boolean).join(' ')}</div>}
      {shop.phone && <div className="t-center">Tel. {shop.phone}</div>}
      <hr />
      <div className="t-center"><strong>RESGUARDO DE DEPÓSITO</strong></div>
      <div className="t-center t-big">Nº {s(t.ticket_number)}</div>
      <div>{date}</div>
      <hr />
      <div><strong>Cliente:</strong> {s(c?.full_name)}</div>
      {c?.phone_e164 ? <div><strong>Tel.:</strong> +{s(c.phone_e164)}</div> : null}
      <div><strong>Equipo:</strong> {[t.brand, t.model].filter(Boolean).map(s).join(' ')}</div>
      {t.serial_imei ? <div><strong>IMEI/Serie:</strong> {s(t.serial_imei)}</div> : null}
      <div><strong>Avería:</strong> {s(t.reported_fault)}</div>
      {t.accessories ? <div><strong>Accesorios:</strong> {s(t.accessories)}</div> : null}
      {t.physical_condition ? <div><strong>Estado:</strong> {s(t.physical_condition)}</div> : null}
      {Number(t.budget_amount_eur) > 0 && <div><strong>Presupuesto:</strong> {Number(t.budget_amount_eur).toFixed(2)} € (IVA incl.)</div>}
      {Number(t.deposit_eur) > 0 && <div><strong>Señal:</strong> {Number(t.deposit_eur).toFixed(2)} €</div>}
      <hr />
      <div className="t-small">Este resguardo no es una factura.</div>
      {shop.ticket_footer && <div className="t-small">{shop.ticket_footer}</div>}
      <div style={{ marginTop: '10mm' }}>Firma del cliente: ____________________</div>
    </div>
  );
}

export function Etiqueta({ t, c }: { t: T; c: C }) {
  return (
    <div className="ticket label">
      <div className="t-big"><strong>{s(t.ticket_number)}</strong></div>
      <div>{s(c?.full_name)}</div>
      <div>{[t.brand, t.model].filter(Boolean).map(s).join(' ')}</div>
      <div className="t-small">{s(t.reported_fault).slice(0, 60)}</div>
      {t.promised_at ? <div className="t-small">Promesa: {new Date(s(t.promised_at)).toLocaleDateString('es-ES')}</div> : null}
    </div>
  );
}

const PX_PER_MM = 3.78;

/** Paper preview + width/type pickers, then prints exactly what is previewed. */
export function PrintDialog({ shop, t, c, onClose, initial = 'resguardo' }: { shop: Shop; t: T; c: C; onClose: () => void; initial?: 'resguardo' | 'etiqueta' }) {
  const [kind, setKind] = useState<'resguardo' | 'etiqueta'>(initial);
  const [width, setWidth] = useState<58 | 80>(shop.printer_width_mm === 58 ? 58 : 80);
  const [printing, setPrinting] = useState(false);
  const doc = kind === 'resguardo' ? <Resguardo shop={shop} t={t} c={c} /> : <Etiqueta t={t} c={c} />;
  return (
    <Modal title="Vista previa de impresión" onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-[200px_1fr]">
        <div className="space-y-4 text-sm">
          <div>
            <p className="mb-1 font-semibold">Documento</p>
            {([['resguardo', 'Resguardo de depósito'], ['etiqueta', 'Etiqueta adhesiva']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 py-0.5"><input type="radio" name="pk" checked={kind === k} onChange={() => setKind(k)} /> {label}</label>
            ))}
          </div>
          <div>
            <p className="mb-1 font-semibold">Ancho del rollo</p>
            {([58, 80] as const).map((w) => (
              <label key={w} className="flex items-center gap-2 py-0.5"><input type="radio" name="pw" checked={width === w} onChange={() => setWidth(w)} /> {w} mm</label>
            ))}
          </div>
          <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 font-semibold text-white" onClick={() => setPrinting(true)}>
            <Printer size={16} /> Imprimir
          </button>
          <p className="text-xs text-slate-500">En el cuadro de impresión elige tu impresora térmica y desactiva márgenes y cabeceras.</p>
        </div>
        <div className="flex justify-center overflow-auto rounded-md bg-slate-200 p-4">
          <div className={cx('bg-white p-2 text-black shadow-lg')} style={{ width: `${(width - 4) * PX_PER_MM + 16}px`, font: "11px/1.35 'Courier New', ui-monospace, monospace" }}>
            <style>{`.preview-paper .t-center{text-align:center}.preview-paper .t-big{font-size:16px}.preview-paper .t-small{font-size:9px}.preview-paper hr{border:0;border-top:1px dashed #000;margin:4px 0}`}</style>
            <div className="preview-paper">{doc}</div>
          </div>
        </div>
      </div>
      {printing && <PrintArea widthMm={width} onDone={() => setPrinting(false)}>{doc}</PrintArea>}
    </Modal>
  );
}
