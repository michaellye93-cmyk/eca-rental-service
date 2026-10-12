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

// When each change was made on the device (the client sends its own time with every save and clear).
const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 2, minute)).toISOString();
const save = (db: any, month: string, statements: unknown[], savedAt: string) =>
  call<any>(db, `select public.finance_save_reconcile_draft($1::date, $2::jsonb, $3::timestamptz) value`, [month, JSON.stringify(statements), savedAt]);
const clear = (db: any, month: string, savedAt: string) => call<any>(db, `select public.finance_clear_reconcile_draft($1::date, $2::timestamptz) value`, [month, savedAt]);
const load = (db: any, month: string) => call<any>(db, `select public.finance_load_reconcile_draft($1::date) value`, [month]);
const hashes = (draft: any) => draft.statements.map((s: any) => s.source_hash);
const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b);

test('unposted Reconcile work is kept on the server per month, for Admins only', async () => {
  const db = await setup();
  try {
    assert.equal(await load(db, '2026-08-01'), null);
    const saved = await save(db, '2026-08-01', [statement('a'), statement('b')], at(1));
    assert.ok(sameTime(saved.saved_at, at(1)), 'returns the stored draft, saved at the time the change was made');
    const draft = await load(db, '2026-08-01');
    assert.deepEqual(hashes(draft), ['a', 'b']);
    assert.equal(draft.statements[0].rows[0].matched_id, 'p1');
    assert.ok(sameTime(draft.saved_at, at(1)));
    assert.equal(await load(db, '2026-09-01'), null, 'another month has its own draft');

    // Saving again replaces the draft; saving no statements (all posted or removed) clears it, keeping when that was
    // done (so an older save arriving late cannot bring the work back).
    await save(db, '2026-08-01', [statement('b')], at(2));
    assert.deepEqual(hashes(await load(db, '2026-08-01')), ['b']);
    await save(db, '2026-08-01', [], at(3));
    const cleared = await load(db, '2026-08-01');
    assert.deepEqual(cleared.statements, [], 'nothing to restore');
    assert.ok(sameTime(cleared.saved_at, at(3)));
    await save(db, '2026-08-01', [statement('c')], at(4));
    await clear(db, '2026-08-01', at(5));
    assert.deepEqual((await load(db, '2026-08-01')).statements, []);

    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-15', '[]'::jsonb, now())`), /first day/);
    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-01', '{"rows":[]}'::jsonb, now())`), /list of statements/);
    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-01', '[]'::jsonb, null)`), /time/);
    // Over 2 MB is refused: the draft holds the lines read from the files, never the files.
    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-01', jsonb_build_array(jsonb_build_object('note', repeat('x', 2200000))), now())`), /too large/);

    await assert.rejects(db.query(`select * from finance_private.reconcile_drafts`), /permission denied/);
    await asUser(db, STAFF_ID);
    await assert.rejects(db.query(`select public.finance_load_reconcile_draft('2026-08-01')`), /Admin/);
    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-01', '[]'::jsonb, now())`), /Admin/);
    await assert.rejects(db.query(`select public.finance_clear_reconcile_draft('2026-08-01', now())`), /Admin/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query(`select public.finance_load_reconcile_draft('2026-08-01')`), /permission denied/);
  } finally { await db.close(); }
});

const totals = { revenue: 10000, contribution: 4000, profit: 2500, margin: 0.25, rules_version: 1 };
const stored = (db: any) => call<any[]>(db, `select public.finance_month_totals() value`);

test('a closed month keeps its trend figures, which go stale when the month is reopened', async () => {
  const db = await setup();
  try {
    await db.exec(`reset role;
      insert into finance_private.months(finance_month,status,revision,frozen_input) values
        ('2026-08-01','CLOSED',3,'{}'::jsonb),('2026-09-01','CLOSED',5,'{}'::jsonb),('2026-10-01','DRAFT',1,null);`);
    await asUser(db);
    assert.deepEqual(await stored(db), []);
    await db.query(`select public.finance_save_month_totals('2026-08-01', 3, $1::jsonb)`, [JSON.stringify(totals)]);
    await db.query(`select public.finance_save_month_totals('2026-09-01', 5, $1::jsonb)`, [JSON.stringify({ ...totals, margin: null })]);
    const rows = await stored(db);
    assert.deepEqual(rows.map((r: any) => [r.month, r.revision]), [['2026-08-01', 3], ['2026-09-01', 5]]);
    assert.deepEqual(rows[0].totals, totals);
    assert.equal(rows[1].totals.margin, null);

    // Only a closed month at its current revision can be stored.
    await assert.rejects(db.query(`select public.finance_save_month_totals('2026-10-01', 1, $1::jsonb)`, [JSON.stringify(totals)]), /closed/);
    await assert.rejects(db.query(`select public.finance_save_month_totals('2026-08-01', 2, $1::jsonb)`, [JSON.stringify(totals)]), /changed/);
    await assert.rejects(db.query(`select public.finance_save_month_totals('2026-08-01', 3, '{"revenue":"lots"}'::jsonb)`), /figures/);
    // The rules version the figures were worked out by is kept, and required.
    const { rules_version: _, ...withoutVersion } = totals;
    await assert.rejects(db.query(`select public.finance_save_month_totals('2026-08-01', 3, $1::jsonb)`, [JSON.stringify(withoutVersion)]), /figures/);

    // Reopening moves the month to a new revision: its stored row is no longer returned, so the trend reads it live.
    await db.exec(`reset role; update finance_private.months set status='DRAFT', revision=4, frozen_input=null where finance_month='2026-08-01';`);
    await asUser(db);
    assert.deepEqual((await stored(db)).map((r: any) => r.month), ['2026-09-01']);
    // Closed again: saved again at the new revision.
    await db.exec(`reset role; update finance_private.months set status='CLOSED', revision=5, frozen_input='{}' where finance_month='2026-08-01';`);
    await asUser(db);
    await db.query(`select public.finance_save_month_totals('2026-08-01', 5, $1::jsonb)`, [JSON.stringify({ ...totals, profit: 2000 })]);
    assert.deepEqual((await stored(db)).map((r: any) => [r.month, r.revision, r.totals.profit]), [['2026-08-01', 5, 2000], ['2026-09-01', 5, 2500]]);

    await assert.rejects(db.query(`select * from finance_private.month_totals`), /permission denied/);
    await asUser(db, STAFF_ID);
    await assert.rejects(stored(db), /Admin/);
    await assert.rejects(db.query(`select public.finance_save_month_totals('2026-09-01', 5, $1::jsonb)`, [JSON.stringify(totals)]), /Admin/);
  } finally { await db.close(); }
});

