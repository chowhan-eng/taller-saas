# 02 — gstack Product & Multi-Tenant Architecture

> Lentes aplicadas: **Eng Manager** (arquitectura, fallos, tests), **Designer** (wizard y UX de mostrador), **/cso** (seguridad).
> Insumo: veredicto del doc 01 → **Starter primero** (tickets ligeros + avisos + reseñas). El TPV va detrás de puertas. La facturación siempre pasa por un proveedor Verifactu.
> Archivo SQL: [`supabase/migrations/001_multi_tenant_core.sql`](../supabase/migrations/001_multi_tenant_core.sql) · Test: [`supabase/tests/rls_isolation.test.sql`](../supabase/tests/rls_isolation.test.sql)
> ⚠️ **Estado:** el SQL se ha revisado a mano pero **no se ha ejecutado** (Docker no estaba arrancado en este PC). Primer paso del día 1: `supabase start && supabase db reset && supabase test db`.

---

## 1. Stack y por qué (decisión cerrada)

| Capa | Elección | Por qué | Coste inicial |
|---|---|---|---|
| Base de datos + Auth + Realtime + Storage + Edge Functions | **Supabase** (región **eu-central-1 Frankfurt** o eu-west) | Postgres + RLS = aislamiento real entre talleres. Realtime para el panel. Datos en la UE (RGPD). | Free → **Pro $25/mes** desde el primer cliente de pago (backups diarios y sin pausas) |
| Frontend (app de taller + web comercial) | **Next.js 15 en Vercel** (o Vite SPA en Vercel/Cloudflare Pages) | Ya trabajas con React, Vite, shadcn y Tailwind: el mismo kit que tus apps Base44. Copias componentes, no aprendes otro framework. | Hobby gratis → **Pro $20/mes** al cobrar (el uso comercial exige Pro) |
| Mensajería | **Meta WhatsApp Cloud API**: tú como **Tech Provider**, Embedded Signup + Coexistence | Ver §3 | Meta cobra por mensaje (ver doc 05) |
| Pagos | **Stripe Billing** + Customer Portal + Stripe Tax | SEPA y tarjeta, facturas de **tu** SaaS a los talleres (la facturación de tu SL la llevas con tu propio programa Verifactu) | 1,5 % + €0,25 (tarjeta UE) |
| Facturación de los talleres (Fase 2) | **Proveedor Verifactu por API** (candidatos a pedir presupuesto: Verifacti, B2Brouter, FacturaDirecta API, Holded API, Quipu; **verifica la certificación y el soporte multi-emisor** antes de firmar) | Ver §5 | ≈ €1–5 por taller al mes |
| Colas / cron | `pg_cron` + Edge Functions (Supabase) | Sin servidores extra. **Nada de cron en Base44** (es lo que te quemó los créditos) | Incluido |
| Impresión | **CSS `@page` 58/80 mm** desde el navegador (Fase 1) + **QZ Tray** opcional para impresión silenciosa ESC/POS | Cero drivers propios | QZ Tray: gratis (licencia comercial opcional) |
| IA (recepcionista, Fase 2) | API con **retención cero** y DPA (Anthropic / OpenAI / Mistral UE) | RGPD: sin entrenamiento con datos de clientes | ≈ €0,5–2 por taller al mes |
| Observabilidad | Sentry (free) + logs de Supabase + `/status` público | Saber antes que el cliente | €0 |

**Lo que NO hacemos:** no migramos tus apps Base44 actuales (tu taller sigue con lo que funciona), no llamamos a Meta desde el navegador y no ponemos la clave `service_role` en el frontend jamás.

---

## 2. Modelo multi-tenant (Eng Manager + /cso)

### 2.1 Principio
**Un solo esquema compartido**, con `tenant_id` en cada fila y **RLS forzada**. Es la opción más barata y la que mejor escala para cientos de talleres pequeños. La alternativa (esquema o base de datos por taller) es excesiva hasta pasar de unos 1.000 talleres.

### 2.2 Tablas (resumen del SQL 001)

