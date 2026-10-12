-- Collection run summaries (owner's review of 12 Oct 2026, F4): after each daily collection run (1PM or 9PM) a short
-- record of what it did: when it started and finished, payments recorded, asks sent, promises logged, cash collected,
-- the GOOD / MID / BAD counts before and after, anything that blocked it, and a summary. The admin site's worklist
-- (/admin/worklist) fills in what the system can count; the person adjusts it and saves. Finance -> Collections shows
-- the last seven as a daily brief for the owner.
--
-- Staff and Admins read and add summaries; only Admins delete one recorded by mistake; nobody edits one. Who recorded
-- it is always the signed-in account (stamped here, as promises and contacts are).
--
-- Also adds an index on public.payment_changes by time, so "payments recorded since the run started" is quick.
--
-- Safe for the current live site: it only adds a table and an index, which the current site ignores. Run it in the
-- Supabase SQL Editor for RentalDatabase, after the 12 Oct collections tools file. It is all-or-nothing, and running it
-- a second time changes nothing.
begin;

do $$ begin
  if to_regprocedure('finance_private.actor_name()') is null or to_regprocedure('finance_private.actor_role()') is null
    or to_regclass('public.payment_changes') is null then
    raise exception 'The 29 Sep collections file has not been run (finance_private.actor_name or payment_changes is missing): stop and check with Claude';
  end if;
end $$;

create table if not exists public.collection_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  run_slot text not null check (char_length(run_slot) between 1 and 20),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  payments_recorded integer not null default 0 check (payments_recorded >= 0),
  asks_sent integer not null default 0 check (asks_sent >= 0),
  promises_logged integer not null default 0 check (promises_logged >= 0),
  collected numeric(12, 2) not null default 0 check (collected >= 0),
  -- {"good": n, "mid": n, "bad": n}; before = the day's status snapshot, after = when the summary was recorded
  categories_before jsonb check (categories_before is null or (jsonb_typeof(categories_before) = 'object' and categories_before ?& array['good', 'mid', 'bad'])),
  categories_after jsonb check (categories_after is null or (jsonb_typeof(categories_after) = 'object' and categories_after ?& array['good', 'mid', 'bad'])),
  blocks text check (blocks is null or char_length(blocks) between 1 and 4000),
  summary text check (summary is null or char_length(summary) between 1 and 4000),
  logged_at timestamptz not null default now(),
  logged_by uuid default auth.uid(),
  logged_by_name text not null default 'Unknown account',
  logged_by_role text,
  constraint collection_runs_finished_after_start check (finished_at >= started_at)
);
-- A run is dated by the Kuala Lumpur day it started (a 9PM run saved after midnight keeps its day).
alter table public.collection_runs drop constraint if exists collection_runs_run_date;
alter table public.collection_runs add constraint collection_runs_run_date
  check (run_date = (started_at at time zone 'Asia/Kuala_Lumpur')::date);
create index if not exists collection_runs_recent on public.collection_runs (run_date desc, started_at desc);
alter table public.collection_runs enable row level security;
revoke all on public.collection_runs from public, anon, authenticated;
grant select, insert, delete on public.collection_runs to authenticated;
drop policy if exists "Staff and admins read run summaries" on public.collection_runs;
drop policy if exists "Staff and admins record run summaries" on public.collection_runs;
drop policy if exists "Admins delete run summaries" on public.collection_runs;
create policy "Staff and admins read run summaries" on public.collection_runs for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Staff and admins record run summaries" on public.collection_runs for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Admins delete run summaries" on public.collection_runs for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- Who recorded it is always the signed-in account; a run cannot start in the future.
create or replace function finance_private.stamp_collection_run() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.started_at > now() + interval '5 minutes' then raise exception 'The run start time is in the future'; end if;
  new.finished_at := coalesce(new.finished_at, now());
  new.logged_at := now();
  new.logged_by := auth.uid();
  new.logged_by_name := finance_private.actor_name();
  new.logged_by_role := finance_private.actor_role();
  return new;
end $$;
revoke all on function finance_private.stamp_collection_run() from public, anon, authenticated;
drop trigger if exists collection_runs_stamp on public.collection_runs;
create trigger collection_runs_stamp before insert on public.collection_runs
  for each row execute function finance_private.stamp_collection_run();

create index if not exists payment_changes_recent on public.payment_changes (changed_at);

commit;
