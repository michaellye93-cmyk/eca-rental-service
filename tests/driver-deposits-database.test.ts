import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

// Production as it stands (to the split-match file of 2026-10-06), then the deposits file.
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
];
const RELEASE = '20261006200000_driver_deposits.sql';
const DRIVER_A = '10000000-0000-4000-8000-00000000000a';
const RENT = '20000000-0000-4000-8000-000000000001';
const august = '2026-08-01';

async function setup() {
  const db = await database();
  await db.exec(`alter table public.drivers add column nric text, add column contract_start_date date, add column contract_end_date date,
    add column category text, add column rental_cycle text, add column contract_duration_weeks integer, add column rental_rate numeric,
    add column is_delisted boolean, add column delist_date date, add column created_at timestamptz default now();
    create table public.cars(id text primary key, make text, model text, "plateNumber" text, "roadtaxExpiry" text,
      "insuranceExpiry" text, "inspectionExpiry" text, notes text, label text, ownership text);
    alter table public.cars enable row level security;
    create policy "Enable all access for cars" on public.cars for all using (true) with check (true);
    grant all on public.cars to anon, authenticated, service_role;`);
  for (const file of CHAIN) await migrate(db, file);
  await db.exec(`reset role; select set_config('request.jwt.claims','',false);
    insert into public.drivers(id,name,car_plate) values ('${DRIVER_A}','Fixture Driver A','XAA1001');
    insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values ('${RENT}','${DRIVER_A}','2026-08-03',450,0,'BANK TRANSFER');
    insert into finance_private.vehicles(plate_key,display_plate,business_unit,ownership_type,status) values ('XAA1001','XAA1001','E-HAILING','Car Owner','Active');`);
  await migrate(db, RELEASE);
  return db;
}
const rows = async <T,>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const call = async (db: PGlite, name: string, args: unknown[]) =>
  (await rows<{ value: any }>(db, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args))[0].value;
const addDeposit = async (db: PGlite, values: { kind?: string; entry?: string; date?: string; amount?: number } = {}) =>
  (await rows<{ id: string }>(db, `insert into public.driver_deposits(driver_id,kind,entry,entry_date,amount,note) values ($1,$2,$3,$4,$5,'Fixture') returning id`,
    [DRIVER_A, values.kind ?? 'DEPOSIT', values.entry ?? 'RECEIVED', values.date ?? '2026-08-03', values.amount ?? 250]))[0].id;
const line = (credit: number, extra: Record<string, unknown>) => ({ source_row: 1, transaction_date: '2026-08-03', description: 'Transfer from Fixture Driver A', reference: '9307',
  debit: 0, credit, decision: 'MATCHED', payment_source: null, category: null, plate_key: null, review_note: 'Rent and deposit in one transfer', ...extra });
const post = (db: PGlite, rowsJson: unknown[], revision: number, hash = 'c'.repeat(64)) =>
  db.query(`select public.finance_post_bank_statement($1,'statement.csv','Operating',$2::jsonb,$3,$4)`, [august, JSON.stringify(rowsJson), revision, hash]);

test('staff and admins record deposits and downpayments, every change is logged, signed-out visitors cannot read them', async () => {
  const db = await setup();
  try {
    await asUser(db, STAFF_ID);
    const id = await addDeposit(db, { kind: 'DOWNPAYMENT', amount: 1000 });
    await db.query(`update public.driver_deposits set amount=900 where id=$1`, [id]);
    await addDeposit(db, { entry: 'CONTRA', amount: 100 }); // used to settle rent on delisting
    const log = await rows<{ action: string; changed_by_role: string }>(db, `select action, changed_by_role from public.deposit_changes where deposit_id=$1 order by id`, [id]);
    assert.deepEqual(log.map((r) => [r.action, r.changed_by_role]), [['INSERT', 'staff'], ['UPDATE', 'staff']]);
    await assert.rejects(db.query(`insert into public.driver_deposits(driver_id,kind,entry,entry_date,amount) values ($1,'BOND','RECEIVED','2026-08-03',10)`, [DRIVER_A]));
    await assert.rejects(db.query(`insert into public.driver_deposits(driver_id,kind,entry,entry_date,amount) values ($1,'DEPOSIT','RECEIVED','2026-08-03',0)`, [DRIVER_A]));
    await db.exec(`reset role; set role anon; select set_config('request.jwt.claims','',false)`);
    await assert.rejects(db.query(`select * from public.driver_deposits`));
  } finally { await db.close(); }
});

