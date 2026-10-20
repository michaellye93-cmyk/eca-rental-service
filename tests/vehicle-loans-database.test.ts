import test from 'node:test';
import assert from 'node:assert/strict';
import { asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

// The Finance chain this file builds on (as the money review test replays it), then this release.
const FINANCE_MIGRATIONS = [
  '20260915084108_secure_profile_roles.sql',
  '20260915084110_finance_foundation.sql',
  '20260915085705_finance_bank_statements.sql',
  '20260915104015_finance_section_workflows.sql',
  '20260915120802_finance_delete_vehicle.sql',
  '20260915122156_finance_insurance_responsibility.sql',
  '20260915124812_finance_insurance_premium_rules.sql',
  '20260915132423_finance_shared_recurring_opex.sql',
  '20260920070959_finance_editable_safe_imports.sql',
  '20260920103854_finance_fixed_cost_same_start_edit.sql',
  '20260920111527_simplify_operation_fixed_costs.sql',
];
const RELEASE = '20261021090000_vehicle_loans.sql';
const MANAGED = /This cost is managed in Vehicle loans/;

// Fixture cars only; amounts are made up.
async function setup() {
  const db = await database();
  for (const file of [...FINANCE_MIGRATIONS, RELEASE]) await migrate(db, file);
  await db.exec(`reset role;
    insert into finance_private.vehicles(plate_key,display_plate,business_unit,ownership_type,status) values
      ('XAA1001','XAA 1001','E-HAILING','Own Fleet','Active'),
      ('XAA1002','XAA 1002','E-HAILING','Own Fleet','Active'),
      ('XAA1003','XAA 1003','DAILY RENTAL','Own Fleet','Active');`);
  await asUser(db);
  return db;
}
const value = async <T>(db: any, sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0].value as T;
const save = (db: any, action: string, record: object, reason = '') =>
  value<any[]>(db, `select public.finance_save_vehicle_loan($1, $2::jsonb, $3) value`, [action, JSON.stringify(record), reason]);
const list = (db: any) => value<any[]>(db, `select public.finance_vehicle_loans() value`);
const costs = async (db: any, plate: string) => {
  await db.exec('reset role');
  const rows = (await db.query(`select id::text, cost_type, payee, monthly_amount::float8 amount, start_month::text, end_month::text, loan_id::text, cancelled_at is not null cancelled, cancellation_reason
    from finance_private.recurring_costs where plate_key = $1 order by start_month, id`, [plate])).rows as any[];
  await asUser(db);
  return rows;
};
const loanRecord = (overrides: object = {}) => ({
  plate_key: 'xaa 1001', bank: 'Fixture Bank', finance_amount: 30000, flat_rate_percent: 3, tenure_months: 60,
  first_payment_date: '2023-03-05', downpayment: 3000, monthly_instalment: 575, status: 'ACTIVE', closed_on: null, notes: 'Fixture note', ...overrides,
});
const mutate = async (db: any, action: string, record: object, reason = 'Edited in Finance') => {
  const revision = (await value<any>(db, `select public.finance_read_month('2026-10-01') value`)).month.revision;
  return value<any>(db, `select public.finance_mutate_record('recurring_cost', $1, $2::jsonb, '2026-10-01', $3, $4) value`, [action, JSON.stringify(record), revision, reason]);
};

test('saving a loan creates its Hire Purchase / Loan monthly cost, linked both ways', async () => {
  const db = await setup();
  try {
    assert.deepEqual(await list(db), []);
    const loans = await save(db, 'ADD', loanRecord());
    assert.equal(loans.length, 1);
    const [loan] = loans;
    assert.equal(loan.plate_key, 'XAA1001', 'the plate is stored as Finance stores plates');
    assert.equal(loan.display_plate, 'XAA 1001', "the plate is shown as Finance's vehicle list shows it");
    assert.equal(loan.status, 'ACTIVE');
    assert.equal(loan.monthly_instalment, 575);
    assert.equal(loan.first_payment_date, '2023-03-05');
    assert.equal(loan.record_version, 1);
    const [cost] = await costs(db, 'XAA1001');
    assert.deepEqual(cost, { id: loan.recurring_cost_id, cost_type: 'Hire Purchase / Loan', payee: 'Fixture Bank', amount: 575, start_month: '2023-03-01', end_month: '2028-02-01', loan_id: loan.id, cancelled: false, cancellation_reason: null });
    // Finance's month read carries the link, so Records can show the row read-only.
    const month = await value<any>(db, `select public.finance_read_month('2026-10-01') value`);
    assert.equal(month.recurring_costs.find((row: any) => row.id === loan.recurring_cost_id).loan_id, loan.id);
    // The change is recorded in Finance's audit.
    await db.exec('reset role');
    const audit = (await db.query(`select action, details->>'action' change from finance_private.audit where action = 'SAVE_VEHICLE_LOAN'`)).rows;
    assert.deepEqual(audit, [{ action: 'SAVE_VEHICLE_LOAN', change: 'ADD' }]);
  } finally { await db.close(); }
});

test('a car must be in Finance\'s vehicle list, and has one active loan at a time', async () => {
  const db = await setup();
  try {
    await assert.rejects(save(db, 'ADD', loanRecord({ plate_key: 'XAA9999' })), /Add this car to Finance's vehicle list first/);
    await save(db, 'ADD', loanRecord());
    await assert.rejects(save(db, 'ADD', loanRecord({ first_payment_date: '2026-01-05' })), /already has an active loan/);
    await assert.rejects(save(db, 'ADD', loanRecord({ plate_key: 'XAA1002', status: 'SETTLED', closed_on: null })), /date the loan was settled or the car sold/);
    await assert.rejects(save(db, 'ADD', loanRecord({ plate_key: 'XAA1002', bank: ' ' })), /Enter the bank/);
    await assert.rejects(save(db, 'ADD', loanRecord({ plate_key: 'XAA1002', monthly_instalment: 0 })), /Enter the monthly instalment/);
  } finally { await db.close(); }
});

test('an existing Hire Purchase / Loan cost for the car is adopted, not copied', async () => {
  const db = await setup();
  try {
    await db.exec(`reset role;
      insert into finance_private.recurring_costs(plate_key,start_month,end_month,cost_type,monthly_amount,payee) values
        ('XAA1002','2024-08-01',null,'Hire Purchase / Loan',450,'Typed by hand'),
        ('XAA1002','2024-08-01',null,'Owner Payout',300,'Fixture Owner')`);
    await asUser(db);
    const before = await costs(db, 'XAA1002');
    const hire = before.find((row) => row.cost_type === 'Hire Purchase / Loan');
    const [loan] = await save(db, 'ADD', loanRecord({ plate_key: 'XAA1002', first_payment_date: '2024-08-01', tenure_months: 84, finance_amount: 32000, flat_rate_percent: 2.9, monthly_instalment: 459 }));
    assert.equal(loan.recurring_cost_id, hire.id, 'the row typed earlier is linked');
    const after = await costs(db, 'XAA1002');
    assert.equal(after.length, 2, 'no second Hire Purchase / Loan row');
    assert.deepEqual(after.find((row) => row.id === hire.id), { ...hire, payee: 'Fixture Bank', amount: 459, start_month: '2024-08-01', end_month: '2031-07-01', loan_id: loan.id });
    assert.equal(after.find((row) => row.cost_type === 'Owner Payout').loan_id, null, 'other costs are untouched');
  } finally { await db.close(); }
});

test('two Hire Purchase / Loan costs for the car in the loan\'s months are not guessed between', async () => {
  const db = await setup();
  try {
    await db.exec(`reset role;
      insert into finance_private.recurring_costs(plate_key,start_month,end_month,cost_type,monthly_amount,payee) values
        ('XAA1003','2024-01-01','2024-12-01','Hire Purchase / Loan',400,'Fixture Bank'),
        ('XAA1003','2025-01-01',null,'Hire Purchase / Loan',420,'Fixture Bank'),
        ('XAA1003','2020-01-01','2021-12-01','Hire Purchase / Loan',300,'Earlier loan')`);
    await asUser(db);
    await assert.rejects(save(db, 'ADD', loanRecord({ plate_key: 'XAA1003', first_payment_date: '2024-01-01' })), /more than one Hire Purchase \/ Loan/);
    assert.deepEqual(await list(db), [], 'nothing saved');
    // A loan whose months touch only one of them adopts that one; the earlier loan's row is left alone.
    const [loan] = await save(db, 'ADD', loanRecord({ plate_key: 'XAA1003', first_payment_date: '2025-01-01', tenure_months: 24, monthly_instalment: 420 }));
    const rows = await costs(db, 'XAA1003');
    assert.deepEqual(rows.map((row) => [row.start_month, row.end_month, row.loan_id]), [
      ['2020-01-01', '2021-12-01', null], ['2024-01-01', '2024-12-01', null], ['2025-01-01', '2026-12-01', loan.id],
    ]);
  } finally { await db.close(); }
});

test('the linked cost is read-only in Records: edits, stops and deletes there are refused', async () => {
  const db = await setup();
  try {
    const [loan] = await save(db, 'ADD', loanRecord());
    const cost = { id: loan.recurring_cost_id, plate_key: 'XAA1001', cost_type: 'Hire Purchase / Loan', monthly_amount: 999, payee: 'Fixture Bank', start_month: '2023-03-01', end_month: null };
    await assert.rejects(mutate(db, 'UPDATE', cost), MANAGED);
    await assert.rejects(mutate(db, 'CANCEL', cost, 'Duplicate'), MANAGED);
    await assert.rejects(mutate(db, 'STOP', cost), MANAGED);
    await assert.rejects(mutate(db, 'OVERRIDE_MONTH', cost), MANAGED);
    assert.equal((await costs(db, 'XAA1001'))[0].amount, 575, 'unchanged');
    // Costs typed in Records are edited there as before.
    await db.exec(`reset role; insert into finance_private.recurring_costs(plate_key,start_month,cost_type,monthly_amount,payee) values ('XAA1002','2026-01-01','Owner Payout',300,'Fixture Owner')`);
    await asUser(db);
    const [own] = await costs(db, 'XAA1002');
    await mutate(db, 'UPDATE', { id: own.id, plate_key: 'XAA1002', cost_type: 'Owner Payout', monthly_amount: 320, payee: 'Fixture Owner', start_month: '2026-01-01', end_month: null }, 'Edited in Finance');
    // Effective October 2026 on a cost from January: a new version from October, the old one ends in September.
    assert.deepEqual((await costs(db, 'XAA1002')).map((row) => [row.amount, row.start_month, row.end_month]), [[300, '2026-01-01', '2026-09-01'], [320, '2026-10-01', null]]);
  } finally { await db.close(); }
});

test('editing a loan rewrites its cost, and a stale edit is refused', async () => {
  const db = await setup();
  try {
    const [loan] = await save(db, 'ADD', loanRecord());
    const [edited] = await save(db, 'UPDATE', { ...loanRecord({ monthly_instalment: 580, tenure_months: 48, bank: 'Fixture Bank Two' }), id: loan.id, record_version: loan.record_version });
    assert.equal(edited.record_version, 2);
    assert.equal(edited.recurring_cost_id, loan.recurring_cost_id, 'the same cost row');
    const [cost] = await costs(db, 'XAA1001');
    assert.deepEqual([cost.id, cost.amount, cost.payee, cost.start_month, cost.end_month], [loan.recurring_cost_id, 580, 'Fixture Bank Two', '2023-03-01', '2027-02-01']);
    await assert.rejects(save(db, 'UPDATE', { ...loanRecord(), id: loan.id, record_version: loan.record_version }), /changed elsewhere/);
  } finally { await db.close(); }
});

test('a settled or sold loan ends its cost from the month it closed', async () => {
  const db = await setup();
  try {
    const [loan] = await save(db, 'ADD', loanRecord());
    const close = async (status: string, closedOn: string, version: number) =>
      (await save(db, 'UPDATE', { ...loanRecord({ status, closed_on: closedOn }), id: loan.id, record_version: version }))[0];
    // Settled in June 2026: June onwards costs nothing, so the cost ends in May.
    let saved = await close('SETTLED', '2026-06-15', 1);
    assert.equal(saved.status, 'SETTLED');
    assert.equal(saved.closed_on, '2026-06-15');
    assert.equal((await costs(db, 'XAA1001'))[0].end_month, '2026-05-01');
    // Closed in the first payment month: the cost stays for that one month.
    saved = await close('SOLD', '2023-03-20', 2);
    assert.equal((await costs(db, 'XAA1001'))[0].end_month, '2023-03-01');
    // Closed after the last instalment month: the last instalment month stands.
    saved = await close('SETTLED', '2028-09-01', 3);
    assert.equal((await costs(db, 'XAA1001'))[0].end_month, '2028-02-01');
    // Back to active: the full tenure again, and the closing date is cleared.
    saved = (await save(db, 'UPDATE', { ...loanRecord({ closed_on: '2026-06-15' }), id: loan.id, record_version: 4 }))[0];
    assert.equal(saved.closed_on, null);
    assert.equal((await costs(db, 'XAA1001'))[0].end_month, '2028-02-01');
    // A settled loan no longer blocks a new active loan on the car.
    await close('SETTLED', '2026-06-15', 5);
    const both = await save(db, 'ADD', loanRecord({ first_payment_date: '2026-07-01', tenure_months: 36, monthly_instalment: 700 }));
    assert.equal(both.length, 2);
    assert.deepEqual((await costs(db, 'XAA1001')).map((row) => [row.start_month, row.end_month, row.amount]), [['2023-03-01', '2026-05-01', 575], ['2026-07-01', '2029-06-01', 700]]);
  } finally { await db.close(); }
});

test('deleting a loan cancels it and its cost together, with the reason', async () => {
  const db = await setup();
  try {
    const [loan] = await save(db, 'ADD', loanRecord());
    await assert.rejects(save(db, 'DELETE', { id: loan.id, record_version: 1 }, ' '), /reason/);
    assert.deepEqual(await save(db, 'DELETE', { id: loan.id, record_version: 1 }, 'Typed for the wrong car'), []);
    const [cost] = await costs(db, 'XAA1001');
    assert.equal(cost.cancelled, true);
    assert.equal(cost.cancellation_reason, 'Typed for the wrong car');
    await db.exec('reset role');
    const stored = (await db.query(`select cancellation_reason from finance_private.vehicle_loans`)).rows;
    assert.deepEqual(stored, [{ cancellation_reason: 'Typed for the wrong car' }], 'kept for the audit, out of the list');
  } finally { await db.close(); }
});

test('saving a loan sends open Finance months back to Draft, and leaves closed months alone', async () => {
  const db = await setup();
  try {
    await db.exec(`reset role;
      insert into finance_private.months(finance_month,status,revision) values ('2026-09-01','READY FOR REVIEW',4);
      insert into finance_private.months(finance_month,status,revision,frozen_input) values ('2026-08-01','CLOSED',7,'{}'::jsonb);`);
    await asUser(db);
    await save(db, 'ADD', loanRecord());
    await db.exec('reset role');
    const months = (await db.query(`select finance_month::text, status, revision from finance_private.months order by finance_month`)).rows;
    assert.deepEqual(months, [{ finance_month: '2026-08-01', status: 'CLOSED', revision: 7 }, { finance_month: '2026-09-01', status: 'DRAFT', revision: 5 }]);
  } finally { await db.close(); }
});

test('only Admins reach the loans; the table stays closed to the browser', async () => {
  const db = await setup();
  try {
    await save(db, 'ADD', loanRecord());
    await asUser(db, STAFF_ID);
    await assert.rejects(list(db), /Finance requires a valid authenticated Admin session/);
    await assert.rejects(save(db, 'ADD', loanRecord({ plate_key: 'XAA1002' })), /Finance requires a valid authenticated Admin session/);
    await db.exec('reset role; set role anon');
    await assert.rejects(list(db), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query('select * from finance_private.vehicle_loans'), /permission denied/);
  } finally { await db.close(); }
});

test('the file can safely run twice and keeps the loans', async () => {
  const db = await setup();
  try {
    const [loan] = await save(db, 'ADD', loanRecord());
    await db.exec('reset role');
    await migrate(db, RELEASE);
    await asUser(db);
    assert.deepEqual((await list(db)).map((row) => row.id), [loan.id]);
    const cost = { id: loan.recurring_cost_id, plate_key: 'XAA1001', cost_type: 'Hire Purchase / Loan', monthly_amount: 1, payee: 'x', start_month: '2023-03-01', end_month: null };
    await assert.rejects(mutate(db, 'UPDATE', cost), MANAGED, 'still guarded after the second run');
  } finally { await db.close(); }
});

test('every other door is shut too: a direct change to a loan-owned cost (an Excel import, say) is refused, a plate-only change passes', async () => {
  const db = await setup();
  try {
    const [loan] = await save(db, 'ADD', loanRecord());
    await db.exec('reset role');
    await assert.rejects(db.query(`update finance_private.recurring_costs set monthly_amount = 1 where id = $1`, [loan.recurring_cost_id]), MANAGED, 'amount');
    await assert.rejects(db.query(`update finance_private.recurring_costs set end_month = '2024-01-01' where id = $1`, [loan.recurring_cost_id]), MANAGED, 'end month');
    await assert.rejects(db.query(`update finance_private.recurring_costs set cancelled_at = now() where id = $1`, [loan.recurring_cost_id]), MANAGED, 'cancel');
    await assert.rejects(db.query(`update finance_private.recurring_costs set loan_id = null where id = $1`, [loan.recurring_cost_id]), MANAGED, 'unlink');
    await db.query(`update finance_private.recurring_costs set plate_key = 'XAA1009', notes = 'moved' where id = $1`, [loan.recurring_cost_id]);
    await asUser(db);
    const [cost] = await costs(db, 'XAA1009');
    assert.equal(cost.amount, 575, 'a plate correction or a note leaves the loan-owned figures alone');
  } finally { await db.close(); }
});

test('correcting a plate in Vehicle Master moves the loan with its cost, so the loan can still be edited', async () => {
  const db = await setup();
  try {
    const [loan] = await save(db, 'ADD', loanRecord());
    const revision = (await value<any>(db, `select public.finance_read_month('2026-10-01') value`)).month.revision;
    await value<any>(db, `select public.finance_mutate_record('vehicle', 'CORRECT_PLATE', $1::jsonb, '2026-10-01', $2, 'Corrected registration typo') value`,
      [JSON.stringify({ old_plate: 'XAA1001', plate_key: 'XAA1009', display_plate: 'XAA 1009' }), revision]);
    const [moved] = await list(db);
    assert.equal(moved.plate_key, 'XAA1009');
    assert.equal(moved.display_plate, 'XAA 1009');
    const [cost] = await costs(db, 'XAA1009');
    assert.equal(cost.loan_id, loan.id, 'the cost moved with it and stays linked');
    const [edited] = await save(db, 'UPDATE', { ...loanRecord({ plate_key: 'XAA1009', bank: 'Fixture Bank Two' }), id: moved.id, record_version: moved.record_version });
    assert.equal(edited.bank, 'Fixture Bank Two', 'the loan is still editable under its corrected plate');
  } finally { await db.close(); }
});
