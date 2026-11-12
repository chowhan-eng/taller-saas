# 04 — Motor de captación automatizado + Agente de voz IA

> **Lectura obligatoria antes de automatizar nada:** el General Counsel del consejo (doc 01 §1.5) puso **STOP** a tres piezas del plan original:
> 1. **Scraping de Google Maps** → viola los ToS de Google.
> 2. **WhatsApp en frío** a móviles 6xx/7xx → LSSI art. 21 + política de Meta (riesgo de **baneo de tu número**).
> 3. **Llamada automática** a quien prueba el simulador **sin consentimiento específico** → LGT 11/2022 art. 66.
>
> Este documento rediseña el motor para que siga **muy automatizado** pero **sin ninguna de esas tres bombas**. Lo que se automatiza al 90 % es todo lo que pasa **después** de que el taller levante la mano. La primera toma de contacto en frío se hace con canales no electrónicos o hechos por una persona, que además son los que mejor convierten entre colegas de gremio.
> Cuando aquí se dice "legal" es una lectura prudente, no asesoría. **Valídalo con un abogado** antes de lanzar.

---

## 1. Mapa del embudo

```
            PROSPECCIÓN (lista)                CONTACTO EN FRÍO (humano/no electrónico)      LEVANTA LA MANO (consentimiento)        AUTOMÁTICO 90%
 Google Places API ─┐                         ┌─ Visita en persona (ruta por provincia)       ┌─ Simulador web (doc 03)        ┐  ┌─ WhatsApp de demo
 Distribuidores ────┼─▶ leads (pain score) ──▶├─ Carta postal + QR al simulador ─────────────▶├─ Llamada entrante al +34      ├─▶├─ Callback IA a los 5 min (si lo aceptó)
 Grupos/ferias ─────┘                         ├─ Llamada humana, 1 a 1, al fijo del negocio   ├─ Respuesta a anuncio / vídeo   │  ├─ Secuencia de email/WA con opt-in
                                              └─ Contenido (YouTube/TikTok/grupos técnicos)   └─ Referido de otro taller       ┘  └─ Enlace Stripe → alta → wizard
```

### 1.1 Matriz legal de canales

| Canal | ¿En frío? | Estado | Condiciones |
|---|---|---|---|
| Visita en persona | Sí | ✅ | Ninguna especial. Es tu mayor ventaja: eres del gremio |
| Carta / buzoneo con QR | Sí | ✅ | No es comunicación electrónica (no aplica LSSI). Incluye identificación y cómo oponerse |
| Llamada **hecha por una persona** al teléfono **publicado del negocio** | Sí | ⚠️ | Pocas llamadas, una a una. Filtra la **Lista Robinson**. Identifícate y respeta el "no". Para **autónomos** (personas físicas) la LGT art. 66 exige consentimiento previo para llamadas comerciales: **pide al abogado que confirme** si puedes llamar a negocios de autónomos. Si duda, limita la llamada en frío a **SL** |
| Llamada **automática / con IA** | No | ✅ solo con consentimiento | Casilla específica o petición verbal o escrita del taller |
| WhatsApp | No | ✅ solo con opt-in | Solo tras simulador, respuesta o petición |
| Email | No | ✅ solo con consentimiento o relación previa | LSSI art. 21–22. Sin "listas compradas" |
| Anuncios (Google/Meta) | — | ✅ | Formularios con casillas como en el doc 03 |
| Grupos de técnicos (Facebook/Telegram) | — | ✅ | Aportando valor, no haciendo spam. Respeta las normas de cada grupo |

---

## 2. Prospección: `automation/scraper_talleres.py`

### 2.1 Qué hace (y qué NO)
- **Usa la Google Places API (New), Text Search**: la vía oficial, de pago y dentro de los términos. **No** raspa el HTML de Google Maps.
- Busca por **provincia × término** ("reparación móviles", "servicio técnico móvil", "reparación consolas", "reparación ordenadores", "reparación portátiles", "servicio técnico informático").
- Clasifica teléfonos (**móvil 6xx/7xx** vs **fijo 8xx/9xx**) y calcula el **Pain Score**.
- **Cumplimiento con los términos de Google:** solo `place_id` puede guardarse indefinidamente. El resto (nombre, teléfono, web, valoración) se guarda **como máximo 30 días** (columna `fetched_at` + purga) y se **vuelve a consultar** cuando vas a contactar. Revisa los "Google Maps Platform Service Specific Terms" vigentes antes de usarlo.
- Exporta CSV para la **ruta de visitas** y el **envío postal**, y hace upsert en `leads` (Supabase, service_role) **sin** marcar ningún consentimiento.

