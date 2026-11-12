# 01 — Boardroom Executive Verdict: Taller SaaS

> **Fecha:** 12 nov 2026 · **Protocolo:** `boardroom` (7 perspectivas aisladas en paralelo + síntesis)
> **Decisión evaluada:** Empaquetar WhatsApp Pro + motor de tickets + TPV en un SaaS multi-tenant para talleres independientes de España a €29 / €69 / €199 VIP, con captación 90 % automatizada y objetivo de 50 talleres (€3.000 MRR) en 90 días.
> **Aviso:** esto es un insumo para decidir, no una decisión. Las partes legales **no sustituyen a un abogado/asesor fiscal español**. Hazlas revisar antes de cobrar al primer cliente.

---

## 0. Lo que encontramos en tu código ANTES de reunir al consejo (inspección solo lectura)

Esto condiciona todo lo demás, así que va primero y sin maquillaje:

| Hallazgo | Evidencia | Implicación |
|---|---|---|
| **WhatsApp Pro es real y funciona.** Envío directo por Meta Cloud API (Graph v23.0), recordatorio de reseña 24 h tras "Entregado + Reseña", reintentos con clasificación de errores Meta, horario comercial, opt-out. | `whatsapp-inbox-pro/base44/functions/sendDueReviews`, `whatsappWebhook`, `_shared/businessHours.ts` | Es tu único activo vendible **hoy**. Es la base del plan Starter. |
| **El motor de tickets que hay en ese código espeja HelloClient** (polling cada 5 min). Nos has confirmado que **HelloClient está descontinuado y ahora usas Reparo**. | `pollHelloClient/entry.ts`, entidad `RepairOrder` ("HelloClient order number") | El código de integración con HelloClient es **legado**. **Confirmado por el fundador: Reparo es su propia app Base44 a medida**, igual que WhatsApp Inbox Pro y los módulos de TPV. **La propiedad intelectual es 100 % suya** y no hay ningún tercero del que depender. Su código no estaba en las dos carpetas inspeccionadas, así que la lógica de Reparo y del TPV se **porta** al núcleo multi-tenant (`001_multi_tenant_core.sql`) en lugar de reescribirse desde cero. Base44 sigue sin servir para multi-tenant. |
| **No existe código de TPV, Cierre de Caja ni CashDroPuente** en las carpetas inspeccionadas. | `grep` de `tpv|cierre|cashdro|verifactu|resguardo` sin resultados en código | El plan Pro a €69 se vendería hoy como **hoja de ruta**, no como producto. |
| **Todo corre en Base44**, una app por tienda, facturado en créditos. En junio de 2026 casi te quedas sin créditos solo por las automatizaciones programadas. | `whatsapp-inbox-pro/ZERO-COST-PLAN.md` | Base44 no sirve para multi-tenant (no tiene aislamiento por tenant ni coste predecible). El SaaS se construye en **Supabase + Vercel**. Tu app de tienda actual **sigue funcionando tal cual**. |
| **Incidente previo:** un bug de paginación envió **6 mensajes duplicados** a tus clientes. Ya está parcheado con deduplicación + "send-guard". | Cabecera de `pollHelloClient/entry.ts` | En multi-tenant, la idempotencia tiene que vivir en la **base de datos** (clave única), no en el código. Resuelto en el esquema 001. |
| **Bug de opt-out activo hoy:** un "no" a secas da de baja al cliente **para siempre**. | `whatsappWebhook/entry.ts:377` → `['baja','stop','no',...]` | Un cliente que contesta "no" a "¿Necesitas algo más?" deja de recibir avisos sin que nadie lo sepa. **Arréglalo ya en tu app actual** (quita `'no'`, `'cancelar'` y `'no mas'` de la lista y deja solo `BAJA`/`STOP` con coincidencia exacta). |

> **Nota de método:** los 7 ejecutivos recibieron el dato "HelloClient" antes de tu corrección. Donde dicen "dependencia de HelloClient", léelo como **"el motor de tickets todavía no es código propio y multi-tenant"**. El riesgo es el mismo.

