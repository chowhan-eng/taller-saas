import { LEGAL, legalComplete } from '@/lib/legal';

const EMAIL = LEGAL.email || 'el email de privacidad indicado arriba';

export default function Privacidad() {
  return (
    <main className="wrap" style={{ maxWidth: 760, padding: '40px 16px 64px' }}>
      <div className="alert err" role="note">
        BORRADOR: texto provisional pendiente de revisión por un abogado especialista en protección de datos antes de publicar.
      </div>
      <h1>Política de privacidad</h1>
      <p><strong>Responsable:</strong>{' '}
        {legalComplete()
          ? <>{LEGAL.name}, CIF {LEGAL.cif}, {LEGAL.address}, {LEGAL.email}.</>
          : <em>datos del titular pendientes de publicar.</em>}
      </p>

      <h2>Demo de WhatsApp de la web</h2>
      <p>
        Si pides la demo, tratamos tu número de móvil y el nombre de tu taller para enviarte <strong>un único</strong> WhatsApp de
        demostración (base legal: tu consentimiento, art. 6.1.a RGPD).
        Guardamos el registro de tu consentimiento (fecha, IP y versión del texto) como prueba. Puedes retirarlo en cualquier momento
        respondiendo BAJA o escribiendo a {EMAIL}.
      </p>

      <h2>Clientes del servicio</h2>
      <p>Tratamos los datos de tu cuenta y de facturación para prestarte el servicio (ejecución del contrato, art. 6.1.b RGPD).</p>

      <h2 id="encargado">Encargado del Tratamiento (RGPD art. 28)</h2>
      <p>
        Respecto a los datos de los clientes de tu taller, <strong>tú eres el responsable</strong> y nosotros el encargado: solo los
        tratamos siguiendo tus instrucciones para prestar el servicio, con confidencialidad, medidas de seguridad, asistencia en el
        ejercicio de derechos, notificación de brechas y devolución o borrado al terminar. Subencargados: Base44 (alojamiento, base de datos y
        funciones de servidor), Meta Platforms (WhatsApp), Stripe (pagos) y, si el taller activa el recepcionista IA de WhatsApp, el proveedor de IA (se publicará aquí antes de activarlo). El nombre y el
        teléfono de tus clientes y los códigos de desbloqueo se guardan cifrados (AES-256). El{' '}
        <a href="/legal/contrato-encargado-tratamiento.md" target="_blank" rel="noopener">contrato completo</a>
        {' '}(versión <code>dpa-v1-2026-11</code>) se acepta en el alta.
      </p>

      <h2>Tus derechos</h2>
      <p>Acceso, rectificación, supresión, oposición, limitación y portabilidad en {EMAIL}. Puedes reclamar ante la AEPD (aepd.es).</p>
    </main>
  );
}
