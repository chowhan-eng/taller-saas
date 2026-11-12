-- =============================================================================
-- Taller SaaS — 002_sales_engine.sql
-- Voice callbacks + outreach touches for the sales engine (docs/04).
-- All tables are platform-only (RLS on, no policies => service_role only).
-- =============================================================================

create table public.voice_calls (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid references public.leads(id) on delete cascade,
  direction        text not null check (direction in ('inbound', 'callback')),
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'dialing', 'completed', 'no_answer', 'failed', 'cancelled')),
  scheduled_for    timestamptz,
  attempts         smallint not null default 0,
  provider         text not null default 'retell',
  provider_call_id text unique,
  from_phone       text,
  to_phone         text,
  outcome          text,     -- quiere_comprar | link_enviado | demo_agendada | pide_humano | no_interesa | no_es_taller | do_not_call | buzon
  duration_sec     integer,
  cost_eur         numeric(8,4),
  summary          text,     -- short summary only; full transcript stays at provider (30-day retention)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index voice_calls_due_idx on public.voice_calls (scheduled_for) where status = 'scheduled';
create trigger trg_voice_calls_updated before update on public.voice_calls
  for each row execute function private.set_updated_at();

create table public.outreach_touches (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  channel     text not null check (channel in ('visita', 'carta', 'llamada_humana', 'whatsapp_optin', 'email_optin', 'evento', 'referido')),
  step        text,          -- e.g. 'D0', 'D2', 'folleto-v1'
  result      text,          -- 'sin_respuesta' | 'interesado' | 'demo' | 'no' | 'baja'
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index outreach_touches_lead_idx on public.outreach_touches (lead_id, created_at desc);

alter table public.voice_calls      enable row level security;
alter table public.voice_calls      force row level security;
alter table public.outreach_touches enable row level security;
alter table public.outreach_touches force row level security;
revoke all on public.voice_calls, public.outreach_touches from anon, authenticated;

-- Next allowed call slot (Europe/Madrid): Mon–Fri 09:00–20:55, Sat 10:00–13:55, never Sunday.
create or replace function private.next_call_slot(p_ts timestamptz) returns timestamptz
language plpgsql stable as $$
declare
  loc timestamp := p_ts at time zone 'Europe/Madrid';
  d   date;
  t   time;
  dow int;
begin
  for i in 1..8 loop
    d := loc::date; t := loc::time; dow := extract(isodow from loc);
    if dow between 1 and 5 then
      if t < '09:00' then return (d + time '09:00') at time zone 'Europe/Madrid'; end if;
      if t <= '20:55' then return loc at time zone 'Europe/Madrid'; end if;
    elsif dow = 6 then
      if t < '10:00' then return (d + time '10:00') at time zone 'Europe/Madrid'; end if;
      if t <= '13:55' then return loc at time zone 'Europe/Madrid'; end if;
    end if;
    loc := (d + 1) + time '00:00';   -- move to start of next day and re-evaluate
  end loop;
  return null;
end $$;

-- Schedule a consented callback. Refuses unless the lead gave explicit call consent.
create or replace function public.schedule_voice_callback(p_lead uuid, p_delay_minutes integer default 5)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l   public.leads%rowtype;
  id_ uuid;
begin
  select * into l from public.leads where id = p_lead;
  if not found then raise exception 'lead not found'; end if;
  if not l.consent_commercial_call or l.do_not_contact then
    raise exception 'no call consent for lead %', p_lead using errcode = '42501';
  end if;
  if exists (select 1 from public.voice_calls
             where lead_id = p_lead and status in ('scheduled', 'dialing')) then
    return null;  -- idempotent: one pending callback per lead
  end if;

  insert into public.voice_calls (lead_id, direction, scheduled_for, to_phone)
  values (p_lead, 'callback',
          private.next_call_slot(now() + make_interval(mins => greatest(p_delay_minutes, 1))),
          l.phone_e164)
  returning id into id_;
  return id_;
end $$;
revoke all on function public.schedule_voice_callback(uuid, integer) from public, anon, authenticated;
grant execute on function public.schedule_voice_callback(uuid, integer) to service_role;
