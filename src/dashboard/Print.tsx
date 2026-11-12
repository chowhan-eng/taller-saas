// 58/80 mm thermal printing (resguardo + label) — browser print with a page sized to the roll, as the
// live Reparo prints. The printable node is rendered off-screen and shown only by @media print.
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type Shop = { trade_name?: string; nif?: string | null; address_line?: string | null; city?: string | null; postal_code?: string | null; phone?: string | null; ticket_footer?: string | null; printer_width_mm?: number };

function printNow(widthMm: number) {
  let style = document.getElementById('print-page') as HTMLStyleElement | null;
  if (!style) { style = document.createElement('style'); style.id = 'print-page'; document.head.appendChild(style); }
  style.textContent = `@page { size: ${widthMm}mm auto; margin: 2mm; }`;
  setTimeout(() => window.print(), 50);
}

export function PrintArea({ children, widthMm, onDone }: { children: ReactNode; widthMm: number; onDone: () => void }) {
  useEffect(() => {
    const after = () => onDone();
    window.addEventListener('afterprint', after);
    printNow(widthMm);
    return () => window.removeEventListener('afterprint', after);
  }, [widthMm, onDone]);
  return createPortal(<div className="print-area" style={{ width: `${widthMm - 4}mm` }}>{children}</div>, document.body);
}

type T = Record<string, unknown>;
type C = Record<string, unknown> | null;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

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
    </div>
  );
}
