import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseReconcileDraft, clearReconcileDraft, draftStatements, draftToResend, loadReconcileDraft, markReconcileDraftSynced, saveReconcileDraft, SERVER_DRAFT_LIMIT, serverDraftTooLarge, settleServerSave, type DraftStatement } from '../services/finance/reconcileDraft.ts';

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

test('the app keeps a draft for the server only up to 1.8 MB of compact JSON (the server refuses over 2 MB of its own, wider, text)', () => {
  assert.equal(SERVER_DRAFT_LIMIT, Math.floor(1.8 * 1024 * 1024));
  const rows = (count: number) => [{ ...statement('b'), rows: Array.from({ length: count }, (_, i) => ({ ...statement('b').rows[0], source_row: i, description: 'X'.repeat(400) })) }];
  // About 1.9 MB of compact JSON: under the server's 2 MB, but over the app's limit.
  const size = (count: number) => new TextEncoder().encode(JSON.stringify(draftStatements(rows(count)))).length;
  let count = 3000;
  while (size(count) < 1.9 * 1024 * 1024) count += 50;
  assert.ok(size(count) < 2 * 1024 * 1024);
  assert.equal(serverDraftTooLarge(rows(count)), true);
});

test('when the server refuses an older save, this browser keeps whichever draft is newer', () => {
  const store = memory();
  saveReconcileDraft(store, '2026-08', [statement('mine')], new Date('2026-10-12T03:00:00Z'));
  // Accepted: the server returns the draft as sent (its own time format), and this browser's copy is marked as on the server.
  assert.equal(settleServerSave(store, '2026-08', '2026-10-12T03:00:00.000Z', { statements: [statement('mine')], saved_at: '2026-10-12T03:00:00+00:00' }), 'saved');
  assert.equal(chooseReconcileDraft(store, '2026-08', new Set(), { available: true, draft: null }), null, 'on the server: the server decides');
  // Refused: another device saved newer work; it replaces this browser's older copy, so reopening shows it.
  saveReconcileDraft(store, '2026-08', [statement('mine2')], new Date('2026-10-12T04:00:00Z'));
  const newer = { statements: [statement('theirs')], saved_at: '2026-10-12T05:00:00+00:00' };
  assert.equal(settleServerSave(store, '2026-08', '2026-10-12T04:00:00.000Z', newer), 'newer-on-server');
  assert.deepEqual(loadReconcileDraft(store, '2026-08', new Set())?.statements.map((s) => s.source_hash), ['theirs']);
  assert.equal(draftToResend(store, '2026-08', new Set(), { available: true, draft: newer }), null, 'nothing of this browser left to send');
  // Refused, but this browser has changed since (a newer local copy): the newer local copy stays, to be sent next.
  saveReconcileDraft(store, '2026-08', [statement('latest')], new Date('2026-10-12T06:00:00Z'));
  assert.equal(settleServerSave(store, '2026-08', '2026-10-12T04:30:00.000Z', newer), 'newer-on-server');
  assert.deepEqual(loadReconcileDraft(store, '2026-08', new Set())?.statements.map((s) => s.source_hash), ['latest']);
});

test('a discard is kept as an empty draft, so an older copy anywhere cannot bring the work back', () => {
  const store = memory();
  saveReconcileDraft(store, '2026-08', [statement('a')], new Date('2026-10-12T03:00:00Z'));
  markReconcileDraftSynced(store, '2026-08', '2026-10-12T03:00:00.000Z');
  saveReconcileDraft(store, '2026-08', [], new Date('2026-10-12T04:00:00Z'));
  assert.equal(loadReconcileDraft(store, '2026-08', new Set()), null, 'nothing to restore');
  // The discard has not reached the server, which still holds the older draft: it is not restored, and the discard is sent.
  const older = { statements: [statement('a')], saved_at: '2026-10-12T03:00:00+00:00' };
  assert.equal(chooseReconcileDraft(store, '2026-08', new Set(), { available: true, draft: older }), null);
  assert.deepEqual(draftToResend(store, '2026-08', new Set(), { available: true, draft: older }), { statements: [], saved_at: '2026-10-12T04:00:00.000Z' });
  // A discard made on another device after this browser's unsent work wins over it.
  const other = memory();
  saveReconcileDraft(other, '2026-08', [statement('unsent')], new Date('2026-10-12T03:30:00Z'));
  const discarded = { statements: [], saved_at: '2026-10-12T04:00:00+00:00' };
  assert.equal(chooseReconcileDraft(other, '2026-08', new Set(), { available: true, draft: discarded }), null);
  assert.equal(draftToResend(other, '2026-08', new Set(), { available: true, draft: discarded }), null);
});

test('only this browser\'s work that never reached the server is sent again on opening, with the time it was made', () => {
  const store = memory();
  const server = { statements: [statement('s')], saved_at: '2026-10-12T02:00:00+00:00' };
  assert.equal(draftToResend(store, '2026-08', new Set(), { available: true, draft: server }), null, 'nothing in this browser');
  saveReconcileDraft(store, '2026-08', [statement('local'), statement('posted')], new Date('2026-10-12T03:00:00Z'));
  assert.deepEqual(draftToResend(store, '2026-08', new Set(['posted']), { available: true, draft: server }), { statements: [statement('local')], saved_at: '2026-10-12T03:00:00.000Z' },
    'unsent and newer: sent with its own time, without statements posted since');
  assert.equal(draftToResend(store, '2026-08', new Set(), { available: false, draft: null }), null, 'no server to send to');
  markReconcileDraftSynced(store, '2026-08', '2026-10-12T03:00:00.000Z');
  assert.equal(draftToResend(store, '2026-08', new Set(), { available: true, draft: server }), null, 'already on the server: a restored draft is not sent again');
});

test('a draft keeps the statement month-end balances, so a statement restored from it still fills Cash when posted', () => {
  const [kept] = draftStatements([{ rows: [], issues: [], total_debits: 0, total_credits: 0, filename: 'f.xlsx', account_label: 'RHB …9999',
    finance_month: '2026-09', source_hash: 'h', opening_balance: 1000, closing_balance: 900 } as DraftStatement]);
  assert.equal(kept.opening_balance, 1000);
  assert.equal(kept.closing_balance, 900);
});