---

## 1. Transcripción del consejo (Fase 1: 7 perspectivas aisladas)

Cada ejecutivo vio **solo** su especificación de rol y el caso. Ninguno vio a los demás.

### 1.1 CEO — Veredicto: **PAUSE**
- **Preocupación principal:** vas a plantar una bandera "Taller SaaS" sobre un producto que aún no es tuyo entero. Tu foso de verdad son 20 años y más de 1.800 reseñas, y venderle una promesa a tus propios colegas de gremio lo pone en riesgo. Los primeros 50 clientes hablan entre ellos.
- **Pregunta:** ¿cuál es el uso alternativo de tus próximos 90 días de atención? Y tres jugadas después, con 50 talleres, ¿quién firma la declaración responsable de Verifactu y quién atiende el soporte?
- **Rechaza:** vender Pro antes de que exista en tu código. Lanza **solo Starter** como cuña de distribución. El objetivo de 50 talleres en 90 días es de vanidad: te empuja a scraping y llamadas en frío que queman credibilidad.
- **Números:** €3.000 MRR exigen unos 43 talleres a €69 o unos 103 a €29. Con 50 talleres y mezcla Starter, sales a €1.450–2.000.
- **Discrepa con:** CTO. Prefiere un piloto estrecho ya antes que esperar a la "pureza" arquitectónica.

### 1.2 CFO — Veredicto: **CONDITIONAL** (preventa de pago primero)
- **Preocupación principal:** se está poniendo precio a un producto que no existe sobre una base de costes que no se conoce.
- **Pregunta:** ¿cuál es el margen de contribución por taller en el mes 6 con un 5 % de churn mensual, y quién paga el coste de cumplir Verifactu antes de facturar el primer euro de TPV?
- **Unit economics (estimación):**

| | Starter €29 | Pro €69 |
|---|---|---|
| Meta (≈60 tickets/mes; utility ≈ €0,025, marketing ≈ €0,06) | ≈ €6 | ≈ €12 |
| Stripe (1,5 % + €0,25) | €0,69 | €1,30 |
| Infra | €3–5 | €8 |
| IA / voz | — | €3,30 |
| **Margen bruto antes de soporte** | **≈ €18 (62 %)** | **≈ €44 (64 %)** |
| Soporte (40–60 min/mes a €30/h) | €20 | €30 |
| **Contribución real** | **≈ −€2** | **≈ €14** |

- **Proyección a 90 días:** caso base de 8–12 talleres Starter (€250–350 MRR), caso optimista de unos 20 (≈ €900), caso pesimista de 3. **Probabilidad de llegar a €3.000: < 10 %.**
- **Exposición Verifactu:** hasta €150.000/año por producto, unas 4 veces el ARR objetivo.
- **Discrepa con:** CEO por el crecimiento a toda costa. Quiere cobrar antes de dar cualquier uso gratis.

### 1.3 COO — Veredicto: **CONDITIONAL** (Starter sí, Pro en pausa)
- **Preocupación principal:** eres el único operador, soporte e instalador, y además llevas el taller cada día.
- **Pregunta:** ¿quién atiende al taller nº 12 a las 10:00 con la impresora muerta mientras en tu mostrador hay cola?
- **Números:** onboarding de Starter ≈ 3 h (Meta + plantillas, con un 30 % que se atasca); Pro + VIP ≈ 6–8 h. 50 talleres ≈ 210 h de onboarding, unas 5 semanas a tiempo completo. Soporte ≈ 120–150 tickets/mes, 50–60 h. **Techo realista para un fundador con tienda: 15–20 talleres.**
- **Exige:** idempotencia, límites de envío por tenant y kill-switch **antes del taller nº 2**. El agente de voz 24/7 es un SLA sin dueño: fuera por ahora.
- **Discrepa con:** CEO. La ventana de mercado puede ser real; la de ejecución, no.

