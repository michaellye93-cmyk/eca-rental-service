import type { BankStatementPreview } from '../../types/finance-bank.ts';

/**
 * Unposted Reconcile work (loaded statements, matches and decisions) kept in this browser per Finance month, so
 * switching tab, window or reloading does not lose it. Nothing here is shared or posted: the draft is cleared when
 * the statements are posted or discarded. The original files are not kept, only the lines read from them.
 */
export type DraftStatement = BankStatementPreview & { source_hash: string; skipped?: { count: number; amount: number } };
export interface ReconcileDraft { version: 1; month: string; saved_at: string; statements: DraftStatement[] }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const key = (month: string) => `eca_reconcile_draft_${month}`;

export function saveReconcileDraft(store: Store, month: string, statements: DraftStatement[], now = new Date()): void {
  try {
    if (!statements.length) { store.removeItem(key(month)); return; }
    const draft: ReconcileDraft = {
      version: 1, month, saved_at: now.toISOString(),
      statements: statements.map(({ rows, issues, total_debits, total_credits, filename, account_label, finance_month, source_hash, skipped }) => ({ rows, issues, total_debits, total_credits, filename, account_label, finance_month, source_hash, skipped })),
    };
    store.setItem(key(month), JSON.stringify(draft));
  } catch { /* storage blocked or full: the work stays on screen, it just is not kept */ }
}

/** The saved draft for the month, without statements posted since it was saved; null when there is nothing to restore. */
export function loadReconcileDraft(store: Store, month: string, postedHashes: Set<string>): ReconcileDraft | null {
  try {
    const raw = store.getItem(key(month));
    if (!raw) return null;
    const draft = JSON.parse(raw) as ReconcileDraft;
    if (draft?.version !== 1 || draft.month !== month || !Array.isArray(draft.statements)) return null;
    const statements = draft.statements.filter((statement) => Array.isArray(statement?.rows) && !postedHashes.has(statement.source_hash));
    return statements.length ? { ...draft, statements } : null;
  } catch {
    return null;
  }
}

export function clearReconcileDraft(store: Store, month: string): void {
  try { store.removeItem(key(month)); } catch { /* nothing to clear */ }
}
