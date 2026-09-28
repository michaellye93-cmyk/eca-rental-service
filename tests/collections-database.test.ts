import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { ADMIN_ID, asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

const FINANCE = ['20260915084108_secure_profile_roles.sql', '20260915084110_finance_foundation.sql'];
const PORTAL = '20260927090100_driver_portal_phone_screening.sql';
const LOCKDOWN = '20260927090200_close_public_access.sql';
const COLLECTIONS = '20260929090000_collections_support.sql';
const DRIVER_A = '10000000-0000-4000-8000-00000000000a';
const DRIVER_B = '10000000-0000-4000-8000-00000000000b';
const PAYMENT_1 = '20000000-0000-4000-8000-000000000001';
const NEW_PAYMENT = '20000000-0000-4000-8000-0000000000f1';
const NRIC_A = '900101-01-1234';

/** Production as it stands (Finance, portal and lock-down files, spaced plates), then the collections file. */
async function setup() {
  const db = await database();
  for (const file of FINANCE) await migrate(db, file);
  await db.exec(`reset role;
    alter table public.drivers add column nric text, add column email text, add column address text,
      add column contract_start_date date, add column contract_end_date date, add column category text,
      add column rental_cycle text, add column contract_duration_weeks integer, add column rental_rate numeric,
      add column is_delisted boolean default false, add column delist_date date, add column tags text[],
      add column created_at timestamptz default now();
    alter table public.payments add column created_at timestamptz default now();
    insert into public.drivers(id,name,car_plate,nric,contract_start_date,category,rental_cycle,contract_duration_weeks,rental_rate,tags) values
      ('${DRIVER_A}','Fixture Driver A','XAA 1001','${NRIC_A}','2026-08-01','SEWABELI','WEEKLY',52,400,'{SAT}'),
      ('${DRIVER_B}','Fixture Driver B','xab2001','900202-02-2345','2026-08-03','SEWA_BIASA','MONTHLY',12,1500,'{MONTHLY}');
    insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values
      ('${PAYMENT_1}','${DRIVER_A}','2026-08-01',400,0,'BANK TRANSFER');`);
  await migrate(db, PORTAL);
  await migrate(db, LOCKDOWN);
  await migrate(db, COLLECTIONS);
  return db;
}
const asAnon = (db: PGlite) => db.exec(`reset role; select set_config('request.jwt.claims','',false); set role anon`);
/** The SQL Editor: the owner's role with no signed-in account. */
const asSqlEditor = (db: PGlite) => db.exec(`reset role; select set_config('request.jwt.claims','',false)`);
const rows = async <T,>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

test('plates are stored in capitals without spaces: existing ones are converted and their old spelling kept', async () => {
  const db = await setup();
  try {
    await asSqlEditor(db);
    assert.deepEqual((await rows<{ car_plate: string }>(db, `select car_plate from public.drivers order by id`)).map(r => r.car_plate), ['XAA1001', 'XAB2001']);
    assert.deepEqual(await rows(db, `select driver_id, old_plate, new_plate from finance_private.plate_conversion_backup order by driver_id`), [
      { driver_id: DRIVER_A, old_plate: 'XAA 1001', new_plate: 'XAA1001' },
      { driver_id: DRIVER_B, old_plate: 'xab2001', new_plate: 'XAB2001' },
    ]);
    await asUser(db, STAFF_ID);
    await db.query(`insert into public.drivers(id,name,car_plate,nric) values('10000000-0000-4000-8000-00000000000c','Fixture Driver C','xac  3001','900303-03-3456')`);
    await db.query(`update public.drivers set car_plate = 'xad 3002' where id = $1`, [DRIVER_B]);
    await db.query(`update public.drivers set name = 'Fixture Driver A2' where id = $1`, [DRIVER_A]);
    assert.deepEqual((await rows<{ car_plate: string }>(db, `select car_plate from public.drivers order by id`)).map(r => r.car_plate), ['XAA1001', 'XAD3002', 'XAC3001']);
    // Finance's vehicle key is the same text, so vehicles still match; hyphens are left alone as Finance leaves them
    await db.query(`update public.drivers set car_plate = 'xae-3003' where id = $1`, [DRIVER_B]);
    assert.equal((await rows<{ car_plate: string }>(db, `select car_plate from public.drivers where id = $1`, [DRIVER_B]))[0].car_plate, 'XAE-3003');
    await assert.rejects(db.query(`select * from finance_private.plate_conversion_backup`), /permission denied/);
  } finally { await db.close(); }
});

test('every payment added, edited or deleted is logged with who did it, when, and the values before and after', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values($1,$2,'2026-09-28',450,0,'BANK TRANSFER')`, [NEW_PAYMENT, DRIVER_A]);
    await db.query(`update public.payments set amount = 500, date = '2026-09-27' where id = $1`, [NEW_PAYMENT]);
    await db.query(`update public.payments set amount = 500 where id = $1`, [NEW_PAYMENT]); // nothing changed: not logged
    await asUser(db, ADMIN_ID);
    await db.query(`delete from public.payments where id = $1`, [NEW_PAYMENT]);
    await asSqlEditor(db);
    await db.query(`update public.payments set amount = 410 where id = $1`, [PAYMENT_1]);

    const log = await rows<{ payment_id: string; driver_id: string; action: string; changed_by: string | null; changed_by_name: string; changed_by_role: string | null; before: any; after: any }>(db,
      `select payment_id, driver_id, action, changed_by, changed_by_name, changed_by_role, before, after from public.payment_changes order by id`);
    assert.deepEqual(log.map(r => [r.payment_id, r.action, r.changed_by, r.changed_by_name, r.changed_by_role]), [
      [NEW_PAYMENT, 'INSERT', STAFF_ID, 'Staff', 'staff'],
      [NEW_PAYMENT, 'UPDATE', STAFF_ID, 'Staff', 'staff'],
      [NEW_PAYMENT, 'DELETE', ADMIN_ID, 'Admin', 'admin'],
      [PAYMENT_1, 'UPDATE', null, 'Database (SQL Editor)', null],
    ]);
    assert.ok(log.every(r => r.driver_id === DRIVER_A));
    // Only the role is kept, never the account's username or email (a username can look like an Access ID)
    assert.equal((await rows(db, `select 1 from public.payment_changes c where c.changed_by_name in (select username from public.profiles) or c.changed_by_name like '%@%'`)).length, 0);
    assert.equal(log[0].before, null);
    assert.equal(Number(log[0].after.amount), 450);
    assert.deepEqual([Number(log[1].before.amount), log[1].before.date, Number(log[1].after.amount), log[1].after.date], [450, '2026-09-28', 500, '2026-09-27']);
    assert.equal(Number(log[2].before.amount), 500);
    assert.equal(log[2].after, null);
    assert.ok('created_at' in log[0].after, 'the whole row is kept, including when it was typed');
  } finally { await db.close(); }
});

test('a save is never blocked by the log: a server caller with no profile is logged as an unknown account', async () => {
  const db = await setup();
  try {
    await db.exec('reset role; set role service_role');
    await db.query(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: '00000000-0000-4000-8000-0000000000ff', role: 'service_role' })]);
    await db.query(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values($1,$2,'2026-09-28',450,0,'CASH DEPOSIT')`, [NEW_PAYMENT, DRIVER_A]);
    await asSqlEditor(db);
    assert.deepEqual(await rows(db, `select action, changed_by_name, changed_by_role from public.payment_changes`), [{ action: 'INSERT', changed_by_name: 'Unknown account', changed_by_role: null }]);
  } finally { await db.close(); }
});

