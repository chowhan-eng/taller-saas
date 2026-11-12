# 07 — Taller SaaS on Base44 (supersedes the Supabase/Vercel track)

Status: refactor done locally, **not yet deployed**. Supersedes the Supabase + Vercel parts of doc 02 and the `web/` setup in the old `web/README.md`. Reparo, WhatsApp Inbox Pro and TPV are the founder's own Base44 apps (100% own IP): we port their logic into this app's modules; they are not third-party vendors.

## 1. Layout (Base44 CLI format)

```
base44/
  config.jsonc          project config (visibility public, entitiesDir ./db, site → ./dist)
  .app.jsonc            created by `npx base44 link` (gitignored, holds the app id)
  db/*.jsonc            17 entity schemas = the old 001 + 002 SQL schema
  functions/<name>/entry.ts   backend functions (Deno), URL https://<app-domain>/functions/<name>
  shared/*.ts           code shared by functions (crypto, gating, quotas, Stripe, sales)
src/  index.html  onboarding/  privacidad/   static React site (Vite multi-page → dist/)
public/                 static files copied as-is (mostrador.jpg, legal/contrato-encargado-tratamiento.md)
tests/                  vitest: crypto, customers, gating, quotas, call slots
```

The brief asked for `.app.jsonc`, `functions/`, `public/`, `db/`. They exist, but with Base44's real layout. Two differences: `.app.jsonc` lives inside `base44/` (the CLI creates it), and the site is served from the Vite build `dist/`. `public/` holds its static assets, because Vite copies `public/` into `dist/`.

## 2. Functions

| Function | Auth | Replaces |
|---|---|---|
| `demoWhatsapp` | public | `/api/demo/whatsapp` (same 8 steps, same Spanish messages, same limits 1/phone/24 h, 3/IP/h, 200/day) |
| `onboardingState` | user | browser query on `tenant_users` |
| `createTenant` | user | `create_tenant()` + `accept_dpa()` + `is_autonomo` update |
| `checkout` | owner | `/api/checkout` + **14-day Starter trial** |
| `stripeWebhook` | Stripe signature | `/api/stripe/webhook` (only place that changes plan/status) |
| `entitlements` | member | new: modules the shop may use |
| `whatsappWebhook` | Meta signature | WhatsApp Inbox Pro `whatsappWebhook`: inbound, receipts, BAJA/STOP, AI receptionist (see §8) |
| `whatsapp` | member + plan | send, AI draft, pause bot, quota, settings (WhatsApp Inbox Pro `sendMessage` + `generateDraft`) |
| `reparo` | member + **active paid Pro** | Reparo CRM: tickets, budget, auto-quote, unlock code, IMEI lookup (§9) |
| `tpv` | owner/admin/counter + **active paid Pro** | TPV: caja, sales by method, cash in/out, Z cierre (§9) |
| `ticketNotifySweep` | `X-Cron-Key` | every 5 min: sends due ticket WhatsApp notices |
| `seedPriceTemplates` | app admin | seed `INSERT` of 24 prices |

**Plan gating (`shared/modules.ts`, single source of truth):** Starter = `whatsapp`; Pro = `whatsapp`, `reparo`, `tpv`. Every module call runs `gateModule()` in this order:
1. The user is signed in.
2. The user has an active membership in the tenant.
3. The tenant status is onboarding, active or past_due (same as the old `tenant_active()`).
4. The plan includes the module (otherwise **402**).
5. The user's role is allowed.

**Pricing and copy (aligned with the gating):** Starter costs **39 €/mes** and is WhatsApp-only (auto-notifier, AI receptionist, Google review booster). Pro costs **79 €/mes** and adds Reparo CRM (resguardos, etiquetas, customers), technicians, TPV and cierre de caja. `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_PRO` must point to Stripe Prices of 39 € and 79 €; checkout charges whatever Price those secrets name.

## 3. Billing: 14-day trial

- **Trial terms:** Starter only, at most once per tenant (`Subscription.trial_used`).
- **Card upfront:** `payment_method_collection: 'always'`. If the card is missing when the trial ends, the subscription is cancelled (`missing_payment_method: 'cancel'`).
- **Status mapping:** `trialing` maps the tenant to `active`.
- **Trial cap (`shared/waQuota.ts`):** at most **50 outbound WhatsApp messages** while the subscription is `trialing`. `blocked_*` attempts don't count. The daily cap `wa_daily_cap` (default 250) and the `wa_paused` kill-switch apply on every plan.
- **Where the cap is enforced:** `shared/waSend.ts` `sendWhatsapp()`, the only send path (manual sends and AI replies), calls `checkWhatsappQuota()` before any Meta request. Tested, including a mutation check that removing the call fails the tests.
- **Race limit:** there are no transactions, so concurrent sends at message 49 can each pass. The overshoot is bounded by the number of concurrent sends.
- **Stripe setting:** in the Stripe Dashboard, turn on the email reminder before a trial ends (Billing → Subscriptions → "Send reminder emails"). Spanish consumer practice expects a warning before the first charge.

