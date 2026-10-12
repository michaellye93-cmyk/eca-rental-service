import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN_ID, database, migrate } from './finance-db-fixture.ts';

// Production as it stands on 2026-10-12 (with the old invoices table), then the clean-up file.
const CHAIN = [
  '20260728000000_create_invoices.sql',
  '20260915084108_secure_profile_roles.sql',
  '20260915084110_finance_foundation.sql',
  '20260915085705_finance_bank_statements.sql',
  '20260915095239_access_id_login_rate_limit.sql',
  '20260915104015_finance_section_workflows.sql',
  '20260915120802_finance_delete_vehicle.sql',
  '20260915122156_finance_insurance_responsibility.sql',
  '20260915124812_finance_insurance_premium_rules.sql',
  '20260915132423_finance_shared_recurring_opex.sql',
  '20260920070959_finance_editable_safe_imports.sql',
  '20260920103854_finance_fixed_cost_same_start_edit.sql',
  '20260920111527_simplify_operation_fixed_costs.sql',
  '20260927090000_cash_position_and_outlook.sql',
  '20260927090100_driver_portal_phone_screening.sql',
  '20260927090200_close_public_access.sql',
  '20260929010000_reopen_cars_for_guardian.sql',
  '20260929090000_collections_support.sql',
  '20260929180000_fleet_close_cars.sql',
  '20261006090000_finance_car_history_and_cash_flow.sql',
  '20261006120000_finance_bank_reconciliation_required.sql',
  '20261006150000_finance_payment_bank_status.sql',
  '20261006180000_finance_bank_split_match.sql',
  '20261006200000_driver_deposits.sql',
  '20261007090000_finance_bank_match_once.sql',
  '20261007120000_driver_portal_remember.sql',
  '20261009090000_vehicle_details_and_agreements.sql',
  '20261009150000_driver_master_and_agreement_copy.sql',
  '20261009170000_returning_drivers.sql',
  '20261010090000_drop_approved_driver.sql',
  '20261012180000_security_review.sql',
  '20261012200000_money_review.sql',
];
const CLEANUP = '20261012220000_cleanup.sql';
// The five old Finance write endpoints that now only raise an exception.
const STUBS = [
  'public.finance_save_record(text,jsonb)',
  'public.finance_post_section_workbook(text,date,text,jsonb,integer,text)',
  'public.finance_post_workshop(date,text,jsonb,integer,text)',
  'public.finance_bootstrap(jsonb,text)',
  'public.finance_copy_previous_shared_costs(date,jsonb,integer)',
];
const HASH = 'a'.repeat(64);
const UPLOAD = '30000000-0000-4000-8000-000000000001';

