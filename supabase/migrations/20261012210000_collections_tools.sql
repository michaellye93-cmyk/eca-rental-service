-- Collections tools (owner's review of 12 Oct 2026): what the daily collection run needs to keep in the system instead of
-- in notes.
--
-- F1  Each driver's collection arrangement (e.g. "Monthly RM1,400 by the 10th"), tone (Soft, Polite or Firm), language,
--     contact window (e.g. "after 2pm") and a collection note. Typed only in Add / Edit Driver. The 12 Oct driver change
--     log records edits to them by itself. The driver's own sign-in page never shows them.
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

commit;
