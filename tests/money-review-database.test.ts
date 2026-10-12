import test from 'node:test';
import assert from 'node:assert/strict';
import { asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

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
const MIGRATION = '20261012200000_money_review.sql';

async function setup() {
  const db = await database();
  for (const file of [...FINANCE_MIGRATIONS, MIGRATION]) await migrate(db, file);
  await asUser(db);
  return db;
}
const call = async <T>(db: any, sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0].value as T;
const statement = (hash: string) => ({ filename: `${hash}.xlsx`, account_label: 'Bank A', source_hash: hash, finance_month: '2026-08', total_debits: 0, total_credits: 400, issues: [],
  rows: [{ source_row: 1, transaction_date: '2026-08-01', description: 'IBG CREDIT FIXTURE', credit: 400, debit: 0, decision: 'MATCHED', matched_id: 'p1', review_note: 'Auto-matched' }] });

test('unposted Reconcile work is kept on the server per month, for Admins only', async () => {
  const db = await setup();
  try {
    assert.equal(await call(db, `select public.finance_load_reconcile_draft('2026-08-01') value`), null);
    const saved = await call<string>(db, `select public.finance_save_reconcile_draft('2026-08-01', $1::jsonb) value`, [JSON.stringify([statement('a'), statement('b')])]);
    assert.ok(saved, 'returns when it was saved');
    const draft = await call<any>(db, `select public.finance_load_reconcile_draft('2026-08-01') value`);
    assert.deepEqual(draft.statements.map((s: any) => s.source_hash), ['a', 'b']);
    assert.equal(draft.statements[0].rows[0].matched_id, 'p1');
    assert.ok(draft.saved_at);
    assert.equal(await call(db, `select public.finance_load_reconcile_draft('2026-09-01') value`), null, 'another month has its own draft');

    // Saving again replaces the draft; saving no statements (all posted or removed) clears it.
    await db.query(`select public.finance_save_reconcile_draft('2026-08-01', $1::jsonb)`, [JSON.stringify([statement('b')])]);
    assert.deepEqual((await call<any>(db, `select public.finance_load_reconcile_draft('2026-08-01') value`)).statements.map((s: any) => s.source_hash), ['b']);
    await db.query(`select public.finance_save_reconcile_draft('2026-08-01', '[]'::jsonb)`);
    assert.equal(await call(db, `select public.finance_load_reconcile_draft('2026-08-01') value`), null);
    await db.query(`select public.finance_save_reconcile_draft('2026-08-01', $1::jsonb)`, [JSON.stringify([statement('c')])]);
    await db.query(`select public.finance_clear_reconcile_draft('2026-08-01')`);
    assert.equal(await call(db, `select public.finance_load_reconcile_draft('2026-08-01') value`), null);

    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-15', '[]'::jsonb)`), /first day/);
    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-01', '{"rows":[]}'::jsonb)`), /list of statements/);
    // Over 2 MB is refused: the draft holds the lines read from the files, never the files.
    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-01', jsonb_build_array(jsonb_build_object('note', repeat('x', 2200000))))`), /too large/);

    await assert.rejects(db.query(`select * from finance_private.reconcile_drafts`), /permission denied/);
    await asUser(db, STAFF_ID);
    await assert.rejects(db.query(`select public.finance_load_reconcile_draft('2026-08-01')`), /Admin/);
    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-01', '[]'::jsonb)`), /Admin/);
    await assert.rejects(db.query(`select public.finance_clear_reconcile_draft('2026-08-01')`), /Admin/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query(`select public.finance_load_reconcile_draft('2026-08-01')`), /permission denied/);
  } finally { await db.close(); }
});

test('the file can safely run twice', async () => {
  const db = await setup();
  try {
    await db.query(`select public.finance_save_reconcile_draft('2026-08-01', $1::jsonb)`, [JSON.stringify([statement('a')])]);
    await db.exec('reset role');
    await migrate(db, MIGRATION);
    await asUser(db);
    assert.deepEqual((await call<any>(db, `select public.finance_load_reconcile_draft('2026-08-01') value`)).statements.map((s: any) => s.source_hash), ['a']);
  } finally { await db.close(); }
});