### 2.2 Pain Score (0–100): cuanto más alto, más dolor (y más probable que compre)

| Señal | Puntos | Por qué |
|---|---|---|
| < 50 reseñas en Google | +25 (< 20: +30) | Necesita el impulsor de reseñas |
| Valoración < 4,3 | +10 | Clientes insatisfechos → falta de comunicación |
| Sin web | +20 | Poca digitalización, más margen de mejora |
| Web sin HTTPS o que tarda > 3 s / no responde | +10 | Señal de abandono digital |
| La web no menciona "WhatsApp" ni `wa.me` | +10 | No usa WhatsApp de forma estructurada |
| Teléfono principal **móvil** (6xx/7xx) | +10 | Probable autónomo que lo hace todo solo → el dolor de "¿ya está?" es máximo |
| Abierto (`OPERATIONAL`) | requisito | Descarta los cerrados |
| Cadena / franquicia conocida (lista negra de nombres) | −40 | No decide el dueño |

**Prioriza:** Pain Score ≥ 60 **y** provincia con ruta de visitas (empieza por Valencia, Castellón y Alicante).

### 2.3 Coste aproximado
Text Search con campos de contacto se factura en el SKU más caro (*Enterprise*). Para unas 50 provincias × 6 términos × ~3 páginas ≈ 900 peticiones → **del orden de €30–60 por pasada nacional** (comprueba la tabla de precios vigente y la cuota gratuita mensual por SKU). Pon un **límite de presupuesto** en Google Cloud Billing (p. ej. €50/mes) antes de ejecutar.

### 2.4 Uso
```bash
cd automation
python -m venv .venv && .venv\Scripts\activate          # Windows
pip install requests python-dotenv
copy .env.example .env   # GOOGLE_PLACES_API_KEY=..., SUPABASE_URL=..., SUPABASE_SERVICE_ROLE_KEY=... (opcional)
python scraper_talleres.py --provincias "Valencia,Castellón,Alicante" --out leads_levante.csv --check-web
python scraper_talleres.py --todas --out leads_espana.csv --max-pages 2
python scraper_talleres.py --purge-older-than 30        # cumplimiento: purga datos >30 días
```

---

## 3. Secuencias de contacto "de taller a taller" (guiones)

Tono: **colega a colega**. Hablas como técnico, no como comercial. Nunca "revolucionario", nunca "IA disruptiva".

### 3.1 Visita en persona (90 segundos, mejor entre 16:30 y 17:15, antes de que se llene)
> "Hola, ¿eres el dueño? Soy [Nombre], de Informática Torrent, el taller de Torrent. No vengo a venderte repuestos 😄.
> Una pregunta rápida: ¿cuántas veces al día te llaman para preguntar si ya está el móvil?
> *(escucha)*
> A mí me pasaba igual. Me hice un programa que manda el WhatsApp solo cuando cambio el estado de la reparación y, al recoger, pide la reseña. ¿Te lo enseño en tu propio móvil? Son 5 segundos."
> → Escanea el QR del folleto, prueba el simulador delante de ti, ve llegar el WhatsApp.
> "Para los 20 primeros talleres es €29 al mes para siempre, sin permanencia, y si en 30 días no te convence te devuelvo el dinero. ¿Te lo dejo funcionando ahora o te paso el enlace?"

**Folleto A5:** por delante, "¿Harto de contestar *¿ya está mi móvil?*?" + QR grande al simulador. Por detrás, 3 pasos, precio Fundador, foto tuya en tu taller y tus datos de identificación como empresa.

### 3.2 Carta postal (Correos, ~€0,30–0,60/unidad)
> Asunto visual: **De un taller a otro taller**
> Hola, compañero:
> Soy [Nombre], llevo desde 2003 reparando móviles, consolas y ordenadores en Torrent (Valencia).
> Te escribo porque seguro que a ti también te llaman diez veces al día para preguntar "¿ya está lo mío?".
> Me hice un programa que **avisa por WhatsApp automáticamente** al cliente cuando su reparación entra, tiene presupuesto y está lista, y que **pide la reseña de Google** al recogerla.
> **Escanea este QR y recibe ahora en tu móvil el aviso que recibirían tus clientes.** 5 segundos, sin registrarte.
> [QR → tallersaas.es/demo?c=carta-{provincia}]
> Precio Fundador: €29/mes de por vida para los 20 primeros talleres. Sin permanencia. Garantía de 30 días.
> Un saludo de colega,
> [Firma] · [Teléfono] · [SL, CIF, dirección] · *Si no quieres recibir más cartas, escríbenos a baja@… y te borramos.*

