import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN_ID, STAFF_ID, asUser, database, migrate } from './finance-db-fixture.ts';

const FINANCE = ['20260915084108_secure_profile_roles.sql', '20260915084110_finance_foundation.sql'];
const PORTAL = '20260927090100_driver_portal_phone_screening.sql';
const REMEMBER = '20261007120000_driver_portal_remember.sql';
const RELEASE = '20261009150000_driver_master_and_agreement_copy.sql';
const DRIVER_A = '10000000-0000-4000-8000-00000000000a';
const DRIVER_B = '10000000-0000-4000-8000-00000000000b';
const NRIC_A = '900101-01-1234';
const NRIC_B = '900101-01-5678';
const OUTSIDER = '00000000-0000-4000-8000-000000000077';
const copy = (ref: string) => JSON.stringify({ kind: 'SEWABELI', template: { title: 'Fixture', sections: [] }, values: { agreement_ref: ref } });

async function setup() {
  const db = await database();
  for (const file of FINANCE) await migrate(db, file);
  await db.exec(`reset role;
    alter table public.drivers add column nric text, add column email text, add column address text,
      add column contract_start_date date, add column contract_end_date date, add column category text,
      add column rental_cycle text, add column contract_duration_weeks integer, add column rental_rate numeric,
      add column is_delisted boolean default false, add column delist_date date, add column tags text[],
      add column created_at timestamptz default now();
    insert into public.drivers(id,name,car_plate,nric,contract_start_date,category,rental_cycle,contract_duration_weeks,rental_rate) values
      ('${DRIVER_A}','Fixture Driver A','XAA1001','${NRIC_A}','2026-08-03','SEWABELI','WEEKLY',52,400),
      ('${DRIVER_B}','Fixture Driver B','XAA1002','${NRIC_B}','2026-08-03','SEWA_BIASA','WEEKLY',52,300);
    insert into auth.users(id,email) values('${OUTSIDER}','outsider@example.test');`);
  await migrate(db, PORTAL);
  await migrate(db, REMEMBER);
  await migrate(db, RELEASE);
  return db;
}
const asAnon = (db: PGlite) => db.exec('reset role; set role anon');
const login = async (db: PGlite, nric: string) => (await db.query<{ value: any }>('select public.driver_portal_login($1) value', [nric])).rows[0].value;

test('drivers get the emergency contact and approved driver columns, which staff can fill', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(`update public.drivers set emergency_contact_name = 'Fixture Contact', emergency_contact_phone = '60120000009', approved_driver = 'None' where id = '${DRIVER_A}'`);
    const row = (await db.query<{ emergency_contact_name: string }>(`select emergency_contact_name from public.drivers where id = '${DRIVER_A}'`)).rows[0];
    assert.equal(row.emergency_contact_name, 'Fixture Contact');
  } finally { await db.close(); }
});

test('a driver sees only their own newest agreement copy; none until staff save one', async () => {
  const db = await setup();
  try {
    await asAnon(db);
    const before = await login(db, NRIC_A);
    assert.equal(before.agreement, null);
    assert.deepEqual(Object.keys(before).sort(), ['agreement', 'driver', 'payment_instructions', 'payments']);
    await asUser(db, STAFF_ID);
    await db.query(`insert into public.driver_agreements(driver_id, kind, content, created_at) values ('${DRIVER_A}', 'SEWABELI', $1, now() - interval '1 day')`, [copy('OLD')]);
    await db.query(`insert into public.driver_agreements(driver_id, kind, content) values ('${DRIVER_A}', 'SEWABELI', $1)`, [copy('NEW')]);
    await asAnon(db);
    const after = await login(db, NRIC_A);
    assert.equal(after.agreement.values.agreement_ref, 'NEW');
    assert.ok(after.agreement.created_at);
    assert.equal((await login(db, NRIC_B)).agreement, null, "another driver never sees A's agreement");
    await assert.rejects(db.query('select * from public.driver_agreements'), /permission denied/);
  } finally { await db.close(); }
});

test('copies can be added and read by staff and admins only, and never changed or removed', async () => {
  const db = await setup();
  try {
    await asUser(db, ADMIN_ID);
    await db.query(`insert into public.driver_agreements(driver_id, kind, content) values ('${DRIVER_A}', 'SEWABELI', $1)`, [copy('A1')]);
    await asUser(db, STAFF_ID);
    assert.equal((await db.query('select * from public.driver_agreements')).rows.length, 1);
    await assert.rejects(db.query(`update public.driver_agreements set kind = 'SEWA_BIASA'`), /permission denied/);
    await assert.rejects(db.query('delete from public.driver_agreements'), /permission denied/);
    await asUser(db, OUTSIDER);
    assert.equal((await db.query('select * from public.driver_agreements')).rows.length, 0);
    await assert.rejects(db.query(`insert into public.driver_agreements(driver_id, kind, content) values ('${DRIVER_A}', 'SEWABELI', '{}')`), /row-level security/);
  } finally { await db.close(); }
});

test('the file can safely run twice', async () => {
  const db = await setup();
  try {
    await migrate(db, RELEASE);
    await asAnon(db);
    assert.equal((await login(db, NRIC_A)).driver.name, 'Fixture Driver A');
  } finally { await db.close(); }
});
