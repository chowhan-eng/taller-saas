-- =============================================================================
-- Taller SaaS — 001_multi_tenant_core.sql
-- Multi-tenant core for Spanish repair shops (móviles, consolas, PC).
-- Target: Supabase Postgres 15+.
--
-- ISOLATION MODEL (read this before touching anything):
--   * Every business row carries tenant_id. RLS is ENABLED + FORCED on every table.
--   * Access is granted ONLY through membership in public.tenant_users, checked by
--     private.is_member() / private.has_role(): SECURITY DEFINER helpers in a schema
--     that PostgREST does NOT expose.
--   * Cross-tenant references are impossible by construction: child tables use
--     COMPOSITE foreign keys (tenant_id, parent_id) -> parent(tenant_id, id).
--   * tenant_id is immutable after insert (trigger).
--   * Money/cash/fiscal rows are APPEND-ONLY (no UPDATE/DELETE, even for the owner).
--     The only bypass is the service_role purge flag (SET LOCAL app.purge = 'on')
--     used by the contract-termination job after the shop has exported its data.
--   * Platform tables (leads, demo_requests, wa_events_inbox) have RLS on and NO
--     policies => only the service_role (Edge Functions) can touch them.
--
-- FISCAL BOUNDARY (Verifactu, RD 1007/2023):
--   * repair_tickets = "Resguardo de depósito / Orden de reparación" (RD 58/1988).
--     It is NOT an invoice and never carries fiscal numbering.
--   * Invoices (facturas / facturas simplificadas) are issued by a certified
--     Verifactu provider via API. We only store the provider's reference + QR +
--     hash in public.fiscal_documents (append-only). We never compute the chain.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type public.plan_code        as enum ('starter', 'pro');
create type public.tenant_status    as enum ('onboarding', 'active', 'past_due', 'suspended', 'cancelled');
create type public.member_role      as enum ('owner', 'admin', 'counter', 'technician');
create type public.sub_status       as enum ('trialing', 'active', 'past_due', 'unpaid', 'cancelled', 'incomplete');
create type public.wa_mode          as enum ('shared_number', 'own_number_coexistence', 'own_number_cloud');
create type public.device_type      as enum ('movil', 'tablet', 'portatil', 'sobremesa', 'consola', 'mando', 'smartwatch', 'otro');
create type public.ticket_status    as enum (
  'recibido', 'diagnostico', 'presupuesto_enviado', 'presupuesto_aceptado',
  'presupuesto_rechazado', 'esperando_pieza', 'en_reparacion', 'listo_recoger',
  'entregado', 'no_reparable', 'cancelado'
);
create type public.budget_status    as enum ('no_requerido', 'pendiente', 'enviado', 'aceptado', 'rechazado');
create type public.wa_direction     as enum ('outbound', 'inbound');
create type public.wa_category      as enum ('utility', 'marketing', 'authentication', 'service');
create type public.wa_msg_status    as enum ('queued', 'sent', 'delivered', 'read', 'failed', 'blocked_opt_out', 'blocked_hours', 'blocked_duplicate');
create type public.cash_mov_type    as enum ('apertura', 'venta_efectivo', 'venta_tarjeta', 'venta_bizum', 'senal_deposito', 'devolucion', 'entrada_manual', 'salida_manual', 'retirada_banco');
create type public.closing_status   as enum ('abierta', 'en_cierre', 'cerrada');
create type public.fiscal_doc_type  as enum ('factura_simplificada', 'factura_completa', 'rectificativa');

-- ----------------------------------------------------------------------------
-- Generic helpers
-- ----------------------------------------------------------------------------
create or replace function private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.forbid_tenant_change() returns trigger
language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.purge_mode() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.purge', true), '') = 'on'
     and current_user in ('service_role', 'postgres');
$$;

create or replace function private.forbid_mutation() returns trigger
language plpgsql as $$
begin
  if private.purge_mode() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% is append-only (% blocked)', tg_table_name, tg_op using errcode = '42501';
end $$;

