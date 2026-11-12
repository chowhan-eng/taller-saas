import DemoSimulator from '@/components/DemoSimulator';
import RoiCalculator from '@/components/RoiCalculator';
import { legalLine } from '@/lib/legal';


const FAQ: [string, string][] = [
  ['¿Tengo que cambiar mi número de WhatsApp?',
   'No. Con la conexión oficial de Meta puedes seguir usando WhatsApp Business en el móvil del taller y los avisos salen desde ese mismo número. Si lo prefieres, también puedes usar un número nuevo solo para avisos.'],
  ['¿Me pueden bloquear WhatsApp?',
   'Usamos la API oficial de Meta, no apps piratas que escanean el QR. Solo enviamos avisos a clientes que han aceptado recibirlos en el resguardo, y la palabra BAJA los da de baja al momento. Además, el sistema se frena solo si detecta un problema de calidad.'],
  ['¿Cuánto cuesta cada mensaje?',
   'Starter incluye 400 conversaciones al mes, de sobra para un taller de unas 150 reparaciones. Si te pasas, pagas el coste de Meta más un pequeño margen, y te avisamos antes.'],
  ['No tengo tiempo para configurar nada.',
   'El alta dura un minuto. Si te atascas, la Instalación Llave en Mano lo deja todo funcionando en una videollamada de 60 minutos.'],
  ['¿Sirve con mi impresora térmica?',
   'Sí, si es de 58 u 80 mm (Epson, Xprinter, Star, la típica USB…). En el alta imprimes un ticket de prueba para comprobarlo.'],
  ['¿Hace facturas? ¿Y Verifactu?',
   'No factura: el plan Pro genera resguardos de depósito, que no son facturas, así que puedes seguir con tu programa de facturación o tu gestoría. La facturación Verifactu llegará conectada a un proveedor certificado.'],
  ['¿Mis datos y los de mis clientes?',
   'Servidores en la Unión Europea. Firmamos contigo el contrato de Encargado del Tratamiento (RGPD art. 28). Tus datos son tuyos y los exportas cuando quieras.'],
  ['¿Permanencia?',
   'Ninguna. Te das de baja desde el panel. Y si en los primeros 30 días no te convence, te devolvemos el dinero.'],
];