/** The leftovers that exist in production: the old invoices copy, the snapshot table and the retired functions. */
async function setup() {
  const db = await database();
  await db.exec(`alter table public.drivers add column nric text, add column email text, add column address text,
      add column contract_start_date date, add column contract_end_date date,
      add column category text, add column rental_cycle text, add column contract_duration_weeks integer, add column rental_rate numeric,
      add column is_delisted boolean default false, add column delist_date date, add column tags text[], add column created_at timestamptz default now();
    alter table public.payments add column created_at timestamptz default now();
    create table public.cars(id text primary key, make text, model text, "plateNumber" text, "roadtaxExpiry" text,
      "insuranceExpiry" text, "inspectionExpiry" text, notes text, label text, ownership text);
    alter table public.cars enable row level security;
    create policy "Enable all access for cars" on public.cars for all using (true) with check (true);
    grant all on public.cars to anon, authenticated, service_role;
    create function public.test_get_drivers() returns jsonb language plpgsql security definer as $$begin return (select jsonb_agg(d) from public.drivers d);end;$$;
    create function public.reconcile_bank_statement(batch_transactions jsonb) returns jsonb language plpgsql security definer as $$begin return '[]'::jsonb;end;$$;
    create function public.reconcile_bank_statement(batch_transactions jsonb, strict boolean) returns jsonb language plpgsql security definer as $$begin return '[]'::jsonb;end;$$;
    create table public.fleet_snapshots(id uuid primary key, snapshot_date date, good_count integer);
    -- An old live function in no repository file; it reads the invoices table, so it would fail once that is gone.
    create function public.cleanup_all_ghost_invoices_manual() returns integer language plpgsql security definer as $$begin return (select count(*) from public.invoices);end;$$;
    create function public.cleanup_all_ghost_invoices_manual(p_driver uuid) returns integer language plpgsql security definer as $$begin return (select count(*) from public.invoices);end;$$;`);
  for (const file of CHAIN) await migrate(db, file);
  await db.exec(`reset role; select set_config('request.jwt.claims','',false);
    insert into finance_private.months(finance_month) values ('2026-08-01') on conflict do nothing;
    insert into finance_private.section_uploads(id,finance_month,kind,filename,source_hash,imported_by,row_count)
      values ('${UPLOAD}','2026-08-01','VEHICLE_EXPENSE','fixture.xlsx','${HASH}','${ADMIN_ID}',1);
    insert into finance_private.import_previews(finance_month,kind,filename,source_hash,mode,requested_rows,changes,month_revision,mutation_generation,created_by,expires_at,applied_upload_id) values
      ('2026-08-01','VEHICLE_EXPENSE','expired.xlsx','${HASH}','UPDATE','[]','[]',0,0,'${ADMIN_ID}',now()-interval '2 days',null),
      ('2026-08-01','VEHICLE_EXPENSE','open.xlsx','${HASH}','UPDATE','[]','[]',0,0,'${ADMIN_ID}',now()+interval '20 minutes',null),
      ('2026-08-01','VEHICLE_EXPENSE','posted.xlsx','${HASH}','UPDATE','[]','[]',0,0,'${ADMIN_ID}',now()-interval '2 days','${UPLOAD}');`);
  return db;
}
const found = async (db: PGlite, lookup: 'to_regclass' | 'to_regprocedure', name: string) =>
  (await db.query<{ found: boolean }>(`select ${lookup}($1) is not null found`, [name])).rows[0].found;
const overloads = async (db: PGlite, name: string) =>
  (await db.query<{ n: number }>(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.proname = $1`, [name])).rows[0].n;

test('the clean-up drops the unused tables and retired functions, keeps posted import history, and can run twice', async () => {
  const db = await setup();
  try {
    assert.equal(await found(db, 'to_regclass', 'public.invoices'), true, 'the fixture starts with the old tables');
    assert.equal(await overloads(db, 'reconcile_bank_statement'), 2);
    assert.equal(await overloads(db, 'cleanup_all_ghost_invoices_manual'), 2);
    for (const stub of STUBS) assert.equal(await found(db, 'to_regprocedure', stub), true, `${stub} exists before`);

    await migrate(db, CLEANUP);

    assert.equal(await found(db, 'to_regclass', 'public.invoices'), false, 'invoices is gone');
    assert.equal(await found(db, 'to_regclass', 'public.fleet_snapshots'), false, 'fleet_snapshots is gone');
    assert.equal(await overloads(db, 'reconcile_bank_statement'), 0, 'every reconcile_bank_statement overload is gone');
    assert.equal(await overloads(db, 'test_get_drivers'), 0, 'test_get_drivers is gone');
    assert.equal(await overloads(db, 'cleanup_all_ghost_invoices_manual'), 0, 'every cleanup_all_ghost_invoices_manual overload is gone');
    for (const stub of STUBS) assert.equal(await found(db, 'to_regprocedure', stub), false, `${stub} is gone`);

    const previews = (await db.query<{ filename: string }>(`select filename from finance_private.import_previews order by filename`)).rows.map(r => r.filename);
    assert.deepEqual(previews, ['open.xlsx', 'posted.xlsx'], 'only the expired preview that was never posted is deleted');

    // The live tables and the reviewed Finance workflow are untouched.
    for (const table of ['public.drivers', 'public.payments', 'public.cars', 'finance_private.section_uploads']) {
      assert.equal(await found(db, 'to_regclass', table), true, `${table} stays`);
    }
    assert.equal(await found(db, 'to_regprocedure', 'public.finance_mutate_record(text,text,jsonb,date,integer,text)'), true);

    await migrate(db, CLEANUP);
    assert.equal(await found(db, 'to_regclass', 'public.invoices'), false, 'running it again changes nothing and does not fail');
  } finally { await db.close(); }
});