| Tabla | Propósito | Quién escribe | Notas |
|---|---|---|---|
| `tenants` | El taller: NIF, logo, impresora 58/80, horario, WhatsApp, reseñas, DPA | Owner/Admin (solo columnas seguras); `plan`, `status` y WABA, solo el backend | `wa_paused` = kill-switch; `wa_daily_cap` |
| `tenant_users` | Membresía + rol (`owner`/`admin`/`counter`/`technician`) | Owner | **La única llave a los datos** |
| `subscriptions` | Espejo de Stripe | Solo el webhook de Stripe (service_role) | |
| `customers` | Clientes finales del taller | Personal del taller | **Registro de consentimiento** separado para avisos, marketing y opt-out; DNI solo con los 4 últimos caracteres |
| `price_items` | Lista de precios (plantillas globales `tenant_id NULL` + copia por taller) | Owner/Admin | Sembrada con 24 precios españoles típicos |
| `repair_tickets` | **Resguardo de depósito / Orden de reparación** | Personal del taller | Numeración `AAAA-000123` por taller y año; garantía mínima de 90 días; código de desbloqueo **cifrado** |
| `ticket_events` | Historial de estados (append-only) | Trigger | KPIs de técnicos y auditoría |
| `whatsapp_logs` | **Outbox** + log de todo lo enviado y recibido | Triggers y dispatcher | `UNIQUE(tenant_id, idempotency_key)` → **adiós al incidente 6x** |
| `cash_closings` | Cierre de caja diario | Mostrador | Una vez `cerrada`, **inmutable**; una diferencia distinta de 0 exige motivo |
| `cash_movements` | Libro de caja **append-only** | Mostrador | Las correcciones son movimientos opuestos, nunca ediciones |
| `fiscal_documents` | Referencia a facturas emitidas **por el proveedor Verifactu** | Solo backend | Inmutable salvo `aeat_status` |
| `leads`, `demo_requests`, `wa_events_inbox` | Plataforma (ventas, demo, webhooks crudos) | Solo service_role | RLS activa sin políticas |

### 2.3 Las 7 garantías de aislamiento (/cso)
1. `ENABLE` + **`FORCE ROW LEVEL SECURITY`** en las 15 tablas. `anon` sin permisos en ninguna.
2. Políticas basadas en `private.is_member(tenant_id)` y `private.has_role(...)`: funciones `SECURITY DEFINER` con `search_path = ''`, en un esquema **no expuesto** por la API.
3. **FK compuestas** `(tenant_id, x_id)`: aunque un bug intente enlazar un ticket del taller A con un cliente del taller B, **Postgres lo rechaza**.
4. `tenant_id` **inmutable** por trigger.
5. Escrituras sensibles (plan, estado, WABA, suscripción, facturas, logs de WhatsApp) **revocadas** para `authenticated`. Solo las hacen las Edge Functions con service_role.
6. **Realtime** respeta RLS: cada panel solo recibe sus tickets.
7. **Tests automáticos** (`supabase test db`) en cada push: el usuario del taller B intenta leer, insertar y actualizar datos del taller A, y debe fallar. Si un test falla, no se despliega.

### 2.4 Seguridad adicional (/cso checklist)
- [ ] Auth: email + **magic link / OTP**. El personal de mostrador entra con cuenta propia (nada de cuentas compartidas, para que la auditoría sea real).
- [ ] Clave `service_role` **solo** en los secretos de las Edge Functions. Revisa en CI que no aparezca en `web/` (`grep -r "service_role" web/` debe dar 0).
- [ ] **Supabase Vault** para los tokens de WhatsApp por taller y las claves del proveedor Verifactu.
- [ ] Webhook de Meta: verifica la firma `X-Hub-Signature-256` con el App Secret **antes** de procesar.
- [ ] Webhook de Stripe: `stripe.webhooks.constructEvent` con el secreto del endpoint.
- [ ] `unlock_code_enc`: cifrado `pgp_sym_encrypt` en una Edge Function. Se muestra solo al técnico asignado y se **borra automáticamente** 30 días después de entregar.
- [ ] Rate limit + **Cloudflare Turnstile** en todo formulario público (demo, registro).
- [ ] Backups: Supabase Pro (diarios, 7 días) + **export semanal cifrado** a Cloudflare R2 (≈ €0). RPO objetivo: 24 h. RTO: 4 h.
- [ ] **Purga RGPD** al darse de baja un taller: export → 30 días de gracia → `SET LOCAL app.purge = 'on'` (service_role) → borrado en cascada. Las facturas se conservan **en el proveedor Verifactu** (4 años, LGT art. 66).
- [ ] Logs sin datos personales en Sentry (filtra teléfono y nombre).

