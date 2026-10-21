import test from 'node:test';
import assert from 'node:assert/strict';
import { asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

// Production as it stands (the whole chain, as tests/migration-chain.test.ts replays it), then this release.
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
  '20261007090000_finance_bank_match_once.sql',
  '20261007120000_driver_portal_remember.sql',
  '20261009090000_vehicle_details_and_agreements.sql',
  '20261009150000_driver_master_and_agreement_copy.sql',
  '20261009170000_returning_drivers.sql',
  '20261010090000_drop_approved_driver.sql',
  '20261012180000_security_review.sql',
  '20261012200000_money_review.sql',
  '20261012210000_collections_tools.sql',
  '20261012220000_cleanup.sql',
  '20261012230000_collection_runs.sql',
  '20261012240000_one_vehicle.sql',
  '20261021090000_vehicle_loans.sql',
  '20261021150000_vehicle_loan_letter_fields.sql',
];
const RELEASE = '20261021180000_other_income_recurring.sql';

// Fixture cars and made-up round amounts only.
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
  for (const file of [...CHAIN, RELEASE]) await migrate(db, file);
  await db.exec(`reset role; select set_config('request.jwt.claims','',false);
    insert into finance_private.vehicles(plate_key,display_plate,business_unit,ownership_type,status) values
      ('XAA1001','XAA 1001','DAILY RENTAL','Own Fleet','Active');`);
  await asUser(db);
  return db;
}
const value = async <T>(db: any, sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0].value as T;
const read = (db: any, month: string) => value<any>(db, `select public.finance_read_month($1::date) value`, [month]);
const revision = async (db: any, month: string) => (await read(db, month)).month.revision as number;
const save = async (db: any, action: string, record: Record<string, unknown>) =>
  value<any>(db, `select public.finance_save_other_income($1, $2::jsonb, $3) value`, [action, JSON.stringify(record), await revision(db, String(record.finance_month))]);
/** What the browser does when a Draft month opens: create its Operation Fix Cost lines (and now recurring Other Income). */
const open = async (db: any, month: string) =>
  value<any>(db, `select public.finance_generate_fixed_costs($1::date, $2) value`, [month, await revision(db, month)]);
const lines = async (db: any, month: string) => ((await read(db, month)).other_income as any[])
  .map((row) => ({ ...row, amount: Number(row.amount) }))
  .sort((a, b) => String(a.income_type).localeCompare(String(b.income_type)) || String(a.created_at).localeCompare(String(b.created_at)));
const active = async (db: any, month: string) => (await lines(db, month)).filter((row) => !row.cancelled_at);
const series = async (db: any) => {
  await db.exec('reset role');
  const rows = (await db.query(`select id::text, income_type, amount::float8 amount, plate_key, business_unit, reference, notes,
      effective_from::text, effective_until::text, record_version from finance_private.other_income_series order by created_at, id`)).rows as any[];
  await asUser(db);
  return rows;
};
const recurring = (overrides: Record<string, unknown> = {}) => ({
  finance_month: '2026-10-01', status: 'CONFIRMED', income_type: 'Fixture parking rent', amount: 500, plate_key: null,
  business_unit: 'E-HAILING', receipt_date: '2026-10-05', reference: 'FIX-1', notes: 'Fixture note', frequency: 'MONTHLY_RECURRING', ...overrides,
});