test('the change log is read-only: staff and admins read it, nobody writes it, the public sees nothing', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`update public.payments set amount = 420 where id = $1`, [PAYMENT_1]);
    assert.equal((await rows(db, `select id from public.payment_changes`)).length, 1);
    await assert.rejects(db.query(`insert into public.payment_changes(payment_id, action, changed_by_name) values($1,'INSERT','someone')`, [PAYMENT_1]), /permission denied/);
    await assert.rejects(db.query(`update public.payment_changes set changed_by_name = 'someone else'`), /permission denied/);
    await assert.rejects(db.query(`delete from public.payment_changes`), /permission denied/);
    await asUser(db, ADMIN_ID);
    await assert.rejects(db.query(`delete from public.payment_changes`), /permission denied/);
    await asAnon(db);
    await assert.rejects(db.query(`select * from public.payment_changes`), /permission denied/);
    await assert.rejects(db.query(`select finance_private.actor_name()`), /permission denied/);
  } finally { await db.close(); }
});

test('payments take an optional reference and drivers an optional WhatsApp group; the driver portal shows neither', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`update public.payments set reference = 'DN20260801XAA' where id = $1`, [PAYMENT_1]);
    await db.query(`update public.drivers set whatsapp_group = 'FIXTURE XAA1001 SAT' where id = $1`, [DRIVER_A]);
    await assert.rejects(db.query(`update public.payments set reference = $2 where id = $1`, [PAYMENT_1, 'R'.repeat(101)]), /payments_reference_length/);
    await assert.rejects(db.query(`update public.payments set reference = '' where id = $1`, [PAYMENT_1]), /payments_reference_length/);
    await assert.rejects(db.query(`update public.drivers set whatsapp_group = $2 where id = $1`, [DRIVER_A, 'G'.repeat(101)]), /drivers_whatsapp_group_length/);
    await asAnon(db);
    const portal = (await rows<{ value: any }>(db, `select public.driver_portal_login($1) value`, [NRIC_A]))[0].value;
    assert.equal(portal.driver.car_plate, 'XAA1001');
    assert.equal('whatsapp_group' in portal.driver, false);
    assert.ok(portal.payments.length > 0);
    for (const payment of portal.payments) assert.deepEqual(Object.keys(payment).sort(), ['amount', 'date', 'id', 'payment_method', 'service_claim']);
  } finally { await db.close(); }
});