-- Spanish phone normaliser: returns E.164 without '+', e.g. 34612345678
create or replace function private.normalize_es_phone(raw text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if raw is null then return null; end if;
  d := regexp_replace(raw, '\D', '', 'g');
  if d like '0034%' then d := substr(d, 3); end if;
  if length(d) = 9 then d := '34' || d; end if;
  return nullif(d, '');
end $$;

-- ----------------------------------------------------------------------------
-- TENANTS
-- ----------------------------------------------------------------------------
create table public.tenants (
  id                   uuid primary key default gen_random_uuid(),
  slug                 citext not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  trade_name           text   not null check (length(trade_name) between 2 and 120),   -- nombre comercial
  legal_name           text,                                                            -- razón social
  nif                  text   check (nif is null or nif ~ '^[A-Z0-9]{9}$'),             -- NIF/CIF sin guiones
  is_autonomo          boolean not null default true,     -- Verifactu deadline: 1 Jul 2027 (autónomo) vs 1 Jan 2027 (IS)
  address_line         text,
  postal_code          text check (postal_code is null or postal_code ~ '^[0-5][0-9]{4}$'),
  city                 text,
  province             text,
  phone                text,
  email                citext,
  logo_url             text,
  timezone             text not null default 'Europe/Madrid',
  printer_width_mm     smallint not null default 80 check (printer_width_mm in (58, 80)),
  ticket_footer        text default 'Garantía mínima de 3 meses en la reparación (art. 120 TRLGDCU / RD 58/1988). Conserve este resguardo para retirar su equipo.',
  default_warranty_days smallint not null default 90 check (default_warranty_days >= 90),
  opening_hours        jsonb not null default '{"mon":[["10:00","14:00"],["17:00","20:30"]],"tue":[["10:00","14:00"],["17:00","20:30"]],"wed":[["10:00","14:00"],["17:00","20:30"]],"thu":[["10:00","14:00"],["17:00","20:30"]],"fri":[["10:00","14:00"],["17:00","20:30"]],"sat":[["10:00","14:00"]],"sun":[]}',
  -- WhatsApp
  wa_mode              public.wa_mode not null default 'shared_number',
  wa_waba_id           text,
  wa_phone_number_id   text unique,
  wa_display_phone     text,
  wa_quality_rating    text,                    -- GREEN / YELLOW / RED mirrored from Meta webhooks
  wa_paused            boolean not null default false,  -- kill-switch per tenant
  wa_daily_cap         integer not null default 250,    -- hard per-tenant send cap (dispatcher enforces)
  google_review_url    text,
  review_delay_hours   smallint not null default 24 check (review_delay_hours between 2 and 168),
  -- Fiscal provider (Verifactu middleware)
  fiscal_provider      text,                    -- e.g. 'verifacti' | 'b2brouter' | null (no invoicing)
  fiscal_provider_ref  text,                    -- tenant id at the provider (API secret lives in Supabase Vault)
  -- Commercial / legal
  plan                 public.plan_code not null default 'starter',
  status               public.tenant_status not null default 'onboarding',
  onboarding_step      smallint not null default 0,
  dpa_accepted_at      timestamptz,             -- RGPD art. 28 contract acceptance (required before go-live)
  dpa_accepted_by      uuid,
  dpa_version          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_tenants_updated before update on public.tenants
  for each row execute function private.set_updated_at();

-- ----------------------------------------------------------------------------
-- TENANT USERS (membership = the only key to data)
-- ----------------------------------------------------------------------------
create table public.tenant_users (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         public.member_role not null default 'counter',
  display_name text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_users_user_idx on public.tenant_users(user_id);

-- ----------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER, not exposed through the API schema)
-- ----------------------------------------------------------------------------
create or replace function private.is_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_users tu
    where tu.tenant_id = t and tu.user_id = (select auth.uid()) and tu.active
  );
$$;

create or replace function private.has_role(t uuid, roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_users tu
    where tu.tenant_id = t and tu.user_id = (select auth.uid()) and tu.active
      and tu.role = any(roles)
  );
$$;

create or replace function private.tenant_is_operational(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenants where id = t and status in ('onboarding','active','past_due'));
$$;

revoke all on function private.is_member(uuid) from public;
revoke all on function private.has_role(uuid, public.member_role[]) from public;
revoke all on function private.tenant_is_operational(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, public.member_role[]) to authenticated;
grant execute on function private.tenant_is_operational(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- SUBSCRIPTIONS (written ONLY by the Stripe webhook Edge Function / service_role)
-- ----------------------------------------------------------------------------
create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null unique references public.tenants(id) on delete cascade,
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  plan                    public.plan_code not null,
  status                  public.sub_status not null default 'incomplete',
  vip_setup_paid          boolean not null default false,   -- €199 one-off
  cashdro_bridge          boolean not null default false,   -- hardware upsell add-on
  current_period_end      timestamptz,
  trial_end               timestamptz,
  cancel_at_period_end    boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger trg_subs_updated before update on public.subscriptions
  for each row execute function private.set_updated_at();

-- ----------------------------------------------------------------------------
-- CUSTOMERS (end-customers of the shop — personal data; shop = Responsable)
-- ----------------------------------------------------------------------------
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  full_name          text not null check (length(full_name) between 1 and 160),
  phone_e164         text check (phone_e164 is null or phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  email              citext,
  dni_last4          text check (dni_last4 is null or dni_last4 ~ '^[0-9A-Z]{4}$'), -- minimisation: never store full DNI
  -- consent ledger (RGPD art. 6/7 + Meta opt-in policy)
  wa_service_opt_in        boolean not null default false,   -- repair status notifications (utility)
  wa_service_opt_in_at     timestamptz,
  wa_marketing_opt_in      boolean not null default false,   -- review requests / promos (marketing)
  wa_marketing_opt_in_at   timestamptz,
  wa_opted_out             boolean not null default false,   -- BAJA/STOP => blocks every template
  wa_opted_out_at          timestamptz,
  consent_source           text,                             -- 'mostrador_firma' | 'web' | 'whatsapp'
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, phone_e164)
);
create index customers_tenant_name_idx on public.customers (tenant_id, lower(full_name));
create trigger trg_customers_updated before update on public.customers
  for each row execute function private.set_updated_at();
create trigger trg_customers_tenant before update on public.customers
  for each row execute function private.forbid_tenant_change();

create or replace function private.customers_normalize() returns trigger
language plpgsql as $$
begin
  new.phone_e164 := private.normalize_es_phone(new.phone_e164);
  if new.wa_service_opt_in and new.wa_service_opt_in_at is null then new.wa_service_opt_in_at := now(); end if;
  if new.wa_marketing_opt_in and new.wa_marketing_opt_in_at is null then new.wa_marketing_opt_in_at := now(); end if;
  if new.wa_opted_out and new.wa_opted_out_at is null then new.wa_opted_out_at := now(); end if;
  return new;
end $$;
create trigger trg_customers_normalize before insert or update on public.customers
  for each row execute function private.customers_normalize();

-- ----------------------------------------------------------------------------
-- PRICE LIST (global Spanish templates have tenant_id NULL; shops get a copy)
-- ----------------------------------------------------------------------------
create table public.price_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) on delete cascade,   -- NULL = global template
  category      public.device_type not null,
  brand         text not null,
  model         text,
  service       text not null,             -- 'Cambio pantalla', 'Conector HDMI', ...
  price_eur     numeric(10,2) not null check (price_eur >= 0),
  price_is_from boolean not null default true,   -- "desde X €"
  duration_min  integer,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index price_items_lookup_idx on public.price_items (tenant_id, category, brand, model);
