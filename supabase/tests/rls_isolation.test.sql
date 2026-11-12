-- pgTAP: tenant isolation tests for 001_multi_tenant_core.sql
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Fixtures (as superuser, bypassing RLS)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into public.tenants (id, slug, trade_name) values
  ('10000000-0000-0000-0000-00000000000a', 'taller-a', 'Taller A'),
  ('10000000-0000-0000-0000-00000000000b', 'taller-b', 'Taller B');
insert into public.tenant_users (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'owner');
insert into public.customers (id, tenant_id, full_name, phone_e164) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Cliente A', '612345678');
insert into public.repair_tickets (tenant_id, customer_id, device_type, brand, reported_fault, notify_whatsapp) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'movil', 'Apple', 'Pantalla', false);

-- Act as user B (owner of Taller B)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*) from public.tenants where id = '10000000-0000-0000-0000-00000000000a')::int, 0,
          'B cannot see tenant A');
select is((select count(*) from public.customers)::int, 0, 'B sees no customers of A');
select is((select count(*) from public.repair_tickets)::int, 0, 'B sees no tickets of A');
select throws_ok($$ insert into public.customers (tenant_id, full_name)
                    values ('10000000-0000-0000-0000-00000000000a', 'x') $$,
                 '42501', null, 'B cannot insert a customer into A');
select lives_ok($$ update public.repair_tickets set status = 'entregado'
                   where tenant_id = '10000000-0000-0000-0000-00000000000a' $$,
                'update aimed at A runs but matches 0 rows');
select throws_ok($$ insert into public.tenant_users (tenant_id, user_id, role)
                    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'admin') $$,
                 '42501', null, 'B cannot add itself to A');
select throws_ok($$ update public.tenants set plan = 'pro' where id = '10000000-0000-0000-0000-00000000000b' $$,
                 '42501', null, 'B cannot self-upgrade its plan');
select throws_ok($$ select count(*) from public.leads $$,
                 '42501', null, 'platform leads table is not readable by tenants');
reset role;

select is((select status::text from public.repair_tickets limit 1), 'recibido',
          'ticket of A untouched by B');

select * from finish();
rollback;
