import { useState } from 'react';

// Assumptions are shown on screen (docs/03 §3). Replace AVOID_RATE with the founder's measured data.
const AVOID_RATE = 0.6;   // share of "¿ya está?" calls a status WhatsApp prevents
const ASK_RATE = 0.5;     // share of customers who accept a review request
const REVIEW_RATE = 0.15; // share of those who actually leave a review
const PLAN_EUR = 39;

function Slider(p: { id: string; label: string; min: number; max: number; step: number; value: number; set: (n: number) => void; suffix?: string }) {
  return (
    <div className="field">
      <label htmlFor={p.id}>{p.label}: <strong>{p.value.toLocaleString('es-ES')}{p.suffix ?? ''}</strong></label>
      <input id={p.id} type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.set(Number(e.target.value))} />
    </div>
  );
}

export default function RoiCalculator() {
  const [repairs, setRepairs] = useState(120);
  const [callsPer, setCallsPer] = useState(1.5);
  const [mins, setMins] = useState(3);
  const [hour, setHour] = useState(25);

  const callsAvoided = Math.round(repairs * callsPer * AVOID_RATE);
  const hoursSaved = (callsAvoided * mins) / 60;
  const money = Math.round(hoursSaved * hour);
  const reviews = Math.round(repairs * ASK_RATE * REVIEW_RATE);
  const roi = money / PLAN_EUR;
  const n1 = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });

  return (
    <div className="lp-roi">
      <div className="lp-card">
        <Slider id="r1" label="Reparaciones al mes" min={20} max={600} step={10} value={repairs} set={setRepairs} />
        <Slider id="r2" label="Llamadas «¿ya está?» por reparación" min={0} max={4} step={0.5} value={callsPer} set={setCallsPer} />
        <Slider id="r3" label="Minutos perdidos por llamada" min={1} max={10} step={1} value={mins} set={setMins} />
        <Slider id="r4" label="Valor de tu hora" min={10} max={60} step={5} value={hour} set={setHour} suffix=" €" />
        <p className="small muted" style={{ margin: 0 }}>
          Estimación con estos supuestos: el aviso evita el {AVOID_RATE * 100} % de las llamadas, el {ASK_RATE * 100} % acepta que le pidan
          reseña y el {REVIEW_RATE * 100} % la deja. Cada taller es distinto.
        </p>
      </div>
      <div className="lp-out" aria-live="polite">
        <div className="big">{n1(hoursSaved)} h <small>al mes que recuperas</small></div>
        <p style={{ margin: '6px 0 0', position: 'relative', zIndex: 1 }}>≈ <strong style={{ color: '#fff' }}>{money.toLocaleString('es-ES')} €</strong> de tu tiempo, sin contar las ventas que se pierden por no contestar.</p>
        <dl>
          <div><dt>Llamadas evitadas</dt><dd>{callsAvoided}</dd></div>
          <div><dt>Reseñas de Google extra</dt><dd>+{reviews}/mes</dd></div>
          <div><dt>Coste de Starter</dt><dd>{PLAN_EUR} €/mes</dd></div>
          <div><dt>Retorno estimado</dt><dd className="roi">{n1(roi)}×</dd></div>
        </dl>
      </div>
    </div>
  );
}
