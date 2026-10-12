import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN_ID, asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

// Production as it stands on 2026-10-12, then the security file.
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
];
const RELEASE = '20261012180000_security_review.sql';
const DRIVER_A = '10000000-0000-4000-8000-00000000000a';
const DRIVER_B = '10000000-0000-4000-8000-00000000000b';
const NRIC_A = '900101-01-1234';

async function setup(beforeRelease?: (db: PGlite) => Promise<void>) {
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
  await db.exec(`reset role; select set_config('request.jwt.claims','',false);
    insert into public.drivers(id,name,car_plate,nric,contract_start_date,category,rental_cycle,contract_duration_weeks,rental_rate,is_delisted) values
      ('${DRIVER_A}','Fixture Driver A','XAA1001','${NRIC_A}','2026-08-01','SEWABELI','WEEKLY',52,400,false),
      ('${DRIVER_B}','Fixture Driver B','XAB2001','900202-02-2345','2026-08-03','SEWA_BIASA','MONTHLY',12,1500,true);`);
  if (beforeRelease) await beforeRelease(db);
  await migrate(db, RELEASE);
  return db;
}
const rows = async <T,>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const count = async (db: PGlite, sql: string, params: unknown[] = []) => (await rows<{ n: number }>(db, sql, params))[0].n;
const asAnon = (db: PGlite) => db.exec(`reset role; select set_config('request.jwt.claims','',false); set role anon`);
const pay = (db: PGlite, id: string, driver: string, amount: number, reference: string | null, claim = 0, method: string | null = 'BANK TRANSFER') =>
  db.query(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method,reference) values($1,$2,'2026-10-01',$3,$4,$5,$6)`,
    [id, driver, amount, claim, method, reference]);

test('staff read, add and edit drivers, payments and deposits, but only admins delete them', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await pay(db, '20000000-0000-4000-8000-000000000001', DRIVER_A, 400, 'REF001');
    await db.query(`update public.payments set amount = 410 where id = '20000000-0000-4000-8000-000000000001'`);
    await db.query(`insert into public.driver_deposits(id,driver_id,kind,entry,entry_date,amount) values('30000000-0000-4000-8000-000000000001',$1,'DOWNPAYMENT','RECEIVED','2026-08-01',1000)`, [DRIVER_A]);
    await db.query(`update public.drivers set rental_rate = 420 where id = $1`, [DRIVER_A]);
    // A staff delete removes nothing
    await db.query(`delete from public.payments where id = '20000000-0000-4000-8000-000000000001'`);
    await db.query(`delete from public.driver_deposits where id = '30000000-0000-4000-8000-000000000001'`);
    await db.query(`delete from public.drivers where id = $1`, [DRIVER_B]);
    assert.equal(await count(db, `select count(*)::int n from public.payments`), 1);
    assert.equal(await count(db, `select count(*)::int n from public.driver_deposits`), 1);
    assert.equal(await count(db, `select count(*)::int n from public.drivers`), 2);
    await asUser(db, ADMIN_ID);
    await db.query(`delete from public.driver_deposits where id = '30000000-0000-4000-8000-000000000001'`);
    await db.query(`delete from public.payments where id = '20000000-0000-4000-8000-000000000001'`);
    await db.query(`delete from public.drivers where id = $1`, [DRIVER_B]);
    assert.equal(await count(db, `select count(*)::int n from public.payments`), 0);
    assert.equal(await count(db, `select count(*)::int n from public.driver_deposits`), 0);
    assert.equal(await count(db, `select count(*)::int n from public.drivers`), 1);
    await asAnon(db);
    await assert.rejects(db.query(`select * from public.drivers`), /permission denied/);
  } finally { await db.close(); }
});

test('every change to a driver is logged with who, when, the fields changed and their values before and after', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`update public.drivers set rental_rate = 450, contract_start_date = '2026-08-02' where id = $1`, [DRIVER_A]);
    await db.query(`update public.drivers set rental_rate = 450 where id = $1`, [DRIVER_A]); // no change: not logged
    await db.query(`insert into public.drivers(id,name,car_plate,nric) values('10000000-0000-4000-8000-00000000000c','Fixture Driver C','XAC3001','900303-03-3456')`);
    await asUser(db, ADMIN_ID);
    await db.query(`delete from public.drivers where id = '10000000-0000-4000-8000-00000000000c'`);
    const log = await rows<{ driver_id: string; action: string; changed_by_name: string; fields: string[]; before: any; after: any }>(db,
      `select driver_id, action, changed_by_name, fields, before, after from public.driver_changes order by id`);
    assert.deepEqual(log.map(r => [r.action, r.changed_by_name]), [['UPDATE', 'Staff'], ['INSERT', 'Staff'], ['DELETE', 'Admin']]);
    assert.deepEqual(log[0].fields, ['contract_start_date', 'rental_rate']);
    assert.deepEqual(log[0].before, { contract_start_date: '2026-08-01', rental_rate: 400 });
    assert.deepEqual(log[0].after, { contract_start_date: '2026-08-02', rental_rate: 450 });
    assert.equal(log[1].before, null);
    assert.equal(log[2].after, null);
    assert.equal(log[2].before.name, 'Fixture Driver C', 'a deleted driver is kept in the log');
    await asUser(db, STAFF_ID);
    assert.equal(await count(db, `select count(*)::int n from public.driver_changes`), 3, 'staff can read the log');
    await assert.rejects(db.query(`delete from public.driver_changes`), /permission denied/);
    await assert.rejects(db.query(`update public.driver_changes set changed_by_name = 'x'`), /permission denied/);
  } finally { await db.close(); }
});

test('a bank reference can be recorded once, whatever its spacing or capitals; claim-only lines and blanks are not checked', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await pay(db, '20000000-0000-4000-8000-000000000001', DRIVER_A, 400, 'ab 123');
    await assert.rejects(pay(db, '20000000-0000-4000-8000-000000000002', DRIVER_A, 400, 'AB123'), /payments_reference_once/);
    await assert.rejects(pay(db, '20000000-0000-4000-8000-000000000003', DRIVER_B, 200, ' Ab 12 3 '), /payments_reference_once/, 'another driver too');
    await pay(db, '20000000-0000-4000-8000-000000000004', DRIVER_A, 0, 'AB123', 150); // claim-only line on the same receipt
    await pay(db, '20000000-0000-4000-8000-000000000005', DRIVER_A, 400, null);
    await pay(db, '20000000-0000-4000-8000-000000000006', DRIVER_A, 400, '  ');
    await pay(db, '20000000-0000-4000-8000-000000000007', DRIVER_A, 400, null);
    // Deposit forfeits all carry the label "Deposit contra"; cash in hand has no bank receipt
    await pay(db, '20000000-0000-4000-8000-000000000008', DRIVER_A, 300, 'Deposit contra', 0, 'DEPOSIT CONTRA');
    await pay(db, '20000000-0000-4000-8000-000000000009', DRIVER_B, 500, 'Deposit contra', 0, 'DEPOSIT CONTRA');
    await pay(db, '20000000-0000-4000-8000-000000000010', DRIVER_A, 50, 'AB123', 0, 'CASH');
    // A cash deposit slip is a bank receipt too, and a missing method counts as bank transfer
    await assert.rejects(pay(db, '20000000-0000-4000-8000-000000000011', DRIVER_A, 400, 'AB123', 0, 'CASH DEPOSIT'), /payments_reference_once/);
    await assert.rejects(pay(db, '20000000-0000-4000-8000-000000000012', DRIVER_A, 400, 'AB123', 0, null), /payments_reference_once/);
    assert.equal(await count(db, `select count(*)::int n from public.payments`), 8);
  } finally { await db.close(); }
});

test('when two payments already share a reference the rule is not switched on, and the file still runs', async () => {
  const db = await setup(async db => {
    await pay(db, '20000000-0000-4000-8000-000000000003', DRIVER_A, 300, 'Deposit contra', 0, 'DEPOSIT CONTRA');
    await pay(db, '20000000-0000-4000-8000-000000000004', DRIVER_B, 300, 'Deposit contra', 0, 'DEPOSIT CONTRA');
    await pay(db, '20000000-0000-4000-8000-000000000001', DRIVER_A, 400, 'DUP1');
    await pay(db, '20000000-0000-4000-8000-000000000002', DRIVER_A, 400, 'dup 1');
  });
  try {
    assert.equal(await count(db, `select count(*)::int n from pg_indexes where indexname = 'payments_reference_once'`), 0);
    await db.exec(`reset role; delete from public.payments where id = '20000000-0000-4000-8000-000000000002'`);
    await migrate(db, RELEASE);
    assert.equal(await count(db, `select count(*)::int n from pg_indexes where indexname = 'payments_reference_once'`), 1, 'switched on once fixed (deposit forfeits never count as a clash)');
  } finally { await db.close(); }
});

test('the driver sign-in no longer sends the old payment instructions, and the old text and functions are gone', async () => {
  const db = await setup();
  try {
    await asAnon(db);
    const record = (await rows<{ value: any }>(db, `select public.driver_portal_login($1) value`, [NRIC_A]))[0].value;
    assert.deepEqual(Object.keys(record).sort(), ['agreement', 'driver', 'payments']);
    assert.equal(record.driver.id, DRIVER_A);
    await db.exec('reset role');
    assert.equal(await count(db, `select count(*)::int n from pg_proc where proname in ('finance_portal_instructions','finance_save_portal_instructions','portal_payment_instructions')`), 0);
    assert.equal(await count(db, `select count(*)::int n from pg_tables where schemaname = 'finance_private' and tablename = 'portal_settings'`), 0);
  } finally { await db.close(); }
});

test('busy minutes from many phones no longer lock every driver out at 120 tries; 600 is the cap for all phones', async () => {
  const db = await setup();
  try {
    await db.exec(`insert into finance_private.driver_login_limits(bucket, window_start, attempts)
      select 'driver:other' || g, date_trunc('minute', now()), 5 from generate_series(1, 100) g`); // 500 tries elsewhere
    await asAnon(db);
    const record = (await rows<{ value: any }>(db, `select public.driver_portal_login($1) value`, [NRIC_A]))[0].value;
    assert.equal(record.driver.id, DRIVER_A);
    await db.exec(`reset role; insert into finance_private.driver_login_limits(bucket, window_start, attempts) values ('driver:flood', date_trunc('minute', now()), 200)`);
    await asAnon(db);
    await assert.rejects(db.query(`select public.driver_portal_login($1)`, [NRIC_A]), /Too many attempts/);
  } finally { await db.close(); }
});

test('the car list closes to signed-out visitors even if the 29 Sep close file was never run', async () => {
  const db = await setup(async db => {
    // As live after the 29 Sep reopen for Eca Guardian, without the later close
    await db.exec(`drop policy if exists "Staff and admins manage cars" on public.cars;
      grant select, insert, update, delete on public.cars to anon;
      create policy "Enable all access for cars" on public.cars for all using (true) with check (true);
      insert into public.cars(id, "plateNumber") values ('c1', 'XAA1001');`);
  });
  try {
    await asAnon(db);
    await assert.rejects(db.query(`select * from public.cars`), /permission denied/);
    await assert.rejects(db.query(`delete from public.cars`), /permission denied/);
    await asUser(db, STAFF_ID);
    assert.equal(await count(db, `select count(*)::int n from public.cars`), 1, 'staff still see the cars on Fleet');
    await db.exec('reset role');
    assert.deepEqual((await rows<{ policyname: string }>(db, `select policyname from pg_policies where tablename = 'cars'`)).map(r => r.policyname),
      ['Staff and admins manage cars']);
  } finally { await db.close(); }
});

test('the file can safely run twice', async () => {
  const db = await setup();
  try {
    await migrate(db, RELEASE);
    await asUser(db, STAFF_ID);
    await db.query(`update public.drivers set name = 'Fixture Driver A2' where id = $1`, [DRIVER_A]);
    assert.equal(await count(db, `select count(*)::int n from public.driver_changes`), 1, 'one trigger, one log line');
  } finally { await db.close(); }
});