### 1.4 CTO — Veredicto: **CONDITIONAL** (Starter ya; Pro/TPV/CashDro en pausa)
- **Preocupación principal:** esto es un cambio de plataforma disfrazado de lista de funciones. Pasas a ser el sistema de registro de dinero y documentos legales sin tests, SLOs ni runbooks.
- **Pregunta:** ¿quién está de guardia cuando un cierre de caja no cuadra un sábado por la tarde, y cuál es el procedimiento de restauración y el RPO por tenant?
- **Decisiones técnicas:**
  - **Verifactu: comprar, sin debate.** Construirlo cuesta 1–2 trimestres de ingeniería; comprarlo, ≈ €1–5 por tenant al mes. Va detrás de una interfaz `InvoiceSigner` intercambiable.
  - **WhatsApp: Embedded Signup por tenant, no WABA compartida.** Una WABA compartida tiene una sola calificación de calidad y un radio de impacto del 100 % ante un baneo.
  - **Base44 → Supabase:** el núcleo nuevo va en Postgres + RLS. Las apps actuales siguen igual. Tests de RLS por tabla en CI.
  - **Impresión:** no construir drivers. Usar un agente de impresión local, WebUSB/WebSerial o PrintNode, con una matriz de al menos 3 impresoras probadas.
  - **CashDro:** puente on-premise, solo cuando un cliente pague por él.
- **Números:** Starter ≈ 1 trimestre. Pro completo ≈ 4–6 trimestres de equipo, y el doble o más para un fundador solo con IA. El polling cada 5 min son 288 llamadas por taller al día.
- **Discrepa con:** CEO (meter Pro en la historia de lanzamiento) y CFO (si elige WABA compartida por coste).

### 1.5 General Counsel — Veredicto: **STOP** al outbound tal como está descrito; **CONDITIONAL** al producto
- **Verifactu:**
  - El **resguardo de depósito / orden de reparación (RD 58/1988) NO es un registro de facturación**. Mantenlo en un módulo estrictamente separado.
  - **Una factura simplificada (ticket) SÍ es factura** (RD 1619/2012). Si el TPV la emite, eres productor de SIF.
  - **Opción recomendada:** no emitir facturas con código propio. Integrar un SIF certificado por API.
  - El cierre de caja **no puede permitir editar ni borrar tickets**.
  - Sanción al productor: hasta **€150.000** por ejercicio (art. 201 bis LGT). Usuario: **€50.000**.
  - Plazos (RDL 15/2025): **1 ene 2027** para contribuyentes del IS (SL), **1 jul 2027** para el resto (autónomos).
  - Limita tu responsabilidad por contrato y firma la declaración responsable por escrito.
- **RGPD:**
  - El taller es responsable y tú eres **encargado** (art. 28). El DPA es obligatorio antes de dar de alta a nadie, con lista de subencargados: Supabase, Vercel, Meta, Stripe, proveedor LLM, Retell/Vapi, Twilio.
  - Transferencias internacionales con SCC o DPF, más una evaluación de impacto de la transferencia.
  - El LLM, con retención cero y sin entrenamiento con los datos.
  - Para tus propios leads eres responsable: aviso art. 14.
- **Outbound, partida por partida:**

| Táctica | Veredicto | Alternativa conforme |
|---|---|---|
| Scraping de Google Maps | ❌ Viola los ToS de Google | Places API oficial dentro de sus términos, o base B2B licenciada |
| WhatsApp en frío a 6xx/7xx | ❌ **Ilegal tal como está descrito** (LSSI art. 21 + política de Meta) | Solo responder a quien te escribe o deja su número con consentimiento |
| Email en frío | ⚠️ Condicional y arriesgado (LSSI art. 21–22) | Ver doc 04: solo con relación previa o consentimiento |
| Llamada automática 5 min después de la demo | ❌ **Ilegal tal como está descrito** (LGT 11/2022 art. 66) | Casilla **específica, desmarcada**, guardada con fecha y hora + Lista Robinson |
| WhatsApp de demo | ✅ Si el visitante lo pide, el formulario lo dice y es un solo envío | — |
| Agente de voz IA | ⚠️ AI Act art. 50 | Decir al inicio que es una IA + consentimiento de grabación |