test('a monthly recurring Other Income creates its series and this month\'s line, linked to it', async () => {
  const db = await setup();
  try {
    const input = await save(db, 'ADD', recurring());
    const [line] = input.other_income;
    assert.equal(input.other_income.length, 1);
    assert.equal(line.status, 'CONFIRMED');
    assert.equal(Number(line.amount), 500);
    assert.equal(line.receipt_date, '2026-10-05');
    assert.ok(line.series_id, 'the month read carries the line\'s series');
    const [one] = await series(db);
    assert.deepEqual(one, { id: line.series_id, income_type: 'Fixture parking rent', amount: 500, plate_key: null, business_unit: 'E-HAILING',
      reference: 'FIX-1', notes: 'Fixture note', effective_from: '2026-10-01', effective_until: null, record_version: 1 });
    // The month read lists the active series, so the browser can tell a Draft month still needs its lines.
    assert.deepEqual(input.other_income_series.map((row: any) => row.id), [line.series_id]);
    // Adding the same line again changes nothing, as for a one-off line.
    await save(db, 'ADD', recurring());
    assert.equal((await series(db)).length, 1);
    assert.equal((await active(db, '2026-10-01')).length, 1);
    await db.exec('reset role');
    const audit = (await db.query(`select details->>'action' change from finance_private.audit where action = 'SAVE_OTHER_INCOME'`)).rows;
    assert.deepEqual(audit, [{ change: 'ADD' }]);
  } finally { await db.close(); }
});

test('a one-off Other Income creates no series, as before', async () => {
  const db = await setup();
  try {
    const { frequency, ...oneOff } = recurring();
    void frequency;
    const input = await save(db, 'ADD', oneOff);
    assert.equal(input.other_income[0].series_id, null);
    await save(db, 'ADD', recurring({ income_type: 'Fixture one-off', frequency: 'ONE_OFF' }));
    assert.deepEqual(await series(db), []);
    // Opening the next month makes no lines from one-off income.
    await open(db, '2026-11-01');
    assert.deepEqual(await lines(db, '2026-11-01'), []);
    await assert.rejects(save(db, 'ADD', recurring({ income_type: 'Fixture bad', frequency: 'WEEKLY' })), /frequency/i);
    // Stop recurring is only for a line that belongs to a series.
    const line = (await active(db, '2026-10-01'))[0];
    await assert.rejects(save(db, 'STOP_RECURRING', { id: line.id, finance_month: '2026-10-01' }), /not monthly recurring/);
  } finally { await db.close(); }
});

test('opening a later Draft month creates its Draft line once; with no Until month it keeps going', async () => {
  const db = await setup();
  try {
    const seriesId = (await save(db, 'ADD', recurring())).other_income[0].series_id;
    await open(db, '2026-11-01');
    let [line] = await lines(db, '2026-11-01');
    assert.equal(line.status, 'DRAFT', 'counted in the P&L only once confirmed by hand when the money arrives');
    assert.equal(line.amount, 500);
    assert.equal(line.income_type, 'Fixture parking rent');
    assert.equal(line.business_unit, 'E-HAILING');
    assert.equal(line.reference, 'FIX-1');
    assert.equal(line.notes, 'Fixture note');
    assert.equal(line.receipt_date, null);
    assert.equal(line.source, 'Recurring Other Income');
    assert.equal(line.series_id, seriesId);
    // Running it again adds nothing and leaves the month's revision alone.
    const before = await revision(db, '2026-11-01');
    await open(db, '2026-11-01');
    assert.equal((await lines(db, '2026-11-01')).length, 1);
    assert.equal(await revision(db, '2026-11-01'), before);
    // Blank Until: a month a year ahead still gets its line.
    await open(db, '2027-10-01');
    [line] = await lines(db, '2027-10-01');
    assert.equal(line.series_id, seriesId);
    assert.equal(line.amount, 500);
    // A month before the series started gets none.
    await open(db, '2026-09-01');
    assert.deepEqual(await lines(db, '2026-09-01'), []);
  } finally { await db.close(); }
});

