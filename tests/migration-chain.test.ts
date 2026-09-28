import test from 'node:test';
import assert from 'node:assert/strict';
import { asUser, database, migrate } from './finance-db-fixture.ts';

// The Finance chain as it stands in production, then the Cash & Efficiency and collections files in the order the owner runs them.
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
  '20260929090000_collections_support.sql',
];

test('the new files apply after the whole Finance chain, and the additive ones can safely run twice', async () => {
  const db = await database();
  try {
    await db.exec(`alter table public.drivers add column nric text, add column contract_start_date date, add column contract_end_date date,
      add column category text, add column rental_cycle text, add column contract_duration_weeks integer, add column rental_rate numeric,
      add column is_delisted boolean, add column delist_date date, add column created_at timestamptz default now()`);
    for (const file of CHAIN) await migrate(db, file);
    // Running the two additive files again (by mistake) changes nothing and does not fail.
    for (const file of ['20260927090000_cash_position_and_outlook.sql', '20260927090100_driver_portal_phone_screening.sql', '20260929090000_collections_support.sql']) await migrate(db, file);
    await asUser(db);
    const outlook = (await db.query<{ value: any }>(`select public.finance_cash_outlook(current_date) value`)).rows[0].value;
    assert.deepEqual(Object.keys(outlook).sort(), ['balances', 'duplicate_recurring', 'history', 'insurance', 'months', 'today']);
    assert.equal((await db.query<{ value: string | null }>(`select public.finance_portal_instructions() value`)).rows[0].value, null);
  } finally { await db.close(); }
});
