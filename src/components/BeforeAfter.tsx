// «Antes vs. Después» of a repair shop's day. Interactive toggle; both columns stay visible so it scans well.
import { useState } from 'react';
import { PhoneOff, Sparkles } from 'lucide-react';

const BEFORE: [string, string][] = [
  ['10:05', 'Suena el teléfono: «¿Ya está mi móvil?». Dejas la placa a medias.'],
  ['10:40', 'Otra llamada igual. Y un cliente en el mostrador esperando.'],
  ['12:15', 'Buscas el resguardo en papel: no aparece. Llamas al cliente para pedirle el número.'],
  ['17:30', 'Entregas la reparación. El cliente se va contento… sin dejar reseña.'],
  ['20:45', 'Cierras caja a mano con la calculadora. Te faltan 3 €. ¿Dónde?'],
];
const AFTER: [string, string][] = [
  ['10:05', 'Cambias el estado a «Listo» y el cliente recibe su WhatsApp. Nadie llama.'],
  ['10:40', 'Un cliente escribe por la noche: la IA contesta horario y precios, y te deja el borrador.'],
  ['12:15', 'Buscas «Luis» y ves su reparación, el presupuesto y la conversación en una pantalla.'],
  ['17:30', 'Al entregar, el sistema le pide la reseña de Google por ti. 24 h después, sin que hagas nada.'],
  ['20:45', 'Cierre de caja guiado: ventas, tarjeta, efectivo contado y diferencia. En 2 minutos.'],
];

export default function BeforeAfter() {
  const [view, setView] = useState<'before' | 'after'>('after');
  return (
    <div>
      <div className="lp-toggle" role="group" aria-label="Comparar un día de taller">
        <button type="button" aria-pressed={view === 'before'} onClick={() => setView('before')}>Antes</button>
        <button type="button" aria-pressed={view === 'after'} onClick={() => setView('after')}>Después</button>
      </div>
      <div className="lp-ba">
        {([['before', 'Sin sistema', BEFORE, PhoneOff], ['after', 'Con Taller SaaS', AFTER, Sparkles]] as const).map(([k, title, rows, Icon]) => (
          <div key={k} className={`col ${k} ${view === k ? 'on' : ''}`}>
            <h3><Icon size={18} aria-hidden /> {title}</h3>
            <ul>{rows.map(([t, txt]) => <li key={t}><time>{t}</time><span>{txt}</span></li>)}</ul>
          </div>
        ))}
      </div>
    </div>
  );
}