test('an Until month ends the series after that month; a closed month gets nothing', async () => {
  const db = await setup();
  try {
    await save(db, 'ADD', recurring({ end_month: '2026-11-01' }));
    assert.equal((await series(db))[0].effective_until, '2026-11-01');
    await open(db, '2026-11-01');
    await open(db, '2026-12-01');
    assert.equal((await lines(db, '2026-11-01')).length, 1);
    assert.deepEqual(await lines(db, '2026-12-01'), []);
    await assert.rejects(save(db, 'ADD', recurring({ income_type: 'Fixture early end', end_month: '2026-09-01' })), /Until month/);
    // Closed months are never changed: generation asserts an open month.
    await db.exec(`reset role; insert into finance_private.months(finance_month,status,frozen_input) values('2026-08-01','CLOSED','{"month":{"revision":0},"other_income":[]}');`);
    await asUser(db);
    await assert.rejects(open(db, '2026-08-01'), /Reopen the closed month/);
  } finally { await db.close(); }
});

test('editing or deleting a generated line changes that month only', async () => {
  const db = await setup();
  try {
    await save(db, 'ADD', recurring());
    await open(db, '2026-11-01');
    const [november] = await lines(db, '2026-11-01');
    await save(db, 'UPDATE', { id: november.id, finance_month: '2026-11-01', status: 'CONFIRMED', income_type: 'Fixture parking rent', amount: 450,
      plate_key: null, business_unit: 'E-HAILING', receipt_date: '2026-11-07', reference: 'FIX-1', notes: 'Paid short' });
    const [edited] = await lines(db, '2026-11-01');
    assert.equal(edited.amount, 450);
    assert.equal(edited.status, 'CONFIRMED');
    assert.equal(edited.series_id, november.series_id, 'the edited line stays linked');
    const [one] = await series(db);
    assert.equal(one.amount, 500, 'the series keeps its amount');
    assert.equal(one.record_version, 1);
    await open(db, '2026-12-01');
    assert.equal((await lines(db, '2026-12-01'))[0].amount, 500, 'the next month uses the series amount');
    // A generated line deleted by hand is not made again when the month is opened again.
    const [december] = await lines(db, '2026-12-01');
    await save(db, 'CANCEL', { id: december.id, finance_month: '2026-12-01', reason: 'Not received this month' });
    await open(db, '2026-12-01');
    assert.deepEqual(await active(db, '2026-12-01'), []);
    assert.equal((await series(db))[0].effective_until, null, 'deleting one month leaves the series running');
  } finally { await db.close(); }
});

test('Stop recurring ends the series at that line\'s month; the line stays and later months get none', async () => {
  const db = await setup();
  try {
    await save(db, 'ADD', recurring());
    await open(db, '2026-11-01');
    await open(db, '2026-12-01');
    const [november] = await lines(db, '2026-11-01');
    await asUser(db, STAFF_ID);
    await assert.rejects(value(db, `select public.finance_save_other_income('STOP_RECURRING', $1::jsonb, 1) value`, [JSON.stringify({ id: november.id, finance_month: '2026-11-01' })]), /Admin/);
    await asUser(db);
    await save(db, 'STOP_RECURRING', { id: november.id, finance_month: '2026-11-01' });
    const [one] = await series(db);
    assert.equal(one.effective_until, '2026-11-01');
    assert.equal(one.record_version, 2);
    const [kept] = await active(db, '2026-11-01');
    assert.equal(kept.id, november.id, 'the line itself stays');
    // December's Draft line, made before the stop, is removed; opening the months after creates nothing.
    assert.deepEqual(await active(db, '2026-12-01'), []);
    assert.equal((await lines(db, '2026-12-01'))[0].cancellation_reason, 'Monthly recurring stopped');
    await open(db, '2026-12-01');
    await open(db, '2027-01-01');
    assert.deepEqual(await active(db, '2026-12-01'), []);
    assert.deepEqual(await lines(db, '2027-01-01'), []);
    assert.deepEqual((await read(db, '2026-11-01')).other_income_series.map((row: any) => row.effective_until), ['2026-11-01']);
    await db.exec('reset role');
    const audit = (await db.query(`select details->>'action' change, details->'series_after'->>'effective_until' until from finance_private.audit
      where action = 'SAVE_OTHER_INCOME' order by occurred_at, id`)).rows;
    assert.deepEqual(audit.at(-1), { change: 'STOP_RECURRING', until: '2026-11-01' });
  } finally { await db.close(); }
});