- **Ley de reparaciones:** resguardo con presupuesto, garantía mínima de 3 meses (TRLGDCU) y plazos de presupuesto. El software no puede debilitar esos campos.
- **Discrepa con:** CEO ("automatizar todo y escalar rápido"). Y con el CTO si el ticket TPV se modela como una fila mutable.

### 1.6 CHRO — Veredicto: **PAUSE**
- **Preocupación principal:** riesgo de persona clave sin ninguna profundidad. Los clientes llamarán de 10–14 h y de 17–20:30 h, justo cuando tu taller está más lleno.
- **Pregunta:** ¿quién coge el teléfono un martes a las 11:30 cuando el taller nº 12 no puede imprimir, y a cuál de tus técnicos le quitas una hora facturable? ¿Se lo has preguntado?
- **Números:**
  - ≈ 45 h/semana extra sobre la tienda para llegar a 50 talleres.
  - **Primera contratación:** media jornada de soporte (20 h/semana ≈ **€1.000–1.200/mes** con Seguridad Social) al llegar a **≈ 25 talleres** o en cuanto el soporte pase de 8 h/semana.
  - Jornada completa ≈ €2.300–2.600/mes. Rampa de formación: 2–3 meses.
- **Exige:** un registro de horas real durante 30 días. Credenciales y runbook accesibles si estás 3 semanas de baja. Como mucho, un cambio grande por trimestre en el taller.
- **Discrepa con:** CEO (el calendario quema al fundador) y CFO ("sin contratar" tiene un coste oculto).

### 1.7 Red-Team Chair — Veredicto: **PAUSE**
- **Preocupación principal:** se vende una hoja de ruta como si fuera un producto. El patrón que mata a estas empresas es: el fundador vende la hoja de ruta para financiarla, el soporte se come el tiempo de construir, un incidente de automatización (duplicados, baneo, denuncia a la AEPD) golpea a los primeros 10 clientes y el boca a boca del gremio se vuelve en contra. **No los mata la competencia; los mata el colapso de confianza temprano.**
- **Pregunta:** ¿cuántos talleres que no sean el tuyo ni de amigos te han pagado algo hoy por un notificador de WhatsApp? ¿Y cuál es tu plan B si Meta banea tu número en mitad del embudo de demo?
- La tabla completa de modos de fallo está en §3.

---

## 2. Síntesis del agregador (Fase 2)

### 2.1 Tabla de veredictos

| Rol | Veredicto | Línea roja |
|---|---|---|
| CEO | Pause | No vender Pro antes de que exista |
| CFO | Conditional | Cobrar desde el día 1; Starter a €29 tiene margen ≈ 0 tras soporte |
| COO | Conditional | Techo de 15–20 talleres sin contratar; idempotencia antes del taller nº 2 |
| CTO | Conditional | Verifactu se compra; Embedded Signup; Supabase + RLS con tests |
| General Counsel | **STOP** (outbound) / Conditional | WhatsApp en frío y auto-llamadas ilegales; DPA y separación resguardo/factura |
| CHRO | Pause | Media jornada de soporte a ≈ 25 talleres; plan de persona clave |
| Red-Team Chair | Pause | Arreglar opt-out + duplicados; un solo canal 30 días; fecha de stop-loss |

### 2.2 Dónde está de acuerdo el consejo (≥ 4 roles)
1. **Lanzar SOLO Starter primero** (7/7). Pro, TPV y CashDro no se venden hasta que existan en código y tengan Verifactu resuelto con un proveedor certificado.
2. **50 talleres / €3.000 MRR en 90 días no es realista** (CEO, CFO, COO, Red-Team). Objetivo honesto: **15–25 talleres de pago en 90 días** y 50 entre los meses 6 y 9.
3. **Nada gratis; cobrar desde el día 1** (CEO, CFO, COO, Red-Team).
4. **Idempotencia, kill-switch y límites de envío en la base de datos antes del segundo cliente** (CTO, COO, Red-Team, CFO).
5. **El fundador es el cuello de botella** (COO, CHRO, Red-Team, CEO).

