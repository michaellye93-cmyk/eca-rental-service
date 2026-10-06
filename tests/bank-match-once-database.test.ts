import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

// Production as it stands (to the deposits file of 2026-10-06), then the double-match guard.
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
];
const RELEASE = '20261007090000_finance_bank_match_once.sql';
const OTHER = '20000000-0000-4000-8000-000000000002';
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
    insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values ('${RENT}','${DRIVER_A}','2026-08-03',450,0,'BANK TRANSFER'),('${OTHER}','${DRIVER_A}','2026-08-04',250,0,'BANK TRANSFER');
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

test('a payment matched on a posted statement cannot be matched again on another statement or line', async () => {
  const db = await setup();
  try {
    await asUser(db);
    let data = await call(db, 'finance_refresh_payments', [august]);
    await post(db, [line(450, { matched_kind: 'payment', matched_id: RENT, matched_ids: null })], data.month.revision, 'a'.repeat(64));
    data = await call(db, 'finance_read_month', [august]);
    await assert.rejects(post(db, [{ ...line(450, { matched_kind: 'payment', matched_id: RENT, matched_ids: null }), description: 'Second bank, same payment' }], data.month.revision, 'b'.repeat(64)), /already matched/);
    // Two lines of one statement cannot take the same payment either, nor a split that reuses it.
    await assert.rejects(post(db, [
      { ...line(250, { matched_kind: 'payment', matched_id: OTHER, matched_ids: null }), source_row: 1, description: 'Line one' },
      { ...line(250, { matched_kind: 'payment', matched_id: OTHER, matched_ids: null }), source_row: 2, description: 'Line two' },
    ], data.month.revision, 'c'.repeat(64)), /already matched/);
    await assert.rejects(post(db, [{ ...line(700, { matched_kind: 'payment', matched_id: OTHER, matched_ids: [OTHER, RENT] }), description: 'Split reusing rent' }], data.month.revision, 'd'.repeat(64)), /already matched/);
  } finally { await db.close(); }
});

test('a deposit receipt is matched once only; excluded lines and amendments of the same line are fine; the file can run twice', async () => {
  const db = await setup();
  try {
    await asUser(db);
    const deposit = await addDeposit(db);
    let data = await call(db, 'finance_refresh_payments', [august]);
    await post(db, [line(250, { matched_kind: 'deposit', matched_id: deposit, matched_ids: null, matched_deposit_ids: [deposit] }), { ...line(99, { decision: 'EXCLUDED', matched_kind: null, matched_id: null, review_note: 'Not rent' }), source_row: 2, description: 'Daily rental' }], data.month.revision, 'e'.repeat(64));
    data = await call(db, 'finance_read_month', [august]);
    await assert.rejects(post(db, [{ ...line(250, { matched_kind: 'deposit', matched_id: deposit, matched_ids: null, matched_deposit_ids: [deposit] }), description: 'Again' }], data.month.revision, 'f'.repeat(64)), /already matched/);
    // Amending the posted line itself (an exclusion) is not a double match.
    const importId = data.bank_rows[0].import_id;
    await call(db, 'finance_review_bank_match', [august, importId, 1, 'EXCLUDED', null, null, 'Checked: not a deposit', data.month.revision]);
    await db.exec(`reset role; select set_config('request.jwt.claims','',false)`);
    await migrate(db, RELEASE);
  } finally { await db.close(); }
});
