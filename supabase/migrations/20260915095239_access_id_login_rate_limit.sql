-- Access-ID login is a server-validated credential flow. The public browser
-- cannot read/reset this limiter or mint sessions directly.
create table finance_private.access_login_limits (
  bucket text not null,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  primary key(bucket,window_start)
);
alter table finance_private.access_login_limits enable row level security;
revoke all on finance_private.access_login_limits from public,anon,authenticated,service_role;

create function finance_private.access_id_login_attempt(p_bucket text) returns boolean
language plpgsql security definer set search_path='' as $$
declare attempt_count integer;begin
  if p_bucket is null or (p_bucket !~ '^client:[a-f0-9]{64}$' and p_bucket !~ '^account:[a-f0-9-]{36}$') then raise exception 'Invalid login bucket';end if;
  delete from finance_private.access_login_limits where window_start < now()-interval '1 day';
  insert into finance_private.access_login_limits(bucket,window_start,attempts)
    values(p_bucket,date_trunc('minute',now()),1)
    on conflict(bucket,window_start) do update set attempts=finance_private.access_login_limits.attempts+1
    returning attempts into attempt_count;
  return attempt_count<=30;
end$$;
revoke all on function finance_private.access_id_login_attempt(text) from public,anon,authenticated;
grant usage on schema finance_private to service_role;
grant execute on function finance_private.access_id_login_attempt(text) to service_role;

create function public.access_id_login_attempt(p_bucket text) returns boolean
language sql security invoker set search_path='' as $$select finance_private.access_id_login_attempt(p_bucket)$$;
revoke all on function public.access_id_login_attempt(text) from public,anon,authenticated;
grant execute on function public.access_id_login_attempt(text) to service_role;