### 2.5 Paginación infinita del panel (rendimiento)
Keyset, nunca `OFFSET`:
```sql
select id, ticket_number, status, brand, model, created_at
from repair_tickets
where tenant_id = $1 and (created_at, id) < ($cursor_created_at, $cursor_id)
order by created_at desc, id desc
limit 50;
```
Índice `repair_tickets_feed_idx` ya creado. Con 100.000 tickets por taller, cada página tarda menos de 10 ms.

### 2.6 Cómo probar el aislamiento (manual, 2 minutos)
Ver el bloque `RLS SMOKE TEST` al final del SQL 001.

### 2.7 Tests automáticos
`supabase/tests/rls_isolation.test.sql` (pgTAP) crea 2 talleres y 2 usuarios, y comprueba 8 ataques cruzados. Se ejecuta con `supabase test db`.

---

## 3. Onboarding de WhatsApp sin "infierno Meta" (< 3 minutos)

### 3.1 Comparativa

| Criterio | **A. Número maestro compartido** (todos los talleres envían desde "Taller SaaS") | **B. Embedded Signup + Coexistence** (cada taller usa SU número, gestionado por nosotros como Tech Provider) |
|---|---|---|
| Tiempo de alta del taller | 0 min | **2–3 min** (login de Facebook, elegir número, escanear QR desde su app WhatsApp Business) |
| ¿Quién verifica la empresa? | Nadie más | El taller puede enviar con el nivel inicial **sin verificar su empresa** (verás el límite exacto vigente en el panel). Para crecer, la verificación se hace después, con calma |
| El cliente final ve… | Un número desconocido ("Taller SaaS") | **El número y el nombre de SU taller** (confianza = conversión de reseñas) |
| Respuestas del cliente | Llegan a nosotros y hay que reenrutarlas: un lío | Llegan **a su móvil** (coexistence) **y** a nuestra bandeja |
| Calidad y baneo | **Uno para todos**: un taller que hace spam tumba a los 200 | **Aislado por taller** |
| Política de Meta | Zona gris: un número enviando en nombre de muchas empresas distintas | Es el modelo oficial para plataformas |
| Coste de Meta | Lo pagas tú | Lo pagas tú (Meta factura a la WABA o a tu línea de crédito como Tech Provider) y lo repercutes en el plan |
| Esfuerzo técnico | Bajo | Medio: 2–3 semanas, una sola vez |
| **Veredicto** | ❌ Solo para la **demo web** y el "mensaje de prueba" del onboarding | ✅ **GANADOR** |

> Fuentes para verificar antes de construir (Meta cambia esto a menudo): *developers.facebook.com/docs/whatsapp/embedded-signup*, la sección **"Onboarding WhatsApp Business app users (coexistence)"** y *Tech Provider program*. Comprueba la disponibilidad de coexistence para números +34, los límites del nivel inicial sin verificar y las tarifas vigentes en España.

