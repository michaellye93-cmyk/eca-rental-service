import type { BankStatementPreview } from '../../types/finance-bank.ts';

/**
 * Unposted Reconcile work (loaded statements, matches and decisions) per Finance month, so switching tab, window,
 * device or reloading does not lose it. It is saved on the server (finance_save_reconcile_draft, see
 * supabase/migrations/20261012200000_money_review.sql) and in this browser, which is also the fallback while that
 * database update has not been run. Nothing here is posted: the draft is cleared when the statements are posted or
 * discarded. The original files are not kept, only the lines read from them.
 */
export type DraftStatement = BankStatementPreview & { source_hash: string; skipped?: { count: number; amount: number } };
/** `synced_at` is the `saved_at` of the copy that reached the server; when they differ this browser has newer work. */
export interface ReconcileDraft { version: 1; month: string; saved_at: string; synced_at?: string; statements: DraftStatement[] }
/** The month's draft as the server returns it. */
export interface ServerReconcileDraft { statements: DraftStatement[]; saved_at: string }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const key = (month: string) => `eca_reconcile_draft_${month}`;
/** The server refuses a draft over 2 MB; a larger one stays in this browser only. */
export const SERVER_DRAFT_LIMIT = 2 * 1024 * 1024;

/** What a draft keeps of each loaded statement: the lines read and the decisions, never the file or its mapping. */
export const draftStatements = (statements: DraftStatement[]): DraftStatement[] =>
  statements.map(({ rows, issues, total_debits, total_credits, filename, account_label, finance_month, source_hash, skipped }) => ({ rows, issues, total_debits, total_credits, filename, account_label, finance_month, source_hash, skipped }));

export const serverDraftTooLarge = (statements: DraftStatement[]) =>
  new TextEncoder().encode(JSON.stringify(draftStatements(statements))).length > SERVER_DRAFT_LIMIT;

export function saveReconcileDraft(store: Store, month: string, statements: DraftStatement[], now = new Date()): void {
  try {
    if (!statements.length) { store.removeItem(key(month)); return; }
    const draft: ReconcileDraft = { version: 1, month, saved_at: now.toISOString(), statements: draftStatements(statements) };
    store.setItem(key(month), JSON.stringify(draft));
  } catch { /* storage blocked or full: the work stays on screen, it just is not kept */ }
}

function readDraft(store: Store, month: string): ReconcileDraft | null {
  const raw = store.getItem(key(month));
  if (!raw) return null;
  const draft = JSON.parse(raw) as ReconcileDraft;
  return draft?.version === 1 && draft.month === month && Array.isArray(draft.statements) ? draft : null;
}
const withoutPosted = <T extends { statements: DraftStatement[] }>(draft: T, postedHashes: Set<string>): T | null => {
  const statements = draft.statements.filter((statement) => Array.isArray(statement?.rows) && !postedHashes.has(statement.source_hash));
  return statements.length ? { ...draft, statements } : null;
};

/** The saved draft for the month, without statements posted since it was saved; null when there is nothing to restore. */
export function loadReconcileDraft(store: Store, month: string, postedHashes: Set<string>): ReconcileDraft | null {
  try {
    const draft = readDraft(store, month);
    return draft ? withoutPosted(draft, postedHashes) : null;
  } catch {
    return null;
  }
}

/** Records that the copy saved at `savedAt` reached the server (ignored when this browser has saved newer work since). */
export function markReconcileDraftSynced(store: Store, month: string, savedAt: string): void {
  try {
    const draft = readDraft(store, month);
    if (draft && draft.saved_at === savedAt) store.setItem(key(month), JSON.stringify({ ...draft, synced_at: savedAt }));
  } catch { /* nothing to mark */ }
}

/**
 * The draft to restore. Without the server (database update not run, or unreachable) this browser's copy, as before.
 * With it, the server's draft, so work moves between devices; except when this browser holds work that has not
 * reached the server yet (the page closed before the save, or it was made before the update was run).
 */
export function chooseReconcileDraft(
  store: Store | null, month: string, postedHashes: Set<string>,
  server: { available: boolean; draft: ServerReconcileDraft | null },
): { statements: DraftStatement[]; saved_at: string } | null {
  const local = store ? loadReconcileDraft(store, month, postedHashes) : null;
  if (!server.available) return local;
  if (local && local.synced_at !== local.saved_at) return local;
  return server.draft && Array.isArray(server.draft.statements) ? withoutPosted(server.draft, postedHashes) : null;
}

export function clearReconcileDraft(store: Store, month: string): void {
  try { store.removeItem(key(month)); } catch { /* nothing to clear */ }
}
