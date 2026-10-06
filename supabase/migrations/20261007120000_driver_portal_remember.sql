-- Driver page: "Keep me signed in on this phone" for 30 days (owner's request, 2026-10-07).
--
-- A driver who ticks the box signs in with their NRIC as before (same 10-tries-a-minute limit) and also gets a random
-- token, kept in their phone's browser. Reopening the page sends the token instead of the NRIC. Only a SHA-256 hash of
-- the token is stored, so the table alone cannot open anyone's page. A token lasts 30 days from sign-in (reopening does
-- not extend it); signing out deletes it; removing the driver removes their tokens.
--
-- driver_portal_login keeps its name, arguments and result; its record is now built by one shared function so the
-- remembered and normal sign-ins always return the same thing. Safe to run again.

begin;

create table if not exists finance_private.driver_portal_sessions (
  token_hash bytea primary key,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists driver_portal_sessions_expiry on finance_private.driver_portal_sessions (expires_at);
alter table finance_private.driver_portal_sessions enable row level security;
revoke all on finance_private.driver_portal_sessions from public, anon, authenticated;

-- The driver's own record: contract fields, payments and the payment instructions; never NRIC, contact details or tags.
create or replace function finance_private.driver_portal_record(p_driver uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'driver', jsonb_build_object(
      'id', d.id, 'name', d.name, 'car_plate', d.car_plate,
      'contract_start_date', d.contract_start_date, 'contract_end_date', d.contract_end_date,
      'category', d.category, 'rental_cycle', d.rental_cycle,
      'contract_duration_weeks', d.contract_duration_weeks, 'rental_rate', d.rental_rate,
      'is_delisted', d.is_delisted, 'delist_date', d.delist_date),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'date', p.date, 'amount', p.amount,
        'service_claim', p.service_claim, 'payment_method', p.payment_method) order by p.date desc, p.id)
      from public.payments p where p.driver_id = d.id), '[]'::jsonb),
    'payment_instructions', finance_private.portal_payment_instructions())
  from public.drivers d where d.id = p_driver
$$;
revoke all on function finance_private.driver_portal_record(uuid) from public, anon, authenticated;

-- Same as the 2026-09-27 version (rate limit, NRIC match, newest record first); only the result now comes from
-- driver_portal_record.
create or replace function public.driver_portal_login(p_nric text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  digits text := regexp_replace(coalesce(p_nric, ''), '\D', '', 'g');
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  caller text := coalesce(
    nullif(btrim(headers->>'cf-connecting-ip'), ''),
    nullif(btrim(regexp_replace(coalesce(headers->>'x-forwarded-for', ''), '^.*,', '')), ''),
    'unknown');
  bucket_key text := 'driver:' || md5(caller);
  tries integer;
  all_tries integer;
  match_id uuid;
begin
  delete from finance_private.driver_login_limits where window_start < now() - interval '1 day';
  insert into finance_private.driver_login_limits(bucket, window_start, attempts)
    values (bucket_key, date_trunc('minute', now()), 1)
    on conflict (bucket, window_start) do update set attempts = finance_private.driver_login_limits.attempts + 1
    returning attempts into tries;
  select coalesce(sum(l.attempts), 0) into all_tries from finance_private.driver_login_limits l where l.window_start = date_trunc('minute', now());
  if tries > 10 or all_tries > 120 then
    raise exception 'Too many attempts. Please wait a minute and try again.';
  end if;
  if length(digits) < 6 then return null; end if;

  select d.id into match_id
    from public.drivers d
    where regexp_replace(coalesce(d.nric, ''), '\D', '', 'g') = digits
    order by d.created_at desc nulls last
    limit 1;
  if match_id is null then return null; end if;
  return finance_private.driver_portal_record(match_id);
end$$;
revoke all on function public.driver_portal_login(text) from public, anon, authenticated;
grant execute on function public.driver_portal_login(text) to anon, authenticated;

-- Sign in and remember this phone: the normal sign-in plus a new 30-day token (returned once, stored as a hash).
create or replace function public.driver_portal_login_remember(p_nric text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  signed_in jsonb := public.driver_portal_login(p_nric);
  token text;
  expires timestamptz := now() + interval '30 days';
begin
  if signed_in is null then return null; end if;
  delete from finance_private.driver_portal_sessions where expires_at < now();
  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into finance_private.driver_portal_sessions(token_hash, driver_id, expires_at)
    values (sha256(convert_to(token, 'UTF8')), (signed_in->'driver'->>'id')::uuid, expires);
  return signed_in || jsonb_build_object('session', jsonb_build_object('token', token, 'expires_at', expires));
end$$;
revoke all on function public.driver_portal_login_remember(text) from public, anon, authenticated;
grant execute on function public.driver_portal_login_remember(text) to anon, authenticated;

-- Reopen the page on a remembered phone: the same record, or null when the token is unknown or expired.
create or replace function public.driver_portal_resume(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  hit finance_private.driver_portal_sessions%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  delete from finance_private.driver_portal_sessions where expires_at < now();
  select * into hit from finance_private.driver_portal_sessions where token_hash = sha256(convert_to(p_token, 'UTF8'));
  if hit.driver_id is null then return null; end if;
  return finance_private.driver_portal_record(hit.driver_id) || jsonb_build_object('session', jsonb_build_object('expires_at', hit.expires_at));
end$$;
revoke all on function public.driver_portal_resume(text) from public, anon, authenticated;
grant execute on function public.driver_portal_resume(text) to anon, authenticated;

-- Sign out on this phone: forget the token.
create or replace function public.driver_portal_forget(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from finance_private.driver_portal_sessions where token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
$$;
revoke all on function public.driver_portal_forget(text) from public, anon, authenticated;
grant execute on function public.driver_portal_forget(text) to anon, authenticated;

commit;