### 3.2 Requisitos previos (los haces **tú una vez**, no cada taller)
1. Constituir la SL y el dominio (`tallersaas.es` o la marca elegida).
2. Meta Business Manager de la SL → **verificación de empresa** (CIF + factura de suministro o escritura): 2–10 días.
3. Crear la app de Meta (tipo Business) → producto WhatsApp → solicitar **Tech Provider** → App Review para `whatsapp_business_management` y `whatsapp_business_messaging` (grabar un vídeo del flujo): 1–4 semanas. **Empieza el día 1.**
4. Configurar Embedded Signup (Facebook Login for Business, `config_id`) con `featureType: 'whatsapp_business_app_onboarding'` para coexistence.
5. Webhook de la app → `https://<proyecto>.supabase.co/functions/v1/wa-webhook` (campos `messages`, `message_template_status_update`, `phone_number_quality_update`, `account_update`).

### 3.3 Flujo del taller (UX, 3 minutos)
```
[Wizard paso 4: "Conecta tu WhatsApp"]
  ¿Usas WhatsApp Business en el móvil del taller?
   (●) Sí, quiero seguir usándolo (recomendado)  -> coexistence
   ( ) No / prefiero un número nuevo solo para avisos -> número nuevo
  [Botón verde: Conectar con Facebook]
      └─ popup Meta: inicia sesión → elige/crea Business → elige número → (coexistence) escanea QR en la app WA Business
  ← callback JS: { code, waba_id, phone_number_id }
[Edge Function wa-onboard]
  1. Intercambia code → business token (server-side)
  2. Guarda token en Vault; waba_id/phone_number_id en tenants
  3. Suscribe la app a la WABA (POST /{waba_id}/subscribed_apps)
  4. Registra el número si es nuevo (POST /{phone_number_id}/register con PIN)
  5. Crea las 4 plantillas del taller desde nuestro catálogo (ver 3.4)
  6. Envía "mensaje de prueba" al móvil del dueño
[Pantalla] ✅ "¡Listo! Te acabamos de mandar un WhatsApp de prueba. ¿Te ha llegado?" [Sí] [No → ayuda]
```
**Si algo falla** (en torno al 20–30 % de los casos: cuenta de Facebook bloqueada, número en otra WABA…), la pantalla ofrece "Llámame y lo hacemos juntos" → reserva de 15 min con Cal.com. Esa es la **Instalación Llave en Mano**.

### 3.4 Catálogo de plantillas (español, categoría y variables)

| Nombre | Categoría | Texto (variables entre {{ }}) |
|---|---|---|
| `taller_recibido_v1` | utility | Hola {{1}}, hemos recibido tu {{2}} en {{3}}. Nº de resguardo: {{4}}. Te avisaremos por aquí en cuanto tengamos el diagnóstico. Responde BAJA si no quieres avisos. |
| `taller_presupuesto_v1` | utility | Hola {{1}}, el presupuesto para tu {{2}} es de {{3}} € (IVA incl.). Resguardo {{4}}. Responde *SÍ* para aceptar o *NO* para rechazarlo. |
| `taller_listo_v1` | utility | ¡Buenas noticias, {{1}}! Tu {{2}} ya está reparado y listo para recoger en {{3}}. Horario: {{4}}. Trae el resguardo {{5}}. |
| `taller_resena_v1` | **marketing** | Gracias por confiar en {{1}}, {{2}}. ¿Nos ayudas con una reseña de 30 segundos? {{3}} ¡Nos ayuda muchísimo! |

> Ojo: en `taller_presupuesto_v1` la respuesta "NO" significa **rechazar el presupuesto**, no darse de baja. Por eso el opt-out (3.6) **nunca** puede tratar "no" como baja.

