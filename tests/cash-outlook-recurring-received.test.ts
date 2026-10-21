import test from 'node:test';
import assert from 'node:assert/strict';
import { asUser, database, migrate } from './finance-db-fixture.ts';

// Money → Cash: monthly recurring Other Income already Confirmed for a month is in the bank, so the projection no longer
// counts it again for that month (supabase/migrations/20261021210000_cash_outlook_recurring_received.sql).
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
  '20261021180000_other_income_recurring.sql',
];
const RELEASE = '20261021210000_cash_outlook_recurring_received.sql';

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
  await asUser(db);
  return db;
}
const value = async <T>(db: any, sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0].value as T;
const read = (db: any, month: string) => value<any>(db, `select public.finance_read_month($1::date) value`, [month]);
const revision = async (db: any, month: string) => (await read(db, month)).month.revision as number;
const save = async (db: any, action: string, record: Record<string, unknown>) =>
  value<any>(db, `select public.finance_save_other_income($1, $2::jsonb, $3) value`, [action, JSON.stringify(record), await revision(db, String(record.finance_month))]);
const open = async (db: any, month: string) => value<any>(db, `select public.finance_generate_fixed_costs($1::date, $2) value`, [month, await revision(db, month)]);
const ahead = async (db: any, today: string) => (await value<any>(db, `select public.finance_cash_outlook($1::date) value`, [today])).recurring_ahead
  .map((r: any) => [r.month, Number(r.amount)]);
const recurring = (overrides: Record<string, unknown> = {}) => ({
  finance_month: '2026-10-01', status: 'CONFIRMED', income_type: 'Fixture parking rent', amount: 500, plate_key: null,
  business_unit: 'E-HAILING', receipt_date: '2026-10-05', reference: 'FIX-1', notes: null, frequency: 'MONTHLY_RECURRING', ...overrides,
});

test('a month whose recurring line is already Confirmed counts nothing more for that month; Draft lines and later months count in full', async () => {
  const db = await setup();
  try {
    await save(db, 'ADD', recurring());
    await save(db, 'ADD', recurring({ income_type: 'Fixture storage rent', amount: 200, reference: 'FIX-2', status: 'DRAFT' }));
    // October: 500 received (Confirmed), 200 still to come (Draft). November: nothing made yet, both expected.
    assert.deepEqual((await ahead(db, '2026-10-15')).slice(0, 2), [['2026-10-01', 200], ['2026-11-01', 700]]);
    await open(db, '2026-11-01');
    assert.deepEqual((await ahead(db, '2026-10-15')).slice(0, 2), [['2026-10-01', 200], ['2026-11-01', 700]], 'Draft lines made for November still count');
    const november = ((await read(db, '2026-11-01')).other_income as any[]).find((row) => row.income_type === 'Fixture parking rent');
    await save(db, 'UPDATE', { ...recurring({ finance_month: '2026-11-01' }), id: november.id, status: 'CONFIRMED' });
    assert.deepEqual((await ahead(db, '2026-11-15')).slice(0, 2), [['2026-11-01', 200], ['2026-12-01', 700]]);
  } finally { await db.close(); }
});

test('the file can run twice', async () => {
  const db = await setup();
  try {
    await db.exec('reset role');
    await migrate(db, RELEASE);
    await asUser(db);
    assert.deepEqual(await ahead(db, '2026-10-15'), [['2026-10-01', 0], ['2026-11-01', 0], ['2026-12-01', 0], ['2027-01-01', 0], ['2027-02-01', 0], ['2027-03-01', 0]]);
  } finally { await db.close(); }
});