test('the file can safely run twice', async () => {
  const db = await setup();
  try {
    await save(db, '2026-08-01', [statement('a')], at(1));
    await db.exec('reset role');
    await migrate(db, MIGRATION);
    await asUser(db);
    assert.deepEqual(hashes(await load(db, '2026-08-01')), ['a']);
  } finally { await db.close(); }
});

test('a save or clear older than the stored draft is refused without an error, and the stored draft is returned', async () => {
  const db = await setup();
  try {
    // Out of order: the save made at minute 2 arrives after the one made at minute 3.
    await save(db, '2026-08-01', [statement('new')], at(3));
    const late = await save(db, '2026-08-01', [statement('old')], at(2));
    assert.deepEqual(hashes(late), ['new'], 'the stored (newer) draft comes back');
    assert.ok(sameTime(late.saved_at, at(3)));
    assert.deepEqual(hashes(await load(db, '2026-08-01')), ['new']);
    // The same time is not newer either.
    assert.deepEqual(hashes(await save(db, '2026-08-01', [statement('same')], at(3))), ['new']);

    // Discarded at minute 5; a save made at minute 4 arriving afterwards does not bring the work back.
    const discarded = await clear(db, '2026-08-01', at(5));
    assert.deepEqual(discarded.statements, []);
    const resurrect = await save(db, '2026-08-01', [statement('old')], at(4));
    assert.deepEqual(resurrect.statements, [], 'refused: the discard is newer');
    assert.ok(sameTime(resurrect.saved_at, at(5)));
    assert.deepEqual((await load(db, '2026-08-01')).statements, []);
    // A clear older than the stored draft is refused too.
    await save(db, '2026-08-01', [statement('kept')], at(7));
    assert.deepEqual(hashes(await clear(db, '2026-08-01', at(6))), ['kept']);
    assert.deepEqual(hashes(await load(db, '2026-08-01')), ['kept']);
    // A newer save is kept.
    assert.deepEqual(hashes(await save(db, '2026-08-01', [statement('newer')], at(8))), ['newer']);

    // A device clock far ahead would lock the month for everyone else: refused (the work stays in that browser).
    await assert.rejects(db.query(`select public.finance_save_reconcile_draft('2026-08-01', '[]'::jsonb, now() + interval '1 day')`), /clock/);
  } finally { await db.close(); }
});

test('a draft the app sends (up to 1.8 MB of compact JSON) fits the server limit of 2 MB', async () => {
  const { draftStatements, serverDraftTooLarge, SERVER_DRAFT_LIMIT } = await import('../services/finance/reconcileDraft.ts');
  // Realistic lines: a matched credit with a typical bank description, as Reconcile keeps them.
  const row = (i: number) => ({ source_row: i, transaction_date: '2026-08-01', description: 'RPP INWARD INST TRF FIXTURE DRIVER ALPHA / XAA1001 SEWA', reference: String(100000 + i),
    debit: 0, credit: 400, decision: 'MATCHED', payment_source: null, category: null, plate_key: null, matched_kind: 'payment', matched_id: `p${i}`, review_note: 'Auto-matched' });
  const sized = (count: number) => [{ ...statement('big'), rows: Array.from({ length: count }, (_, i) => row(i + 1)) }];
  let count = 1000;
  while (!serverDraftTooLarge(sized(count + 200) as any)) count += 200;
  const draft = draftStatements(sized(count) as any);
  const compact = new TextEncoder().encode(JSON.stringify(draft)).length;
  assert.ok(compact <= SERVER_DRAFT_LIMIT && compact > SERVER_DRAFT_LIMIT - 120000, `close to the app's limit (${compact} bytes)`);
  const db = await setup();
  try {
    const saved = await save(db, '2026-08-01', draft, at(1));
    assert.equal(saved.statements[0].rows.length, count, 'the server keeps it');
  } finally { await db.close(); }
});