### 3.5 Dispatcher (Edge Function `wa-dispatch`, cada minuto con `pg_cron`)
```text
loop (máx 25 s):
  BEGIN;
  SELECT * FROM whatsapp_logs
   WHERE status='queued' AND send_after <= now()
   ORDER BY send_after LIMIT 20
   FOR UPDATE SKIP LOCKED;                 -- nunca dos workers con la misma fila
  para cada fila:
    tenant = tenants[fila.tenant_id]
    si tenant.wa_paused o tenant.status no operativo        -> status='failed', error='paused'
    si cliente.wa_opted_out                                 -> status='blocked_opt_out'
    si fuera de horario comercial del taller (utility no urgente/marketing) -> send_after = próxima apertura; continuar
    si enviados_hoy(tenant) >= tenant.wa_daily_cap          -> send_after = mañana 10:00; alerta al fundador
    POST graph.facebook.com/v23.0/{phone_number_id}/messages (token del Vault)
    ok   -> status='sent', wa_message_id
    error-> clasificar (transient / hold / permanent; reutiliza tu classifyMetaError)
            transient: attempts++, send_after = now()+2^attempts min (máx 3)
            permanent: status='failed'
  COMMIT;
```
**Alarma de calidad:** si el webhook `phone_number_quality_update` reporta `YELLOW`, se envía un WhatsApp al fundador y al dueño y se pausa el marketing (reseñas). Si reporta `RED` o un rate-limit, se pone `wa_paused = true` automáticamente.

### 3.6 Opt-out correcto (corrige el bug actual)
```ts
const OPT_OUT = new Set(['baja', 'stop', 'baja whatsapp', 'darme de baja', 'unsubscribe']);
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
                             .replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const isOptOut = (text: string) => OPT_OUT.has(norm(text));   // COINCIDENCIA EXACTA. "no" NO es baja.
// Si isOptOut: customers.wa_opted_out = true + responder (dentro de la ventana de 24 h, gratis):
// "Hecho. No recibirás más avisos de {{taller}} por WhatsApp. Si cambias de idea, escribe ALTA."
// "ALTA" → reactiva wa_service_opt_in (consentimiento nuevo con fecha).
```
**Acción inmediata en tu app actual** (`whatsapp-inbox-pro/base44/functions/whatsappWebhook/entry.ts:377`): sustituye la lista y el `startsWith` por la coincidencia exacta de arriba. No lo modificamos nosotros porque esa carpeta es de solo lectura.

### 3.7 Webhook entrante (`wa-webhook`)
1. Verificar la firma → 2. `insert into wa_events_inbox (event_id, …) on conflict do nothing` (dedupe) → 3. responder **200 en menos de 1 s** → 4. procesar de forma asíncrona: estados (`sent/delivered/read/failed` → `whatsapp_logs`), mensajes entrantes (opt-out → respuesta del presupuesto "SÍ"/"NO" → recepcionista IA en Pro → bandeja), calidad del número.

---

## 4. Wizard de alta self-serve en 60 segundos (lente Designer)

**Principio:** el dueño de un taller rellena esto **de pie, en el mostrador, entre cliente y cliente**. Botones grandes, un dato por pantalla, todo con valor por defecto y "saltar" en todo lo que no sea crítico.

| Paso | Pantalla | Campos (por defecto) | Tiempo | Truco UX |
|---|---|---|---|---|
| 0 | **Registro** | Email → código de 6 dígitos (OTP). Sin contraseña. | 10 s | Sin "confirma tu email" en otra pestaña: el OTP se escribe ahí mismo |
| 1 | **Tu taller** | Nombre comercial · **NIF/CIF** (validación de letra en vivo) · ¿Eres autónomo o SL? (radio) · Código postal → autocompleta ciudad y provincia | 15 s | "¿Por qué pedimos el NIF? Sale impreso en tu resguardo." |
| 2 | **Logo** | Subir o hacer foto con el móvil (o "Saltar: usaremos tus iniciales") | 5 s | Recorte automático a escala de grises para la impresora térmica + vista previa del ticket |
| 3 | **Impresora** | ( ) 58 mm ( ) 80 mm ( ) No tengo → **[Imprimir ticket de prueba]** | 10 s | Imagen de cada ancho para que lo reconozca. Si sale cortado, 1 clic en "Cambiar a 58" |
| 4 | **Precios** | Casillas: ☑ Móviles (iPhone/Samsung/Xiaomi) ☑ Consolas (PS5 HDMI, Switch, mandos) ☑ PC/portátiles (formateo, SSD) → tabla editable con los precios sembrados | 10 s | "Son precios orientativos 'desde'. Cámbialos cuando quieras." Botón "Subir mi Excel" |
| 5 | **WhatsApp** | Flujo §3.3 (se puede saltar: "Lo conecto luego") | 0–180 s | Saltar no bloquea: tickets e impresión funcionan sin WhatsApp |
| 6 | **Reseñas** | Buscar tu taller en Google (Places Autocomplete) → generamos el enlace `https://search.google.com/local/writereview?placeid=…` | 5 s | Muestra "Tienes 47 reseñas. Los talleres con avisos suelen sumar más cada mes." (dato real del taller, sin prometer cifras) |
| 7 | **Contrato + pago** | Casilla DPA (Encargo del Tratamiento) + condiciones · Plan (Fundador €29 / Starter €39 / Anual) · Stripe Checkout | 20 s | Garantía de 30 días bien visible junto al botón de pago |
| 8 | **Primer ticket** | "Crea tu primer resguardo ahora (puedes usarte a ti mismo de cliente)" → recibe el WhatsApp "recibido" en tu móvil | 30 s | **Momento "¡guau!"**: la activación se mide aquí |

