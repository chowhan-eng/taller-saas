import { BadgeCheck, Check, FileText, ShieldCheck, Unlock } from 'lucide-react';
import DemoSimulator from '@/components/DemoSimulator';
import RoiCalculator from '@/components/RoiCalculator';
import BeforeAfter from '@/components/BeforeAfter';
import FounderOffer, { FounderBadge, useFounderSeats } from '@/components/FounderOffer';
import { InboxMockup, QuoterMockup, TpvMockup } from '@/components/Mockups';
import { legalLine } from '@/lib/legal';
import '@/landing.css';

const FAQ: [string, string][] = [
  ['¿Tengo que cambiar mi número de WhatsApp?',
   'No. Con la conexión oficial de Meta puedes seguir usando WhatsApp Business en el móvil del taller y los avisos salen desde ese mismo número. Si lo prefieres, también puedes usar un número nuevo solo para avisos.'],
  ['¿Me pueden bloquear WhatsApp?',
   'Usamos la API oficial de Meta, no apps piratas que escanean el QR. Solo enviamos avisos a clientes que han aceptado recibirlos en el resguardo, y la palabra BAJA los da de baja al momento. Además, el sistema se frena solo si detecta un problema de calidad, y tienes un botón de pausa de emergencia.'],
  ['¿Cuánto cuesta cada mensaje?',
   'Starter incluye 400 conversaciones al mes, de sobra para un taller de unas 150 reparaciones. Si te pasas, pagas el coste de Meta más un pequeño margen, y te avisamos antes.'],
  ['¿La IA puede contestar algo que no debe?',
   'Tú decides el modo: apagada, en prueba (prepara respuestas pero no envía nada) o activa. Quejas, garantías, negociación de presupuestos y temas no claros se bloquean siempre y te los deja a ti, y puedes bloquear más temas. Cada decisión queda en un registro.'],
  ['¿De dónde salen los precios de los proveedores?',
   'Con tu propia cuenta de distribuidor de Androgeek y SpainSellers ves tus precios reales. Sin cuenta se usan los precios públicos (en SpainSellers, una estimación marcada como tal). MuchoRepuesto no permite consultas automáticas: se abre su web y apuntas el precio, que recordamos para la próxima vez. Tus accesos se guardan cifrados.'],
  ['No tengo tiempo para configurar nada.',
   'El alta dura un minuto. Si te atascas, la Instalación Llave en Mano lo deja todo funcionando en una videollamada de 60 minutos.'],
  ['¿Sirve con mi impresora térmica?',
   'Sí, si es de 58 u 80 mm (Epson, Xprinter, Star, la típica USB…). En el alta imprimes un ticket de prueba para comprobarlo.'],
  ['¿Hace facturas? ¿Y Verifactu?',
   'No factura: el plan Pro genera resguardos de depósito, que no son facturas, así que puedes seguir con tu programa de facturación o tu gestoría. La facturación Verifactu llegará conectada a un proveedor certificado.'],
  ['¿Mis datos y los de mis clientes?',
   'Servidores en la Unión Europea. Nombres, teléfonos, mensajes y códigos de desbloqueo se guardan cifrados (AES-256-GCM). Firmamos contigo el contrato de Encargado del Tratamiento (RGPD art. 28). Tus datos son tuyos y los exportas cuando quieras.'],
  ['¿Permanencia?',
   'Ninguna. Te das de baja desde el panel. Y si en los primeros 30 días no te convence, te devolvemos el dinero.'],
];

const TRUST = [
  { Icon: ShieldCheck, t: 'Cifrado AES-256-GCM', d: 'Nombres, teléfonos, mensajes y códigos de desbloqueo, siempre cifrados.' },
  { Icon: FileText, t: 'RGPD · Encargado del Tratamiento', d: 'Firmamos contigo el contrato del art. 28. Servidores en la UE.' },
  { Icon: BadgeCheck, t: 'API oficial de WhatsApp', d: 'Sin apps con QR. Baja con «BAJA» al instante y pausa de emergencia.' },
  { Icon: Unlock, t: 'Cero permanencia', d: 'Te das de baja desde el panel y exportas tus datos.' },
];

