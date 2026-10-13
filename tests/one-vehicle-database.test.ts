import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

// Production as it stands after the 12 Oct files, then the one-vehicle file.
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
  '20261012200000_money_review.sql',
];
const ONE_VEHICLE = '20261012240000_one_vehicle.sql';
const COLUMNS = `id,make,model,"plateNumber","roadtaxExpiry","insuranceExpiry","inspectionExpiry",notes,label,ownership`;

async function setup() {
  const db = await database();
  await db.exec(`alter table public.drivers add column nric text, add column contract_start_date date, add column contract_end_date date,
      add column category text, add column rental_cycle text, add column contract_duration_weeks integer, add column rental_rate numeric,
      add column is_delisted boolean, add column delist_date date, add column created_at timestamptz default now();
    create table public.cars(id text primary key, make text, model text, "plateNumber" text, "roadtaxExpiry" text,
      "insuranceExpiry" text, "inspectionExpiry" text, notes text, label text, ownership text);
    alter table public.cars enable row level security;
    create policy "Enable all access for cars" on public.cars for all using (true) with check (true);
    grant all on public.cars to anon, authenticated, service_role;`);
  for (const file of CHAIN) await migrate(db, file);
  await db.exec(`reset role; select set_config('request.jwt.claims','',false);
    insert into public.cars(${COLUMNS}) values
      ('car-1','PERODUA','BEZZA','xaa 1001','2026-10-01','2026-11-01','','','','Own Fleet'),
      ('car-2','PERODUA','AXIA',' XAA  1002 ','2026-10-01','2026-11-01','','','','Own Fleet'),
      ('car-3','PERODUA','MYVI',null,'2026-10-01','2026-11-01','','','','Own Fleet');`);
  return db;
}
const keys = async (db: PGlite) =>
  Object.fromEntries((await db.query<{ id: string; plate_key: string | null }>(`select id, plate_key from public.cars order by id`)).rows.map(r => [r.id, r.plate_key]));

test('cars get a plate key in the drivers format, filled for existing cars and kept up to date, without forbidding duplicates', async () => {
  const db = await setup();
  try {
    await migrate(db, ONE_VEHICLE);
    assert.deepEqual(await keys(db), { 'car-1': 'XAA1001', 'car-2': 'XAA1002', 'car-3': null }, 'existing cars are filled in');

    // Fleet saves as staff: the key follows the typed plate; the plate itself is stored as typed.
    await asUser(db);
    await db.exec(`insert into public.cars(${COLUMNS}) values ('car-4','PROTON','SAGA','xaa1004','2026-10-01','2026-11-01','','','','Own Fleet');
      update public.cars set "plateNumber" = 'Xaa 2002' where id = 'car-2';`);
    // A key written by hand is replaced by the rule.
    await db.exec(`update public.cars set plate_key = 'WRONG' where id = 'car-1'`);
    assert.deepEqual(await keys(db), { 'car-1': 'XAA1001', 'car-2': 'XAA2002', 'car-3': null, 'car-4': 'XAA1004' });
    assert.equal((await db.query<{ plate: string }>(`select "plateNumber" plate from public.cars where id = 'car-2'`)).rows[0].plate, 'Xaa 2002');

    // Two cars with the same plate are still allowed (live data may have them); the index only speeds look-ups.
    await db.exec(`insert into public.cars(${COLUMNS}) values ('car-5','PROTON','SAGA','XAA 1004','2026-10-01','2026-11-01','','','','Own Fleet')`);
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from public.cars where plate_key = 'XAA1004'`)).rows[0].n, 2);
    const index = (await db.query<{ indexdef: string }>(`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'cars' and indexdef ilike '%plate_key%'`)).rows;
    assert.equal(index.length, 1);
    assert.doesNotMatch(index[0].indexdef, /unique/i);

    // Running the file again changes nothing and does not fail.
    await db.exec('reset role');
    await migrate(db, ONE_VEHICLE);
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from public.cars where plate_key is not null`)).rows[0].n, 4);
  } finally { await db.close(); }
});

test("Fleet can read Finance's latest insurance cover per plate, for Admins only", async () => {
  const db = await setup();
  try {
    await migrate(db, ONE_VEHICLE);
    await db.exec(`reset role;
      insert into finance_private.insurance(plate_key,premium,coverage_start,coverage_end,responsibility,cancelled_at) values
        ('XAA1001',1200,'2025-10-16','2026-10-15','ECA_PAID',null),
        ('XAA1001',1300,'2026-10-16','2027-10-15','ECA_PAID',null),
        ('XAA1001',1300,'2027-10-16','2028-10-15','ECA_PAID',now()),
        ('XAA1002',0,null,null,'OWNER_PAID',null),
        ('XAA1002',0,'2026-03-01','2027-02-28','OWNER_PAID',null),
        ('XAA1003',0,null,null,'OWNER_PAID',null);`);
    await asUser(db);
    const cover = (await db.query<{ value: unknown }>(`select public.finance_insurance_cover() value`)).rows[0].value;
    // The latest end date of each plate's policies that are not cancelled, whoever paid; a plate without dates is left out.
    assert.deepEqual(cover, [{ plate_key: 'XAA1001', coverage_end: '2027-10-15' }, { plate_key: 'XAA1002', coverage_end: '2027-02-28' }]);

    await asUser(db, STAFF_ID);
    await assert.rejects(db.query(`select public.finance_insurance_cover()`), /Admin/);
    await db.exec(`reset role; select set_config('request.jwt.claims','',false); set role anon;`);
    await assert.rejects(db.query(`select public.finance_insurance_cover()`), /permission denied/);

    await db.exec('reset role');
    await migrate(db, ONE_VEHICLE);
    await asUser(db);
    assert.equal((await db.query<{ n: number }>(`select jsonb_array_length(public.finance_insurance_cover()) n`)).rows[0].n, 2, 'runs twice');
  } finally { await db.close(); }
});

test('the change logs are indexed by time for the live updates, and running the file again changes nothing', async () => {
  const db = await setup();
  try {
    await migrate(db, ONE_VEHICLE);
    await migrate(db, ONE_VEHICLE);
    const rows = (await db.query<{ tablename: string; indexdef: string }>(
      `select tablename, indexdef from pg_indexes where schemaname = 'public' and indexname in ('payment_changes_changed_at', 'driver_changes_changed_at') order by tablename`)).rows;
    assert.deepEqual(rows.map(r => r.tablename), ['driver_changes', 'payment_changes']);
    for (const row of rows) assert.match(row.indexdef, /\(changed_at\)/);
  } finally { await db.close(); }
});