## 4. Encryption (AES-256) — what it guarantees, and what it does not

**Encrypted fields:**
- `Customer`: `full_name_enc`, `phone_enc`
- `RepairTicket`: `unlock_code_enc`
- `WhatsappLog`: `to_phone_enc`, `from_phone_enc`, `body_preview_enc`

**Format:** AES-256-GCM, written as `v1:<iv>:<ct+tag>`. Each entity schema has a `pattern` on these fields, so a plaintext write is rejected by the schema itself.

**Keys:**
- One 32-byte master key is stored in the Base44 secret `FIELD_ENCRYPTION_KEY`.
- HKDF-SHA256 derives a separate key per tenant, and the tenant id is bound as AAD. A ciphertext moved to another tenant fails to decrypt (tested).

**Lookup:** `phone_hash` = HMAC-SHA256 with a per-tenant index key. It makes BAJA handling and deduplication work without storing the phone number.

**Only path:** customer PII is written and read only through `shared/customers.ts`. The `reparo` function shows the pattern.

**It protects against:**
- a database export or dump
- browsing entities in the Base44 dashboard
- backups
- a bug in one tenant's query leaking another tenant's rows (they won't decrypt)

**It does NOT protect against:** our own backend code. Our functions hold the key because they have to decrypt to send WhatsApp messages and to show customer records. The operator can therefore technically decrypt. This is why the contract promises *processor-only use + no staff access except documented support or legal duty*, and **not** that we "cannot access" the data. Making access technically impossible would need client-side keys, and that would break automated WhatsApp sending. Don't claim more than this in marketing.

**Operating the key:**
- Generate it:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- Store it:
  ```bash
  npx base44 secrets set FIELD_ENCRYPTION_KEY=<value>
  ```
- **Back it up offline.** If the key is lost, every customer name and phone is lost with it.
- **Rotation:** add a `v2` key, re-encrypt on read or write, then retire `v1`. The version prefix is already in place.

**Not encrypted:** email, `dni_last4`, ticket device data (brand, model, IMEI, fault) and amounts. I kept to the brief's list. Encrypting email works the same way (`email_enc` plus `email_hash`) if you want it.

## 5. Where each old SQL guarantee lives now

Base44 entities have no SQL, triggers, unique constraints or transactions. Each guarantee moved as follows:

| SQL guarantee | Now |
|---|---|
| RLS tenant isolation | Every entity's `rls` denies direct browser access. All access goes through functions using `asServiceRole` plus a membership check. I did not use `{{user.data.tenant_id}}` rules, because users can edit their own `user.data`, which would make the rule forgeable. |
| UNIQUE slug, phone, `idempotency_key`, one subscription per tenant | Checked in functions before writes. `createTenant` also re-checks the slug after creating. These are **not race-proof** the way a DB index is. |
| `create_tenant` transaction | Sequential creates with a best-effort rollback on error. |
| Ticket numbering, lifecycle timestamps, status history, WhatsApp enqueue triggers; append-only cash and fiscal data; closed-closing freeze | **Not ported yet.** There's no Reparo or TPV code to call them. They must live in the `reparo` and `tpv` handlers when those modules are ported (see the comments there). |
| `next_call_slot`, `schedule_voice_callback` | `shared/sales.ts` (tested, including summer time). |

## 6. Setup and deploy

```bash
npm ci
npx base44 login
npx base44 link            # or: npx base44 create, then link
npx base44 secrets set FIELD_ENCRYPTION_KEY=... STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... STRIPE_PRICE_STARTER=... STRIPE_PRICE_PRO=... DEMO_PHONE_NUMBER_ID=... DEMO_WA_TOKEN=... TURNSTILE_SECRET=... SITE_URL=https://...
cp .env.example .env.local # VITE_BASE44_APP_ID, VITE_TURNSTILE_SITE_KEY, VITE_LEGAL_*
npm test && npm run typecheck && npm run check:functions
npx base44 deploy --build   # entities + functions + site
```

Then:
1. Call `seedPriceTemplates` once while signed in as the app admin.
2. Point the Stripe webhook at `https://<app-domain>/functions/stripeWebhook`. Subscribe to `checkout.session.completed` and `customer.subscription.created`, `.updated` and `.deleted`.

## 7. Known gaps (deliberately not done)

- **Never deployed** to Base44. These were checked only against the docs and `deno check`, not against a live app:
  - whether functions are reachable at `/functions/<name>` on the site's own domain
  - whether `filter()` accepts the documented arguments
  - whether `bulkCreate` exists
- **Sign-in changed.** The email-code form became Base44's hosted sign-in page: "Entrar o crear cuenta" redirects there and returns with a token. The old copy "Sin contraseñas" is gone, because Base44's sign-in method depends on the app's auth settings.
- **Security headers.** `next.config.mjs` used to set `X-Frame-Options` and `nosniff`. Static hosting can't set headers, so only the referrer policy survives, as a meta tag.
- **Scraper.** `automation/scraper_talleres.py` still has its optional Supabase upsert. Point it at the `Lead` entity (via a function) before using it.
- **Docs 02, 03 and 05** still describe Supabase. This doc overrides them where they differ.

## 8. WhatsApp engine (ported from WhatsApp Inbox Pro)

**Source.** WhatsApp Inbox Pro, the founder's live Base44 app. The ported pieces:
- `whatsappWebhook`
- `sendMessage`
- `generateDraft`
- `evaluateAutoReply`
- the Gemini "free LLM" helper

They're now multi-tenant and encrypted:
- **One webhook for all shops.** It's routed by `metadata.phone_number_id` → `Tenant.wa_phone_number_id`. Numbers that belong to no shop, such as the platform demo number, are ignored.
- **Inbound** (`shared/waInbound.ts`):
  - fail-closed `X-Hub-Signature-256` check
  - idempotency on the Meta message id
  - reactions attached to their target message
  - find-or-create thread with a re-check before insert
  - 24 h service window, unread counters, reopening resolved/spam threads
  - delivery receipts
- **Opt-out** (`shared/optout.ts`): **strictly** the whole message `BAJA` or `STOP`, ignoring case, accents and punctuation. "no", "no gracias" and "stop por favor" are not opt-outs. Note that the live app also accepts "darme de baja", "dame de baja", "unsubscribe" and "no más mensajes"; this port does **not**, as you asked. An opt-out creates the Customer record if it doesn't exist, so every later send is blocked.
- **Outbound** (`shared/waSend.ts`, the ONLY send path), in this order:
  1. `checkWhatsappQuota()` (trial cap 50, daily cap, kill-switch)
  2. opt-out block
  3. idempotency key
  4. opening hours for `automated` sends
  5. credentials: the shop token (`Tenant.wa_access_token_enc`, encrypted) or the platform `META_ACCESS_TOKEN`
  6. session text inside 24 h, `Tenant.wa_fallback_template` outside it, and a 131047 → template retry
  7. stored as ciphertext
- **AI receptionist** (`shared/receptionist.ts`):
  - **Inputs:** the decrypted last 20 messages, the shop persona, its opening hours and its own `PriceItem` list.
  - **Decision:** `off` / `shadow` / `live`, minimum confidence, requires-human, blocked categories (complaint, warranty, quote negotiation, other), the daily auto-reply cap (fails closed), and the per-conversation pause and disable switches.
  - **Sending:** live replies go through `sendWhatsapp()`, so the trial cap applies to the bot too.
  - **Logging:** `AutoReplyLog` stores no message text.
- **What's encrypted:**
  - Conversation phone, name, preview and AI draft
  - message phones and text
  - the shop's Meta token
  - lookups use the phone blind index
- **Query lesson from the live app:** the 3-argument `filter(query, sort, limit)` threw in SDK 0.8.3x. Every query now goes through `shared/db.ts` `find()` (1-argument filter, then sort and limit in JS).

**Not ported:**
- the knowledge base and embeddings (RAG)
- customer-insight memory
- chatbot flows
- broadcasts, NPS and scheduled messages
- push and alert notifications
- the HelloClient/RepairCache lookups
- media download (the Meta `media_id` and mime are stored; the binary isn't fetched)
- the inbox UI (list and read actions)

**⚠️ Before turning the receptionist on** (`ai_autoreply_mode` ≠ `off`) **or using the `draft` action:** the decrypted conversation is sent to Gemini (`GEMINI_API_KEY`) or to Base44's LLM. That provider is a new subprocessor, so add it to Annex I of the contract and to `/privacidad` first (clause 6.2). The default is `off`.

**Unverified against a live deploy:**
- **Entry point:** `export default` (from the docs) vs `Deno.serve` (what the live app uses).
- **Secrets:** `secrets.get` (docs) vs `Deno.env.get` (live app).
- **Public flag:** `export const config = { public: true }`, copied from the live webhook.

## 9. Reparo CRM and TPV (ported from the live Reparo and TPV Base44 apps)

**Gate.** Every `reparo` and `tpv` action runs through `gateModule()` before anything else. It requires all of the following:
- `Tenant.plan = pro` and `Tenant.status` ∈ {active, past_due}
- `Subscription.plan = pro` and `Subscription.status` ∈ {active, past_due}

Both rows are written only by `stripeWebhook`. `past_due` counts as Stripe's retry grace period, so a failed card doesn't lock a shop out of its till mid-day. Starter, onboarding, unpaid, cancelled and missing subscriptions get **402**. Tests call every action as a Starter shop. A mutation check (removing the subscription check) makes them fail.

**Reparo** (`shared/tickets.ts`, `shared/pricing.ts`, `shared/ticketNotify.ts`, `shared/reparoApi.ts`):
- **Ticket numbers** `YYYY-000123`, per shop and per year. Atomic: a conditional `updateMany` write, the same as Reparo's `allocateOrderNumber`.
- **Encryption.** The customer lives in Customer (name and phone encrypted). These ticket fields are AES-256-GCM:
  - IMEI/serial, plus a blind index for warranty lookups
  - unlock PIN (placeholders like «no tiene» aren't stored, as in Reparo)
  - fault, diagnosis, accessories, physical condition
  - signature URL

  Brand, model, status and amounts stay readable for reports.
- **Unlock code.** Only owner/admin can reveal it (`revealUnlockCode`), and every reveal is logged as a TicketEvent.
- **Lifecycle.** `ready_at`; `delivered_at` + `warranty_until` (Madrid date + warranty days, ≥ 90); and an append-only TicketEvent history.
- **Budget.** `enviado` (an amount is required), `aceptado` or `rechazado`, and each moves the ticket status.
- **Auto-quote.** `pricing.ts` is a verbatim port of Reparo's engine. Reparo's own expected figures are now vitest tests. It uses each shop's MarginRule/LaborRule and builds the quote message with the shop's own name.
- **WhatsApp notices.** The port of `notifyWhatsApp`:
  - each status queues a TicketNotification due in 60 s; the review request waits `review_delay_hours`
  - the sweep re-reads the ticket, so a status that changed again inside the delay isn't sent
  - notices need the customer's service opt-in (marketing opt-in plus a Google review link for the review request)
  - they're sent through `sendWhatsapp()`, so the trial quota, the BAJA block, idempotency and opening hours all apply
  - if the shop is closed, the notice is retried 15 minutes later

**⚠️ Meta templates to create and approve:**
- `taller_recibido_v1` {shop, ticket no., device}
- `taller_presupuesto_v1` {shop, device, amount}
- `taller_listo_v1` {shop, device, ticket no.}
- `taller_resena_v1` (MARKETING) {shop, review link}

Schedule `ticketNotifySweep` every 5 min with header `X-Cron-Key: <CRON_KEY>`.

**TPV** (`shared/cash.ts`, `shared/tpvApi.ts`; port of `cashTotals.ts`, `openCashSession`, `cashMovement`, `closeCashSession`):
- **Opening:** one open session per register. The float defaults to the last «fondo para mañana».
- **Movements:** every payment, refund and cash in/out is an append-only CashMovement. Each is idempotent on `client_request_id` (double clicks, retries and a slow CashDro are recorded once), and a race keeps the oldest copy.
- **Z close:** the paper formula, verbatim:
  - esperado = fondo + ventas − tarjeta − (bizum + transferencia + señal + vale) + entradas − salidas
  - diferencia = real − esperado
  - fondo para mañana = real − retirado
  - withdrawn may not exceed counted; a CashDro negative withdrawal is accepted
  - the recharges total and balance are stored, as is the CashDro levels snapshot
  - the Z number is per register; only the opener or owner/admin may close; a closed session is never edited
  - anything recorded after the cierre's `cutoff_at` moves to tomorrow's session (auto-opened)
- **CashDro:** the browser talks to the shop's local «Puente CashDro» (`src/lib/cashdro.ts`, a verbatim port; its config stays in the browser). The payment dialog's outcome rules are in `src/lib/cashdroSettle.ts`: a sale counts only if inserted ≥ price and it wasn't cancelled; for a payout, the machine counters beat a zero `totalout`; when unclear, a human confirms. The phases that lock the dialog are listed there.

**Not ported (no screens or entities yet):**
- **Reparo:** the Reparo and TPV user interfaces, supplier part search, PartQuote multi-option quotes with suppliers and ETA, print templates, custom fields, HelloClient sync, public status page, reminders.
- **TPV:** product catalogue and stock, invoices/Verifactu, vouchers and deposits as documents, daily e-mail reports, PIN gates.
- **CashDro bridge:** the Windows program itself is not part of this repo.

**Removed:** the demo's «Acepto que me llamen» checkbox, the voice-callback scheduling and the `VoiceCall` entity (no AI voice follow-ups). `/privacidad` no longer mentions calls.
