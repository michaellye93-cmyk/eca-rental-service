import test from 'node:test';
import assert from 'node:assert/strict';
import { asUser, database, migrate } from './finance-db-fixture.ts';

// The Finance chain as it stands in production, then the Cash & Efficiency, collections and car-list files in the order the owner runs them.
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
  '20261021210000_cash_outlook_recurring_received.sql',
];

test('the new files apply after the whole Finance chain, and the additive ones can safely run twice', async () => {
  const db = await database();
  try {
    await db.exec(`alter table public.drivers add column nric text, add column contract_start_date date, add column contract_end_date date,
      add column category text, add column rental_cycle text, add column contract_duration_weeks integer, add column rental_rate numeric,
      add column is_delisted boolean, add column delist_date date, add column created_at timestamptz default now()`);
    await db.exec(`create table public.cars(id text primary key, make text, model text, "plateNumber" text, "roadtaxExpiry" text,
      "insuranceExpiry" text, "inspectionExpiry" text, notes text, label text, ownership text);
      alter table public.cars enable row level security;
      create policy "Enable all access for cars" on public.cars for all using (true) with check (true);
      grant all on public.cars to anon, authenticated, service_role;`);
    for (const file of CHAIN) await migrate(db, file);
    assert.equal((await db.query<{ open: boolean }>(`select has_table_privilege('anon', 'public.cars', 'SELECT') open`)).rows[0].open, false,
      'at the end of the chain signed-out visitors cannot read the car list');
    // Running the two additive files again (by mistake) changes nothing and does not fail.
    for (const file of ['20260927090000_cash_position_and_outlook.sql', '20260927090100_driver_portal_phone_screening.sql', '20260929090000_collections_support.sql', '20261006090000_finance_car_history_and_cash_flow.sql', '20261007120000_driver_portal_remember.sql', '20261009090000_vehicle_details_and_agreements.sql', '20261009150000_driver_master_and_agreement_copy.sql', '20261009170000_returning_drivers.sql', '20261010090000_drop_approved_driver.sql', '20261012180000_security_review.sql', '20261012200000_money_review.sql', '20261012210000_collections_tools.sql', '20261012220000_cleanup.sql', '20261012230000_collection_runs.sql', '20261012240000_one_vehicle.sql', '20261021090000_vehicle_loans.sql', '20261021150000_vehicle_loan_letter_fields.sql', '20261021180000_other_income_recurring.sql', '20261021210000_cash_outlook_recurring_received.sql']) await migrate(db, file);
    await asUser(db);
    const outlook = (await db.query<{ value: any }>(`select public.finance_cash_outlook(current_date) value`)).rows[0].value;
    assert.deepEqual(Object.keys(outlook).sort(), ['balances', 'duplicate_recurring', 'history', 'insurance', 'months', 'recurring_ahead', 'today']);
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from pg_proc where proname = 'finance_portal_instructions'`)).rows[0].n, 0,
      'the old "How to pay" text is gone at the end of the chain');
    // Reconcile drafts: each save and clear carries the time the change was made (one version of each, no older overload).
    const args = async (name: string) => (await db.query<{ args: string }>(`select pg_get_function_identity_arguments(p.oid) args from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name])).rows.map((row) => row.args);
    assert.deepEqual(await args('finance_save_reconcile_draft'), ['p_month date, p_statements jsonb, p_saved_at timestamp with time zone']);
    assert.deepEqual(await args('finance_clear_reconcile_draft'), ['p_month date, p_saved_at timestamp with time zone']);
    const saved = (await db.query<{ value: any }>(`select public.finance_save_reconcile_draft('2026-08-01', '[]'::jsonb, now()) value`)).rows[0].value;
    assert.deepEqual(saved.statements, []);
    // Vehicle loans: the list reads at the end of the chain (empty here).
    assert.deepEqual((await db.query<{ value: unknown }>(`select public.finance_vehicle_loans() value`)).rows[0].value, []);
  } finally { await db.close(); }
});
