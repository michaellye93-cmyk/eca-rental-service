import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN_ID, STAFF_ID, asUser, database, migrate } from './finance-db-fixture.ts';

const LOCKDOWN = '20260927090200_close_public_access.sql';
const REOPEN = '20260929010000_reopen_cars_for_guardian.sql';
const CLOSE = '20260929180000_fleet_close_cars.sql';
const OUTSIDER = '00000000-0000-4000-8000-000000000077';
const CAR = `'car-1','PERODUA','BEZZA','TST 1001','2026-10-01','2026-11-01','','','','Own Fleet'`;
const COLUMNS = `id,make,model,"plateNumber","roadtaxExpiry","insuranceExpiry","inspectionExpiry",notes,label,ownership`;

/** The live cars table as Guardian made it (camelCase text columns, open to everyone), then the 27 Sep lock-down and the 29 Sep reopening. */
async function setup() {
  const db = await database();
  await db.exec(`
    create table public.cars(id text primary key, make text, model text, "plateNumber" text, "roadtaxExpiry" text,
      "insuranceExpiry" text, "inspectionExpiry" text, notes text, label text, ownership text);
    alter table public.cars enable row level security;
    create policy "Enable all access for all users" on public.cars for all using (true) with check (true);
    create policy "Enable all access for cars" on public.cars for all using (true) with check (true);
    grant all on public.cars to anon, authenticated, service_role;
    insert into public.cars(${COLUMNS}) values (${CAR});
    insert into auth.users(id,email) values('${OUTSIDER}','outsider@example.test');`);
  await migrate(db, LOCKDOWN);
  await migrate(db, REOPEN);
  return db;
}
const asAnon = (db: PGlite) => db.exec(`reset role; select set_config('request.jwt.claims', '', false); set role anon;`);
const carCount = async (db: PGlite) => (await db.query<{ n: number }>('select count(*)::int n from public.cars')).rows[0].n;
const rollback = async (db: PGlite) => {
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/rollback/20260929_fleet_reopen_cars.sql', import.meta.url), 'utf8'));
};

test('before the switch-off the car list is open to signed-out visitors, as Eca Guardian needs', async () => {
  const db = await setup();
  try {
    await asAnon(db);
    assert.equal(await carCount(db), 1);
  } finally { await db.close(); }
});

test('after the switch-off, signed-out visitors can neither read nor change the car list', async () => {
  const db = await setup();
  try {
    await migrate(db, CLOSE);
    await asAnon(db);
    await assert.rejects(db.query('select id from public.cars'), /permission denied/);
    await assert.rejects(db.query(`insert into public.cars(${COLUMNS}) values ('car-9','X','Y','TST 9','2026-10-01','2026-10-01','','','','Own Fleet')`), /permission denied/);
  } finally { await db.close(); }
});

test('after the switch-off, staff and admins still read, add, edit and delete cars', async () => {
  const db = await setup();
  try {
    await migrate(db, CLOSE);
    await asUser(db, STAFF_ID);
    assert.equal(await carCount(db), 1);
    await db.query(`insert into public.cars(${COLUMNS}) values ('car-2','PERODUA','AXIA','TST 1002','2026-10-01','2026-10-01','','','','Others')`);
    await db.query(`update public.cars set "roadtaxExpiry" = '2027-10-01' where id = 'car-1'`);
    await db.query(`delete from public.cars where id = 'car-2'`);
    await asUser(db, ADMIN_ID);
    const rows = await db.query<{ roadtaxExpiry: string }>('select "roadtaxExpiry" from public.cars');
    assert.deepEqual(rows.rows, [{ roadtaxExpiry: '2027-10-01' }]);
  } finally { await db.close(); }
});

test('a signed-in account without a staff or admin profile sees no cars and cannot add one', async () => {
  const db = await setup();
  try {
    await migrate(db, CLOSE);
    await asUser(db, OUTSIDER);
    assert.equal(await carCount(db), 0);
    await assert.rejects(db.query(`insert into public.cars(${COLUMNS}) values ('car-3','X','Y','TST 3','2026-10-01','2026-10-01','','','','Own Fleet')`), /row-level security/);
  } finally { await db.close(); }
});

test('the switch-off can safely run twice', async () => {
  const db = await setup();
  try {
    await migrate(db, CLOSE);
    await migrate(db, CLOSE);
    await asAnon(db);
    await assert.rejects(db.query('select id from public.cars'), /permission denied/);
    await asUser(db, STAFF_ID);
    assert.equal(await carCount(db), 1);
  } finally { await db.close(); }
});

test('the rollback reopens the car list to signed-out visitors', async () => {
  const db = await setup();
  try {
    await migrate(db, CLOSE);
    await rollback(db);
    await asAnon(db);
    assert.equal(await carCount(db), 1);
  } finally { await db.close(); }
});
