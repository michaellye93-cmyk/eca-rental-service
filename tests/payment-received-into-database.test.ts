import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN_ID, asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

const RELEASE = '20261020090000_payment_received_into.sql';
const DRIVER = '10000000-0000-4000-8000-00000000000a';
const ACCOUNT_SDN = '20000000-0000-4000-8000-000000000001';
const ACCOUNT_ENT = '20000000-0000-4000-8000-000000000002';

async function setup(): Promise<PGlite> {
  const db = await database();
  await db.exec(`alter table public.payments enable row level security;
    create policy "Staff and admins manage payments" on public.payments for all to authenticated
      using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')))
      with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'staff')));
    insert into public.drivers(id,name,car_plate) values ('${DRIVER}','Fixture Driver A','XAA1001');`);
  await migrate(db, RELEASE);
  // The owner's seed (run by hand in the SQL Editor) adds the real accounts; fixture labels stand in for them here.
  await db.exec(`insert into public.payment_accounts(id,label,entity,sort_order) values
    ('${ACCOUNT_SDN}','Fixture Bank 1001','SDN_BHD',1),('${ACCOUNT_ENT}','Fixture QR','ENTERPRISE',2);`);
  return db;
}

test('staff read the account list but only the SQL Editor changes it', async () => {
  const db = await setup();
  await asUser(db, STAFF_ID);
  const { rows } = await db.query<{ label: string; entity: string }>('select label, entity from public.payment_accounts order by sort_order');
  assert.deepEqual(rows, [{ label: 'Fixture Bank 1001', entity: 'SDN_BHD' }, { label: 'Fixture QR', entity: 'ENTERPRISE' }]);
  await assert.rejects(db.exec(`insert into public.payment_accounts(label,entity) values ('Another','SDN_BHD')`));
  await asUser(db, ADMIN_ID);
  await assert.rejects(db.exec(`update public.payment_accounts set entity = 'ENTERPRISE'`));
});

test('signed-out visitors cannot read the account list', async () => {
  const db = await setup();
  await db.exec(`reset role; set role anon;`);
  await assert.rejects(db.query('select * from public.payment_accounts'));
});

test('a payment keeps the account it was received into, and old payments stay untagged', async () => {
  const db = await setup();
  await db.exec(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values
    ('30000000-0000-4000-8000-000000000001','${DRIVER}','2026-10-01',400,0,'BANK TRANSFER')`);
  await asUser(db, STAFF_ID);
  await db.exec(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method,received_into) values
    ('30000000-0000-4000-8000-000000000002','${DRIVER}','2026-10-08',400,0,'BANK TRANSFER','${ACCOUNT_ENT}')`);
  const { rows } = await db.query<{ received_into: string | null }>('select received_into from public.payments order by date');
  assert.deepEqual(rows.map(r => r.received_into), [null, ACCOUNT_ENT]);
  // Sorting an old payment later
  await db.exec(`update public.payments set received_into = '${ACCOUNT_SDN}' where id = '30000000-0000-4000-8000-000000000001'`);
  // An account that is not on the list is refused
  await assert.rejects(db.exec(`update public.payments set received_into = '20000000-0000-4000-8000-000000000099'`));
});

test('an account in use cannot be deleted, and the file is safe to run again', async () => {
  const db = await setup();
  await db.exec(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method,received_into) values
    ('30000000-0000-4000-8000-000000000003','${DRIVER}','2026-10-08',400,0,'BANK TRANSFER','${ACCOUNT_SDN}')`);
  await assert.rejects(db.exec(`delete from public.payment_accounts where id = '${ACCOUNT_SDN}'`));
  await migrate(db, RELEASE);
  const { rows } = await db.query<{ n: number }>('select count(*)::int as n from public.payment_accounts');
  assert.equal(rows[0].n, 2);
});
