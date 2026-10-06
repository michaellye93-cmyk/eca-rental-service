import type { BankReviewRow } from '../../types/finance-bank.ts';
import type { EhailingPayment } from '../../types/finance.ts';
import { suggestPaymentMatches, unsolvedPayments, type PaymentSuggestion } from './bankMatchSuggestions.ts';

/**
 * Reconciling several bank statements for one month together (ECA banks with two accounts): matches are suggested
 * across all loaded statements at once, sure matches are applied on load, and every cash payment recorded in the app
 * is either solved (matched to a bank credit) or queued for a look.
 */

// Rows of each statement are numbered apart so one matcher run sees every statement and uses each payment once.
const STRIDE = 1_000_000;

export function suggestAcrossStatements(statements: BankReviewRow[][], payments: EhailingPayment[], taken: Set<string> = new Set(), references?: Map<string, string>): Array<Map<number, PaymentSuggestion>> {
  const combined = statements.flatMap((rows, index) => rows.map((row) => ({ ...row, source_row: index * STRIDE + row.source_row })));
  const all = suggestPaymentMatches(combined, payments, taken, references);
  const result = statements.map(() => new Map<number, PaymentSuggestion>());
  for (const [key, suggestion] of all) {
    const sourceRow = key % STRIDE;
    result[Math.floor(key / STRIDE)].set(sourceRow, { ...suggestion, sourceRow });
  }
  return result;
}

export function matchRow(row: BankReviewRow, paymentId: string, note: string): BankReviewRow {
  return { ...row, decision: 'MATCHED', payment_source: null, category: null, plate_key: null, matched_kind: 'payment', matched_id: paymentId, review_note: note };
}

/** Certain and strong matches are taken without a click; weak ones (looser name, wide date gap, cash deposit) wait. */
export function applySureMatches(rows: BankReviewRow[], suggestions: Map<number, PaymentSuggestion>): BankReviewRow[] {
  return rows.map((row) => {
    const suggestion = suggestions.get(row.source_row);
    return suggestion && suggestion.confidence !== 'WEAK' && row.decision === 'PENDING' ? matchRow(row, suggestion.paymentId, `Auto-matched: ${suggestion.reason}`) : row;
  });
}

export interface PaymentCheck {
  total: number;
  solved: EhailingPayment[];
  /** Solved in a statement that is loaded but not posted yet. */
  waitingToPost: number;
  unsolved: EhailingPayment[];
  unsolvedAmount: number;
}

/** Cash payments of the month: solved when a posted or loaded bank credit is matched to them. Claim-only payments are not checked. */
export function paymentCheck(payments: EhailingPayment[], postedIds: Set<string>, draftIds: Set<string>): PaymentCheck {
  const cash = payments.filter((payment) => payment.cash_amount > 0);
  const solved = cash.filter((payment) => postedIds.has(payment.source_payment_id) || draftIds.has(payment.source_payment_id));
  const unsolved = unsolvedPayments(cash, new Set([...postedIds, ...draftIds]));
  return {
    total: cash.length,
    solved,
    waitingToPost: solved.filter((payment) => !postedIds.has(payment.source_payment_id)).length,
    unsolved,
    unsolvedAmount: Math.round(unsolved.reduce((sum, payment) => sum + payment.cash_amount, 0) * 100) / 100,
  };
}

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Open bank credits (not yet decided) with the payment's amount, in any loaded statement, nearest date first. */
export function bankLinesForPayment(payment: EhailingPayment, statements: BankReviewRow[][]): Array<{ statement: number; row: BankReviewRow; days: number }> {
  const cents = Math.round(payment.cash_amount * 100);
  return statements
    .flatMap((rows, statement) => rows
      .filter((row) => row.decision === 'PENDING' && row.debit === 0 && Math.round(row.credit * 100) === cents)
      .map((row) => ({ statement, row, days: Math.abs(day(row.transaction_date) - day(payment.payment_date)) })))
    .sort((a, b) => a.days - b.days || a.statement - b.statement || a.row.source_row - b.row.source_row);
}
