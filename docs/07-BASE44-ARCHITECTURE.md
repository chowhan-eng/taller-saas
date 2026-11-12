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
| `whatsapp` / `reparo` / `tpv` | member + plan | new: gated module routers (scaffold) |
| `seedPriceTemplates` | app admin | seed `INSERT` of 24 prices |

**Plan gating (`shared/modules.ts`, single source of truth):** Starter = `whatsapp`; Pro = `whatsapp`, `reparo`, `tpv`. Every module call runs `gateModule()` in this order:
1. The user is signed in.
2. The user has an active membership in the tenant.
3. The tenant status is onboarding, active or past_due (same as the old `tenant_active()`).
4. The plan includes the module (otherwise **402**).
5. The user's role is allowed.

> ⚠️ **Copy conflict to decide:** the landing page and step 3 still say Starter includes "Resguardos + etiquetas". Under the gating rule above, resguardos and etiquetas belong to the Reparo module, which is Pro-only. Either move resguardos into the `whatsapp` module's entitlement, or change the Starter copy. I changed neither.

## 3. Billing: 14-day trial

- **Trial terms:** Starter only, at most once per tenant (`Subscription.trial_used`).
- **Card upfront:** `payment_method_collection: 'always'`. If the card is missing when the trial ends, the subscription is cancelled (`missing_payment_method: 'cancel'`).
- **Status mapping:** `trialing` maps the tenant to `active`.
- **Trial cap (`shared/waQuota.ts`):** at most **50 outbound WhatsApp messages** while the subscription is `trialing`. `blocked_*` attempts don't count. The daily cap `wa_daily_cap` (default 250) and the `wa_paused` kill-switch apply on every plan.
- **⚠️ Who must call the cap:** the WhatsApp send path is not ported yet. When it is, it **must** call `checkWhatsappQuota()` before every send. Today only the `whatsapp` → `quota` action calls it.
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
