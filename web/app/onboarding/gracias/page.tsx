export default function Gracias() {
  return (
    <main className="wrap" style={{ maxWidth: 560, padding: '48px 16px' }}>
      <div className="card" style={{ padding: 24 }}>
        <h2>¡Bienvenido a Taller SaaS! 🎉</h2>
        <p>Hemos recibido tu pago. En unos segundos tu taller quedará activado y te llegará la factura por email.</p>
        <p className="muted">
          Siguiente paso: conectar tu WhatsApp e imprimir tu primer resguardo de prueba. Si te atascas, responde a nuestro email y lo
          dejamos funcionando contigo por videollamada.
        </p>
        <p className="small muted">Recuerda: tienes 30 días de garantía de devolución, sin preguntas.</p>
      </div>
    </main>
  );
}