test('bank-in details for statements: everyone signed in reads them, only admins set them', async () => {
  const db = await setup();
  try {
    await asUser(db, ADMIN_ID);
    await db.query(`insert into public.collection_settings(key, value, updated_by_name) values('bank_in_sewabeli', 'Fixture Bank 000-000-000 (ECA)', 'pretend')`);
    await db.query(`insert into public.collection_settings(key, value) values('bank_in_sewa_biasa', 'Fixture Bank 111') on conflict (key) do update set value = excluded.value`);
    await db.query(`insert into public.collection_settings(key, value) values('bank_in_sewa_biasa', 'Fixture Bank 222') on conflict (key) do update set value = excluded.value`);
    await assert.rejects(db.query(`insert into public.collection_settings(key, value) values('something_else', 'x')`), /check/);
    await asUser(db, STAFF_ID);
    assert.deepEqual(await rows(db, `select key, value, updated_by, updated_by_name, updated_by_role from public.collection_settings order by key`), [
      { key: 'bank_in_sewa_biasa', value: 'Fixture Bank 222', updated_by: ADMIN_ID, updated_by_name: 'Admin', updated_by_role: 'admin' },
      { key: 'bank_in_sewabeli', value: 'Fixture Bank 000-000-000 (ECA)', updated_by: ADMIN_ID, updated_by_name: 'Admin', updated_by_role: 'admin' },
    ]);
    await assert.rejects(db.query(`insert into public.collection_settings(key, value) values('bank_in_sewabeli', 'Staff Bank') on conflict (key) do update set value = excluded.value`), /row-level security/);
    await db.query(`update public.collection_settings set value = 'Staff Bank'`);
    await db.query(`delete from public.collection_settings`);
    assert.equal((await rows(db, `select 1 from public.collection_settings where value like 'Fixture Bank%'`)).length, 2, 'staff changes nothing');
    await asAnon(db);
    await assert.rejects(db.query(`select * from public.collection_settings`), /permission denied/);
  } finally { await db.close(); }
});

test('promises to pay: staff and admins log them under their own name, only admins remove them, the public sees nothing', async () => {
  const db = await setup();
  try {
    const today = (await rows<{ d: string }>(db, `select to_char((now() at time zone 'Asia/Kuala_Lumpur')::date, 'YYYY-MM-DD') d`))[0].d;
    await asUser(db, STAFF_ID);
    await db.query(`insert into public.payment_promises(driver_id, amount, promised_date, note, logged_by, logged_by_name) values($1, 900, (now() at time zone 'Asia/Kuala_Lumpur')::date + 2, 'After Friday trips', $2, 'pretend')`, [DRIVER_A, ADMIN_ID]);
    const [promise] = await rows<{ id: string; logged_by: string; logged_by_name: string; logged_by_role: string; logged_on: string; amount: string }>(db,
      `select id, logged_by, logged_by_name, logged_by_role, to_char(logged_on, 'YYYY-MM-DD') logged_on, amount from public.payment_promises`);
    assert.deepEqual([promise.logged_by, promise.logged_by_name, promise.logged_by_role, promise.logged_on, Number(promise.amount)], [STAFF_ID, 'Staff', 'staff', today, 900]);
    await assert.rejects(db.query(`insert into public.payment_promises(driver_id, amount, promised_date) values($1, 100, (now() at time zone 'Asia/Kuala_Lumpur')::date - 1)`, [DRIVER_A]), /promised date/i);
    await assert.rejects(db.query(`insert into public.payment_promises(driver_id, amount, promised_date) values($1, 0, (now() at time zone 'Asia/Kuala_Lumpur')::date)`, [DRIVER_A]), /check/);
    await assert.rejects(db.query(`update public.payment_promises set amount = 1`), /permission denied/);
    await db.query(`delete from public.payment_promises`);
    assert.equal((await rows(db, `select 1 from public.payment_promises`)).length, 1, 'staff cannot remove a promise');
    await asAnon(db);
    await assert.rejects(db.query(`select * from public.payment_promises`), /permission denied/);
    await asUser(db, ADMIN_ID);
    await db.query(`delete from public.payment_promises where id = $1`, [promise.id]);
    assert.equal((await rows(db, `select 1 from public.payment_promises`)).length, 0);
  } finally { await db.close(); }
});