### 3.3 Llamada humana al fijo de un negocio (si el abogado lo valida; máximo unas 20 al día)
> "Hola, buenas, ¿hablo con [Taller]? Soy [Nombre], técnico de Informática Torrent, en Valencia. Te llamo de colega a colega, solo un minuto, ¿te pillo bien?
> *(si dice que no: "Perfecto, ¿te llamo a otra hora o prefieres que no te llame más?" → registra la respuesta)*
> He hecho un programa para mi taller que avisa al cliente por WhatsApp cuando su reparación está lista, y estoy ofreciéndoselo a otros talleres. ¿Te mando un enlace para que lo pruebes en tu móvil en 5 segundos?
> *(si dice que sí → "¿A este número o a otro? ¿Por WhatsApp o por email?" → ese "sí" es tu consentimiento: regístralo en `leads` con `consent_source = 'llamada_humana'` y la fecha)*"

### 3.4 Secuencia automática **tras el opt-in** (WhatsApp desde la WABA de demo, o email)
| Día | Disparador | Mensaje |
|---|---|---|
| D0 (+0 min) | Simulador | Plantilla de demo (doc 03) |
| D0 (+5 min) | `consent_commercial_call` | Callback del agente IA (§4) |
| D0 (+2 h) | Sin pago y sin llamada | "¿Te ha llegado bien el aviso? Si quieres, te enseño en 10 min cómo quedaría con tu logo y tus precios: [Cal.com]. O empieza ya: [enlace Fundador]" *(dentro de la ventana de 24 h si respondió; si no, plantilla de marketing aprobada)* |
| D2 | Sin pago | Vídeo de 60 s: "Así doy de alta un iPhone en 30 segundos" (grabado en tu mostrador) |
| D5 | Sin pago | Caso real: "En mi taller, con los avisos, las llamadas de '¿ya está?' bajaron de X a Y" (**tu dato real medido**) |
| D10 | Sin pago | Última: "Quedan N plazas Fundador. Si no es para ti, responde NO y no te escribo más." → fin de la secuencia |
| Cualquiera | "BAJA" / "NO" a esta pregunta | `do_not_contact = true`; fin |

### 3.5 Programa de referidos (el canal más barato en un gremio pequeño)
"**Trae a un taller y los dos tenéis un mes gratis.**" Enlace único por cliente (`?ref=slug`) y crédito automático vía Stripe (cupón de un mes).

### 3.6 Canales de contenido y alianzas (sin coste por contacto)
- **Distribuidores de repuestos** (ya eres distribuidor oficial de Xiaomi): ofrece al distribuidor un 20 % recurrente o un cupón para sus clientes taller, y que lo incluya en **su** newsletter (ellos tienen el consentimiento de sus clientes).
- **YouTube/TikTok** desde tu banco de trabajo: reparaciones reales con el programa a la vista, en segundo plano.
- **Grupos de técnicos** de Facebook/Telegram: aporta ayuda técnica de verdad y lleva el producto en tu firma.

---

## 4. Agente de voz IA 24/7 (Retell AI o Vapi + número +34)

### 4.1 Qué hace y qué NO
| ✅ Hace | ❌ No hace |
|---|---|
| Atiende **llamadas entrantes** 24/7 al número +34 de la web, los folletos y las cartas | Llamar en frío a nadie |
| Llama **5 min después del simulador** solo si el visitante **marcó la casilla de llamada** (o respondió LLAMADA) | Llamar fuera de 9:00–21:00 L–V o 10:00–14:00 sábados |
| Se presenta como asistente de IA y pide permiso para grabar en la primera frase | Hacerse pasar por persona |
| Envía por WhatsApp el enlace de alta/pago **si el interlocutor lo pide en la llamada** | Cobrar por teléfono o pedir datos de tarjeta |
| Agenda una demo humana o transfiere a tu móvil en horario | Prometer funciones de Pro como si ya existieran |

