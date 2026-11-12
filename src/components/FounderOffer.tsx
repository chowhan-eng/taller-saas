// «Programa Beta Fundadores» card with the live seat counter (public founderSlots function).
import { useEffect, useState } from 'react';

export type Seats = { cap: number; taken: number; left: number };

export function useFounderSeats() {
  const [seats, setSeats] = useState<Seats | null>(null);
  useEffect(() => {
    fetch('/functions/founderSlots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && typeof d.left === 'number' && setSeats(d)).catch(() => {});
  }, []);
  return seats;
}

export const FOUNDER_COMMITMENT = 'Me comprometo a reportar fallos por WhatsApp y dar mi testimonio/reseña si la herramienta me ahorra tiempo.';

export function FounderTerms() {
  return (
    <ul className="ticks small">
      <li><strong>59 € por todo el primer año</strong> con acceso Pro completo: WhatsApp + IA + Reparo CRM + TPV.</li>
      <li><strong>Sin sorpresas en el segundo año:</strong> desde el año 2 mantienes de por vida la tarifa de fundador de <strong>29 €/mes</strong> (en lugar de 79 €/mes). Cancelas cuando quieras.</li>
      <li>A cambio, nos cuentas los fallos por WhatsApp y, si te ahorra tiempo, nos dejas tu testimonio.</li>
    </ul>
  );
}

export default function FounderOffer() {
  const seats = useFounderSeats();
  const full = seats?.left === 0;
  return (
    <section className="soft" id="fundadores">
      <div className="wrap">
        <div className="card founder">
          <span className="eyebrow">Programa Beta Fundadores · limitado a los 10 primeros talleres</span>
          <h2>59 € el primer año. Después, 29 €/mes para siempre.</h2>
          <FounderTerms />
          {seats && <p className="price-sm"><strong>{full ? 'Plazas agotadas' : `Quedan ${seats.left} de ${seats.cap} plazas`}</strong></p>}
          {full
            ? <p className="small muted">Las 10 plazas de fundador ya están cogidas. Puedes empezar con Starter o Pro.</p>
            : <a className="btn inline" href="/onboarding/?plan=founder">Quiero ser taller fundador</a>}
          <p className="small muted">IVA no incluido.</p>
        </div>
      </div>
    </section>
  );
}