### 2.3 Desacuerdos con nombre
- **CEO vs CTO:** ¿piloto ya en el stack actual o reconstruir primero? → **Resolución:** el piloto de 5 talleres va en el **núcleo nuevo de Supabase** (Starter cabe en unas 4–6 semanas). Base44 no se toca para multi-tenant porque el riesgo de fuga entre tenants no es negociable.
- **CFO vs CTO:** ¿WABA compartida (barata) o Embedded Signup (aislada)? → **Resolución:** gana Embedded Signup + Coexistence. El número compartido queda solo para la **demo** y para el "mensaje de prueba al dueño" durante el onboarding, nunca para los clientes finales del taller.
- **General Counsel vs el plan de captación del fundador:** el GC tumba el WhatsApp en frío y la auto-llamada sin consentimiento. → **Resolución:** el embudo se rediseña en el doc 04 con canales conformes (visitas en persona, correo postal con QR, distribuidores de repuestos, contenido y anuncios, llamadas solo con consentimiento).

### 2.4 Preguntas que nadie ha respondido todavía (datos que necesitas)
1. ~~¿Reparo es código tuyo?~~ **Resuelto: Reparo y los módulos de TPV son apps Base44 propias (IP 100 % del fundador).** Pendiente: compartir sus carpetas o exportar sus esquemas de entidades para portar su lógica (cierre de caja en 10 pasos, impresión) al núcleo nuevo.
2. ¿Cuántos talleres pagarían **hoy** €39/mes solo por avisos y reseñas? → **Prueba de preventa: 10 talleres, 14 días** (ver doc 05).
3. ¿Coexistence de Meta está disponible para números españoles en tu cuenta? → Compruébalo en el panel de Meta.
4. ¿Qué proveedor Verifactu da API multi-emisor, a qué precio y con qué SLA? → Pide 3 presupuestos.
5. ¿Cuántas horas por semana puedes quitarle de verdad al taller? → Registro de 30 días.

### 2.5 El riesgo huérfano (nadie lo tiene del todo)
**La pérdida de confianza en tu propio gremio y en tu propio taller.** Tu marca personal (Informática Torrent, más de 1.800 reseñas) es el activo de marketing nº 1 del SaaS. Un incidente con los primeros clientes, o una denuncia a la AEPD por captación agresiva, no solo mata el SaaS: salpica al taller que te da de comer. **Mitigación:** constituye el SaaS en una **sociedad separada (SL)**, con marca propia. Crece despacio con los primeros 10 clientes y mide la calidad antes de escalar.

---

## 3. Modos de fallo y la solución que tiene que existir ANTES del lanzamiento

