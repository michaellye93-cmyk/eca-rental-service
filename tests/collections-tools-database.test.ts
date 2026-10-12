import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN_ID, asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

// Production as it stands after the 12 Oct security file, then the collections tools file.
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
];
const RELEASE = '20261012210000_collections_tools.sql';
const DRIVER_A = '10000000-0000-4000-8000-00000000000a';
const DRIVER_B = '10000000-0000-4000-8000-00000000000b';
const NRIC_A = '900101-01-1234';

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
  await db.exec(`reset role; select set_config('request.jwt.claims','',false);
    insert into public.drivers(id,name,car_plate,nric,contract_start_date,category,rental_cycle,contract_duration_weeks,rental_rate,is_delisted) values
      ('${DRIVER_A}','Fixture Driver A','XAA1001','${NRIC_A}','2026-08-01','SEWABELI','WEEKLY',52,400,false),
      ('${DRIVER_B}','Fixture Driver B','XAB2001','900202-02-2345','2026-08-03','SEWA_BIASA','MONTHLY',12,1500,false);`);
  await migrate(db, RELEASE);
  return db;
}
const rows = async <T,>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const count = async (db: PGlite, sql: string, params: unknown[] = []) => (await rows<{ n: number }>(db, sql, params))[0].n;
const asAnon = (db: PGlite) => db.exec(`reset role; select set_config('request.jwt.claims','',false); set role anon`);

test('F1: a driver carries an optional collection arrangement, tone, language, contact window and note; edits are logged', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`update public.drivers set collection_arrangement = 'Monthly RM1,400 by the 10th', collection_tone = 'FIRM',
      collection_language = 'BM', contact_window = 'after 2pm', collection_note = 'Fixture note' where id = $1`, [DRIVER_B]);
    assert.deepEqual(await rows(db, `select collection_arrangement, collection_tone, collection_language, contact_window, collection_note from public.drivers where id = $1`, [DRIVER_B]),
      [{ collection_arrangement: 'Monthly RM1,400 by the 10th', collection_tone: 'FIRM', collection_language: 'BM', contact_window: 'after 2pm', collection_note: 'Fixture note' }]);
    await assert.rejects(db.query(`update public.drivers set collection_tone = 'ANGRY' where id = $1`, [DRIVER_B]), /drivers_collection_tone/);
    await assert.rejects(db.query(`update public.drivers set collection_arrangement = '' where id = $1`, [DRIVER_B]), /drivers_collection_arrangement_length/);
    await assert.rejects(db.query(`update public.drivers set collection_note = $2 where id = $1`, [DRIVER_B, 'N'.repeat(1001)]), /drivers_collection_note_length/);
    await db.query(`update public.drivers set collection_tone = null where id = $1`, [DRIVER_B]);
    await db.exec('reset role');
    const log = await rows<{ fields: string[] }>(db, `select fields from public.driver_changes where driver_id = $1 and action = 'UPDATE' order by id`, [DRIVER_B]);
    assert.deepEqual(log.map(r => r.fields), [
      ['collection_arrangement', 'collection_language', 'collection_note', 'collection_tone', 'contact_window'],
      ['collection_tone'],
    ], 'the 12 Oct change log picks up the new columns by itself');
  } finally { await db.close(); }
});

test('F1: the driver sign-in never shows the collection arrangement or notes', async () => {
  const db = await setup();
  try {
    await db.query(`update public.drivers set collection_arrangement = 'Weekly', collection_note = 'Internal' where id = $1`, [DRIVER_A]);
    await asAnon(db);
    const record = (await rows<{ value: any }>(db, `select public.driver_portal_login($1) value`, [NRIC_A]))[0].value;
    assert.equal(record.driver.id, DRIVER_A);
    assert.ok(!JSON.stringify(record).includes('Internal') && !JSON.stringify(record).includes('collection'));
  } finally { await db.close(); }
});

test('F2: staff and admins log contacts under their own name; only admins remove one; the public sees nothing', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`insert into public.collection_contacts(driver_id, run_slot, kind, message, logged_by, logged_by_name) values($1, '1PM', 'STATEMENT', 'Sewa XAA1001: ...', $2, 'pretend')`, [DRIVER_A, ADMIN_ID]);
    await db.query(`insert into public.collection_contacts(driver_id, kind, message) values($1, 'NOTE', 'Fixture note')`, [DRIVER_B]);
    const logged = await rows<{ kind: string; run_slot: string | null; logged_by: string; logged_by_name: string; logged_by_role: string; recent: boolean }>(db,
      `select kind, run_slot, logged_by, logged_by_name, logged_by_role, contacted_at > now() - interval '1 minute' recent from public.collection_contacts order by kind desc`);
    assert.deepEqual(logged.map(r => [r.kind, r.run_slot, r.logged_by, r.logged_by_name, r.logged_by_role, r.recent]), [
      ['STATEMENT', '1PM', STAFF_ID, 'Staff', 'staff', true],
      ['NOTE', null, STAFF_ID, 'Staff', 'staff', true],
    ]);
    await assert.rejects(db.query(`insert into public.collection_contacts(driver_id, kind, message) values($1, 'SHOUT', 'x')`, [DRIVER_A]), /check/);
    await assert.rejects(db.query(`insert into public.collection_contacts(driver_id, kind, message) values($1, 'NOTE', '')`, [DRIVER_A]), /check/);
    await assert.rejects(db.query(`insert into public.collection_contacts(driver_id, kind, message, contacted_at) values($1, 'NOTE', 'x', now() + interval '1 day')`, [DRIVER_A]), /future/i);
    await db.query(`insert into public.collection_contacts(driver_id, kind, message, contacted_at) values($1, 'REPLY', 'Driver replied this morning', now() - interval '3 hours')`, [DRIVER_A]);
    await assert.rejects(db.query(`update public.collection_contacts set message = 'changed'`), /permission denied/);
    await db.query(`delete from public.collection_contacts`);
    assert.equal(await count(db, `select count(*)::int n from public.collection_contacts`), 3, 'staff cannot remove a contact');
    await asAnon(db);
    await assert.rejects(db.query(`select * from public.collection_contacts`), /permission denied/);
    await asUser(db, ADMIN_ID);
    await db.query(`delete from public.collection_contacts where kind = 'NOTE'`);
    assert.equal(await count(db, `select count(*)::int n from public.collection_contacts`), 2);
    await db.query(`delete from public.drivers where id = $1`, [DRIVER_A]);
    assert.equal(await count(db, `select count(*)::int n from public.collection_contacts`), 0, 'a deleted driver takes their contacts with them');
  } finally { await db.close(); }
});

test('the file can safely run twice', async () => {
  const db = await setup();
  try {
    await db.query(`update public.drivers set collection_arrangement = 'Keep me' where id = $1`, [DRIVER_A]);
    await migrate(db, RELEASE);
    assert.equal((await rows<{ a: string }>(db, `select collection_arrangement a from public.drivers where id = $1`, [DRIVER_A]))[0].a, 'Keep me');
    assert.equal(await count(db, `select count(*)::int n from pg_constraint where conname = 'drivers_collection_tone'`), 1);
  } finally { await db.close(); }
});
