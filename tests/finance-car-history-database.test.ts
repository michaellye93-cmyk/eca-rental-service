import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

// Production as it stands, then the car-history and cash-flow file.
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
];
const RELEASE = '20261006090000_finance_car_history_and_cash_flow.sql';
const BANK_REQUIRED = '20261006120000_finance_bank_reconciliation_required.sql';
const BANK_STATUS = '20261006150000_finance_payment_bank_status.sql';
const DRIVER_A = '10000000-0000-4000-8000-00000000000a';
const OLD_PAYMENT = '20000000-0000-4000-8000-000000000001';
const NEW_PAYMENT = '20000000-0000-4000-8000-000000000002';
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
    insert into public.payments(id,driver_id,date,amount,service_claim,payment_method) values
      ('${OLD_PAYMENT}','${DRIVER_A}','2026-08-03',400,0,'BANK TRANSFER');
    insert into finance_private.vehicles(plate_key,display_plate,business_unit,ownership_type,status) values
      ('XAA1001','XAA1001','E-HAILING','Car Owner','Active'),('XAA2002','XAA2002','E-HAILING','Car Owner','Active');`);
  await migrate(db, RELEASE);
  await migrate(db, BANK_REQUIRED);
  await migrate(db, BANK_STATUS);
  return db;
}
const rows = async <T,>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const BANK_ROW = { source_row: 1, transaction_date: '2026-08-05', description: 'Transfer between company accounts', reference: 'T001', debit: 0, credit: 500,
  decision: 'EXCLUDED', payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, review_note: 'Own transfer' };
const postBankStatement = (db: PGlite, revision: number) => db.query(`select public.finance_post_bank_statement($1,'statement.csv','Operating',$2::jsonb,$3,$4)`,
  [august, JSON.stringify([BANK_ROW]), revision, 'a'.repeat(64)]);
const asSqlEditor = (db: PGlite) => db.exec(`reset role; select set_config('request.jwt.claims','',false)`);

test('existing payments take their driver’s current car, without adding entries to the payment change log', async () => {
  const db = await setup();
  try {
    await asSqlEditor(db);
    assert.deepEqual(await rows(db, `select car_plate from public.payments where id=$1`, [OLD_PAYMENT]), [{ car_plate: 'XAA1001' }]);
    assert.deepEqual(await rows(db, `select count(*)::int n from public.payment_changes where payment_id=$1 and action='UPDATE'`, [OLD_PAYMENT]), [{ n: 0 }]);
  } finally { await db.close(); }
});

test('a new payment remembers the car its driver had on the day it was recorded', async () => {
  const db = await setup();
  try {
    await asUser(db);
    await db.exec(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method)
      values ('${NEW_PAYMENT}','${DRIVER_A}','2026-08-10',400,0,'BANK TRANSFER')`);
    assert.deepEqual(await rows(db, `select car_plate from public.payments where id=$1`, [NEW_PAYMENT]), [{ car_plate: 'XAA1001' }]);
    // A plate typed by hand is stored in capitals without spaces.
    await db.exec(`update public.payments set car_plate='xaa 2002' where id='${NEW_PAYMENT}'`);
    assert.deepEqual(await rows(db, `select car_plate from public.payments where id=$1`, [NEW_PAYMENT]), [{ car_plate: 'XAA2002' }]);
  } finally { await db.close(); }
});