| # | Modo de fallo | Probabilidad | ¿Mata el negocio? | Solución previa al lanzamiento (dónde vive) |
|---|---|---|---|---|
| 1 | **Churn al mes 3** (talleres muy sensibles al precio, sin coste de cambio) | Alta | Sí | Alta en el día 1 con el **valor más visible** (aviso al cliente + reseña). Panel "Este mes: X avisos, Y reseñas nuevas, Z llamadas evitadas". Plan anual con 2 meses gratis. No escalar si la activación en la semana 4 baja del 70 %. *(doc 02 §4, doc 05)* |
| 2 | **Atasco en la verificación de Meta** del dueño no técnico | Alta | No (retrasa) | **Tú** eres el Tech Provider verificado. El taller **no** toca Meta Developers: hace Embedded Signup (un login de Facebook) y empieza a enviar con límites básicos sin verificar su empresa. Plantillas pre-aprobadas a nivel de plataforma. *(doc 02 §3)* |
| 3 | **El taller no quiere "mover" su número** de WhatsApp Business | Alta | Sí | **Coexistence**: sigue usando la app en su móvil y nosotros enviamos por API con el mismo número. Si no está disponible: número nuevo dedicado "Avisos [Taller]". *(doc 02 §3)* |
| 4 | **Calificación de calidad baja, límites o baneo** | Media-alta | Sí | Opt-in registrado por cliente (casilla firmada en el resguardo). Solo plantillas utility para estados. Reseña como marketing, una sola vez y opt-in aparte. Tope diario por tenant (`wa_daily_cap`). Alarma de calidad que pone `wa_paused = true` automáticamente. *(SQL 001, doc 02 §3.5)* |
| 5 | **Repetición de duplicados** (incidente 6x) | Alta sin controles | Sí | `UNIQUE (tenant_id, idempotency_key)` en `whatsapp_logs`. El navegador nunca llama a Meta. Dispatcher con `FOR UPDATE SKIP LOCKED`. *(SQL 001)* |
| 6 | **Mala interpretación del opt-out** ("no" = baja) | **Segura** (existe hoy) | Sí | Solo `BAJA` / `STOP` / `BAJA WHATSAPP` con coincidencia **exacta** tras normalizar. Todo lo demás va a la bandeja o a la IA. Respuesta de confirmación de baja. *(doc 02 §3.6)* |
| 7 | **Denuncia AEPD / LSSI por captación** | Media | Sí (reputación) | Sin WhatsApp en frío ni llamadas automáticas sin consentimiento. Registro de consentimientos con versión del texto, IP y fecha. Lista Robinson. *(doc 04)* |
| 8 | **Sobrecarga de soporte** | Alta | Sí | Wizard de autoservicio de 60 s. Videos de 90 s por pantalla. Como mucho 5 altas por semana. Soporte por WhatsApp con horario 9–10 h y 14–17 h (fuera de la punta de tu taller). Media jornada al llegar a ≈ 25 talleres. *(doc 02 §4, doc 05)* |
| 9 | **Distracción del fundador** (taller + SaaS + 4 canales) | Muy alta | Sí | Un solo canal durante 30 días. Bloques fijos en el calendario. **Stop-loss:** si el día 60 no hay 8 talleres de pago, se congela la captación y se revisa. *(doc 05)* |
| 10 | **Verifactu** (TPV que factura sin cumplir) | Segura si se lanza TPV propio | Sí, para Pro | Fase 1 **no emite facturas**: solo resguardos. El TPV de Fase 2 factura **a través de un SIF certificado por API**. Movimientos de caja **append-only**. *(SQL 001, doc 02 §5)* |
| 11 | **Fuga de datos entre talleres** | Baja con RLS / catastrófica sin ella | Sí | RLS forzada en todas las tablas, FK compuestas por tenant, tests pgTAP en CI, ninguna clave service_role en el navegador. *(SQL 001, doc 02 §2)* |
| 12 | **Dependencia del sistema de tickets** (HelloClient ya cayó) | Ya ocurrió | Sí | Motor de tickets **propio** en el núcleo. Importador CSV desde Reparo y otros. Nunca depender de la API de otro CRM para el flujo principal. *(SQL 001, doc 02 §4)* |
| 13 | **Hardware variable** (impresoras 58/80, datáfonos) | Alta | No | Matriz de 3 impresoras certificadas (Epson TM-T20III, Xprinter XP-58/80, Star TSP143). Impresión del navegador con CSS `@page` como base y QZ Tray/PrintNode como opción. Los datáfonos van fuera del alcance de Fase 1. |

---

## 4. VEREDICTO FINAL DEL CONSEJO

### 4.1 Decisión: **GO CONDICIONAL — Starter primero, Pro con puertas.**

### 4.2 Precio y empaquetado (versión corregida)

