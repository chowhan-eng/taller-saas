# 05 — Hoja de ruta maestra de 90 días (de €0 a los primeros talleres de pago)

> **Inicio:** lunes 16 nov 2026 (Día 1) · **Fin:** viernes 12 feb 2027 (Día 89).
> **Objetivo honesto (doc 01):** **15–25 talleres de pago a los 90 días** (≈ €500–900 MRR) y **50 talleres / €3.000 MRR entre los meses 6 y 9**. El objetivo de 50 en 90 días queda como "techo", no como plan.
> **Reglas:** un solo canal de captación durante 30 días · como mucho 5 altas por semana · bloques fijos (L–V 8:00–10:00 y 14:00–17:00) para no robarle horas punta a tu taller.
> **Índice:** [01 Veredicto](01-BOARDROOM-EXECUTIVE-VERDICT.md) · [02 Arquitectura](02-GSTACK-TECHNICAL-ARCHITECTURE.md) · [03 Web y demo](03-WEBSITE-AND-LIVE-DEMO-SPEC.md) · [04 Ventas y voz](04-AUTOMATED-SALES-AND-VOICE-ENGINE.md)

---

## 1. Costes mensuales de infraestructura (estimados; verifica las tarifas vigentes)

| Servicio | Mes 1 (construcción) | Con 20 talleres | Con 50 talleres |
|---|---|---|---|
| Supabase | €0 (Free) | €25 (Pro) | €25–40 |
| Vercel | €0 (Hobby) | €20 (Pro) | €20 |
| Meta WhatsApp (≈ 60 tickets por taller; utility ≈ €0,02–0,03, reseñas marketing ≈ €0,05–0,06) | ≈ €2 (demo) | ≈ €80–120 | ≈ €200–300 |
| Retell + Twilio +34 (número ≈ €1–5 + minutos) | €0 | ≈ €40–70 | ≈ €80–120 |
| Stripe (1,5 % + €0,25) | €0 | ≈ €14 | ≈ €35 |
| Google Places API (con presupuesto limitado) | ≈ €30–60 una vez | €0–20 | €0–20 |
| Dominio + email (Google Workspace / Zoho) | ≈ €8 | €8 | €15 |
| Turnstile, Sentry, Plausible/PostHog free, Cal.com free | €0 | €0 | €0 |
| **Total infra** | **≈ €40–70** | **≈ €190–280** | **≈ €375–550** |
| Únicos: SL (≈ €300–600 + notario/gestoría), abogado RGPD/fiscal (≈ €600–1.500), folletos/cartas (≈ €150–300) | | | |

**Margen:** con 20 talleres × ≈ €32 de media ≈ €640 MRR, la infra son ≈ €230 → margen bruto ≈ 64 % **antes** de tu tiempo. El negocio empieza a tener sentido a partir de unos 40 talleres o con Pro.

---

## 2. Semana a semana (con detalle diario en las 2 primeras)

### Semana 1 (16–20 nov): cimientos y trámites lentos
- **L16:**
  - Pide cita para **constituir la SL** (gestoría).
  - Elige marca y dominio.
  - **Arregla el bug de opt-out** en tu app actual (`whatsappWebhook/entry.ts:377`, ver doc 02 §3.6).
  - Empieza el **registro de horas** (30 días).
- **M17:** abre Meta Business Manager y crea la app de Meta. Prepara la verificación de empresa (con tu taller mientras se constituye la SL, o espera a tener el CIF).
- **X18:**
  - Instala Docker Desktop y la Supabase CLI.
  - Ejecuta `supabase init` y copia `migrations/` y `tests/`.
  - Ejecuta `supabase start && supabase db reset && supabase test db`, y **corrige hasta que esté en verde** (el SQL no se ha ejecutado todavía).
- **J19:** solicita el número +34 en Twilio (paquete regulatorio). Crea la WABA de **demo** y envía la plantilla `demo_taller_listo` a aprobación.
- **V20:** pide **3 presupuestos a proveedores Verifactu** con API multi-emisor. Envía al abogado los borradores del DPA y de las condiciones.

### Semana 2 (23–27 nov): motor de tickets en tu propio taller
- **L23–M24:** web app con Auth OTP + wizard pasos 0–4 (doc 02 §4).
- **X25:** alta de ticket en 30 s + resguardo 58/80 mm (CSS `@page`). Pruébalo con tu impresora.
- **J26:** panel de tickets con lista infinita + cambio de estado.
- **V27:** **usa el sistema en paralelo con Reparo en tu mostrador** (los tickets reales los das de alta en los dos sitios). Apunta todo lo que te frene.
- **Paralelo:** solicita la App Review / Tech Provider de Meta (vídeo del flujo).