create trigger trg_price_items_updated before update on public.price_items
  for each row execute function private.set_updated_at();
create trigger trg_price_items_tenant before update on public.price_items
  for each row execute function private.forbid_tenant_change();

-- ----------------------------------------------------------------------------
-- REPAIR TICKETS = Resguardo de depósito / Orden de reparación (NOT an invoice)
-- ----------------------------------------------------------------------------
create table public.ticket_counters (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,
  year       smallint not null,
  last_value integer  not null default 0
);

create table public.repair_tickets (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  ticket_number      text not null,                         -- e.g. 2026-000123 (per tenant, per year)
  customer_id        uuid not null,
  device_type        public.device_type not null,
  brand              text not null,
  model              text,
  serial_imei        text,
  unlock_code_enc    bytea,               -- encrypted server-side (pgp_sym_encrypt, key in Vault); never plaintext
  accessories        text,                -- 'cargador, funda, tarjeta SIM'
  physical_condition text,                -- 'pantalla rajada esquina sup. dcha.'
  reported_fault     text not null,
  diagnosis          text,
  budget_status      public.budget_status not null default 'pendiente',
  budget_amount_eur  numeric(10,2) check (budget_amount_eur is null or budget_amount_eur >= 0),
  budget_sent_at     timestamptz,
  budget_answered_at timestamptz,
  diagnosis_fee_eur  numeric(10,2) not null default 0 check (diagnosis_fee_eur >= 0),
  deposit_eur        numeric(10,2) not null default 0 check (deposit_eur >= 0),  -- señal
  status             public.ticket_status not null default 'recibido',
  priority           smallint not null default 0 check (priority between 0 and 2),
  technician_id      uuid,
  promised_at        timestamptz,
  ready_at           timestamptz,
  delivered_at       timestamptz,
  warranty_days      smallint not null default 90 check (warranty_days >= 90),
  warranty_until     date,
  warranty_parent_id uuid,                 -- warranty return -> original ticket
  customer_signature_url text,             -- signed resguardo (counter tablet)
  notify_whatsapp    boolean not null default true,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, ticket_number),
  foreign key (tenant_id, customer_id)        references public.customers(tenant_id, id),
  foreign key (tenant_id, warranty_parent_id) references public.repair_tickets(tenant_id, id),
  foreign key (tenant_id, technician_id)      references public.tenant_users(tenant_id, user_id)
);
-- Infinite-scroll dashboard: keyset pagination on (tenant_id, created_at desc, id desc)
create index repair_tickets_feed_idx   on public.repair_tickets (tenant_id, created_at desc, id desc);
create index repair_tickets_open_idx   on public.repair_tickets (tenant_id, status)
  where status not in ('entregado','cancelado','no_reparable');
create index repair_tickets_tech_idx   on public.repair_tickets (tenant_id, technician_id, status);
create index repair_tickets_serial_idx on public.repair_tickets (tenant_id, serial_imei);
create index repair_tickets_cust_idx   on public.repair_tickets (tenant_id, customer_id);

create or replace function private.assign_ticket_number() returns trigger
language plpgsql security definer set search_path = '' as $$
declare y smallint := extract(year from (now() at time zone 'Europe/Madrid'));
        v integer;
begin
  insert into public.ticket_counters as c (tenant_id, year, last_value)
  values (new.tenant_id, y, 1)
  on conflict (tenant_id) do update
    set last_value = case when c.year = y then c.last_value + 1 else 1 end,
        year = y
  returning last_value into v;
  new.ticket_number := y::text || '-' || lpad(v::text, 6, '0');
  return new;
