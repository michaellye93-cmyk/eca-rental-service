import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ADMIN_ID, asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

const FINANCE = ['20260915084108_secure_profile_roles.sql', '20260915084110_finance_foundation.sql'];
const PORTAL = '20260927090100_driver_portal_phone_screening.sql';
const LOCKDOWN = '20260927090200_close_public_access.sql';
const DRIVER_A = '10000000-0000-4000-8000-00000000000a';
const DRIVER_B = '10000000-0000-4000-8000-00000000000b';
const NRIC_A = '900101-01-1234';

/** The fixture's drivers table grows the production columns the app reads; the old open access is recreated too. */
async function setup() {
  const db = await database();
  for (const file of FINANCE) await migrate(db, file);
  await db.exec(`reset role;
    alter table public.drivers add column nric text, add column email text, add column address text,
      add column contract_start_date date, add column contract_end_date date, add column category text,
      add column rental_cycle text, add column contract_duration_weeks integer, add column rental_rate numeric,
      add column is_delisted boolean default false, add column delist_date date, add column tags text[],
      add column created_at timestamptz default now();
    alter table public.drivers enable row level security;
    alter table public.payments enable row level security;
    create policy "Enable read access for all users" on public.drivers for all using (true) with check (true);
    create policy "Enable read access for all users" on public.payments for all using (true) with check (true);
    insert into public.drivers(id,name,car_plate,nric,email,address,contract_start_date,category,rental_cycle,contract_duration_weeks,rental_rate,tags,created_at) values
      ('${DRIVER_A}','Fixture Driver A','XAA 1001','${NRIC_A}','a@example.test','1 Fixture Road','2026-08-03','SEWABELI','WEEKLY',52,400,'{SUN}',now()-interval '2 days'),
      ('${DRIVER_B}','Fixture Driver B','XAB 2001','900202-02-2345','b@example.test','2 Fixture Road','2026-08-03','SEWA_BIASA','MONTHLY',12,1500,'{}',now());
    insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values
      ('20000000-0000-4000-8000-000000000001','${DRIVER_A}','2026-08-03',400,0,'BANK TRANSFER'),
      ('20000000-0000-4000-8000-000000000002','${DRIVER_A}','2026-08-10',300,100,'CASH DEPOSIT'),
      ('20000000-0000-4000-8000-000000000003','${DRIVER_B}','2026-08-03',1500,0,'BANK TRANSFER');
    -- Unused leftovers that exist in production and read everything with the owner's rights
    create function public.test_get_drivers() returns jsonb language plpgsql security definer as $$begin return (select jsonb_agg(d) from public.drivers d);end;$$;
    create function public.reconcile_bank_statement(batch_transactions jsonb) returns jsonb language plpgsql security definer as $$begin return (select jsonb_agg(p) from public.payments p);end;$$;
    create table public.fleet_snapshots(id uuid primary key, snapshot_date date, good_count integer);
    alter table public.fleet_snapshots enable row level security;
    create policy "Enable all access for fleet_snapshots" on public.fleet_snapshots for all using (true) with check (true);
    grant all on public.fleet_snapshots to anon, authenticated;`);
  await migrate(db, PORTAL);
  return db;
}
const asAnon = (db: PGlite) => db.exec('reset role; set role anon');
const login = async (db: PGlite, nric: string) => (await db.query<{ value: any }>('select public.driver_portal_login($1) value', [nric])).rows[0].value;

test('a driver signs in with their NRIC and gets only their own contract and payments', async () => {
  const db = await setup();
  try {
    await asAnon(db);
    const portal = await login(db, '900101011234');
    assert.deepEqual(Object.keys(portal).sort(), ['driver', 'payment_instructions', 'payments']);
    assert.equal(portal.driver.id, DRIVER_A);
    assert.equal(portal.driver.car_plate, 'XAA 1001');
    assert.equal(portal.driver.rental_cycle, 'WEEKLY');
    for (const hidden of ['nric', 'address', 'email', 'phone', 'tags', 'created_at']) assert.equal(hidden in portal.driver, false, hidden);
    assert.deepEqual(portal.payments.map((p: any) => [p.id.slice(-1), Number(p.amount), Number(p.service_claim)]), [['2', 300, 100], ['1', 400, 0]]);
    assert.equal(portal.payment_instructions, null);
    assert.equal(await login(db, '900101-01-9999'), null);
    assert.equal(await login(db, '12'), null);
    assert.equal(await login(db, '---'), null);
  } finally { await db.close(); }
});

test('driver sign-in is limited to 10 tries a minute per connection', async () => {
  const db = await setup();
  try {
    // Without request headers every caller shares the "unknown" bucket. Fill this minute and the next, so the test does
    // not depend on the clock turning over mid-test.
    await db.exec(`reset role; insert into finance_private.driver_login_limits(bucket,window_start,attempts)
      values ('driver:'||md5('unknown'), date_trunc('minute',now()), 10), ('driver:'||md5('unknown'), date_trunc('minute',now())+interval '1 minute', 10)`);
    await asAnon(db);
    await assert.rejects(login(db, NRIC_A), /Too many attempts/);
    await assert.rejects(db.query('select * from finance_private.driver_login_limits'), /permission denied/);
  } finally { await db.close(); }
});

