import type { FinanceExpense, QualityIssue } from './finance';
export interface BankSourceRow { source_row: number; transaction_date: string; description: string; reference: string | null; debit: number; credit: number }
export type BankMatchKind = 'payment' | 'smart_import' | 'recurring_cost' | 'insurance' | 'expense';
export interface BankReviewRow extends BankSourceRow {
  decision: 'PENDING' | 'EXPENSE' | 'MATCHED' | 'EXCLUDED';
  payment_source: FinanceExpense['payment_source'] | null; category: string | null; plate_key: string | null;
  matched_kind: BankMatchKind | null; matched_id: string | null; review_note: string;
  /** Two or more payments whose cash adds up to this credit (one transfer paying several things); matched_id is the first. */
  matched_ids?: string[] | null;
}
export interface BankStatementPreview { rows: BankReviewRow[]; issues: QualityIssue[]; total_debits: number; total_credits: number; filename: string; account_label: string; finance_month: string }
export interface BankImport { id: string; finance_month: string; filename: string; account_label: string; source_hash: string; imported_at: string; row_count: number; total_debits: number; total_credits: number }
