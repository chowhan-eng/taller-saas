// «Programa Beta Fundadores»: live seat counter (public founderSlots function), the hero badge and the founder section.
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

/** Pill for the hero: «Quedan X de 10 plazas a 59 €/año» (anchor to the founder section). */
export function FounderBadge() {
  const seats = useFounderSeats();
  const full = seats?.left === 0;
  return (
    <a className={`lp-badge ${full ? 'full' : ''}`} href="#fundadores">
      <span className="dot" aria-hidden />
      {!seats ? 'Programa Beta Fundadores · 10 plazas a 59 €/año' : full ? 'Plazas de fundador agotadas' : `Quedan ${seats.left} de ${seats.cap} plazas a 59 €/año`}
      <span aria-hidden>→</span>
    </a>
  );
}

export default function FounderOffer() {
  const seats = useFounderSeats();
  const full = seats?.left === 0;
  return (
    <section className="lp-founder" id="fundadores">
      <div className="wrap">
        <div>
          <span className="lp-kicker" style={{ color: '#6ee7b7' }}>Programa Beta Fundadores · solo 10 talleres</span>
          <h2>59 € el primer año. Después, 29 €/mes de por vida.</h2>
          <p className="lp-sub" style={{ color: '#cbd5e1' }}>Los primeros talleres que confíen en nosotros se quedan con el precio de fundador para siempre y nos ayudan a afinar el producto.</p>
          <FounderTerms />
          {full
            ? <p className="small" style={{ color: '#94a3b8' }}>Las 10 plazas de fundador ya están cogidas. Puedes empezar con Starter o Pro.</p>
            : <a className="lp-btn primary" href="/onboarding/?plan=founder">Quiero ser taller fundador</a>}
          <p className="small" style={{ color: '#94a3b8', marginTop: 12 }}>IVA no incluido. Sin permanencia.</p>
        </div>
        <div className="lp-seats" aria-live="polite">
          <div className="n">{seats ? seats.left : '·'} <small>de {seats?.cap ?? 10} plazas libres</small></div>
          <div className="lp-bar" role="img" aria-label={seats ? `${seats.taken} de ${seats.cap} plazas ocupadas` : 'Cargando plazas'}>
            {Array.from({ length: seats?.cap ?? 10 }, (_, i) => <i key={i} className={seats && i < seats.taken ? 'on' : ''} />)}
          </div>
          <p className="small" style={{ margin: 0, color: '#94a3b8' }}>{seats ? (full ? 'Plazas agotadas.' : 'Cada alta confirmada ocupa una plaza. Una plaza reservada en un pago a medias se libera a los 35 minutos.') : 'Cargando…'}</p>
        </div>
      </div>
    </section>
  );
}