end $$;
create trigger trg_ticket_number before insert on public.repair_tickets
  for each row when (new.ticket_number is null)
  execute function private.assign_ticket_number();

create or replace function private.ticket_lifecycle() returns trigger
language plpgsql as $$
begin
  if new.status = 'listo_recoger' and new.ready_at is null then new.ready_at := now(); end if;
  if new.status = 'entregado' and new.delivered_at is null then
    new.delivered_at := now();
    new.warranty_until := (now() at time zone 'Europe/Madrid')::date + new.warranty_days;
  end if;
  if new.budget_status = 'enviado' and new.budget_sent_at is null then new.budget_sent_at := now(); end if;
  if new.budget_status in ('aceptado','rechazado') and new.budget_answered_at is null then
    new.budget_answered_at := now();
  end if;
  return new;
end $$;
create trigger trg_ticket_lifecycle before insert or update on public.repair_tickets
  for each row execute function private.ticket_lifecycle();
create trigger trg_tickets_updated before update on public.repair_tickets
  for each row execute function private.set_updated_at();
create trigger trg_tickets_tenant before update on public.repair_tickets
  for each row execute function private.forbid_tenant_change();

-- Status history (append-only) — drives technician KPIs and audit
create table public.ticket_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  ticket_id   uuid not null,
  from_status public.ticket_status,
  to_status   public.ticket_status not null,
  actor_id    uuid,
  note        text,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, ticket_id) references public.repair_tickets(tenant_id, id) on delete cascade
);
create index ticket_events_ticket_idx on public.ticket_events (tenant_id, ticket_id, created_at);
create trigger trg_ticket_events_ro before update on public.ticket_events
  for each row execute function private.forbid_mutation();
-- (DELETE allowed only via cascade when the owner deletes the parent ticket — RGPD erasure.)

create or replace function private.log_ticket_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.ticket_events (tenant_id, ticket_id, from_status, to_status, actor_id)
    values (new.tenant_id, new.id,
            case when tg_op = 'UPDATE' then old.status end,
            new.status, (select auth.uid()));
  end if;
  return new;
end $$;
create trigger trg_ticket_status_log after insert or update of status on public.repair_tickets
  for each row execute function private.log_ticket_status();

-- ----------------------------------------------------------------------------
-- WHATSAPP OUTBOX + LOGS
--   The browser NEVER calls Meta. Status changes insert a row into whatsapp_logs
--   (status='queued') with a deterministic idempotency_key; the dispatcher Edge
--   Function sends it, then Meta webhooks update the status.
--   UNIQUE (tenant_id, idempotency_key) makes a "6x duplicate send" impossible.
-- ----------------------------------------------------------------------------
create table public.whatsapp_logs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  customer_id      uuid,
  ticket_id        uuid,
  direction        public.wa_direction not null,
  category         public.wa_category not null default 'utility',
  template_name    text,
  template_lang    text default 'es',
  body_preview     text,                          -- truncated, for the inbox UI
  to_phone         text,
  from_phone       text,
  idempotency_key  text,                          -- e.g. ticket:<uuid>:status:listo_recoger
  wa_message_id    text unique,
  status           public.wa_msg_status not null default 'queued',
  error_code       integer,
  error_title      text,
  attempts         smallint not null default 0,
  send_after       timestamptz not null default now(),  -- business hours / review delay
  cost_eur         numeric(8,4),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete set null (customer_id),
  foreign key (tenant_id, ticket_id)   references public.repair_tickets(tenant_id, id) on delete set null (ticket_id)
);
create index whatsapp_logs_dispatch_idx on public.whatsapp_logs (send_after) where status = 'queued';
create index whatsapp_logs_tenant_idx   on public.whatsapp_logs (tenant_id, created_at desc);
create trigger trg_wa_updated before update on public.whatsapp_logs
  for each row execute function private.set_updated_at();
create trigger trg_wa_tenant before update on public.whatsapp_logs
  for each row execute function private.forbid_tenant_change();

-- Enqueue notification on status change (recibido / presupuesto / listo / entregado->reseña)
create or replace function private.enqueue_ticket_whatsapp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c     public.customers%rowtype;
  t     public.tenants%rowtype;
  tpl   text;
  cat   public.wa_category := 'utility';
  delay interval := interval '0';
begin
  if not new.notify_whatsapp then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;

  tpl := case new.status
           when 'recibido'            then 'taller_recibido_v1'
           when 'presupuesto_enviado' then 'taller_presupuesto_v1'
           when 'listo_recoger'       then 'taller_listo_v1'
           when 'entregado'           then 'taller_resena_v1'
           else null end;
  if tpl is null then return new; end if;

  select * into c from public.customers where id = new.customer_id and tenant_id = new.tenant_id;
  select * into t from public.tenants   where id = new.tenant_id;
  if c.phone_e164 is null or c.wa_opted_out or t.wa_paused then return new; end if;

  if new.status = 'entregado' then
    if not c.wa_marketing_opt_in or t.google_review_url is null then return new; end if;
    cat   := 'marketing';
    delay := make_interval(hours => t.review_delay_hours);
  elsif not c.wa_service_opt_in then
    return new;
  end if;

  insert into public.whatsapp_logs (tenant_id, customer_id, ticket_id, direction, category,
                                    template_name, to_phone, idempotency_key, send_after)
  values (new.tenant_id, new.customer_id, new.id, 'outbound', cat,
          tpl, c.phone_e164, 'ticket:' || new.id || ':status:' || new.status, now() + delay)
  on conflict (tenant_id, idempotency_key) do nothing;
  return new;