test('a vehicle\'s recurring income follows a plate correction, and takes the vehicle\'s business', async () => {
  const db = await setup();
  try {
    const input = await save(db, 'ADD', recurring({ plate_key: 'xaa 1001', business_unit: 'E-HAILING' }));
    assert.equal(input.other_income[0].business_unit, 'DAILY RENTAL');
    assert.equal((await series(db))[0].business_unit, 'DAILY RENTAL');
    await value<any>(db, `select public.finance_mutate_record('vehicle', 'CORRECT_PLATE', $1::jsonb, '2026-10-01', $2, 'Corrected registration typo') value`,
      [JSON.stringify({ old_plate: 'XAA1001', plate_key: 'XAA1002', display_plate: 'XAA 1002' }), await revision(db, '2026-10-01')]);
    assert.equal((await series(db))[0].plate_key, 'XAA1002');
    await open(db, '2026-11-01');
    const [line] = await lines(db, '2026-11-01');
    assert.equal(line.plate_key, 'XAA1002');
    assert.equal(line.business_unit, 'DAILY RENTAL');
  } finally { await db.close(); }
});

test('the cash outlook splits recurring Other Income out of history and lists the next six months of it', async () => {
  const db = await setup();
  try {
    await save(db, 'ADD', recurring());
    await save(db, 'ADD', recurring({ income_type: 'Fixture storage rent', amount: 200, reference: 'FIX-2', end_month: '2026-12-01' }));
    await save(db, 'ADD', recurring({ income_type: 'Fixture one-off', amount: 300, reference: 'FIX-3', frequency: 'ONE_OFF' }));
    await save(db, 'ADD', recurring({ income_type: 'Fixture draft', amount: 9000, reference: 'FIX-4', status: 'DRAFT', frequency: 'ONE_OFF' }));
    await open(db, '2026-11-01');
    const data = await value<any>(db, `select public.finance_cash_outlook('2026-11-15'::date) value`);
    assert.deepEqual(Object.keys(data).sort(), ['balances', 'duplicate_recurring', 'history', 'insurance', 'months', 'recurring_ahead', 'today']);
    const october = data.history.find((h: any) => h.month === '2026-10-01');
    assert.equal(Number(october.other_income), 1000, 'confirmed lines only, as before');
    assert.equal(Number(october.recurring_other_income), 700);
    assert.deepEqual(Object.keys(october).sort(), ['has_data', 'month', 'one_off_opex', 'other_income', 'recurring_other_income', 'smart_drive_net', 'vehicle_costs', 'workshop']);
    assert.deepEqual(data.recurring_ahead.map((r: any) => [r.month, Number(r.amount)]), [
      ['2026-11-01', 700], ['2026-12-01', 700], ['2027-01-01', 500], ['2027-02-01', 500], ['2027-03-01', 500], ['2027-04-01', 500],
    ]);
    // November's line is still Draft, so November's history (when it becomes history) counts nothing yet.
    const later = await value<any>(db, `select public.finance_cash_outlook('2026-12-15'::date) value`);
    assert.equal(Number(later.history.find((h: any) => h.month === '2026-11-01').recurring_other_income), 0);
  } finally { await db.close(); }
});

test('the file can run twice and keeps the new table private', async () => {
  const db = await setup();
  try {
    await save(db, 'ADD', recurring());
    await db.exec('reset role');
    await migrate(db, RELEASE);
    await asUser(db);
    assert.equal((await series(db)).length, 1, 'running it again keeps the series');
    await open(db, '2026-11-01');
    assert.equal((await lines(db, '2026-11-01')).length, 1);
    await assert.rejects(db.query(`select * from finance_private.other_income_series`), /permission denied/);
    await assert.rejects(db.query(`select finance_private.generate_other_income_core('2026-11-01')`), /permission denied/);
  } finally { await db.close(); }
});