test('one transfer can pay rent and a deposit together; the month data lists the deposits', async () => {
  const db = await setup();
  try {
    await asUser(db);
    const deposit = await addDeposit(db);
    let data = await call(db, 'finance_refresh_payments', [august]);
    assert.deepEqual(data.deposits.map((d: any) => [d.id, d.kind, d.entry, Number(d.amount)]), [[deposit, 'DEPOSIT', 'RECEIVED', 250]]);
    await post(db, [line(700, { matched_kind: 'payment', matched_id: RENT, matched_ids: [RENT], matched_deposit_ids: [deposit] })], data.month.revision);
    data = await call(db, 'finance_read_month', [august]);
    const [row] = data.bank_rows;
    assert.deepEqual([row.matched_ids, row.matched_deposit_ids, row.match_valid], [[RENT], [deposit], true]);
  } finally { await db.close(); }
});

test('a transfer that is only a deposit is matched to the deposit', async () => {
  const db = await setup();
  try {
    await asUser(db);
    const deposit = await addDeposit(db);
    const data = await call(db, 'finance_refresh_payments', [august]);
    await post(db, [line(250, { matched_kind: 'deposit', matched_id: deposit, matched_ids: null, matched_deposit_ids: [deposit] })], data.month.revision);
    const after = await call(db, 'finance_read_month', [august]);
    assert.equal(after.bank_rows[0].match_valid, true);
  } finally { await db.close(); }
});

test('refunds, other months, wrong totals and a deposit listed twice are refused', async () => {
  const db = await setup();
  try {
    await asUser(db);
    const refund = await addDeposit(db, { entry: 'REFUNDED' });
    const july = await addDeposit(db, { date: '2026-07-30' });
    const good = await addDeposit(db);
    const data = await call(db, 'finance_refresh_payments', [august]);
    const r = data.month.revision;
    await assert.rejects(post(db, [line(700, { matched_kind: 'payment', matched_id: RENT, matched_ids: [RENT], matched_deposit_ids: [refund] })], r, 'd'.repeat(64)), /does not match/);
    await assert.rejects(post(db, [line(700, { matched_kind: 'payment', matched_id: RENT, matched_ids: [RENT], matched_deposit_ids: [july] })], r, 'e'.repeat(64)), /does not match/);
    await assert.rejects(post(db, [line(701, { matched_kind: 'payment', matched_id: RENT, matched_ids: [RENT], matched_deposit_ids: [good] })], r, 'f'.repeat(64)), /does not match/);
    await assert.rejects(post(db, [line(500, { matched_kind: 'deposit', matched_id: good, matched_ids: null, matched_deposit_ids: [good, good] })], r, '1'.repeat(64)), /does not match/);
    await assert.rejects(post(db, [line(250, { matched_kind: 'deposit', matched_id: RENT, matched_ids: null, matched_deposit_ids: [good] })], r, '2'.repeat(64)), /does not match/);
  } finally { await db.close(); }
});

test('changing a matched deposit invalidates the match; the file can run twice with matches in place', async () => {
  const db = await setup();
  try {
    await asUser(db);
    const deposit = await addDeposit(db);
    let data = await call(db, 'finance_refresh_payments', [august]);
    await post(db, [line(700, { matched_kind: 'payment', matched_id: RENT, matched_ids: [RENT], matched_deposit_ids: [deposit] })], data.month.revision);
    await db.exec(`reset role; select set_config('request.jwt.claims','',false)`);
    await migrate(db, RELEASE);
    await asUser(db);
    await db.query(`update public.driver_deposits set amount=200 where id=$1`, [deposit]);
    data = await call(db, 'finance_read_month', [august]);
    assert.equal(data.bank_rows[0].match_valid, false);
  } finally { await db.close(); }
});
