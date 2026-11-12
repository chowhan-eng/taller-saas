export default function Gracias() {
  const trial = new URLSearchParams(window.location.search).get('plan') !== 'pro';
  return (
    <main className="wrap" style={{ maxWidth: 560, padding: '48px 16px' }}>
      <div className="card" style={{ padding: 24 }}>
        <h2>¡Bienvenido a Taller SaaS! 🎉</h2>
        {trial ? (
          <p>Tu <strong>prueba gratis de 14 días</strong> ha empezado. No te cobraremos nada hasta el día 15 y puedes cancelar antes desde el panel. Durante la prueba puedes enviar hasta 50 mensajes de WhatsApp.</p>
        ) : (
          <p>Hemos recibido tu pago. En unos segundos tu taller quedará activado y te llegará la factura por email.</p>
        )}
        <p className="muted">
          Siguiente paso: conectar tu WhatsApp e imprimir tu primer resguardo de prueba. Si te atascas, responde a nuestro email y lo
          dejamos funcionando contigo por videollamada.
        </p>
        <p className="small muted">Recuerda: tienes 30 días de garantía de devolución, sin preguntas.</p>
      </div>
    </main>
  );
}
