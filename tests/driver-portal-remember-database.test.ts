import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { database, migrate } from './finance-db-fixture.ts';

const FINANCE = ['20260915084108_secure_profile_roles.sql', '20260915084110_finance_foundation.sql'];
const PORTAL = '20260927090100_driver_portal_phone_screening.sql';
const REMEMBER = '20261007120000_driver_portal_remember.sql';
const DRIVER_A = '10000000-0000-4000-8000-00000000000a';
const NRIC_A = '900101-01-1234';

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
      ('${DRIVER_A}','Fixture Driver A','XAA 1001','${NRIC_A}','2026-08-03','SEWABELI','WEEKLY',52,400);
    insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values
      ('20000000-0000-4000-8000-000000000001','${DRIVER_A}','2026-08-03',400,0,'BANK TRANSFER');`);
  await migrate(db, PORTAL);
  await migrate(db, REMEMBER);
  return db;
}
const asAnon = (db: PGlite) => db.exec('reset role; set role anon');
const call = async (db: PGlite, sql: string, args: unknown[]) => (await db.query<{ value: any }>(sql, args)).rows[0].value;
const login = (db: PGlite, nric: string) => call(db, 'select public.driver_portal_login($1) value', [nric]);
const remember = (db: PGlite, nric: string) => call(db, 'select public.driver_portal_login_remember($1) value', [nric]);
const resume = (db: PGlite, token: string) => call(db, 'select public.driver_portal_resume($1) value', [token]);

test('signing in with "keep me signed in" returns the usual record plus a 30-day token, stored only as a hash', async () => {
  const db = await setup();
  try {
    await asAnon(db);
    const plain = await login(db, NRIC_A);
    assert.deepEqual(Object.keys(plain).sort(), ['driver', 'payment_instructions', 'payments'], 'the normal sign-in is unchanged');
    const signedIn = await remember(db, '900101011234');
    const { session, ...record } = signedIn;
    assert.deepEqual(record, plain);
    assert.match(session.token, /^[0-9a-f]{64}$/);
    const days = (Date.parse(session.expires_at) - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30, `expires in ${days} days`);
    assert.equal(await remember(db, '900101-01-9999'), null);
    await assert.rejects(db.query('select * from finance_private.driver_portal_sessions'), /permission denied/);
    await db.exec('reset role');
    const stored = (await db.query<{ hex: string }>(`select encode(token_hash,'hex') hex from finance_private.driver_portal_sessions`)).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].hex, createHash('sha256').update(session.token).digest('hex'), 'only the SHA-256 of the token is stored');
  } finally { await db.close(); }
});

test('a remembered phone reopens the same record without the NRIC; signing out forgets it', async () => {
  const db = await setup();
  try {
    await asAnon(db);
    const { session, ...record } = await remember(db, NRIC_A);
    const reopened = await resume(db, session.token);
    const { session: again, ...same } = reopened;
    assert.deepEqual(same, record);
    assert.equal(again.expires_at, session.expires_at, 'reopening does not extend the 30 days');
    assert.equal(again.token, undefined, 'the token is not sent back');
    assert.equal(await resume(db, 'f'.repeat(64)), null);
    assert.equal(await resume(db, 'not-a-token'), null);
    await db.query('select public.driver_portal_forget($1)', [session.token]);
    assert.equal(await resume(db, session.token), null);
  } finally { await db.close(); }
});

test('an expired token or a removed driver no longer opens the page', async () => {
  const db = await setup();
  try {
    await asAnon(db);
    const first = (await remember(db, NRIC_A)).session.token;
    const second = (await remember(db, NRIC_A)).session.token;
    await db.exec(`reset role; update finance_private.driver_portal_sessions set expires_at = now() - interval '1 minute'
      where token_hash = sha256(convert_to('${first}','UTF8'))`);
    await asAnon(db);
    assert.equal(await resume(db, first), null);
    assert.ok(await resume(db, second));
    await db.exec(`reset role; delete from public.payments; delete from public.drivers where id = '${DRIVER_A}'`);
    await asAnon(db);
    assert.equal(await resume(db, second), null);
  } finally { await db.close(); }
});

test('the remembered sign-in shares the normal sign-in limit of 10 tries a minute', async () => {
  const db = await setup();
  try {
    await db.exec(`reset role; insert into finance_private.driver_login_limits(bucket,window_start,attempts)
      values ('driver:'||md5('unknown'), date_trunc('minute',now()), 10), ('driver:'||md5('unknown'), date_trunc('minute',now())+interval '1 minute', 10)`);
    await asAnon(db);
    await assert.rejects(remember(db, NRIC_A), /Too many attempts/);
  } finally { await db.close(); }
});

test('the file can safely run twice', async () => {
  const db = await setup();
  try {
    await migrate(db, REMEMBER);
    await asAnon(db);
    assert.ok((await remember(db, NRIC_A)).session.token);
  } finally { await db.close(); }
});
