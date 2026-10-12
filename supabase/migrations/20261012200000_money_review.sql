-- Money review (2026-10-12): Reconcile drafts kept on the server (D3) and stored trend figures for closed months (C3).
-- Additive only: new private tables and functions; nothing the live site uses today is changed, and the site keeps
-- working (as before) until this is run. Run it in the Supabase SQL Editor for RentalDatabase. It is all-or-nothing
-- (an error leaves no change behind) and safe to run again.
begin;

-- D3. Unposted Reconcile work (the statements loaded for a Finance month, with their matches and decisions), so it
-- survives another device or browser. One draft per month; the newest save replaces it. Only the lines read from
-- the bank files are kept, never the files. Nothing here is posted: posting still goes through Reconcile.
create table if not exists finance_private.reconcile_drafts (
  finance_month date primary key check (extract(day from finance_month) = 1),
  statements jsonb not null check (jsonb_typeof(statements) = 'array'),
  saved_at timestamptz not null default now(),
  saved_by uuid not null
);
alter table finance_private.reconcile_drafts enable row level security;
revoke all on finance_private.reconcile_drafts from public, anon, authenticated;

create or replace function finance_private.check_draft_month(p_month date) returns void
language plpgsql immutable set search_path='' as $$
begin
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Finance month must be the first day of a month'; end if;
end$$;

-- Saves the month's draft (an empty list clears it) and returns when it was saved. Refuses more than 2 MB.
create or replace function finance_private.save_reconcile_draft(p_month date, p_statements jsonb)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare saved timestamptz := now();
begin
  perform finance_private.require_admin();
  perform finance_private.check_draft_month(p_month);
  if p_statements is null or jsonb_typeof(p_statements) <> 'array' then raise exception 'The draft must be a list of statements'; end if;
  if octet_length(p_statements::text) > 2097152 then raise exception 'The Reconcile draft is too large to keep on the server (over 2 MB)'; end if;
  if jsonb_array_length(p_statements) = 0 then
    delete from finance_private.reconcile_drafts where finance_month = p_month;
    return saved;
  end if;
  insert into finance_private.reconcile_drafts(finance_month, statements, saved_at, saved_by)
    values (p_month, p_statements, saved, auth.uid())
    on conflict (finance_month) do update set statements = excluded.statements, saved_at = excluded.saved_at, saved_by = excluded.saved_by;
  return saved;
end$$;