test('changing a driver’s car keeps earlier payments on the old car and records the change in the history', async () => {
  const db = await setup();
  try {
    await asUser(db);
    await db.exec(`update public.drivers set car_plate='XAA2002' where id='${DRIVER_A}'`);
    await db.exec(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method)
      values ('${NEW_PAYMENT}','${DRIVER_A}','2026-08-17',400,0,'BANK TRANSFER')`);
    assert.deepEqual(await rows(db, `select id, car_plate from public.payments order by date`), [
      { id: OLD_PAYMENT, car_plate: 'XAA1001' },
      { id: NEW_PAYMENT, car_plate: 'XAA2002' },
    ]);
    const history = await rows<{ car_plate: string; previous_plate: string | null }>(db,
      `select car_plate, previous_plate from public.driver_car_assignments where driver_id=$1 order by id`, [DRIVER_A]);
    assert.deepEqual(history, [{ car_plate: 'XAA1001', previous_plate: null }, { car_plate: 'XAA2002', previous_plate: 'XAA1001' }]);
    // Re-saving the same plate, or a spacing-only edit, adds nothing.
    await db.exec(`update public.drivers set car_plate='XAA 2002' where id='${DRIVER_A}'`);
    assert.equal((await rows(db, `select id from public.driver_car_assignments where driver_id=$1`, [DRIVER_A])).length, 2);
  } finally { await db.close(); }
});

test('Finance books each payment to the car it was paid for, not the driver’s current car', async () => {
  const db = await setup();
  try {
    await asUser(db);
    await db.exec(`update public.drivers set car_plate='XAA2002' where id='${DRIVER_A}'`);
    await db.exec(`insert into public.payments(id,driver_id,date,amount,service_claim,payment_method)
      values ('${NEW_PAYMENT}','${DRIVER_A}','2026-08-17',300,0,'BANK TRANSFER')`);
    await db.query(`select public.finance_read_month($1)`, [august]);
    const input = (await rows<{ value: any }>(db, `select public.finance_refresh_payments($1) value`, [august]))[0].value;
    const byPayment = Object.fromEntries(input.ehailing.map((row: any) => [row.source_payment_id, row.plate_key]));
    assert.equal(byPayment[OLD_PAYMENT], 'XAA1001');
    assert.equal(byPayment[NEW_PAYMENT], 'XAA2002');
  } finally { await db.close(); }
});

test('admins choose whether an Operation Fix Cost counts in the P&L or only in cash flow; tax instalments start as cash flow only', async () => {
  const db = await setup();
  try {
    await asUser(db);
    const add = async (category: string, amount: number, payee: string | null) => {
      const month = (await rows<{ value: any }>(db, `select public.finance_read_month($1) value`, [august]))[0].value.month;
      await db.query(`select public.finance_save_fixed_cost('ADD', $1::jsonb, $2::date, $3)`,
        [JSON.stringify({ category, monthly_amount: amount, effective_from: august, effective_until: null, payee, note: null }), august, month.revision]);
    };
    await add('LHDN', 100, 'CP204');
    await add('Office Rental', 200, null);
    // The release file decides tax instalments recorded before it ran; run it again to classify these fixtures.
    await asSqlEditor(db);
    await migrate(db, RELEASE);
    const series = Object.fromEntries((await rows<{ category: string; series_id: string }>(db,
      `select category, series_id from finance_private.fixed_cost_templates`)).map((row) => [row.category, row.series_id]));
    await asUser(db);
    let treatments = (await rows<{ value: any[] }>(db, `select public.finance_fixed_cost_treatments() value`))[0].value;
    assert.deepEqual(treatments, [{ series_id: series['LHDN'], treatment: 'CASH_FLOW_ONLY' }]);

    treatments = (await rows<{ value: any[] }>(db, `select public.finance_set_fixed_cost_treatment($1, 'CASH_FLOW_ONLY') value`, [series['Office Rental']]))[0].value;
    assert.equal(treatments.length, 2);
    treatments = (await rows<{ value: any[] }>(db, `select public.finance_set_fixed_cost_treatment($1, 'PNL') value`, [series['Office Rental']]))[0].value;
    assert.deepEqual(treatments.map((row) => row.series_id), [series['LHDN']]);
    // The month data carries the list, so a month frozen at close keeps it.
    const month = (await rows<{ value: any }>(db, `select public.finance_read_month($1) value`, [august]))[0].value;
    assert.deepEqual(month.fixed_cost_treatments, [{ series_id: series['LHDN'], treatment: 'CASH_FLOW_ONLY' }]);

    await assert.rejects(db.query(`select public.finance_set_fixed_cost_treatment($1, 'SOMETHING')`, [series['LHDN']]));
    await asUser(db, STAFF_ID);
    await assert.rejects(db.query(`select public.finance_fixed_cost_treatments()`));
    await assert.rejects(db.query(`select public.finance_set_fixed_cost_treatment($1, 'PNL')`, [series['LHDN']]));
  } finally { await db.close(); }
});

test('the release file can run twice and signed-out visitors cannot read the car history', async () => {
  const db = await setup();
  try {
    await asSqlEditor(db);
    await migrate(db, RELEASE);
    assert.equal((await rows<{ n: number }>(db, `select count(*)::int n from public.driver_car_assignments`))[0].n, 1);
    assert.equal((await rows<{ open: boolean }>(db, `select has_table_privilege('anon','public.driver_car_assignments','SELECT') open`))[0].open, false);
  } finally { await db.close(); }
});

test('after a driver changes car and the month is refreshed, the month can still go to review', async () => {
  const db = await setup();
  try {
    await asUser(db);
    await db.exec(`update public.drivers set car_plate='XAA2002' where id='${DRIVER_A}'`);
    const call = async (name: string, args: unknown[]) =>
      (await rows<{ value: any }>(db, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args))[0].value;
    let data = await call('finance_read_month', [august]);
    data = await call('finance_refresh_payments', [august]);
    await call('finance_post_smart_drive', [august, 'empty-report.xlsx', '[]', false, data.month.revision, null]);
    data = await call('finance_read_month', [august]);
    await postBankStatement(db, data.month.revision);
    data = await call('finance_read_month', [august]);
    // The payment stays on its old car; the ledger check must accept that, so the next blocker is the section reviews.
    await assert.rejects(call('finance_transition_month', [august, 'READY', data.month.revision, '']), /Review every Finance section/);
  } finally { await db.close(); }
});

test('a month cannot go to review or close until a bank statement for it is reconciled', async () => {
  const db = await setup();
  try {
    await asUser(db);
    const call = async (name: string, args: unknown[]) =>
      (await rows<{ value: any }>(db, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args))[0].value;
    let data = await call('finance_refresh_payments', [august]);
    await call('finance_post_smart_drive', [august, 'empty-report.xlsx', '[]', false, data.month.revision, null]);
    data = await call('finance_read_month', [august]);
    await assert.rejects(call('finance_transition_month', [august, 'READY', data.month.revision, '']), /bank statement/i);
    await postBankStatement(db, data.month.revision);
    data = await call('finance_read_month', [august]);
    await assert.rejects(call('finance_transition_month', [august, 'READY', data.month.revision, '']), /Review every Finance section/);
  } finally { await db.close(); }
});

test('each payment shows whether a posted bank statement matched it (admins only)', async () => {
  const db = await setup();
  try {
    await asUser(db);
    const call = async (name: string, args: unknown[]) =>
      (await rows<{ value: any }>(db, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args))[0].value;
    let status = await call('finance_payment_bank_status', [DRIVER_A]);
    assert.deepEqual(status, { matched: [], months: [] });
    const data = await call('finance_refresh_payments', [august]);
    const matchedRow = { ...BANK_ROW, description: 'Transfer from Fixture Driver A', credit: 400, decision: 'MATCHED', matched_kind: 'payment', matched_id: OLD_PAYMENT, review_note: 'Suggested match', transaction_date: '2026-08-03' };
    await db.query(`select public.finance_post_bank_statement($1,'statement.csv','Operating',$2::jsonb,$3,$4)`, [august, JSON.stringify([matchedRow]), data.month.revision, 'b'.repeat(64)]);
    status = await call('finance_payment_bank_status', [DRIVER_A]);
    assert.deepEqual(status, { matched: [OLD_PAYMENT], months: ['2026-08'] });
    await asUser(db, STAFF_ID);
    await assert.rejects(call('finance_payment_bank_status', [DRIVER_A]));
  } finally { await db.close(); }
});
