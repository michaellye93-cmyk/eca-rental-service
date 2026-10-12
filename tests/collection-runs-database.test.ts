import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN_ID, asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

// Production as it stands after the 12 Oct collections tools file, then the run summary file.
const CHAIN = [
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
  '20261012210000_collections_tools.sql',
];
const RELEASE = '20261012230000_collection_runs.sql';

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
    grant all on public.cars to anon, authenticated, service_role;`);
  for (const file of CHAIN) await migrate(db, file);
  await migrate(db, RELEASE);
  return db;
}
const rows = async <T,>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const count = async (db: PGlite, sql: string, params: unknown[] = []) => (await rows<{ n: number }>(db, sql, params))[0].n;
const asAnon = (db: PGlite) => db.exec(`reset role; select set_config('request.jwt.claims','',false); set role anon`);
const RUN = `insert into public.collection_runs(run_date, run_slot, started_at, finished_at, payments_recorded, asks_sent, promises_logged, collected,
  categories_before, categories_after, blocks, summary, logged_by, logged_by_name)
  values ('2026-10-12', '1PM', now() - interval '1 hour', now(), 3, 12, 2, 1350.50, '{"good":10,"mid":5,"bad":3}', '{"good":11,"mid":4,"bad":3}',
    'Fixture block', 'Fixture summary', $1, 'pretend')`;

test('staff and admins record run summaries under their own name; nobody edits one; only admins delete; the public sees nothing', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(RUN, [ADMIN_ID]);
    const [run] = await rows<{ run_slot: string; payments_recorded: number; collected: string; categories_before: any; categories_after: any; logged_by: string; logged_by_name: string; logged_by_role: string; recent: boolean }>(db,
      `select run_slot, payments_recorded, collected, categories_before, categories_after, logged_by, logged_by_name, logged_by_role, logged_at > now() - interval '1 minute' recent from public.collection_runs`);
    assert.deepEqual([run.run_slot, run.payments_recorded, Number(run.collected), run.categories_before, run.categories_after, run.logged_by, run.logged_by_name, run.logged_by_role, run.recent],
      ['1PM', 3, 1350.5, { good: 10, mid: 5, bad: 3 }, { good: 11, mid: 4, bad: 3 }, STAFF_ID, 'Staff', 'staff', true]);
    await assert.rejects(db.query(`update public.collection_runs set summary = 'changed'`), /permission denied/);
    await db.query(`delete from public.collection_runs`);
    assert.equal(await count(db, `select count(*)::int n from public.collection_runs`), 1, 'staff cannot delete a summary');
    await asAnon(db);
    await assert.rejects(db.query(`select * from public.collection_runs`), /permission denied/);
    await assert.rejects(db.query(RUN, [ADMIN_ID]), /permission denied/);
    await asUser(db, ADMIN_ID);
    await db.query(RUN, [STAFF_ID]);
    assert.equal(await count(db, `select count(*)::int n from public.collection_runs where logged_by = $1 and logged_by_name = 'Admin'`, [ADMIN_ID]), 1);
    await assert.rejects(db.query(`update public.collection_runs set summary = 'changed'`), /permission denied/, 'admins cannot edit either');
    await db.query(`delete from public.collection_runs`);
    assert.equal(await count(db, `select count(*)::int n from public.collection_runs`), 0);
  } finally { await db.close(); }
});

test('a summary keeps sensible values: counts and cash not negative, categories as good / mid / bad, finished after it started', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    const insert = (columns: string, values: string) => db.query(`insert into public.collection_runs(run_date, run_slot, started_at${columns}) values ('2026-10-12', '9PM', now() - interval '1 hour'${values})`);
    await insert('', '');
    const [run] = await rows<{ payments_recorded: number; asks_sent: number; promises_logged: number; collected: string; finished: boolean }>(db,
      `select payments_recorded, asks_sent, promises_logged, collected, finished_at > now() - interval '1 minute' finished from public.collection_runs`);
    assert.deepEqual([run.payments_recorded, run.asks_sent, run.promises_logged, Number(run.collected), run.finished], [0, 0, 0, 0, true], 'counts start at nothing; finished now');
    await assert.rejects(insert(', payments_recorded', ', -1'), /check/);
    await assert.rejects(insert(', collected', ', -5'), /check/);
    await assert.rejects(insert(', categories_before', `, '{"good":1}'`), /check/);
    await assert.rejects(insert(', categories_after', `, '[1,2,3]'`), /check/);
    await assert.rejects(insert(', finished_at', `, now() - interval '2 hours'`), /check/);
    await assert.rejects(insert(', summary', `, ''`), /check/);
    await assert.rejects(db.query(`insert into public.collection_runs(run_date, run_slot, started_at) values ('2026-10-12', '', now())`), /check/);
    await assert.rejects(db.query(`insert into public.collection_runs(run_date, run_slot, started_at) values ('2026-10-12', '1PM', now() + interval '1 day')`), /future/i);
  } finally { await db.close(); }
});

test('payments recorded since a run started can be found quickly (an index on when each change was made)', async () => {
  const db = await setup();
  try {
    assert.equal(await count(db, `select count(*)::int n from pg_indexes where schemaname = 'public' and indexname = 'payment_changes_recent'`), 1);
  } finally { await db.close(); }
});

test('the file can safely run twice', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(RUN, [STAFF_ID]);
    await db.exec('reset role');
    await migrate(db, RELEASE);
    assert.equal(await count(db, `select count(*)::int n from public.collection_runs`), 1, 'summaries already recorded are kept');
  } finally { await db.close(); }
});