-- The month's draft as {statements, saved_at}, or null when there is none.
create or replace function finance_private.load_reconcile_draft(p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform finance_private.require_admin();
  perform finance_private.check_draft_month(p_month);
  return (select jsonb_build_object('statements', d.statements, 'saved_at', d.saved_at)
    from finance_private.reconcile_drafts d where d.finance_month = p_month);
end$$;

create or replace function finance_private.clear_reconcile_draft(p_month date)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform finance_private.require_admin();
  perform finance_private.check_draft_month(p_month);
  delete from finance_private.reconcile_drafts where finance_month = p_month;
end$$;

create or replace function public.finance_save_reconcile_draft(p_month date, p_statements jsonb) returns timestamptz
  language sql security invoker set search_path='' as $$select finance_private.save_reconcile_draft(p_month, p_statements)$$;
create or replace function public.finance_load_reconcile_draft(p_month date) returns jsonb
  language sql security invoker set search_path='' as $$select finance_private.load_reconcile_draft(p_month)$$;
create or replace function public.finance_clear_reconcile_draft(p_month date) returns void
  language sql security invoker set search_path='' as $$select finance_private.clear_reconcile_draft(p_month)$$;

revoke all on function finance_private.check_draft_month(date) from public, anon, authenticated;
revoke all on function finance_private.save_reconcile_draft(date, jsonb), finance_private.load_reconcile_draft(date),
  finance_private.clear_reconcile_draft(date) from public, anon, authenticated;
grant execute on function finance_private.save_reconcile_draft(date, jsonb), finance_private.load_reconcile_draft(date),
  finance_private.clear_reconcile_draft(date) to authenticated;
revoke all on function public.finance_save_reconcile_draft(date, jsonb), public.finance_load_reconcile_draft(date),
  public.finance_clear_reconcile_draft(date) from public, anon, authenticated;
grant execute on function public.finance_save_reconcile_draft(date, jsonb), public.finance_load_reconcile_draft(date),
  public.finance_clear_reconcile_draft(date) to authenticated;

-- C3. The Overview trend's figures (revenue, contribution, profit, margin) for each CLOSED month, computed in the app
-- by the same P&L rules as the month itself and saved when the month is closed (or first read while closed). The trend
-- then reads these instead of reading every earlier month in full. A row counts only while the month is still closed
-- at the same revision: reopening moves the month to a new revision, so its row is ignored until it is closed again.
create table if not exists finance_private.month_totals (
  finance_month date primary key references finance_private.months(finance_month),
  revision integer not null,
  totals jsonb not null check (jsonb_typeof(totals) = 'object'),
  saved_at timestamptz not null default now()
);
alter table finance_private.month_totals enable row level security;
revoke all on finance_private.month_totals from public, anon, authenticated;

create or replace function finance_private.save_month_totals(p_month date, p_revision integer, p_totals jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare m finance_private.months;
begin
  perform finance_private.require_admin();
  -- A share lock: a reopen (which locks the month for update) waits for this save, or this save sees the new revision.
  select * into m from finance_private.months where finance_month = p_month for share;
  if not found or m.status <> 'CLOSED' then raise exception 'Only a closed month keeps its trend figures'; end if;
  if p_revision is distinct from m.revision then raise exception 'Month changed. Reload before saving its trend figures.'; end if;
  if p_totals is null or jsonb_typeof(p_totals) <> 'object'
    or jsonb_typeof(p_totals->'revenue') is distinct from 'number' or jsonb_typeof(p_totals->'contribution') is distinct from 'number'
    or jsonb_typeof(p_totals->'profit') is distinct from 'number' or jsonb_typeof(p_totals->'margin') not in ('number', 'null')
    or octet_length(p_totals::text) > 4096 then
    raise exception 'The trend figures must be revenue, contribution, profit (numbers) and margin (a number or empty)';
  end if;
  insert into finance_private.month_totals(finance_month, revision, totals, saved_at)
    values (p_month, p_revision, jsonb_build_object('revenue', p_totals->'revenue', 'contribution', p_totals->'contribution',
      'profit', p_totals->'profit', 'margin', p_totals->'margin'), now())
    on conflict (finance_month) do update set revision = excluded.revision, totals = excluded.totals, saved_at = excluded.saved_at;
end$$;

-- Stored figures of months that are still closed at the revision they were saved at, oldest first.
create or replace function finance_private.month_totals_rows()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform finance_private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('month', t.finance_month, 'revision', t.revision, 'totals', t.totals, 'saved_at', t.saved_at)
      order by t.finance_month)
    from finance_private.month_totals t
    join finance_private.months m on m.finance_month = t.finance_month and m.status = 'CLOSED' and m.revision = t.revision), '[]'::jsonb);
end$$;

create or replace function public.finance_save_month_totals(p_month date, p_revision integer, p_totals jsonb) returns void
  language sql security invoker set search_path='' as $$select finance_private.save_month_totals(p_month, p_revision, p_totals)$$;
create or replace function public.finance_month_totals() returns jsonb
  language sql security invoker set search_path='' as $$select finance_private.month_totals_rows()$$;

revoke all on function finance_private.save_month_totals(date, integer, jsonb), finance_private.month_totals_rows() from public, anon, authenticated;
grant execute on function finance_private.save_month_totals(date, integer, jsonb), finance_private.month_totals_rows() to authenticated;
revoke all on function public.finance_save_month_totals(date, integer, jsonb), public.finance_month_totals() from public, anon, authenticated;
grant execute on function public.finance_save_month_totals(date, integer, jsonb), public.finance_month_totals() to authenticated;

commit;