export default function Home() {
  return (
    <main>
      <section>
        <div className="wrap hero">
          <div>
            <span className="eyebrow">Creado por un técnico con más de 20 años de taller en Valencia, para otros talleres</span>
            <h1>Deja de contestar «¿Ya está mi móvil?»</h1>
            <p className="lead">
              Tus clientes reciben un WhatsApp automático cuando su reparación entra, tiene presupuesto y está lista. Y al recogerla,
              les pedimos la reseña de Google por ti.
            </p>
            <a className="btn inline" href="#demo">Pruébalo en tu móvil ahora →</a>
            <p className="small muted">Sin instalar nada · Sin tarjeta para la demo · 5 segundos</p>
            <ul className="ticks">
              <li><strong>14 Días de Prueba Gratis</strong> en el plan Starter</li>
              <li>Resguardo e impresión de etiquetas 58/80 mm (plan Pro)</li>
              <li>Avisos de WhatsApp con el número de TU taller</li>
              <li>Recordatorio automático de reseñas</li>
              <li>Garantía de devolución de 30 días</li>
            </ul>
          </div>
          <DemoSimulator />
        </div>
      </section>

      <section className="soft">
        <div className="wrap">
          <h2>Si tienes un taller, esto te suena</h2>
          <div className="grid3">
            <div className="card"><h3>📞 El teléfono no para</h3><p>Suena 20 veces al día para preguntar «¿cómo va lo mío?», y cada llamada te saca de la placa que estabas soldando.</p></div>
            <div className="card"><h3>🗂️ Resguardos perdidos</h3><p>A mano o en un Excel que nadie encuentra cuando el cliente vuelve por garantía.</p></div>
            <div className="card"><h3>⭐ Reseñas que no llegan</h3><p>Clientes contentos que se van sin dejar reseña, mientras la cadena de la esquina tiene miles.</p></div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <h2>Cómo funciona</h2>
          <div className="grid3">
            <div className="card"><h3>1. Alta en 30 segundos <span className="small muted">(Solo plan Pro)</span></h3><p>Teléfono, modelo y avería. Imprime el resguardo y la etiqueta.</p></div>
            <div className="card"><h3>2. Un toque y avisado</h3><p>Cambias el estado a «Presupuesto» o «Listo» y tu cliente recibe el WhatsApp desde el número de tu taller.</p></div>
            <div className="card"><h3>3. La reseña, sola</h3><p>24 horas después de entregar, le pedimos la reseña con un enlace directo a tu ficha de Google.</p></div>
          </div>
        </div>
      </section>

      <section className="soft">
        <div className="wrap">
          <h2>¿Cuánto te ahorra?</h2>
          <RoiCalculator />
        </div>
      </section>

      <section id="planes">
        <div className="wrap">
          <h2>Planes</h2>
          <div className="grid2">
            <div className="card">
              <h3>Starter</h3>
              <p className="price">39 €<span className="small muted">/mes</span></p>
              <p className="small muted">Solo automatización de WhatsApp.</p>
              <p className="small"><strong>14 días de prueba gratis</strong>, después 39 €/mes. Pedimos la tarjeta al empezar y no se cobra nada si cancelas antes del día 15. Durante la prueba: hasta 50 mensajes de WhatsApp.</p>
              <ul className="ticks">
                <li>Avisos automáticos de WhatsApp: entrada, presupuesto y «ya está listo» (400 conversaciones/mes)</li>
                <li>Recepcionista IA de WhatsApp 24/7: contesta a tus clientes mientras trabajas</li>
                <li>Impulso de reseñas de Google: la petición sale sola al entregar</li>
              </ul>
              <a className="btn" href="/onboarding?plan=starter">Empezar mis 14 días gratis</a>
            </div>
            <div className="card">
              <h3>Pro</h3>
              <p className="price">79 €<span className="small muted">/mes</span></p>
              <ul className="ticks">
                <li>Todo lo de Starter (1.000 conversaciones/mes)</li>
                <li>Reparo CRM: resguardos + etiquetas 58/80 mm, clientes y reparaciones</li>
                <li>Técnicos, garantías e informes</li>
                <li>TPV + Cierre de caja + facturación Verifactu <span className="muted small">(en despliegue progresivo)</span></li>
              </ul>
              <a className="btn secondary" href="/onboarding?plan=pro">Empezar con Pro</a>
            </div>
          </div>
          <p className="small muted">IVA no incluido. Sin permanencia. 14 días de prueba gratis en Starter. Garantía de devolución de 30 días. Instalación Llave en Mano por AnyDesk: 149 € (gratis en plan anual).</p>
        </div>
      </section>

      <section className="soft">
        <div className="wrap grid2">
          <div>
            <h2>Quién está detrás</h2>
            <p>
              Llevo desde 2003 detrás del mostrador de <strong>Informática Torrent</strong>, en Valencia: móviles, consolas, portátiles,
              microsoldadura. Más de 1.800 reseñas en Google.
            </p>
            <p>
              Este programa lo hice para mi propio taller, porque ninguno de los que probé estaba pensado para cómo trabajamos de verdad:
              con prisa, con el cliente delante y con el soldador encendido. Ahora lo abro a otros talleres.
            </p>
          </div>
          {/* Drop the real counter photo at public/mostrador.jpg; until then the image hides itself. */}
          <img src="/mostrador.jpg" alt="El mostrador de Informática Torrent en Valencia" className="card"
               style={{ width: '100%', height: 'auto', padding: 0, objectFit: 'cover' }}
               onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
      </section>

      <section>
        <div className="wrap">
          <h2>Preguntas frecuentes</h2>
          {FAQ.map(([q, a]) => (
            <details key={q}><summary>{q}</summary><p>{a}</p></details>
          ))}
        </div>
      </section>

      <section className="soft">
        <div className="wrap" style={{ textAlign: 'center' }}>
          <h2>Tu próximo cliente puede recibir su aviso hoy mismo</h2>
          <a className="btn inline" href="/onboarding">Empieza tus 14 días gratis · después 39 €/mes</a>
          <p className="small muted">14 Días de Prueba Gratis · Garantía de 30 días · Sin permanencia</p>
        </div>
      </section>

      <footer>
        <div className="wrap">
          © {new Date().getFullYear()} Taller SaaS · <a href="/privacidad">Privacidad</a>
          {legalLine() && <> · {legalLine()}</>}
        </div>
      </footer>
    </main>
  );
}