end $$;
create trigger trg_ticket_enqueue_wa after insert or update of status on public.repair_tickets
  for each row execute function private.enqueue_ticket_whatsapp();

-- ----------------------------------------------------------------------------
-- TPV / CASH CONTROL (append-only ledger + daily closing)
-- ----------------------------------------------------------------------------
create table public.cash_closings (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  business_date           date not null,
  register_code           text not null default 'CAJA1',
  status                  public.closing_status not null default 'abierta',
  opening_float_eur       numeric(10,2) not null default 0,
  expected_cash_eur       numeric(10,2),        -- computed at close via public.cash_expected()
  counted_cash_eur        numeric(10,2),        -- physically counted
  difference_eur          numeric(10,2) generated always as (counted_cash_eur - expected_cash_eur) stored,
  card_total_eur          numeric(10,2),
  card_terminal_total_eur numeric(10,2),        -- Z report from the datáfono (manual entry or bridge)
  bizum_total_eur         numeric(10,2),
  denominations           jsonb,                -- {"50":2,"20":5,"10":3,"2":4,"1":7,"0.50":3,...}
  checklist               jsonb not null default '[]', -- 10-step cierre checklist results
  difference_reason       text,
  cashdro_report          jsonb,                -- raw payload from CashDroPuente (if contracted)
  opened_by               uuid references auth.users(id),
  closed_by               uuid references auth.users(id),
  opened_at               timestamptz not null default now(),
  closed_at               timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, business_date, register_code)
);
create trigger trg_closings_tenant before update on public.cash_closings
  for each row execute function private.forbid_tenant_change();

-- Once closed, a closing is frozen forever.
create or replace function private.freeze_closed_closing() returns trigger
language plpgsql as $$
begin
  if private.purge_mode() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'cash_closings cannot be deleted' using errcode = '42501';
  end if;
  if old.status = 'cerrada' then
    raise exception 'cash closing % is closed and immutable', old.id using errcode = '42501';
  end if;
  if new.status = 'cerrada' then
    new.closed_at := coalesce(new.closed_at, now());
    new.closed_by := coalesce(new.closed_by, (select auth.uid()));
    if new.counted_cash_eur is null or new.expected_cash_eur is null then
      raise exception 'expected_cash_eur and counted_cash_eur are required to close' using errcode = '23514';
    end if;
    if abs(new.counted_cash_eur - new.expected_cash_eur) > 0.009
       and coalesce(length(trim(new.difference_reason)), 0) < 5 then
      raise exception 'a non-zero difference requires difference_reason' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_closings_freeze before update or delete on public.cash_closings
  for each row execute function private.freeze_closed_closing();

-- Fiscal documents: references to invoices issued by the certified Verifactu provider
create table public.fiscal_documents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  doc_type         public.fiscal_doc_type not null,
  provider         text not null,
  provider_doc_id  text not null,
  series           text not null,
  number           text not null,
  issued_at        timestamptz not null,
  total_eur        numeric(10,2) not null,
  vat_eur          numeric(10,2) not null,
  verifactu_hash   text,
  qr_url           text,
  pdf_url          text,
  aeat_status      text,                   -- 'aceptado' | 'aceptado_con_errores' | 'rechazado' | 'pendiente'
  ticket_id        uuid,
  rectifies_id     uuid,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, series, number),
  unique (provider, provider_doc_id),
  foreign key (tenant_id, ticket_id)    references public.repair_tickets(tenant_id, id),
  foreign key (tenant_id, rectifies_id) references public.fiscal_documents(tenant_id, id)
);
-- Only aeat_status may change (provider callback via service_role); everything else frozen.
create or replace function private.fiscal_docs_guard() returns trigger
language plpgsql as $$
begin
  if private.purge_mode() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'fiscal_documents cannot be deleted' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'aeat_status') is distinct from (to_jsonb(old) - 'aeat_status') then
    raise exception 'fiscal_documents are immutable (only aeat_status can change)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_fiscal_docs_guard before update or delete on public.fiscal_documents
  for each row execute function private.fiscal_docs_guard();