test('catch-up plans: admins create, change and stop them, staff read them, and a driver has one running plan at a time', async () => {
  const db = await setup();
  try {
    await asUser(db, ADMIN_ID);
    await db.query(`insert into public.catch_up_plans(driver_id, extra_per_cycle, start_date, note) values($1, 100, '2026-09-28', 'Agreed by phone')`, [DRIVER_A]);
    await assert.rejects(db.query(`insert into public.catch_up_plans(driver_id, extra_per_cycle, start_date) values($1, 50, '2026-10-05')`, [DRIVER_A]), /catch_up_plans_one_running/);
    await assert.rejects(db.query(`insert into public.catch_up_plans(driver_id, extra_per_cycle, start_date, end_date) values($1, 50, '2026-10-05', '2026-10-01')`, [DRIVER_B]), /check/);
    await assert.rejects(db.query(`update public.catch_up_plans set created_by_name = 'Someone else'`), /permission denied/);
    await db.query(`update public.catch_up_plans set stopped_on = '2026-10-04' where driver_id = $1`, [DRIVER_A]);
    await db.query(`insert into public.catch_up_plans(driver_id, extra_per_cycle, start_date, end_date) values($1, 150, '2026-10-05', '2026-12-31')`, [DRIVER_A]);
    await asUser(db, STAFF_ID);
    assert.deepEqual((await rows<{ extra: string; by: string; role: string }>(db, `select extra_per_cycle extra, created_by_name by, created_by_role role from public.catch_up_plans order by start_date`)).map(r => [Number(r.extra), r.by, r.role]),
      [[100, 'Admin', 'admin'], [150, 'Admin', 'admin']]);
    await assert.rejects(db.query(`insert into public.catch_up_plans(driver_id, extra_per_cycle, start_date) values($1, 50, '2026-10-05')`, [DRIVER_B]), /row-level security/);
    await assert.rejects(db.query(`update public.catch_up_plans set extra_per_cycle = 1`), /permission denied/);
    await db.query(`update public.catch_up_plans set note = 'Staff note', stopped_on = '2026-10-10'`);
    await db.query(`delete from public.catch_up_plans`);
    assert.deepEqual((await rows<{ extra: string; note: string | null; stopped: string | null }>(db, `select extra_per_cycle extra, note, to_char(stopped_on, 'YYYY-MM-DD') stopped from public.catch_up_plans order by start_date`))
      .map(r => [Number(r.extra), r.note, r.stopped]), [[100, 'Agreed by phone', '2026-10-04'], [150, null, null]], 'staff changes nothing');
    await asAnon(db);
    await assert.rejects(db.query(`select * from public.catch_up_plans`), /permission denied/);
  } finally { await db.close(); }
});

test('running the file a second time changes nothing and does not fail', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`update public.payments set amount = 430 where id = $1`, [PAYMENT_1]);
    await asSqlEditor(db);
    await migrate(db, COLLECTIONS);
    assert.equal((await rows(db, `select 1 from public.payment_changes`)).length, 1);
    assert.equal((await rows(db, `select 1 from finance_private.plate_conversion_backup`)).length, 2);
    assert.equal((await rows<{ n: number }>(db, `select count(*)::int n from pg_trigger where tgname in ('payments_log_change', 'drivers_normalize_plate')`))[0].n, 2);
  } finally { await db.close(); }
});

test('the rollback file stops converting plates and gives them back their old spelling, unless changed again since', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`update public.drivers set car_plate = 'XAF 4004' where id = $1`, [DRIVER_B]); // changed after the release
    await db.query(`update public.payments set reference = 'KEEP1' where id = $1`, [PAYMENT_1]);
    await asSqlEditor(db);
    await db.exec(await readFile(new URL('../supabase/rollback/20260929_collections_support_rollback.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await rows<{ car_plate: string }>(db, `select car_plate from public.drivers order by id`)).map(r => r.car_plate), ['XAA 1001', 'XAF4004']);
    await db.query(`update public.drivers set car_plate = 'xag 5005' where id = $1`, [DRIVER_B]);
    assert.equal((await rows<{ car_plate: string }>(db, `select car_plate from public.drivers where id = $1`, [DRIVER_B]))[0].car_plate, 'xag 5005');
    assert.equal((await rows<{ reference: string }>(db, `select reference from public.payments where id = $1`, [PAYMENT_1]))[0].reference, 'KEEP1', 'typed data stays');
  } finally { await db.close(); }
});
