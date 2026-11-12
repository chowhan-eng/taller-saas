# Taller SaaS — web (MVP)

Landing B2B + simulador de WhatsApp en 5 s + alta en 3 pasos con Stripe. Alcance bloqueado en [`../docs/06-MVP-SCOPE-LOCK.md`](../docs/06-MVP-SCOPE-LOCK.md).

## Rutas
| Ruta | Qué hace |
|---|---|
| `/` | Landing en español (copy de `docs/03`), simulador y calculadora de ROI |
| `POST /api/demo/whatsapp` | Turnstile → consentimiento → móvil 6xx/7xx → límites → `leads` + `demo_requests` → plantilla Meta → callback de voz solo con consentimiento |
| `/onboarding` | 1) Email + código OTP 2) Taller (`rpc create_tenant` + `rpc accept_dpa`) 3) Plan → Stripe |
| `POST /api/checkout` | Solo el `owner` del taller; crea el Customer y la Checkout Session (Starter €29 / Pro €69) |
| `POST /api/stripe/webhook` | **Única** fuente de verdad del pago → `subscriptions` + `tenants.status/plan` |

## Puesta en marcha (local)
1. Base de datos: en la raíz, `supabase start`, luego `supabase db reset` (aplica `001` y `002`) y `supabase test db`.
2. Supabase Auth: en **Authentication → Email Templates → Magic Link**, añade `{{ .Token }}` para que llegue el **código de 6 dígitos** que pide el wizard.
3. Stripe (modo test): crea 2 *Prices* recurrentes en EUR (29 € y 69 €/mes) y copia sus IDs.
4. `copy .env.example .env.local` y rellénalo.
5. `npm install`, luego `npm run dev`, y en otra terminal `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
6. Prueba: simulador con tu móvil → wizard → tarjeta `4242 4242 4242 4242` → `tenants.status = 'active'`.

## Seguridad
- `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` y `DEMO_WA_TOKEN` solo se usan en `app/api/**` (servidor). Nunca en archivos `'use client'`.
- En producción, **Turnstile es obligatorio**: sin `TURNSTILE_SECRET`, la demo rechaza todas las peticiones.
- `/privacidad` es un **borrador**: revisión por abogado antes de publicar.

## Verificado (12 nov 2026)
`tsc --noEmit` ✔ · `next build` ✔ (8 rutas) · Validaciones de la API probadas en el servidor de desarrollo: sin consentimiento → 400, fijo 96x → 400, JSON inválido → 400, webhook sin firma → 400, checkout sin sesión → 401 · Landing comprobada a 375 px.
**Sin probar todavía:** envío real por Meta, flujo OTP real y pago real en Stripe test (requieren tus credenciales).