create table public.cash_movements (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  closing_id         uuid not null,
  movement_type      public.cash_mov_type not null,
  amount_eur         numeric(10,2) not null,   -- positive = in, negative = out
  ticket_id          uuid,
  fiscal_document_id uuid,                     -- invoice issued by the Verifactu provider (if any)
  concept            text,
  actor_id           uuid references auth.users(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  foreign key (tenant_id, closing_id)         references public.cash_closings(tenant_id, id),
  foreign key (tenant_id, ticket_id)          references public.repair_tickets(tenant_id, id),
  foreign key (tenant_id, fiscal_document_id) references public.fiscal_documents(tenant_id, id)
);
create index cash_movements_closing_idx on public.cash_movements (tenant_id, closing_id);
create trigger trg_cash_movements_ro before update or delete on public.cash_movements
  for each row execute function private.forbid_mutation();

-- Corrections are NEW opposite movements, never edits. No inserts into closed days.
create or replace function private.cash_movement_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.cash_closings
             where id = new.closing_id and tenant_id = new.tenant_id and status = 'cerrada') then
    raise exception 'cannot add movements to a closed cash session' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_cash_movement_guard before insert on public.cash_movements
  for each row execute function private.cash_movement_guard();

-- ----------------------------------------------------------------------------
-- PLATFORM-ONLY TABLES (RLS on, no policies => service_role only)
-- ----------------------------------------------------------------------------
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,          -- 'web_simulator' | 'places_api' | 'referral' | 'inbound_call'
  shop_name        text,
  contact_name     text,
  phone_e164       text unique,
  phone_kind       text check (phone_kind in ('mobile','landline','other')),
  email            citext,
  province         text,
  city             text,
  google_place_id  text unique,
  google_rating    numeric(2,1),
  google_reviews   integer,
  website          text,
  pain_score       smallint check (pain_score between 0 and 100),
  stage            text not null default 'new',  -- new|demo_sent|hot|called|trial|won|lost|do_not_contact
  consent_whatsapp_demo   boolean not null default false,
  consent_commercial_call boolean not null default false,   -- LGT 11/2022 art. 66 — explicit, unticked by default
  consent_text_version    text,
  consent_at              timestamptz,
  consent_ip              inet,
  robinson_checked_at     timestamptz,
  do_not_contact          boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_leads_updated before update on public.leads
  for each row execute function private.set_updated_at();

create table public.demo_requests (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references public.leads(id) on delete cascade,
  phone_e164    text not null,
  ip            inet,
  user_agent    text,
  turnstile_ok  boolean not null default false,
  wa_message_id text,
  status        text not null default 'queued',
  created_at    timestamptz not null default now()
);
create index demo_requests_phone_idx on public.demo_requests (phone_e164, created_at desc);
create index demo_requests_ip_idx    on public.demo_requests (ip, created_at desc);