### Semana 3 (30 nov–4 dic): WhatsApp en el núcleo nuevo
- `wa-dispatch`, `wa-webhook` y opt-out correcto. Tu taller envía los avisos desde el núcleo nuevo.
- **Criterio:** 7 días sin duplicados y opt-out probado con "no", "NO gracias" y "BAJA".
- Web comercial (doc 03) con el simulador funcionando.

### Semana 4 (7–11 dic): cobrar
- Stripe Checkout + webhook + Customer Portal + cupón Fundador + garantía de 30 días.
- **Preventa (puerta nº 2):** visita a 15 talleres de tu zona (Torrent, Aldaia, Alaquàs, Xirivella, Picanya, Paiporta, Valencia ciudad) con folleto y simulador. **Objetivo: 10 "sí" con pago o señal.**
- 🛑 **Si hay menos de 5 "sí": no construyas más.** Entrevista a quienes dijeron que no y ajusta precio y mensaje.

### Semanas 5–6 (14–25 dic): 5 talleres piloto
- Embedded Signup + Coexistence en producción (si Meta ya aprobó). Si no, los pilotos usan un número nuevo con tu WABA y tú gestionas la conexión manualmente.
- Instala tú mismo a los 5 primeros (Llave en Mano, gratis para ellos) y anota cada atasco → vídeos de 90 s.
- **Navidad:** los talleres están a tope, así que no captes del 21 dic al 6 ene. Dedica ese tiempo a pulir y a los vídeos.

### Semanas 7–8 (28 dic–8 ene): estabilidad + contenido
- Panel de resultados ("X avisos, Y reseñas, Z llamadas evitadas").
- Importador CSV (Reparo y otros).
- Graba 5 vídeos desde tu mostrador.
- **Mide tu dato real:** llamadas "¿ya está?" antes y después (para la calculadora de ROI y el email del D5).
- 1 ene 2027: arranca Verifactu para las SL. Recuerda a tus clientes que Starter no factura (FAQ).

### Semanas 9–10 (11–22 ene): captación por un solo canal
- **Canal elegido: visitas en persona + folleto** en la provincia de Valencia (15 visitas por semana).
- Ejecuta `scraper_talleres.py --provincias "Valencia" --check-web` → ruta ordenada por Pain Score.
- Referidos activos (un mes gratis para ambos).
- Agente de voz **solo para entrantes** + callbacks con consentimiento.

### Semanas 11–12 (25 ene–5 feb): segundo canal + revisión
- **Día 60 (≈ 14 ene) = STOP-LOSS:** si hay menos de 8 talleres de pago, se congela la captación y se revisa (doc 01 §4.5).
- Si se supera: añade cartas postales (100 a la semana) a Castellón y Alicante.
- Revisión de churn y activación. Si la activación baja del 70 %, se arregla el onboarding antes de captar más.

### Semana 13 (8–12 feb): decisión de Pro
- **Puertas de Pro:** TPV + cierre usados 30 días en tu taller con cuadre + proveedor Verifactu firmado + al menos 15 Starter activos.
- Si se cumplen: lista de espera de Pro → los primeros 5 a €59.
- Si llegas a ≈ 25 talleres o el soporte pasa de 8 h/semana: **contrata media jornada de soporte** (≈ €1.000–1.200/mes, doc 01 §1.6).

---

## 3. Panel semanal (los lunes, 15 minutos)
| Métrica | Semana 4 | Semana 8 | Semana 13 |
|---|---|---|---|
| Talleres de pago | 3–5 (preventa) | 8–12 | 15–25 |
| MRR | €100–150 | €250–400 | €500–900 |
| Activación en la semana 1 | — | ≥ 70 % | ≥ 70 % |
| Duplicados de WhatsApp | 0 | 0 | 0 |
| Horas/semana en el SaaS (registro) | ≤ 20 | ≤ 20 | ≤ 20 |
| Calidad de los números (Meta) | Green | Green | Green |

## 4. Lo que NO harás en estos 90 días
WhatsApp o email en frío · llamadas automáticas sin consentimiento · vender Pro, TPV o CashDro · migrar tus apps Base44 actuales · más de un canal nuevo a la vez · prueba gratis sin tarjeta.
