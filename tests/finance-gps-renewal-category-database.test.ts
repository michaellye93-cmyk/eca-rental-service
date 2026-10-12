import test from 'node:test';
import assert from 'node:assert/strict';
import { asUser, database, migrate } from './finance-db-fixture.ts';
import type { FinanceInput } from '../types/finance.ts';

const month = '2026-08-01';

async function setup() {
  const db = await database();
  for (const file of [
    '20260915084108_secure_profile_roles.sql',
    '20260915084110_finance_foundation.sql',
    '20260915085705_finance_bank_statements.sql',
    '20260915104015_finance_section_workflows.sql',
    '20260915120802_finance_delete_vehicle.sql',
    '20260915122156_finance_insurance_responsibility.sql',
    '20260915124812_finance_insurance_premium_rules.sql',
    '20260915132423_finance_shared_recurring_opex.sql',
    '20260920070959_finance_editable_safe_imports.sql',
    '20261012120000_finance_gps_renewal_category.sql',
  ]) await migrate(db, file);
  await db.exec(`reset role;
    insert into finance_private.vehicles(plate_key,display_plate,business_unit,ownership_type,status)
    values ('ABC123','ABC 123','E-HAILING','Owner','Active');`);
  await asUser(db);
  return db;
}

const call = async <T>(db: any, name: string, args: unknown[]) =>
  (await db.query<{ value: T }>(`select public.${name}(${args.map((_, index) => '$' + (index + 1)).join(',')}) value`, args)).rows[0].value;
const read = (db: any) => call<FinanceInput>(db, 'finance_read_month', [month]);
const expense = (category: string) => JSON.stringify({
  finance_month: month, billing_date: '2026-08-31', plate_key: 'ABC123', category,
  payment_source: 'Vehicle Direct Cost', frequency: 'ONE_OFF', supplier: 'Vendor', amount: 10,
});

test('Other Vehicle Costs accept GPS Renewal and still reject unknown categories', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    input = await call(db, 'finance_mutate_record', ['expense', 'ADD', expense('GPS Renewal'), month, input.month.revision, 'GPS renewal']);
    assert.deepEqual(input.expenses.map((row: any) => row.category), ['GPS Renewal']);
    await assert.rejects(call(db, 'finance_mutate_record', ['expense', 'ADD', expense('Made Up'), month, input.month.revision, 'Unknown']));
  } finally {
    await db.close();
  }
});
