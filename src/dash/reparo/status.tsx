// Ticket statuses and the solid pill used across Reparo, the WhatsApp context panel and the TPV.
// Group colours follow the production Reparo StatusPill (new #e11d48 · in progress #f97316 · ready #65a30d · failed #64748b).
import { Laptop, Gamepad2, Smartphone, Tablet, Watch, Monitor, HardDrive, Cpu } from 'lucide-react';

export const STATUS: Record<string, { label: string; color: string; group: 'new' | 'in_progress' | 'ready' | 'done' | 'failed' }> = {
  recibido: { label: 'Recibido', color: '#e11d48', group: 'new' },
  diagnostico: { label: 'Diagnóstico', color: '#f97316', group: 'in_progress' },
  presupuesto_enviado: { label: 'Presupuesto enviado', color: '#f59e0b', group: 'in_progress' },
  presupuesto_aceptado: { label: 'Presupuesto aceptado', color: '#d97706', group: 'in_progress' },
  presupuesto_rechazado: { label: 'Presupuesto rechazado', color: '#64748b', group: 'failed' },
  esperando_pieza: { label: 'Esperando pieza', color: '#ea580c', group: 'in_progress' },
  en_reparacion: { label: 'En reparación', color: '#f97316', group: 'in_progress' },
  listo_recoger: { label: 'Listo para recoger', color: '#65a30d', group: 'ready' },
  entregado: { label: 'Entregado', color: '#15803d', group: 'done' },
  no_reparable: { label: 'No reparable', color: '#64748b', group: 'failed' },
  cancelado: { label: 'Cancelado', color: '#64748b', group: 'failed' },
};
export const STATUS_ORDER = Object.keys(STATUS);
export const GROUPS: [string, string[]][] = [
  ['Entrada', ['recibido']],
  ['En curso', ['diagnostico', 'presupuesto_enviado', 'presupuesto_aceptado', 'esperando_pieza', 'en_reparacion']],
  ['Listo', ['listo_recoger']],
  ['Cerrados', ['entregado', 'presupuesto_rechazado', 'no_reparable', 'cancelado']],
];

export function StatusPill({ status, small }: { status: string; small?: boolean }) {
  const s = STATUS[status] ?? { label: status, color: '#64748b' };
  return (
    <span className={`inline-block whitespace-nowrap rounded-full font-semibold text-white ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]'}`} style={{ background: s.color }}>
      {s.label}
    </span>
  );
}

export const DEVICES: { key: string; label: string; Icon: typeof Laptop }[] = [
  { key: 'movil', label: 'Móvil', Icon: Smartphone },
  { key: 'tablet', label: 'Tablet', Icon: Tablet },
  { key: 'portatil', label: 'Portátil', Icon: Laptop },
  { key: 'sobremesa', label: 'Sobremesa', Icon: Monitor },
  { key: 'consola', label: 'Consola', Icon: Gamepad2 },
  { key: 'mando', label: 'Mando', Icon: Cpu },
  { key: 'smartwatch', label: 'Reloj', Icon: Watch },
  { key: 'otro', label: 'Otro', Icon: HardDrive },
];

export function DeviceIcon({ type, size = 18 }: { type: string; size?: number }) {
  const Icon = (DEVICES.find((d) => d.key === type) ?? DEVICES[7]).Icon;
  return <Icon size={size} aria-label={type} />;
}