test('Admins set the payment instructions drivers see; staff and the public cannot', async () => {
  const db = await setup();
  try {
    await asUser(db);
    assert.equal((await db.query<{ value: string }>(`select public.finance_save_portal_instructions($1) value`, ['  Pay by bank transfer and send the receipt to the office.  '])).rows[0].value,
      'Pay by bank transfer and send the receipt to the office.');
    assert.equal((await db.query<{ value: string }>(`select public.finance_portal_instructions() value`)).rows[0].value, 'Pay by bank transfer and send the receipt to the office.');
    await asUser(db, STAFF_ID);
    await assert.rejects(db.query(`select public.finance_save_portal_instructions('staff text')`), /Admin/);
    await asAnon(db);
    assert.equal((await login(db, NRIC_A)).payment_instructions, 'Pay by bank transfer and send the receipt to the office.');
    await assert.rejects(db.query(`select public.finance_portal_instructions()`), /permission denied/);
    await asUser(db);
    assert.equal((await db.query<{ value: string | null }>(`select public.finance_save_portal_instructions('   ') value`)).rows[0].value, null);
  } finally { await db.close(); }
});

test('screening is shared: staff record their own, everyone signed in sees it, the public does not', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`insert into public.driver_screenings(driver_id,screened_on) values($1,'2026-09-27') on conflict do nothing`, [DRIVER_A]);
    await db.query(`insert into public.driver_screenings(driver_id,screened_on) values($1,'2026-09-27') on conflict do nothing`, [DRIVER_A]);
    await assert.rejects(db.query(`insert into public.driver_screenings(driver_id,screened_on,screened_by) values($1,'2026-09-27',$2)`, [DRIVER_B, ADMIN_ID]), /row-level security/);
    await asUser(db);
    const rows = await db.query<{ driver_id: string; screened_by: string }>(`select driver_id, screened_by from public.driver_screenings`);
    assert.deepEqual(rows.rows, [{ driver_id: DRIVER_A, screened_by: STAFF_ID }]);
    await asAnon(db);
    await assert.rejects(db.query(`select * from public.driver_screenings`), /permission denied/);
    await db.exec('reset role');
    await db.query(`delete from public.payments where driver_id=$1`, [DRIVER_A]);
    await db.query(`delete from public.drivers where id=$1`, [DRIVER_A]);
    assert.equal((await db.query(`select 1 from public.driver_screenings`)).rows.length, 0);
  } finally { await db.close(); }
});

test('phone numbers are stored as 60 followed by 8 to 11 digits', async () => {
  const db = await setup();
  try {
    await db.query(`update public.drivers set phone='60123456789' where id=$1`, [DRIVER_A]);
    await assert.rejects(db.query(`update public.drivers set phone='012-345 6789' where id=$1`, [DRIVER_A]), /drivers_phone_format/);
  } finally { await db.close(); }
});

test('the unused functions and snapshot table that exposed records are closed to the public', async () => {
  const db = await setup();
  try {
    await asAnon(db);
    await assert.rejects(db.query(`select public.test_get_drivers()`), /permission denied/);
    await assert.rejects(db.query(`select public.reconcile_bank_statement('[]'::jsonb)`), /permission denied/);
    await assert.rejects(db.query(`select * from public.fleet_snapshots`), /permission denied/);
    // The old site keeps working until the lock-down file: records are still readable before sign-in.
    assert.equal((await db.query(`select id from public.drivers`)).rows.length, 2);
  } finally { await db.close(); }
});

test('the drivers id check stops the file before any change when ids are not uuids', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema finance_private; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
      create table public.profiles(id uuid primary key, role text);
      create table public.drivers(id text primary key, nric text, created_at timestamptz);`);
    await assert.rejects(migrate(db, PORTAL), /not a uuid/);
    await db.exec('rollback');
    assert.equal((await db.query(`select 1 from information_schema.columns where table_name='drivers' and column_name='phone'`)).rows.length, 0);
  } finally { await db.close(); }
});

test('after the lock-down, only signed-in staff and admins reach drivers and payments; Finance still reads them', async () => {
  const db = await setup();
  try {
    await migrate(db, '20260915085705_finance_bank_statements.sql');
    await migrate(db, LOCKDOWN);
    await asAnon(db);
    await assert.rejects(db.query(`select id from public.drivers`), /permission denied/);
    await assert.rejects(db.query(`select id from public.payments`), /permission denied/);
    assert.equal((await login(db, NRIC_A)).driver.id, DRIVER_A);
    await asUser(db, STAFF_ID);
    assert.equal((await db.query(`select id from public.drivers`)).rows.length, 2);
    await db.query(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values('20000000-0000-4000-8000-000000000009',$1,'2026-09-01',400,0,'BANK TRANSFER')`, [DRIVER_A]);
    await asUser(db);
    const refreshed = (await db.query<{ value: any }>(`select public.finance_refresh_payments('2026-08-01') value`)).rows[0].value;
    assert.equal(refreshed.ehailing.length, 3);
    // A signed-in account without a staff or admin role sees nothing and cannot write.
    await db.exec(`reset role; insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000077','other@example.test')`);
    await asUser(db, '00000000-0000-4000-8000-000000000077');
    assert.equal((await db.query(`select id from public.drivers`)).rows.length, 0);
    await assert.rejects(db.query(`insert into public.payments(id,driver_id,date,amount) values('20000000-0000-4000-8000-000000000010',$1,'2026-09-02',1)`, [DRIVER_A]), /row-level security/);
  } finally { await db.close(); }
});

test('the rollback file reopens public access if the new site has to be rolled back', async () => {
  const db = await setup();
  try {
    await migrate(db, LOCKDOWN);
    const { readFile } = await import('node:fs/promises');
    await db.exec(await readFile(new URL('../supabase/rollback/20260927_reopen_public_access.sql', import.meta.url), 'utf8'));
    await asAnon(db);
    assert.equal((await db.query(`select id from public.drivers`)).rows.length, 2);
  } finally { await db.close(); }
});
