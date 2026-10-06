import test from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, database, migrate } from './finance-db-fixture.ts';

// Production as it stands (to 2026-10-06), then the split-match file.
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
];
const RELEASE = '20261006180000_finance_bank_split_match.sql';
const DRIVER_A = '10000000-0000-4000-8000-00000000000a';
const RENT = '20000000-0000-4000-8000-000000000001';
const PENALTY = '20000000-0000-4000-8000-000000000002';
const OTHER = '20000000-0000-4000-8000-000000000003';
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
      ('${RENT}','${DRIVER_A}','2026-08-25',500,0,'BANK TRANSFER'),
      ('${PENALTY}','${DRIVER_A}','2026-08-25',10,0,'BANK TRANSFER'),
      ('${OTHER}','${DRIVER_A}','2026-08-26',20,0,'BANK TRANSFER');
    insert into finance_private.vehicles(plate_key,display_plate,business_unit,ownership_type,status) values
      ('XAA1001','XAA1001','E-HAILING','Car Owner','Active');`);
  await migrate(db, RELEASE);
  return db;
}
const rows = async <T,>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const call = async (db: PGlite, name: string, args: unknown[]) =>
  (await rows<{ value: any }>(db, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args))[0].value;
const line = (ids: string[], credit = 510) => ({ source_row: 1, transaction_date: '2026-08-25', description: 'Transfer from Fixture Driver A', reference: '925',
  debit: 0, credit, decision: 'MATCHED', payment_source: null, category: null, plate_key: null, matched_kind: 'payment', matched_id: ids[0], matched_ids: ids, review_note: 'Rent and penalty in one transfer' });
const post = (db: PGlite, rowsJson: unknown[], revision: number, hash = 'c'.repeat(64)) =>
  db.query(`select public.finance_post_bank_statement($1,'statement.csv','Operating',$2::jsonb,$3,$4)`, [august, JSON.stringify(rowsJson), revision, hash]);

test('one bank line can be matched to several payments of the same month that add up to it', async () => {
  const db = await setup();
  try {
    await asUser(db);
    let data = await call(db, 'finance_refresh_payments', [august]);
    await post(db, [line([RENT, PENALTY])], data.month.revision);
    data = await call(db, 'finance_read_month', [august]);
    const [row] = data.bank_rows;
    assert.deepEqual([row.matched_id, row.matched_ids, row.match_valid], [RENT, [RENT, PENALTY], true]);
    // Both payments show Bank ✓ on the Drivers page.
    const status = await call(db, 'finance_payment_bank_status', [DRIVER_A]);
    assert.deepEqual([...status.matched].sort(), [RENT, PENALTY].sort());
  } finally { await db.close(); }
});

test('payments that do not add up to the bank line, or a payment listed twice, are refused', async () => {
  const db = await setup();
  try {
    await asUser(db);
    const data = await call(db, 'finance_refresh_payments', [august]);
    await assert.rejects(post(db, [line([RENT, OTHER])], data.month.revision), /does not match/);
    await assert.rejects(post(db, [line([RENT, RENT], 1000)], data.month.revision, 'd'.repeat(64)), /does not match/);
    await assert.rejects(post(db, [{ ...line([RENT, PENALTY]), matched_id: OTHER }], data.month.revision, 'e'.repeat(64)), /does not match/);
  } finally { await db.close(); }
});

test('a split match turns invalid when one of its payments changes, and single matches work as before', async () => {
  const db = await setup();
  try {
    await asUser(db);
    let data = await call(db, 'finance_refresh_payments', [august]);
    const single = { ...line([OTHER], 20), source_row: 2, description: 'Another transfer', matched_ids: null };
    await post(db, [line([RENT, PENALTY]), single], data.month.revision);
    await db.exec(`reset role; select set_config('request.jwt.claims','',false); update public.payments set amount=15 where id='${PENALTY}'`);
    await asUser(db);
    data = await call(db, 'finance_refresh_payments', [august]);
    const byRow = new Map(data.bank_rows.map((r: any) => [r.source_row, r]));
    assert.equal((byRow.get(1) as any).match_valid, false);
    assert.equal((byRow.get(2) as any).match_valid, true);
  } finally { await db.close(); }
});

test('the file can run twice', async () => {
  const db = await setup();
  try {
    await migrate(db, RELEASE);
    await asUser(db);
    const data = await call(db, 'finance_refresh_payments', [august]);
    await post(db, [line([RENT, PENALTY])], data.month.revision);
  } finally { await db.close(); }
});