**Métrica de activación:** primer ticket con WhatsApp entregado en menos de 24 h desde el alta. **Objetivo ≥ 70 %.** Si un taller no se activa en 48 h, el fundador recibe un aviso para llamarle.

### 4.1 Alta de ticket en 30 segundos (pantalla de mostrador)
```
┌──────────────────────────────────────────────┐
│ 📱 Teléfono cliente: [6__ ___ ___]  ← busca al teclear; si existe, rellena nombre
│ 👤 Nombre: [___________]
│ Dispositivo: [Móvil][Tablet][Portátil][PC][Consola][Mando]   (botones grandes)
│ Marca/Modelo: [iPhone 13      ▼] ← autocompleta de price_items + historial
│ Avería: [Pantalla rota][Batería][No carga][No enciende][Mojado][Otro: ____]
│ Precio: 109 € desde (de la tabla) [editar]   Señal: [0 €]
│ Accesorios: ☐ Cargador ☐ Funda ☐ SIM ☐ Tarjeta SD     Estado físico: [____]
│ Código desbloqueo: [••••] (cifrado)          Técnico: [Auto ▼]
│ ☑ Avisarme por WhatsApp del estado de mi reparación
│ ☐ Acepto que me pidan una reseña al recoger (opcional)
│ [ IMPRIMIR RESGUARDO + ETIQUETA ]  (Enter)
└──────────────────────────────────────────────┘
```
Atajos de teclado: `F2` nuevo, `F3` buscar, `F9` imprimir. El **resguardo** lleva QR al estado público (`/t/{token}`), datos del taller y NIF, garantía y el pie "Este documento no es una factura". La **etiqueta** (40×30 mm o una tira de 58 mm) lleva el nº, el cliente, el modelo y un QR interno.

### 4.2 Panel de tickets
Columnas por estado (Kanban) o lista infinita. Filtros por técnico, estado y "atrasados" (pasado `promised_at`). Cambiar de estado = 1 toque, y si el cliente tiene opt-in el WhatsApp sale solo. Indicador de envío por ticket: ✓ enviado, ✓✓ entregado, azul leído, ⚠ fallo.

### 4.3 Migración desde Reparo / otros
Importador CSV con mapeo de columnas (cliente, teléfono, dispositivo, estado, fecha). **Reparo es tu propia app Base44 (la IP es tuya)**: exporta sus entidades (`base44/entities/*.jsonc`) y escribimos un exportador directo, que además sirve de base para portar la lógica de alta, impresión y TPV. Los tickets importados entran **sin disparar WhatsApp** (`notify_whatsapp = false`).

---

## 5. TPV y Cierre de Caja (Fase 2, detrás de puertas)

