-- Money review (2026-10-12): Reconcile drafts kept on the server (D3) and stored trend figures for closed months (C3).
-- Additive only: new private tables and functions; nothing the live site uses today is changed, and the site keeps
-- working (as before) until this is run. Run it in the Supabase SQL Editor for RentalDatabase. It is all-or-nothing
-- (an error leaves no change behind) and safe to run again.
begin;

-- D3. Unposted Reconcile work (the statements loaded for a Finance month, with their matches and decisions), so it
-- survives another device or browser. One draft per month. Each save and clear carries the time the change was made on
-- the device (saved_at); one that is not newer than the stored draft is refused (the stored draft is returned, no
-- error), so a save arriving late can never bring back work discarded or posted since. Clearing keeps an empty draft
-- with its time for the same reason. Only the lines read from the bank files are kept, never the files. Nothing here
-- is posted: posting still goes through Reconcile.
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

-- Saves the month's draft as of p_saved_at (an empty list clears it) and returns the stored draft as
-- {statements, saved_at}: the one just saved, or the newer one already stored when this save is refused. Refuses more
-- than 2 MB, and a time far ahead of the server's clock (it would lock out every other device until then).
create or replace function finance_private.save_reconcile_draft(p_month date, p_statements jsonb, p_saved_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept finance_private.reconcile_drafts;
begin
  perform finance_private.require_admin();
  perform finance_private.check_draft_month(p_month);
  if p_statements is null or jsonb_typeof(p_statements) <> 'array' then raise exception 'The draft must be a list of statements'; end if;
  if p_saved_at is null then raise exception 'The draft needs the time the change was made'; end if;
  if p_saved_at > now() + interval '10 minutes' then
    raise exception 'This device''s clock is ahead of the server, so the Reconcile draft is kept in this browser only';
  end if;
  if octet_length(p_statements::text) > 2097152 then raise exception 'The Reconcile draft is too large to keep on the server (over 2 MB)'; end if;
  insert into finance_private.reconcile_drafts(finance_month, statements, saved_at, saved_by)
    values (p_month, p_statements, p_saved_at, auth.uid())
    on conflict (finance_month) do update set statements = excluded.statements, saved_at = excluded.saved_at, saved_by = excluded.saved_by
      where finance_private.reconcile_drafts.saved_at < excluded.saved_at
    returning * into kept;
  if kept.finance_month is null then
    select * into kept from finance_private.reconcile_drafts where finance_month = p_month;
  end if;
  return jsonb_build_object('statements', kept.statements, 'saved_at', kept.saved_at);
end$$;

-- The month's draft as {statements, saved_at} (an empty list once cleared), or null when there has never been one.
create or replace function finance_private.load_reconcile_draft(p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform finance_private.require_admin();
  perform finance_private.check_draft_month(p_month);
  return (select jsonb_build_object('statements', d.statements, 'saved_at', d.saved_at)
    from finance_private.reconcile_drafts d where d.finance_month = p_month);
end$$;

-- Clears the month's draft as of p_saved_at (posted or discarded); the same rule as a save of no statements.
create or replace function finance_private.clear_reconcile_draft(p_month date, p_saved_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return finance_private.save_reconcile_draft(p_month, '[]'::jsonb, p_saved_at);
end$$;

create or replace function public.finance_save_reconcile_draft(p_month date, p_statements jsonb, p_saved_at timestamptz) returns jsonb
  language sql security invoker set search_path='' as $$select finance_private.save_reconcile_draft(p_month, p_statements, p_saved_at)$$;
create or replace function public.finance_load_reconcile_draft(p_month date) returns jsonb
  language sql security invoker set search_path='' as $$select finance_private.load_reconcile_draft(p_month)$$;
create or replace function public.finance_clear_reconcile_draft(p_month date, p_saved_at timestamptz) returns jsonb
  language sql security invoker set search_path='' as $$select finance_private.clear_reconcile_draft(p_month, p_saved_at)$$;

revoke all on function finance_private.check_draft_month(date) from public, anon, authenticated;
revoke all on function finance_private.save_reconcile_draft(date, jsonb, timestamptz), finance_private.load_reconcile_draft(date),
  finance_private.clear_reconcile_draft(date, timestamptz) from public, anon, authenticated;
grant execute on function finance_private.save_reconcile_draft(date, jsonb, timestamptz), finance_private.load_reconcile_draft(date),
  finance_private.clear_reconcile_draft(date, timestamptz) to authenticated;
revoke all on function public.finance_save_reconcile_draft(date, jsonb, timestamptz), public.finance_load_reconcile_draft(date),
  public.finance_clear_reconcile_draft(date, timestamptz) from public, anon, authenticated;
grant execute on function public.finance_save_reconcile_draft(date, jsonb, timestamptz), public.finance_load_reconcile_draft(date),
  public.finance_clear_reconcile_draft(date, timestamptz) to authenticated;

-- C3. The Overview trend's figures (revenue, contribution, profit, margin) for each CLOSED month, computed in the app
-- by the same P&L rules as the month itself and saved when the month is closed (or first read while closed). The trend
-- then reads these instead of reading every earlier month in full. A row counts only while the month is still closed
-- at the same revision: reopening moves the month to a new revision, so its row is ignored until it is closed again.
-- Each row also keeps the rules_version of the app rules it was worked out by (TREND_RULES_VERSION in
-- services/finance/dashboard.ts); the app reads a row stored under other rules live again and stores it anew.
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
    or jsonb_typeof(p_totals->'rules_version') is distinct from 'number'
    or octet_length(p_totals::text) > 4096 then
    raise exception 'The trend figures must be revenue, contribution, profit (numbers), margin (a number or empty) and rules_version (a number)';
  end if;
  insert into finance_private.month_totals(finance_month, revision, totals, saved_at)
    values (p_month, p_revision, jsonb_build_object('revenue', p_totals->'revenue', 'contribution', p_totals->'contribution',
      'profit', p_totals->'profit', 'margin', p_totals->'margin', 'rules_version', p_totals->'rules_version'), now())
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
