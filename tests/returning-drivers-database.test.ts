import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { STAFF_ID, asUser, database, migrate } from './finance-db-fixture.ts';

const RELEASE = '20261009170000_returning_drivers.sql';

/** The drivers table as production has it: NRIC unique across every record. */
async function setup() {
  const db = await database();
  await db.exec(`alter table public.drivers add column nric text constraint drivers_nric_key unique, add column is_delisted boolean default false;
    insert into public.drivers(id, name, car_plate, nric, is_delisted) values
      ('10000000-0000-4000-8000-00000000000a', 'Fixture Driver A', 'XAA1001', '900101-01-1234', true),
      ('10000000-0000-4000-8000-00000000000b', 'Fixture Driver B', 'XAA1002', '900101-01-5678', false);`);
  return db;
}
const add = (db: PGlite, id: string, nric: string, plate: string) =>
  db.query(`insert into public.drivers(id, name, car_plate, nric) values ($1, 'Fixture Returning', $2, $3)`, [id, plate, nric]);

test('a returning driver (old record delisted) can be added again with the same NRIC, written either way', async () => {
  const db = await setup();
  try {
    await migrate(db, RELEASE);
    await asUser(db, STAFF_ID);
    await add(db, '10000000-0000-4000-8000-00000000000c', '900101011234', 'XAA1003');
    const rows = await db.query<{ n: number }>(`select count(*)::int n from public.drivers where regexp_replace(nric, '\\D', '', 'g') = '900101011234'`);
    assert.equal(rows.rows[0].n, 2);
  } finally { await db.close(); }
});

test('a second ACTIVE driver with the same NRIC is still refused, dashes or not', async () => {
  const db = await setup();
  try {
    await migrate(db, RELEASE);
    await assert.rejects(add(db, '10000000-0000-4000-8000-00000000000d', '900101015678', 'XAA1004'), /drivers_one_active_per_nric/);
  } finally { await db.close(); }
});

test('short placeholder NRICs from the past are not affected', async () => {
  const db = await setup();
  try {
    await migrate(db, RELEASE);
    await add(db, '10000000-0000-4000-8000-00000000000e', '1', 'XAA1005');
    await add(db, '10000000-0000-4000-8000-00000000000f', '1', 'XAA1006');
  } finally { await db.close(); }
});

test('if two active drivers already share an NRIC the rule is skipped, not failed; the file can run twice', async () => {
  const db = await setup();
  try {
    await db.exec(`alter table public.drivers drop constraint drivers_nric_key;
      insert into public.drivers(id, name, car_plate, nric) values ('10000000-0000-4000-8000-000000000010', 'Fixture Twin', 'XAA1007', '900101015678');`);
    await migrate(db, RELEASE);
    assert.equal((await db.query(`select 1 from pg_indexes where indexname = 'drivers_one_active_per_nric'`)).rows.length, 0);
    const clean = await setup();
    try {
      await migrate(clean, RELEASE);
      await migrate(clean, RELEASE);
      assert.equal((await clean.query(`select 1 from pg_indexes where indexname = 'drivers_one_active_per_nric'`)).rows.length, 1);
    } finally { await clean.close(); }
  } finally { await db.close(); }
});
