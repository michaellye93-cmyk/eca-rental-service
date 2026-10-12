-- Collections tools (owner's review of 12 Oct 2026): what the daily collection run needs to keep in the system instead of
-- in notes.
--
-- F1  Each driver's collection arrangement (e.g. "Monthly RM1,400 by the 10th"), tone (Soft, Polite or Firm), language,
--     contact window (e.g. "after 2pm") and a collection note. Typed only in Add / Edit Driver. The 12 Oct driver change
--     log records edits to them by itself. The driver's own sign-in page never shows them.
-- F2  A contact log: every statement, ask, follow-up, thank-you, reply, dispute, escalation or note sent to or about a
--     driver, with when, which daily run (1PM or 9PM) and who logged it. Staff and Admins read and add; only Admins
--     remove an entry logged by mistake. Entries cannot be edited.
--
-- Safe for the current live site: it only adds columns and tables, which the current site ignores. Run it in the
-- Supabase SQL Editor for RentalDatabase. It is all-or-nothing, and running it a second time changes nothing.
begin;

do $$ begin
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'drivers' and column_name = 'id') is distinct from 'uuid' then
    raise exception 'drivers.id is not a uuid: stop and check with Claude before running this file';
  end if;
  if to_regprocedure('finance_private.actor_name()') is null or to_regprocedure('finance_private.actor_role()') is null then
    raise exception 'The 29 Sep collections file has not been run (finance_private.actor_name is missing): stop and check with Claude';
  end if;
end $$;

-- F1 ---------------------------------------------------------------------------------------------------------------
alter table public.drivers add column if not exists collection_arrangement text;
alter table public.drivers add column if not exists collection_tone text;
alter table public.drivers add column if not exists collection_language text;
alter table public.drivers add column if not exists contact_window text;
alter table public.drivers add column if not exists collection_note text;
alter table public.drivers drop constraint if exists drivers_collection_arrangement_length;
alter table public.drivers add constraint drivers_collection_arrangement_length
  check (collection_arrangement is null or char_length(collection_arrangement) between 1 and 300);
alter table public.drivers drop constraint if exists drivers_collection_tone;
alter table public.drivers add constraint drivers_collection_tone check (collection_tone is null or collection_tone in ('SOFT', 'POLITE', 'FIRM'));
-- The language is a short code the app offers (BM, EN, ZH, MIXED); not fixed here so another can be added without SQL.
alter table public.drivers drop constraint if exists drivers_collection_language_length;
alter table public.drivers add constraint drivers_collection_language_length
  check (collection_language is null or char_length(collection_language) between 1 and 20);
alter table public.drivers drop constraint if exists drivers_contact_window_length;
alter table public.drivers add constraint drivers_contact_window_length check (contact_window is null or char_length(contact_window) between 1 and 100);
alter table public.drivers drop constraint if exists drivers_collection_note_length;
alter table public.drivers add constraint drivers_collection_note_length check (collection_note is null or char_length(collection_note) between 1 and 1000);

-- F2 ---------------------------------------------------------------------------------------------------------------
create table if not exists public.collection_contacts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  contacted_at timestamptz not null default now(),
  run_slot text check (run_slot is null or char_length(run_slot) between 1 and 20),
  kind text not null check (kind in ('STATEMENT', 'ASK', 'FOLLOW_UP', 'THANKS', 'REPLY', 'DISPUTE', 'ESCALATION', 'NOTE')),
  message text not null check (char_length(message) between 1 and 4000),
  logged_by uuid default auth.uid(),
  logged_by_name text not null default 'Unknown account',
  logged_by_role text
);
create index if not exists collection_contacts_recent on public.collection_contacts (contacted_at desc);
create index if not exists collection_contacts_driver on public.collection_contacts (driver_id, contacted_at desc);
alter table public.collection_contacts enable row level security;
revoke all on public.collection_contacts from public, anon, authenticated;
grant select, insert, delete on public.collection_contacts to authenticated;
drop policy if exists "Staff and admins read contacts" on public.collection_contacts;
drop policy if exists "Staff and admins log contacts" on public.collection_contacts;
drop policy if exists "Admins remove contacts" on public.collection_contacts;
create policy "Staff and admins read contacts" on public.collection_contacts for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Staff and admins log contacts" on public.collection_contacts for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
create policy "Admins remove contacts" on public.collection_contacts for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- Who logged it is always the signed-in account; a contact can be logged after the fact, but not in the future.
create or replace function finance_private.stamp_collection_contact() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.contacted_at := coalesce(new.contacted_at, now());
  if new.contacted_at > now() + interval '5 minutes' then raise exception 'The contact time is in the future'; end if;
  new.logged_by := auth.uid();
  new.logged_by_name := finance_private.actor_name();
  new.logged_by_role := finance_private.actor_role();
  return new;
end $$;
revoke all on function finance_private.stamp_collection_contact() from public, anon, authenticated;
drop trigger if exists collection_contacts_stamp on public.collection_contacts;
create trigger collection_contacts_stamp before insert on public.collection_contacts
  for each row execute function finance_private.stamp_collection_contact();

commit;
