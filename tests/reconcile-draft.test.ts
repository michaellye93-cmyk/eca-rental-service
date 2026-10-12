import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseReconcileDraft, clearReconcileDraft, draftStatements, loadReconcileDraft, markReconcileDraftSynced, saveReconcileDraft, serverDraftTooLarge, type DraftStatement } from '../services/finance/reconcileDraft.ts';

const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; };
const statement = (hash: string): DraftStatement => ({ filename: `${hash}.xlsx`, account_label: 'Bank A', source_hash: hash, finance_month: '2026-08', total_debits: 0, total_credits: 400, issues: [],
  rows: [{ source_row: 1, transaction_date: '2026-08-01', description: 'IBG CREDIT FIXTURE', reference: null, debit: 0, credit: 400, decision: 'MATCHED', payment_source: null, category: null, plate_key: null, matched_kind: 'payment', matched_id: 'p1', review_note: 'Auto-matched' }] });

test('unposted reconcile work is saved per month and comes back after leaving the page', () => {
  const store = memory();
  saveReconcileDraft(store, '2026-08', [statement('a'), statement('b')], new Date('2026-10-06T13:50:00Z'));
  const draft = loadReconcileDraft(store, '2026-08', new Set());
  assert.equal(draft?.statements.length, 2);
  assert.equal(draft?.statements[0].rows[0].matched_id, 'p1');
  assert.equal(draft?.saved_at, '2026-10-06T13:50:00.000Z');
  assert.equal(loadReconcileDraft(store, '2026-09', new Set()), null); // another month has its own draft
});

test('a statement posted since the draft was saved is dropped; an empty or broken draft is ignored', () => {
  const store = memory();
  saveReconcileDraft(store, '2026-08', [statement('a'), statement('b')]);
  assert.deepEqual(loadReconcileDraft(store, '2026-08', new Set(['a']))?.statements.map((s) => s.source_hash), ['b']);
  assert.equal(loadReconcileDraft(store, '2026-08', new Set(['a', 'b'])), null);
  store.setItem('eca_reconcile_draft_2026-08', '{not json');
  assert.equal(loadReconcileDraft(store, '2026-08', new Set()), null);
  saveReconcileDraft(store, '2026-08', [statement('a')]);
  clearReconcileDraft(store, '2026-08');
  assert.equal(loadReconcileDraft(store, '2026-08', new Set()), null);
});

test('saving never throws when the browser refuses storage', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.doesNotThrow(() => saveReconcileDraft(broken, '2026-08', [statement('a')]));
  assert.equal(loadReconcileDraft(broken, '2026-08', new Set()), null);
  assert.doesNotThrow(() => clearReconcileDraft(broken, '2026-08'));
});

test('the draft keeps only the lines read from a statement, never the original file or its column mapping', () => {
  const loaded = { ...statement('a'), file: { name: 'a.xlsx' }, headers: ['Date'], mapping: { date: 'Date' }, outside: 2 };
  const [kept] = draftStatements([loaded]);
  assert.deepEqual(Object.keys(kept).sort(), ['account_label', 'filename', 'finance_month', 'issues', 'rows', 'skipped', 'source_hash', 'total_credits', 'total_debits']);
  assert.equal(serverDraftTooLarge([statement('a')]), false);
  const huge = { ...statement('b'), rows: Array.from({ length: 6000 }, (_, i) => ({ ...statement('b').rows[0], source_row: i, description: 'X'.repeat(400) })) };
  assert.equal(serverDraftTooLarge([huge]), true, 'over 2 MB stays in this browser only');
});

test('the server draft is used on every device; this browser\'s copy wins only for work not yet saved to the server', () => {
  const store = memory();
  const server = { statements: [statement('s')], saved_at: '2026-10-12T02:00:00Z' };
  // Nothing in this browser: the server's draft comes back (work started on another device).
  assert.deepEqual(chooseReconcileDraft(store, '2026-08', new Set(), { available: true, draft: server })?.statements.map((s) => s.source_hash), ['s']);
  // The server update has not been run, or cannot be reached: this browser's copy, as before.
  saveReconcileDraft(store, '2026-08', [statement('local')], new Date('2026-10-12T03:00:00Z'));
  assert.deepEqual(chooseReconcileDraft(store, '2026-08', new Set(), { available: false, draft: null })?.statements.map((s) => s.source_hash), ['local']);
  // Work in this browser not yet saved to the server (the page closed before the save) is kept.
  assert.deepEqual(chooseReconcileDraft(store, '2026-08', new Set(), { available: true, draft: server })?.statements.map((s) => s.source_hash), ['local']);
  assert.deepEqual(chooseReconcileDraft(store, '2026-08', new Set(), { available: true, draft: null })?.statements.map((s) => s.source_hash), ['local'],
    'work made before the database update was run is not lost');
  // Once that copy reached the server, the server decides: a newer draft from another device, or none (posted or discarded there).
  markReconcileDraftSynced(store, '2026-08', '2026-10-12T03:00:00.000Z');
  assert.deepEqual(chooseReconcileDraft(store, '2026-08', new Set(), { available: true, draft: server })?.statements.map((s) => s.source_hash), ['s']);
  assert.equal(chooseReconcileDraft(store, '2026-08', new Set(), { available: true, draft: null }), null);
  // A statement posted since is left out of the server's draft too.
  assert.equal(chooseReconcileDraft(memory(), '2026-08', new Set(['s']), { available: true, draft: server }), null);
  // Marking an older save as synced does not mark newer work in this browser.
  saveReconcileDraft(store, '2026-08', [statement('newer')], new Date('2026-10-12T04:00:00Z'));
  markReconcileDraftSynced(store, '2026-08', '2026-10-12T03:00:00.000Z');
  assert.deepEqual(chooseReconcileDraft(store, '2026-08', new Set(), { available: true, draft: server })?.statements.map((s) => s.source_hash), ['newer']);
});