const Tick = ({ children }: { children: React.ReactNode }) => <li><Check size={16} aria-hidden /><span>{children}</span></li>;

export default function Home() {
  const seats = useFounderSeats();
  const founderFull = seats?.left === 0;
  return (
    <main className="lp">
      <header className="lp-nav">
        <div className="wrap">
          <a className="lp-logo" href="/"><i aria-hidden /> Taller SaaS</a>
          <span className="sp" />
          <a className="lnk" href="#producto">Producto</a><a className="lnk" href="#planes">Precios</a><a className="lnk" href="#faq">Preguntas</a><a className="lnk" href="/login">Entrar</a>
          <a className="lp-btn primary sm" href="/onboarding">Probar gratis</a>
        </div>
      </header>

      <section className="lp-hero">
        <div className="wrap lp-hero-grid">
          <div>
            <FounderBadge />
            <h1>El sistema operativo <em>con IA</em> para talleres de reparación</h1>
            <p className="lead">
              WhatsApp que avisa solo, una recepcionista con IA que contesta por ti, presupuestos con los precios de tus proveedores y caja con CashDro.
              Todo en un sitio, hecho por un técnico con más de 20 años de taller en Valencia.
            </p>
            <div className="lp-cta-row">
              <a className="lp-btn primary" href="#demo">Pruébalo en tu móvil ahora →</a>
              <a className="lp-btn ghost" href="#planes">Ver planes</a>
            </div>
            <div className="lp-micro"><span>14 días gratis en Starter</span><span>Sin permanencia</span><span>Garantía de 30 días</span></div>
          </div>
          <div className="lp-frame"><InboxMockup /></div>
        </div>
      </section>

      <section className="lp-trust" aria-label="Seguridad y cumplimiento">
        <div className="wrap">
          <ul>{TRUST.map(({ Icon, t, d }) => <li key={t}><Icon size={22} aria-hidden /><span><strong>{t}</strong>{d}</span></li>)}</ul>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="center"><span className="lp-kicker">Si tienes un taller, esto te suena</span><h2>Lo que te quita el tiempo no es reparar</h2></div>
          <div className="lp-grid3" style={{ marginTop: 28 }}>
            {[['📞', 'El teléfono no para', 'Suena 20 veces al día para preguntar «¿cómo va lo mío?», y cada llamada te saca de la placa que estabas soldando.'],
              ['🗂️', 'Resguardos perdidos', 'A mano o en un Excel que nadie encuentra cuando el cliente vuelve por garantía.'],
              ['⭐', 'Reseñas que no llegan', 'Clientes contentos que se van sin dejar reseña, mientras la cadena de la esquina tiene miles.']].map(([i, t, d]) => (
              <div key={t} className="lp-card lp-problem"><span className="ic" aria-hidden>{i}</span><div><h3>{t}</h3><p>{d}</p></div></div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-soft">
        <div className="wrap">
          <div className="center"><span className="lp-kicker">Antes vs. después</span><h2>Un día de taller, con y sin sistema</h2><p className="lp-sub">Cambia el interruptor y compara la misma jornada.</p></div>
          <BeforeAfter />
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="center"><span className="lp-kicker">Calculadora</span><h2>¿Cuánto tiempo te devuelve?</h2><p className="lp-sub">Mueve los deslizadores con los datos de tu taller. Los supuestos están a la vista.</p></div>
          <RoiCalculator />
        </div>
      </section>

      <section className="lp-soft" id="producto">
        <div className="wrap">
          <div className="center"><span className="lp-kicker">El producto</span><h2>Tres herramientas, un solo panel</h2><p className="lp-sub">Cada una con el aspecto y los atajos de una herramienta de mostrador, no de un formulario genérico.</p></div>

          <div className="lp-feature">
            <div>
              <h3 style={{ fontSize: '1.6rem' }}>WhatsApp con recepcionista IA</h3>
              <p className="lp-sub" style={{ marginBottom: 0 }}>Tus clientes reciben el aviso cuando su reparación entra, tiene presupuesto y está lista. Y si te escriben, la IA prepara la respuesta.</p>
              <ul>
                <Tick>Bandeja de tres paneles con cuenta atrás de la ventana de 24 h de WhatsApp.</Tick>
                <Tick>La IA contesta sola solo cuando está segura; quejas y garantías siempre te las deja a ti.</Tick>
                <Tick>Registro de cada decisión de la IA, horario de atención y botón de pausa de emergencia.</Tick>
                <Tick>La reseña de Google se pide sola al entregar.</Tick>
              </ul>
            </div>
            <div className="lp-shot"><InboxMockup /></div>
          </div>

          <div className="lp-feature flip">
            <div>
              <h3 style={{ fontSize: '1.6rem' }}>Reparo: tickets y presupuestos <span className="lp-pill">Plan Pro</span></h3>
              <p className="lp-sub" style={{ marginBottom: 0 }}>Resguardo, etiqueta y presupuesto en un minuto, comparando lo que cuesta la pieza en cada proveedor.</p>
              <ul>
                <Tick>Compara Androgeek y SpainSellers con tu cuenta de distribuidor; MuchoRepuesto en un clic.</Tick>
                <Tick>Te avisa cuando el precio de una pieza sube desde la última vez que la presupuestaste.</Tick>
                <Tick>Tu margen, tu mano de obra y el IVA al 21 % ya calculados. Mensaje listo para el cliente.</Tick>
                <Tick>Resguardo y etiqueta en 58/80 mm, PIN o patrón del dispositivo guardados cifrados.</Tick>
              </ul>
            </div>
            <div className="lp-shot"><QuoterMockup /></div>
          </div>

          <div className="lp-feature">
            <div>
              <h3 style={{ fontSize: '1.6rem' }}>TPV con CashDro y cierre de caja <span className="lp-pill">Plan Pro</span></h3>
              <p className="lp-sub" style={{ marginBottom: 0 }}>Cobra, devuelve y cierra sin calculadora. El efectivo pasa por tu CashDro y el cierre se cuadra solo.</p>
              <ul>
                <Tick>Cobro de reparaciones listas en un toque, efectivo y tarjeta en el mismo ticket.</Tick>
                <Tick>Devoluciones por venta o por línea, con stock que se repone y aviso de poco stock.</Tick>
                <Tick>Cierre Z guiado: ventas, tarjeta, efectivo contado, diferencia y fondo de mañana.</Tick>
                <Tick>Conexión con el puente CashDro y código QR de reseña al terminar el cobro.</Tick>
              </ul>
            </div>
            <div className="lp-shot"><TpvMockup /></div>
          </div>
        </div>
      </section>

      <section id="demo">
        <div className="wrap lp-demo">
          <div>
            <span className="lp-kicker">Demo en 5 segundos</span>
            <h2>Recibe en tu móvil el aviso que verían tus clientes</h2>
            <p className="lp-sub">Sin instalar nada y sin tarjeta. Te mandamos un único WhatsApp de ejemplo con el nombre de tu taller.</p>
            <ul className="ticks"><li>Un solo mensaje, solo a tu número</li><li>Sin compromiso</li><li>Puedes darte de baja con «BAJA»</li></ul>
          </div>
          <DemoSimulator />
        </div>
      </section>

      <FounderOffer />

      <section id="planes">
        <div className="wrap">
          <div className="center"><span className="lp-kicker">Precios</span><h2>Empieza pequeño, crece cuando quieras</h2><p className="lp-sub">Sin permanencia. IVA no incluido. Garantía de devolución de 30 días.</p></div>
          <div className="lp-plans" style={{ marginTop: 34 }}>
            <div className="lp-plan hot">
              <span className="tag">Fundadores · 10 plazas</span>
              <h3>Fundador</h3>
              <div className="pr">59 €<small> /año</small></div>
              <p className="then">Después, 29 €/mes de por vida</p>
              <ul>
                <Tick>Todo el plan Pro el primer año: WhatsApp + IA + Reparo + TPV</Tick>
                <Tick>Tarifa bloqueada de 29 €/mes mientras sigas</Tick>
                <Tick>Contacto directo con el fundador por WhatsApp</Tick>
                <Tick>A cambio: reportas fallos y, si te ahorra tiempo, un testimonio</Tick>
              </ul>
              {founderFull ? <a className="lp-btn outline block" href="/onboarding?plan=pro">Plazas agotadas · ver Pro</a> : <a className="lp-btn solid block" href="/onboarding/?plan=founder">{seats ? `Quedan ${seats.left} de ${seats.cap} · Reservar` : 'Reservar mi plaza'}</a>}
            </div>
            <div className="lp-plan">
              <h3>Starter</h3>
              <div className="pr">39 €<small> /mes</small></div>
              <p className="then">14 días de prueba gratis</p>
              <ul>
                <Tick>Avisos automáticos de WhatsApp: entrada, presupuesto y «ya está listo» (400 conversaciones/mes)</Tick>
                <Tick>Recepcionista IA de WhatsApp 24/7</Tick>
                <Tick>Impulso de reseñas de Google al entregar</Tick>
              </ul>
              <a className="lp-btn outline block" href="/onboarding?plan=starter">Empezar mis 14 días gratis</a>
              <p className="fine">Pedimos la tarjeta al empezar y no se cobra nada si cancelas antes del día 15. Durante la prueba: hasta 50 mensajes de WhatsApp.</p>
            </div>
            <div className="lp-plan">
              <h3>Pro</h3>
              <div className="pr">79 €<small> /mes</small></div>
              <p className="then">Todo lo de Starter y más</p>
              <ul>
                <Tick>Todo lo de Starter (1.000 conversaciones/mes)</Tick>
                <Tick>Reparo CRM: resguardos + etiquetas 58/80 mm, clientes y reparaciones</Tick>
                <Tick>Presupuestador con proveedores, técnicos, garantías e informes</Tick>
                <Tick>TPV + cierre de caja + CashDro · facturación Verifactu <span className="muted small">(en despliegue progresivo)</span></Tick>
              </ul>
              <a className="lp-btn outline block" href="/onboarding?plan=pro">Empezar con Pro</a>
            </div>
          </div>
          <p className="small muted center" style={{ marginTop: 22 }}>Instalación Llave en Mano por AnyDesk: 149 € (gratis en plan anual).</p>
        </div>
      </section>

      <section className="lp-soft">
        <div className="wrap lp-about">
          <div>
            <span className="lp-kicker">Quién está detrás</span>
            <h2>Hecho en un mostrador, no en una oficina</h2>
            <p>Llevo desde 2003 detrás del mostrador de <strong>Informática Torrent</strong>, en Valencia: móviles, consolas, portátiles, microsoldadura. Más de 1.800 reseñas en Google.</p>
            <p>Este programa lo hice para mi propio taller, porque ninguno de los que probé estaba pensado para cómo trabajamos de verdad: con prisa, con el cliente delante y con el soldador encendido. Ahora lo abro a otros talleres.</p>
          </div>
          {/* Drop the real counter photo at public/mostrador.jpg; until then the image hides itself. */}
          <img src="/mostrador.jpg" alt="El mostrador de Informática Torrent en Valencia" style={{ width: '100%', height: 'auto', borderRadius: 18, objectFit: 'cover', boxShadow: '0 20px 50px -24px rgba(15,23,42,.5)' }}
               onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
      </section>

      <section id="faq">
        <div className="wrap">
          <div className="center"><span className="lp-kicker">Preguntas frecuentes</span><h2>Lo que suelen preguntar los talleres</h2></div>
          <div className="lp-faq" style={{ marginTop: 28 }}>{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
        </div>
      </section>

      <section className="lp-final">
        <div className="wrap">
          <h2>Tu próximo cliente puede recibir su aviso hoy mismo</h2>
          <p>14 días de prueba gratis · Garantía de 30 días · Sin permanencia</p>
          <a className="lp-btn primary" href="/onboarding">Empieza gratis · después 39 €/mes</a>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="wrap">© {new Date().getFullYear()} Taller SaaS · <a href="/privacidad">Privacidad</a>{legalLine() && <> · {legalLine()}</>}</div>
      </footer>
    </main>
  );
}