### 4.2 Elección de plataforma
| | **Retell AI** | **Vapi** |
|---|---|---|
| Español de España (voz y acento) | Bueno (voces de ElevenLabs / Cartesia) | Bueno (voces a elegir) |
| Facilidad para un fundador | **Más fácil** (panel, function calling, webhooks) | Más flexible, más configuración |
| Coste aproximado | ~$0,07–0,10/min (voz + motor) + LLM + telefonía | Similar, por componentes |
| **Recomendación** | ✅ Empezar aquí | Alternativa si necesitas más control |

**Número +34:** Twilio (o Telnyx) con número geográfico de Valencia (96x). Requiere un **paquete regulatorio** (documentación de la SL y dirección en España), así que solicítalo el día 1 porque tarda unos días. Conecta el número a Retell por SIP trunk o importación directa.
**Coste estimado:** llamada entrante de 4 min ≈ €0,35–0,50; callback saliente a un móvil español de 4 min ≈ €0,45–0,70. Con unas 150 llamadas al mes ≈ **€60–90/mes**.

### 4.3 Arquitectura y webhooks
```
Llamada entrante +34 96x ──▶ Twilio ──SIP──▶ Retell Agent (prompt: automation/voice_agent_prompt_es.md)
                                                │  tools (HTTP → Edge Function voice-tools, firmado con secreto):
                                                │   • lookup_lead(phone)           → stage, nombre taller, si probó demo
                                                │   • send_signup_link(phone, plan)→ WhatsApp plantilla "enlace_alta" (Stripe Payment Link
                                                │                                    con client_reference_id=lead_id) — SOLO si lo pidió en la llamada
                                                │   • book_demo(datetime)          → Cal.com API
                                                │   • transfer_to_human()          → tu móvil (solo L-V 9-10h / 14-17h) o "te llama mañana"
                                                │   • set_do_not_call(phone)       → leads.do_not_contact = true
                                                ▼
                                       webhook call_ended → Edge Function voice-webhook
                                                → inserta voice_calls (transcripción resumida, resultado, duración, coste)
                                                → actualiza leads.stage (called / trial / lost / do_not_contact)
                                                → alerta al fundador si resultado ∈ {quiere_comprar, pide_humano}

Simulador (consentCall=true) → schedule_voice_callback(lead, 5) → voice_calls(status='scheduled', scheduled_for)
pg_cron cada minuto → Edge Function voice-dispatch:
   selecciona voice_calls scheduled_for<=now() AND status='scheduled' FOR UPDATE SKIP LOCKED
   comprueba: consent_commercial_call, !do_not_contact, horario permitido, intentos<2, Robinson revisado
   → POST Retell create-phone-call {from:+3496x…, to:+346…, agent_id, metadata:{lead_id}}
```
Tablas y función en [`supabase/migrations/002_sales_engine.sql`](../supabase/migrations/002_sales_engine.sql).

### 4.4 Prompt del agente
Completo en [`automation/voice_agent_prompt_es.md`](../automation/voice_agent_prompt_es.md). Incluye la identidad, la divulgación de IA, el guion de entrada y de callback, el manejo de 10 objeciones, el uso de herramientas y las líneas rojas.

### 4.5 Seguridad del agente (/cso)
- Las herramientas solo aceptan peticiones firmadas (`x-retell-signature` o un secreto compartido) y **no** exponen datos de otros leads.
- `send_signup_link` solo envía al **número desde el que llaman** (o al de la ficha si es un callback), nunca a un número dictado → evita el abuso ("mándalo al número de mi vecino").
- Grabaciones: retención de 30 días y luego borrado. Aviso de privacidad en la web.

---

## 5. KPIs del motor (revisión semanal, 15 min el lunes)

| Etapa | Métrica | Objetivo de los primeros 90 días |
|---|---|---|
| Prospección | Leads con Pain Score ≥ 60 en la Comunidad Valenciana | 400 |
| Contacto | Visitas + cartas + llamadas humanas / semana | 15 visitas · 100 cartas · 50 llamadas |
| Mano levantada | Demos de simulador | 20 % de las visitas · 3–5 % de las cartas |
| Conversación | Demos → llamada o demo humana | 40 % |
| Cierre | Demos → pago | 10–15 % |
| Retención | Activación en la semana 1 · churn mensual | ≥ 70 % · ≤ 4 % |