### 5.1 La frontera fiscal (no negociable)
```
 RESGUARDO (repair_tickets)            FACTURA (fiscal_documents)
 - RD 58/1988, NO fiscal                 - Verifactu (RD 1007/2023)
 - se puede editar (diagnóstico, precio) - emitida SOLO por proveedor certificado vía API
 - numeración propia 2026-000123         - serie/número del proveedor, hash encadenado, QR AEAT
 - "Este documento no es una factura"    - inmutable; corregir = factura rectificativa
              │                                          ▲
              └── al cobrar: TPV llama a InvoiceSigner ──┘ → cash_movements (append-only)
```
- **Interfaz `InvoiceSigner`** (`issueSimplified`, `issueFull`, `issueCorrective`, `getStatus`): un adaptador por proveedor. Cambiar de proveedor = cambiar de adaptador.
- **Sin factura no hay venta**: si el proveedor no responde, la venta queda en "pendiente de emitir" con reintento. **Nunca** se genera una numeración "temporal" propia, porque eso sería un SIF casero.
- **Taller que ya tiene su propio programa de facturación** (muy habitual: el de su gestoría): modo "**Sin facturación**". El TPV solo registra cobros y cierre de caja, y la factura la hace su programa. Exposición Verifactu para ti: **cero**.

### 5.2 Cierre de caja en 10 pasos (wizard)
1. Confirmar fecha y caja (`CAJA1`) → 2. Mostrar los tickets cobrados del día (solo lectura) → 3. Sumatorio por medio de pago (`cash_expected()`) → 4. **Contar efectivo por denominación** (500 € … 0,01 €; total automático) → 5. Introducir el total del datáfono (informe Z) → 6. Bizum/transferencias → 7. **Diferencia**: si no es 0, el motivo es obligatorio (mín. 5 caracteres) → 8. Retirada a banco/caja fuerte (movimiento `retirada_banco`) y fondo para mañana → 9. Checklist (cajón cerrado, datáfono cerrado, resguardos firmados archivados…) → 10. **Cerrar** (inmutable) + PDF del cierre por email/WhatsApp al dueño.

### 5.3 CashDroPuente (upsell hardware, mes 6 o más)
Mini-servicio local (Windows service o Raspberry Pi) en la red del taller que habla con la API REST local de CashDro y empuja `cashdro_report` y los movimientos a Supabase con una clave **por dispositivo**, limitada a `cash_movements` de ese taller (Edge Function proxy, nunca service_role en el local). Solo se construye con un cliente que lo pague por adelantado.

---

## 6. Estructura del repositorio
```
taller-saas/
├─ docs/                      ← estos 5 documentos
├─ supabase/
│  ├─ migrations/001_multi_tenant_core.sql
│  ├─ tests/rls_isolation.test.sql
│  └─ functions/              ← (siguiente) wa-onboard, wa-dispatch, wa-webhook, stripe-webhook, demo-whatsapp, voice-webhook
├─ web/                       ← (siguiente) Next.js: /(marketing) landing + /app panel del taller
└─ automation/
   ├─ scraper_talleres.py     ← prospección vía Google Places API (oficial)
   └─ voice_agent_prompt_es.md
```

## 7. Orden de construcción (Eng Manager, para un fundador con IA)

| Semana | Entregable | Hecho = |
|---|---|---|
| 1 | Supabase local + migración 001 + tests RLS en verde | `supabase test db` pasa |
| 1–2 | Auth OTP + wizard pasos 0–4 + alta de ticket + impresión 58/80 | Tú imprimes 20 resguardos reales en tu taller |
| 2–3 | Meta Tech Provider (empezado el día 1) + `wa-onboard` + `wa-dispatch` + `wa-webhook` | Tu taller envía los 4 avisos desde el núcleo nuevo durante 14 días **sin duplicados** |
| 3–4 | Stripe Checkout + webhook + portal + garantía de 30 días | Un taller amigo paga |
| 4–5 | Panel de resultados ("avisos, reseñas, llamadas evitadas") + importador CSV | 5 talleres piloto activos |
| 8+ | (Puerta) TPV + cierre + adaptador `InvoiceSigner` | 30 días en tu taller con un cierre que cuadra |