create table public.wa_events_inbox (           -- raw Meta webhook payloads (dedupe + replay)
  id              bigint generated always as identity primary key,
  event_id        text unique,
  phone_number_id text,
  payload         jsonb not null,
  processed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ONBOARDING RPCs
-- ----------------------------------------------------------------------------
create or replace function public.create_tenant(p_trade_name text, p_slug text, p_nif text default null,
                                                p_printer_width smallint default 80)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'auth required' using errcode = '42501';
  end if;
  if (select count(*) from public.tenant_users
      where user_id = (select auth.uid()) and role = 'owner') >= 3 then
    raise exception 'tenant limit reached' using errcode = '54000';
  end if;

  insert into public.tenants (trade_name, slug, nif, printer_width_mm)
  values (p_trade_name, lower(p_slug),
          nullif(upper(regexp_replace(coalesce(p_nif, ''), '[^A-Za-z0-9]', '', 'g')), ''),
          p_printer_width)
  returning id into new_id;

  insert into public.tenant_users (tenant_id, user_id, role) values (new_id, (select auth.uid()), 'owner');
  insert into public.subscriptions (tenant_id, plan, status) values (new_id, 'starter', 'incomplete');

  -- seed the shop's own editable price list from the global Spanish templates
  insert into public.price_items (tenant_id, category, brand, model, service, price_eur, price_is_from, duration_min)
  select new_id, category, brand, model, service, price_eur, price_is_from, duration_min
  from public.price_items where tenant_id is null and active;

  return new_id;
end $$;
revoke all on function public.create_tenant(text, text, text, smallint) from public, anon;
grant execute on function public.create_tenant(text, text, text, smallint) to authenticated;

-- RGPD art. 28: the owner accepts the Encargo del Tratamiento (DPA) in the wizard
create or replace function public.accept_dpa(p_tenant uuid, p_version text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role(p_tenant, array['owner']::public.member_role[]) then
    raise exception 'only the owner can accept the DPA' using errcode = '42501';
  end if;
  update public.tenants
     set dpa_accepted_at = now(), dpa_accepted_by = (select auth.uid()), dpa_version = p_version
   where id = p_tenant;
end $$;
revoke all on function public.accept_dpa(uuid, text) from public, anon;
grant execute on function public.accept_dpa(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tenants','tenant_users','subscriptions','customers','price_items',
                           'ticket_counters','repair_tickets','ticket_events','whatsapp_logs',
                           'cash_closings','cash_movements','fiscal_documents',
                           'leads','demo_requests','wa_events_inbox']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- tenants: members read; owner/admin update SAFE columns only; insert only via create_tenant()
create policy tenants_select on public.tenants for select to authenticated
  using (private.is_member(id));
create policy tenants_update on public.tenants for update to authenticated
  using (private.has_role(id, array['owner','admin']::public.member_role[]))
  with check (private.has_role(id, array['owner','admin']::public.member_role[]));
revoke insert, update, delete on public.tenants from authenticated;
grant update (trade_name, legal_name, nif, is_autonomo, address_line, postal_code, city, province,
              phone, email, logo_url, timezone, printer_width_mm, ticket_footer, default_warranty_days,
              opening_hours, wa_paused, google_review_url, review_delay_hours, onboarding_step)
  on public.tenants to authenticated;

-- tenant_users: members see colleagues; only the owner manages staff
create policy tu_select on public.tenant_users for select to authenticated
  using (private.is_member(tenant_id));
create policy tu_insert on public.tenant_users for insert to authenticated
  with check (private.has_role(tenant_id, array['owner']::public.member_role[]) and role <> 'owner');
create policy tu_update on public.tenant_users for update to authenticated
  using (private.has_role(tenant_id, array['owner']::public.member_role[]) and user_id <> (select auth.uid()))
  with check (private.has_role(tenant_id, array['owner']::public.member_role[]) and role <> 'owner');
create policy tu_delete on public.tenant_users for delete to authenticated
  using (private.has_role(tenant_id, array['owner']::public.member_role[]) and user_id <> (select auth.uid()));

-- subscriptions: owner/admin read-only (Stripe webhook writes with service_role)
create policy subs_select on public.subscriptions for select to authenticated
  using (private.has_role(tenant_id, array['owner','admin']::public.member_role[]));
revoke insert, update, delete on public.subscriptions from authenticated;

-- customers
create policy customers_select on public.customers for select to authenticated
  using (private.is_member(tenant_id));
create policy customers_insert on public.customers for insert to authenticated
  with check (private.is_member(tenant_id) and private.tenant_is_operational(tenant_id));
create policy customers_update on public.customers for update to authenticated
  using (private.is_member(tenant_id)) with check (private.is_member(tenant_id));
create policy customers_delete on public.customers for delete to authenticated   -- RGPD art. 17
  using (private.has_role(tenant_id, array['owner','admin']::public.member_role[]));

-- price_items: global templates readable by any logged-in user; tenant rows by members
create policy price_select on public.price_items for select to authenticated
  using (tenant_id is null or private.is_member(tenant_id));
create policy price_insert on public.price_items for insert to authenticated
  with check (tenant_id is not null and private.has_role(tenant_id, array['owner','admin']::public.member_role[]));
create policy price_update on public.price_items for update to authenticated
  using (tenant_id is not null and private.has_role(tenant_id, array['owner','admin']::public.member_role[]))
  with check (tenant_id is not null and private.has_role(tenant_id, array['owner','admin']::public.member_role[]));
create policy price_delete on public.price_items for delete to authenticated
  using (tenant_id is not null and private.has_role(tenant_id, array['owner','admin']::public.member_role[]));

-- ticket_counters: no client policies (SECURITY DEFINER trigger only)
revoke all on public.ticket_counters from authenticated;

-- repair_tickets
create policy tickets_select on public.repair_tickets for select to authenticated
  using (private.is_member(tenant_id));
create policy tickets_insert on public.repair_tickets for insert to authenticated
  with check (private.is_member(tenant_id) and private.tenant_is_operational(tenant_id));
create policy tickets_update on public.repair_tickets for update to authenticated
  using (private.is_member(tenant_id)) with check (private.is_member(tenant_id));
create policy tickets_delete on public.repair_tickets for delete to authenticated
  using (private.has_role(tenant_id, array['owner']::public.member_role[]));

-- ticket_events: read-only for members (written by trigger)
create policy tevents_select on public.ticket_events for select to authenticated
  using (private.is_member(tenant_id));
revoke insert, update, delete on public.ticket_events from authenticated;

-- whatsapp_logs: members read; writes only by triggers / service_role
create policy wa_select on public.whatsapp_logs for select to authenticated
  using (private.is_member(tenant_id));
revoke insert, update, delete on public.whatsapp_logs from authenticated;

-- cash: counter staff can open/close and add movements; technicians never see cash
create policy closings_select on public.cash_closings for select to authenticated
  using (private.has_role(tenant_id, array['owner','admin','counter']::public.member_role[]));
create policy closings_insert on public.cash_closings for insert to authenticated
  with check (private.has_role(tenant_id, array['owner','admin','counter']::public.member_role[]));
create policy closings_update on public.cash_closings for update to authenticated
  using (private.has_role(tenant_id, array['owner','admin','counter']::public.member_role[]))
  with check (private.has_role(tenant_id, array['owner','admin','counter']::public.member_role[]));

create policy movements_select on public.cash_movements for select to authenticated
  using (private.has_role(tenant_id, array['owner','admin','counter']::public.member_role[]));
create policy movements_insert on public.cash_movements for insert to authenticated
  with check (private.has_role(tenant_id, array['owner','admin','counter']::public.member_role[]));

-- fiscal docs: read for owner/admin/counter; writes only by the fiscal Edge Function (service_role)
create policy fiscal_select on public.fiscal_documents for select to authenticated
  using (private.has_role(tenant_id, array['owner','admin','counter']::public.member_role[]));
revoke insert, update, delete on public.fiscal_documents from authenticated;

-- leads / demo_requests / wa_events_inbox: RLS on, zero policies => service_role only.
revoke all on public.leads, public.demo_requests, public.wa_events_inbox from authenticated;

-- ----------------------------------------------------------------------------
-- Expected cash for the cierre wizard (SECURITY INVOKER => RLS still applies)
-- ----------------------------------------------------------------------------
create or replace function public.cash_expected(p_closing uuid)
returns table (cash_eur numeric, card_eur numeric, bizum_eur numeric, movements integer)
language sql stable security invoker set search_path = '' as $$
  select
    c.opening_float_eur + coalesce(sum(m.amount_eur) filter (where m.movement_type in
      ('venta_efectivo','senal_deposito','devolucion','entrada_manual','salida_manual','retirada_banco')), 0),
    coalesce(sum(m.amount_eur) filter (where m.movement_type = 'venta_tarjeta'), 0),
    coalesce(sum(m.amount_eur) filter (where m.movement_type = 'venta_bizum'), 0),
    count(m.id)::integer
  from public.cash_closings c
  left join public.cash_movements m on m.closing_id = c.id and m.tenant_id = c.tenant_id
  where c.id = p_closing
  group by c.opening_float_eur;
$$;
grant execute on function public.cash_expected(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Realtime: dashboards subscribe to their own tickets (Realtime honours RLS)
-- ----------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.repair_tickets, public.whatsapp_logs;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Global Spanish price templates (tenant_id NULL). Indicative street prices,
-- always shown as "desde". Each shop edits its own copy in the wizard.
-- ----------------------------------------------------------------------------
insert into public.price_items (tenant_id, category, brand, model, service, price_eur, price_is_from, duration_min) values
  (null,'movil','Apple','iPhone 11','Cambio pantalla',69,true,45),
  (null,'movil','Apple','iPhone 12 / 12 Pro','Cambio pantalla',89,true,45),
  (null,'movil','Apple','iPhone 13','Cambio pantalla',109,true,45),
  (null,'movil','Apple','iPhone 14','Cambio pantalla',129,true,45),
  (null,'movil','Apple','iPhone 15','Cambio pantalla',169,true,60),
  (null,'movil','Apple','iPhone (todos)','Cambio batería',49,true,30),
  (null,'movil','Apple','iPhone (todos)','Conector de carga',49,true,45),
  (null,'movil','Samsung','Galaxy A (serie A)','Cambio pantalla',69,true,60),
  (null,'movil','Samsung','Galaxy S22 / S23','Cambio pantalla',169,true,90),
  (null,'movil','Samsung','Galaxy S24','Cambio pantalla',199,true,90),
  (null,'movil','Xiaomi','Redmi Note','Cambio pantalla',59,true,60),
  (null,'movil','Genérico','Cualquiera','Diagnóstico',0,false,15),
  (null,'consola','Sony','PS5','Reparación conector HDMI',99,true,120),
  (null,'consola','Sony','PS5','Limpieza + pasta térmica / metal líquido',59,true,90),
  (null,'consola','Sony','PS4','Reparación conector HDMI',79,true,120),
  (null,'mando','Sony','DualSense','Reparación drift joystick',35,true,45),
  (null,'consola','Nintendo','Switch','Microsoldadura chip de carga (M92T36 / BQ24193)',89,true,180),
  (null,'consola','Nintendo','Switch','Cambio pantalla',79,true,90),
  (null,'mando','Nintendo','Joy-Con','Reparación drift',25,true,30),
  (null,'portatil','Genérico','Cualquiera','Formateo + Windows + copia de datos',49,true,120),
  (null,'portatil','Genérico','Cualquiera','Cambio a SSD + clonado',39,true,90),
  (null,'portatil','Genérico','Cualquiera','Reparación bisagras',59,true,120),
  (null,'sobremesa','Genérico','Cualquiera','Limpieza + optimización',35,true,60),
  (null,'tablet','Apple','iPad','Cambio cristal táctil',79,true,120);

-- =============================================================================
-- RLS SMOKE TEST (run in the SQL editor inside a transaction, then ROLLBACK):
--   begin;
--   select set_config('request.jwt.claims', '{"sub":"<USER_B_UUID>","role":"authenticated"}', true);
--   set local role authenticated;
--   select count(*) from public.repair_tickets where tenant_id = '<TENANT_A_UUID>';  -- expect 0
--   insert into public.customers (tenant_id, full_name) values ('<TENANT_A_UUID>','x'); -- expect RLS error
--   rollback;
-- Automated pgTAP version: see docs/02 §2.7 (supabase/tests/rls_isolation.test.sql).
-- =============================================================================
