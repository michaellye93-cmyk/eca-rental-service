import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_ID, STAFF_ID, asUser, database, migrate } from './finance-db-fixture.ts';

const RELEASE = '20261009090000_vehicle_details_and_agreements.sql';
const OUTSIDER = '00000000-0000-4000-8000-000000000077';
const DETAILS = `insert into public.car_details(car_id, chassis_no, colour, owner_name, owner_id) values ('car-1','FIXTURECHASSIS1','WHITE','Fixture Owner','000000-00-0000')`;

/** The cars table as Guardian made it (text id primary key), closed to staff and admins, then this release. */
async function setup() {
  const db = await database();
  await db.exec(`
    create table public.cars(id text primary key, make text, model text, "plateNumber" text);
    alter table public.cars enable row level security;
    grant all on public.cars to authenticated;
    create policy "Staff and admins manage cars" on public.cars for all to authenticated
      using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff')))
      with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff')));
    insert into public.cars values ('car-1','PERODUA','BEZZA','XAA1001'), ('car-2','PERODUA','AXIA','XAA1002');
    insert into auth.users(id,email) values('${OUTSIDER}','outsider@example.test');`);
  await migrate(db, RELEASE);
  return db;
}

test("staff add, read and change a car's details, and admins see them", async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    await db.query(DETAILS);
    await db.query(`update public.car_details set registered_date = '2024-01-15' where car_id = 'car-1'`);
    await asUser(db, ADMIN_ID);
    const rows = await db.query<{ owner_name: string; registered_date: string }>(`select owner_name, registered_date::text from public.car_details`);
    assert.deepEqual(rows.rows, [{ owner_name: 'Fixture Owner', registered_date: '2024-01-15' }]);
  } finally { await db.close(); }
});

test('other accounts can neither see nor write the details; signed-out visitors are refused', async () => {
  const db = await setup();
  try {
    await asUser(db, ADMIN_ID);
    await db.query(DETAILS);
    await db.query(`insert into public.agreement_settings(key, value) values ('company', '{}')`);
    await asUser(db, OUTSIDER);
    assert.equal((await db.query('select * from public.car_details')).rows.length, 0);
    assert.equal((await db.query('select * from public.agreement_settings')).rows.length, 0);
    await assert.rejects(db.query(`insert into public.car_details(car_id) values ('car-2')`), /row-level security/);
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false); set role anon;`);
    await assert.rejects(db.query('select * from public.car_details'), /permission denied/);
    await assert.rejects(db.query('select * from public.agreement_settings'), /permission denied/);
  } finally { await db.close(); }
});

test('deleting a car removes its details', async () => {
  const db = await setup();
  try {
    await asUser(db, ADMIN_ID);
    await db.query(DETAILS);
    await asUser(db, STAFF_ID);
    await db.query(`delete from public.cars where id = 'car-1'`);
    await asUser(db, ADMIN_ID);
    assert.equal((await db.query('select * from public.car_details')).rows.length, 0);
  } finally { await db.close(); }
});

test('staff read templates but cannot change them', async () => {
  const db = await setup();
  try {
    await asUser(db, ADMIN_ID);
    await db.query(`insert into public.agreement_settings(key, value) values ('company', '{"company_name":"Fixture Co"}')`);
    await asUser(db, STAFF_ID);
    assert.equal((await db.query('select * from public.agreement_settings')).rows.length, 1);
    await assert.rejects(db.query(`insert into public.agreement_settings(key, value) values ('template:SEWABELI', '{}')`), /row-level security/);
    await db.query(`update public.agreement_settings set value = '{}'`);
    await db.query(`delete from public.agreement_settings`);
    await asUser(db, ADMIN_ID);
    const rows = await db.query<{ value: { company_name: string } }>('select value from public.agreement_settings');
    assert.equal(rows.rows[0].value.company_name, 'Fixture Co', 'a staff update or delete changes nothing');
  } finally { await db.close(); }
});

test('admins save templates and company details; other keys are refused', async () => {
  const db = await setup();
  try {
    await asUser(db, ADMIN_ID);
    await db.query(`insert into public.agreement_settings(key, value) values ('template:SEWA_BIASA', '{"sections":[]}'), ('company', '{"company_name":"Fixture Co"}')`);
    await db.query(`insert into public.agreement_settings(key, value) values ('company', '{"company_name":"Fixture Co 2"}') on conflict (key) do update set value = excluded.value`);
    const rows = await db.query<{ value: { company_name: string } }>(`select value from public.agreement_settings where key = 'company'`);
    assert.equal(rows.rows[0].value.company_name, 'Fixture Co 2');
    await assert.rejects(db.query(`insert into public.agreement_settings(key, value) values ('other', '{}')`), /check constraint/);
  } finally { await db.close(); }
});

test('the file can safely run twice', async () => {
  const db = await setup();
  try {
    await migrate(db, RELEASE);
    await asUser(db, ADMIN_ID);
    await db.query(DETAILS);
  } finally { await db.close(); }
});
