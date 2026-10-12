import type { BankStatementPreview } from '../../types/finance-bank.ts';

/**
 * Unposted Reconcile work (loaded statements, matches and decisions) per Finance month, so switching tab, window,
 * device or reloading does not lose it. It is saved on the server (finance_save_reconcile_draft, see
 * supabase/migrations/20261012200000_money_review.sql) and in this browser, which is also the fallback while that
 * database update has not been run. Nothing here is posted: the draft is cleared when the statements are posted or
 * discarded. The original files are not kept, only the lines read from them.
 *
 * Every copy carries `saved_at`, the time the change was made in this browser. The server keeps a save or clear only
 * when it is newer than what it holds, and this browser keeps whichever copy is newer, so a save arriving late never
 * brings back work discarded or posted since. A clear is kept as an empty draft with its time, for the same reason.
 */
export type DraftStatement = BankStatementPreview & { source_hash: string; skipped?: { count: number; amount: number } };
/** `synced_at` is the `saved_at` of the copy that reached the server; when they differ this browser has newer work. */
export interface ReconcileDraft { version: 1; month: string; saved_at: string; synced_at?: string; statements: DraftStatement[] }
/** The month's draft as the server returns it. */
export interface ServerReconcileDraft { statements: DraftStatement[]; saved_at: string }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const key = (month: string) => `eca_reconcile_draft_${month}`;
/**
 * The server refuses a draft over 2 MB of its own JSON text, which is wider than compact JSON (a space after every
 * ":" and ","), so the app sends at most 1.8 MB of compact JSON; a larger draft stays in this browser only.
 */
export const SERVER_DRAFT_LIMIT = Math.floor(1.8 * 1024 * 1024);

/** What a draft keeps of each loaded statement: the lines read and the decisions, never the file or its mapping. */
export const draftStatements = (statements: DraftStatement[]): DraftStatement[] =>
  statements.map(({ rows, issues, total_debits, total_credits, filename, account_label, finance_month, source_hash, skipped }) => ({ rows, issues, total_debits, total_credits, filename, account_label, finance_month, source_hash, skipped }));

export const serverDraftTooLarge = (statements: DraftStatement[]) =>
  new TextEncoder().encode(JSON.stringify(draftStatements(statements))).length > SERVER_DRAFT_LIMIT;

/** Saves this browser's copy; no statements (posted or discarded) is kept as an empty draft with its time. */
export function saveReconcileDraft(store: Store, month: string, statements: DraftStatement[], now = new Date()): void {
  try {
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

const time = (value: string) => Date.parse(value);
const safeRead = (store: Store | null, month: string) => {
  try { return store ? readDraft(store, month) : null; } catch { return null; }
};
type ServerSide = { available: boolean; draft: ServerReconcileDraft | null };
/** This browser's copy when it has not reached the server and is newer than the server's draft (or there is none). */
const unsentAndNewer = (store: Store | null, month: string, server: ServerSide) => {
  const local = safeRead(store, month);
  if (!local || local.synced_at === local.saved_at) return null;
  const remote = server.draft && Array.isArray(server.draft.statements) ? server.draft : null;
  return !remote || time(local.saved_at) > time(remote.saved_at) ? local : null;
};

/**
 * The draft to restore. Without the server (database update not run, or unreachable) this browser's copy, as before.
 * With it, the server's draft, so work moves between devices; except when this browser holds newer work that has not
 * reached the server yet (the page closed before the save, or it was made before the update was run).
 */
export function chooseReconcileDraft(
  store: Store | null, month: string, postedHashes: Set<string>, server: ServerSide,
): { statements: DraftStatement[]; saved_at: string } | null {
  if (!server.available) return store ? loadReconcileDraft(store, month, postedHashes) : null;
  const local = unsentAndNewer(store, month, server);
  if (local) return withoutPosted(local, postedHashes);
  return server.draft && Array.isArray(server.draft.statements) ? withoutPosted(server.draft, postedHashes) : null;
}

/**
 * On opening Reconcile: this browser's newer work that never reached the server (an empty list for a discard), to be
 * sent once with the time it was made, without statements posted since. A draft restored from the server, or already
 * on it, is never sent again unless it is changed here.
 */
export function draftToResend(store: Store | null, month: string, postedHashes: Set<string>, server: ServerSide): { statements: DraftStatement[]; saved_at: string } | null {
  if (!server.available) return null;
  const local = unsentAndNewer(store, month, server);
  if (!local) return null;
  return { statements: withoutPosted(local, postedHashes)?.statements ?? [], saved_at: local.saved_at };
}

/**
 * After the server answers a save or clear sent with `sentSavedAt`: the draft it holds. The same time means it was
 * kept ("saved"). Otherwise it was refused because the server holds newer work, which replaces this browser's copy
 * unless this browser has changed since ("newer-on-server").
 */
export function settleServerSave(store: Store, month: string, sentSavedAt: string, stored: ServerReconcileDraft): 'saved' | 'newer-on-server' {
  if (time(stored.saved_at) === time(sentSavedAt)) {
    markReconcileDraftSynced(store, month, sentSavedAt);
    return 'saved';
  }
  try {
    const local = readDraft(store, month);
    if (!local || time(stored.saved_at) > time(local.saved_at)) {
      const copy: ReconcileDraft = { version: 1, month, saved_at: stored.saved_at, synced_at: stored.saved_at, statements: Array.isArray(stored.statements) ? stored.statements : [] };
      store.setItem(key(month), JSON.stringify(copy));
    }
  } catch { /* storage blocked: nothing to keep */ }
  return 'newer-on-server';
}

export function clearReconcileDraft(store: Store, month: string): void {
  try { store.removeItem(key(month)); } catch { /* nothing to clear */ }
}
