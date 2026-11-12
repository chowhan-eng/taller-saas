# 06 — MVP Scope Lock (autoplan, lean run)

> **Fecha:** 12 nov 2026 · **Revisa:** `docs/02` + `docs/03` · **Modo:** `/autoplan` *lean*. Lentes CEO → Design → Eng aplicadas inline con auto-decisión según los 6 principios de gstack. **No** se ejecutaron el pipeline multi-agente completo ni la segunda opinión de Codex (no está instalado). Ese recorte lo pidió el fundador ("Sonnet efficiency").
> **Contexto nuevo:** Reparo y los módulos de TPV son **apps Base44 propias del fundador (IP 100 % suya)**. Se portan; no son un riesgo de proveedor.

## 1. Alcance bloqueado del primer build (`web/`)

| # | Pieza | Ruta | Hecho = |
|---|---|---|---|
| 1 | Landing B2B en español (hero, problema, cómo funciona, ROI, planes, quién soy, FAQ, CTA) | `/` | Renderiza en el móvil, LCP < 1 s, copy de `docs/03 §2` |
| 2 | Simulador de WhatsApp en 5 s | UI en `/` + API `POST /api/demo/whatsapp` | Turnstile (si está configurado) → consentimiento → móvil 6xx/7xx → rate limit → `leads` + `demo_requests` → plantilla `demo_taller_listo` vía Meta → aviso al fundador → `schedule_voice_callback` solo con consentimiento de llamada |
| 3 | Wizard de alta en 3 pasos | `/onboarding` | **Paso 1** Cuenta (OTP por email, Supabase Auth) → **Paso 2** Taller (nombre, slug, NIF, autónomo/SL, 58/80 mm, DPA) → `rpc create_tenant` + `rpc accept_dpa` → **Paso 3** Plan → Stripe Checkout |
| 4 | Checkout + webhook de Stripe | `POST /api/checkout`, `POST /api/stripe/webhook` | Sesión de suscripción con `tenant_id` en los metadatos → el webhook escribe `subscriptions` y activa `tenants` (service_role) |
| 5 | Páginas legales mínimas | `/privacidad`, `/onboarding/gracias` | Placeholder marcado "pendiente de revisión por abogado" |

## 2. Decisiones auto-tomadas (registro)

| # | Fase | Decisión | Tipo | Principio | Rechazado |
|---|---|---|---|---|---|
| 1 | CEO | El MVP es exactamente lo que el fundador listó (landing + simulador + wizard + Stripe). Fuera: panel de tickets, dispatcher y Embedded Signup | Mecánica | P6 acción | Construir todo `docs/02 §7` de golpe |
| 2 | CEO | **Precios según la instrucción del fundador: Starter €29 / Pro €69.** El consejo (doc 01) recomendaba €39 de lista + €29 Fundador y Pro solo en lista de espera | **User Challenge** (no auto-decidido; se mantiene la dirección del fundador) | — | — |
| 3 | Eng | La demo vive en una ruta API de Next.js (`/api/demo/whatsapp`), no en una Edge Function de Supabase (el fundador nombró esa ruta). Misma lógica que `docs/03 §4.3` | Mecánica | P3 pragmático | Edge Function |
| 4 | Eng | Auth en el cliente con `supabase-js` (anon key + sesión). Las rutas API validan el `Bearer` con `auth.getUser(token)` y comprueban `owner` en `tenant_users` | Taste | P5 explícito | `@supabase/ssr` con cookies (más piezas y middleware) |
| 5 | Eng | El wizard escribe solo a través de las RPC `SECURITY DEFINER` (`create_tenant`, `accept_dpa`); nunca inserta en `tenants` directamente (RLS lo impide igualmente) | Mecánica | P4 DRY (reutiliza el SQL 001) | Insert directo |
| 6 | Eng | Precios de Stripe por variables de entorno (`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`), nunca importes en el código | Mecánica | P5 | Precios inline |
| 7 | Eng | Sin Tailwind ni shadcn en el MVP: un único `globals.css` con tokens. Menos dependencias, build más rápido | Taste | Reuse ladder (CSS nativo) | Tailwind |
| 8 | Design | Botones grandes (≥ 48 px), un dato por pantalla, progreso visible "Paso X de 3", modo claro y oscuro con tokens, móvil primero | Mecánica | P1 completitud | — |
| 9 | Design | Las casillas de consentimiento van **desmarcadas** y la de la demo es obligatoria; el enlace a `/privacidad` está junto al botón | Mecánica | Legal (doc 01) | Casillas premarcadas |
| 10 | Eng | Stripe: el webhook es la única fuente de verdad del pago; la página "gracias" no activa nada | Mecánica | Seguridad | Activar en el `success_url` |
| 11 | Eng | Idempotencia del webhook: upsert por `tenant_id` / `stripe_subscription_id` | Mecánica | P1 | — |

## 3. NO entra en este build
Panel de tickets, impresión, dispatcher de WhatsApp para talleres, Embedded Signup/Coexistence, recepcionista IA, TPV, cierre, Verifactu, agente de voz (solo se **programa** el callback en `voice_calls`), importador desde Reparo, emails transaccionales propios (Supabase envía el OTP).

## 4. Lo que ya existe y se reutiliza
`001_multi_tenant_core.sql` (`create_tenant`, `accept_dpa`, RLS, `leads`, `demo_requests`), `002_sales_engine.sql` (`schedule_voice_callback`), el copy de `docs/03 §2`, la fórmula ROI de `docs/03 §3` y la lógica de la demo de `docs/03 §4.3`.

## 5. Registro de fallos (Eng)

| Fallo | Qué ve el usuario | Rescate |
|---|---|---|
| Meta rechaza el envío (plantilla no aprobada o token caducado) | "No hemos podido enviarlo ahora, te escribimos en unos minutos" | `demo_requests.status = 'failed'` + alerta al fundador |
| Turnstile falla | "Verificación fallida, recarga" | 400 |
| Slug ya usado | "Esa dirección ya existe, prueba otra" | Error 23505 → mensaje |
| NIF con formato inválido | Validación en el cliente + check en la base de datos | Mensaje en el campo |
| Webhook de Stripe con firma inválida | — | 400 y nada se escribe |
| El usuario cierra el Checkout | Vuelve a `/onboarding?paso=3` | El tenant queda en `onboarding` y `subscriptions.incomplete` |

## 6. Plan de pruebas mínimo
1. `npm run build` en verde.
2. `POST /api/demo/whatsapp` sin consentimiento → 400; con un número fijo 96x → 400; dos envíos al mismo número → el segundo responde "ya te lo enviamos".
3. Wizard completo con Stripe en modo test (tarjeta `4242 4242 4242 4242`) → `stripe listen --forward-to localhost:3000/api/stripe/webhook` → `tenants.status = 'active'`.
4. Test RLS (`supabase test db`).

## 7. Puerta final: decisión pendiente del fundador
**UC1 (Precio y Pro):** has pedido Starter €29 y Pro €69 con checkout. El consejo recomendaba €39 de lista (€29 solo para los 20 Fundadores) y Pro como lista de espera hasta que existan el TPV y Verifactu. **Se ha construido como pediste.** Cambiarlo solo implica tocar las variables de entorno de Stripe y el texto de los planes.