| Plan | Qué incluye | Precio de lista | Precio Fundador (solo los primeros 20 talleres, de por vida) | Cuándo se vende |
|---|---|---|---|---|
| **Starter "Avisos + Reseñas"** | Motor de tickets ligero (alta en 30 s, resguardo 58/80 mm, estados), avisos automáticos de WhatsApp (recibido / presupuesto / listo), recordatorio de reseña Google, panel de resultados. **Hasta 400 conversaciones/mes incluidas.** | **€39/mes** o €390/año | **€29/mes** | **Desde el día 30** (tras la preventa) |
| **Pro "Taller Completo"** | Starter + técnicos y garantías, recepcionista IA de WhatsApp (precios y estados 24/7), TPV + Cierre de Caja en 10 pasos, facturación Verifactu por proveedor certificado. **1.000 conversaciones incluidas.** | **€79/mes** o €790/año | **€59/mes** | **Cuando pase las puertas** (TPV probado 30 días en tu taller + proveedor Verifactu firmado) |
| **Instalación Llave en Mano** (antes "VIP AnyDesk") | 60 min por AnyDesk: impresora, plantillas, lista de precios importada, conexión de WhatsApp. | **€149 una vez** (gratis con el plan anual) | — | Desde el día 30 |
| **Exceso de mensajes** | Por encima del cupo | Coste de Meta + 30 % | — | — |
| **Puente CashDro** | Integración con hardware | **Por proyecto** (desde €490 + €19/mes) | — | No antes del mes 6 y solo con un cliente que lo pida |

**Por qué no €29 de lista:** con soporte incluido, Starter a €29 tiene una contribución de unos −€2 (CFO). A €39 con cupo de mensajes y soporte agrupado, el margen tras soporte queda en unos €8–12. El precio Fundador a €29 conserva tu número original como **gancho de urgencia** ("solo 20 plazas"), limitado y medible.

### 4.3 ¿Prueba gratis con tarjeta o demo en vivo? → **Ninguna de las dos tal cual: "Prueba pagada con garantía".**
1. **Demo en vivo sin plan gratuito** en la web (el simulador de WhatsApp de 5 segundos, doc 03). Es el "wow" sin coste de soporte.
2. Alta con **tarjeta y cobro desde el día 1** y **garantía de devolución de 30 días sin preguntas**. Así filtras a los curiosos (que te costarían tiempo y dinero de Meta), conviertes con la garantía y mantienes ingresos desde el primer día. En Stripe: cobro inmediato y reembolso manual (o automatizado) si lo pide antes de 30 días.
3. **Nunca** una prueba gratis de 14 días: los talleres la activan, no la configuran y se van. Te comen horas de soporte con un 0 % de conversión.

### 4.4 Cumplimiento legal: lo mínimo antes del primer cobro
- [ ] **SL nueva** para el SaaS (separa el riesgo del taller).
- [ ] **Contrato de Encargo del Tratamiento (DPA)** aceptado en el wizard (`accept_dpa()`), con anexo de subencargados.
- [ ] **Condiciones de servicio** con limitación de responsabilidad (por ejemplo, el importe pagado en 12 meses) y exclusión expresa de la facturación en Fase 1.
- [ ] **Fase 1 no emite facturas.** El resguardo lleva el título "Resguardo de depósito – Orden de reparación. Este documento no es una factura."
- [ ] **Fase 2:** contrato con un proveedor Verifactu certificado. La declaración responsable es la del proveedor para el módulo que factura. Revisa con tu asesor si, como integrador, también necesitas la tuya.
- [ ] **Casilla de consentimiento WhatsApp** en el resguardo, separada para avisos y para reseñas.
- [ ] **Cláusula de IA** (AI Act art. 50) en la recepcionista: "Soy el asistente virtual de [Taller]".
- [ ] **Revisión por abogado** especialista en protección de datos y fiscal antes de cobrar (presupuesto ≈ €600–1.500 una vez).

### 4.5 Las 5 condiciones que convierten este "GO CONDICIONAL" en "GO"
1. **Opt-out arreglado** y **cero duplicados** en tu propio taller durante 14 días seguidos en el núcleo nuevo.
2. **Preventa:** 10 talleres pagan Fundador (o dejan señal) **antes** de construir más allá de Starter.
3. **Tech Provider de Meta** aprobado y Embedded Signup + Coexistence probado con 3 talleres.
4. **DPA y condiciones** revisados por un abogado.
5. **Registro de horas** de 30 días que demuestre que tienes al menos 15 h/semana para esto.

**Fecha de stop-loss:** si el **día 60** hay menos de **8 talleres de pago**, se para la captación, se entrevista a 10 talleres que dijeron "no" y se decide entre pivotar y congelar.
