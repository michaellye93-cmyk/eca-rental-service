import test from 'node:test';
import assert from 'node:assert/strict';
import { clearReconcileDraft, loadReconcileDraft, saveReconcileDraft, type DraftStatement } from '../services/finance/reconcileDraft.ts';

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
