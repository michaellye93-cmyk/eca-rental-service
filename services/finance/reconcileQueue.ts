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
  return { ...row, decision: 'MATCHED', payment_source: null, category: null, plate_key: null, matched_kind: 'payment', matched_id: paymentId, matched_ids: null, matched_deposit_ids: null, review_note: note };
}

/** Matches a bank credit to one payment, or to several whose cash adds up to it (kept in matched_ids). */
export function matchRows(row: BankReviewRow, paymentIds: string[], note: string): BankReviewRow {
  return { ...matchRow(row, paymentIds[0], note), matched_ids: paymentIds.length >= 2 ? [...paymentIds] : null };
}

/**
 * Matches a bank credit to rent payments and deposit/downpayment receipts together; with no payments it is matched to
 * the deposits alone (matched_kind 'deposit'). Without deposits it is matchRows.
 */
export function matchItems(row: BankReviewRow, paymentIds: string[], depositIds: string[], note: string): BankReviewRow {
  if (!depositIds.length) return matchRows(row, paymentIds, note);
  if (!paymentIds.length) return { ...matchRow(row, depositIds[0], note), matched_kind: 'deposit', matched_deposit_ids: [...depositIds] };
  return { ...matchRow(row, paymentIds[0], note), matched_ids: [...paymentIds], matched_deposit_ids: [...depositIds] };
}

/** The payments a bank line is matched to: none, one, or several for a split match. */
export function rowPaymentIds(row: BankReviewRow): string[] {
  if (row.decision !== 'MATCHED' || row.matched_kind !== 'payment' || !row.matched_id) return [];
  return row.matched_ids && row.matched_ids.length >= 1 ? [...row.matched_ids] : [row.matched_id];
}

/** The deposit or downpayment receipts a bank line is matched to. */
export function rowDepositIds(row: BankReviewRow): string[] {
  return row.decision === 'MATCHED' && row.matched_deposit_ids ? [...row.matched_deposit_ids] : [];
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

/**
 * The rent check needs money in only: money-out lines (payouts, loans, bills already kept in Records) are left out of
 * the review. Their count and total are kept so the screen can say what was skipped. Row numbers stay as in the file.
 */
export function moneyInOnly(rows: BankReviewRow[]): { rows: BankReviewRow[]; skipped: { count: number; amount: number } } {
  const out = rows.filter((row) => !(row.credit > 0));
  return { rows: rows.filter((row) => row.credit > 0), skipped: { count: out.length, amount: Math.round(out.reduce((sum, row) => sum + row.debit, 0) * 100) / 100 } };
}

/** Lines dated in the reporting month ('YYYY-MM'); lines from another month (or with no date) are left out and counted. */
export function withinMonth(rows: BankReviewRow[], month: string): { rows: BankReviewRow[]; outside: number } {
  const kept = rows.filter((row) => row.transaction_date.slice(0, 7) === month.slice(0, 7));
  return { rows: kept, outside: rows.length - kept.length };
}

/** Review problems in a few readable lines: repeated per-row problems are counted instead of listed one by one. */
export function summarizeProblems(issues: Array<{ code: string; detail: string }>, monthLabel: string): string[] {
  const count = (code: string) => issues.filter((issue) => issue.code === code).length;
  const lines: string[] = [];
  const outside = count('BANK_MONTH_MISMATCH');
  if (outside) lines.push(`${outside} ${outside === 1 ? 'line is' : 'lines are'} dated outside ${monthLabel}`);
  const pending = count('PENDING_BANK_REVIEW');
  if (pending) lines.push(`${pending} ${pending === 1 ? 'line' : 'lines'} still to decide`);
  const rest = issues.filter((issue) => issue.code !== 'BANK_MONTH_MISMATCH' && issue.code !== 'PENDING_BANK_REVIEW').map((issue) => issue.detail);
  lines.push(...rest.slice(0, 3));
  if (rest.length > 3) lines.push(`and ${rest.length - 3} more`);
  return lines;
}

export type PairState = 'posted' | 'matched' | 'suggested' | 'guess' | 'missing' | 'cash';

/** Rent paid in cash in hand, or settled from the driver's deposit (contra): no bank line is expected for it. */
export const isCashInHand = (payment: EhailingPayment) => ['CASH', 'DEPOSIT CONTRA'].includes(String(payment.payment_method ?? '').toUpperCase());
export interface ReconcilePair {
  payment: EhailingPayment;
  state: PairState;
  /** The bank line on the right: statement index (null when already posted), the line and its account. */
  bank?: { statement: number | null; row: BankReviewRow; account: string };
  confidence?: PaymentSuggestion['confidence'];
  /** For a match: how many other payments share the same bank line (one transfer paying several). */
  shared?: number;
  /** For a guess: whether the sender's name looks like the driver, and how many other open lines share the amount. */
  sameName?: boolean;
  others?: number;
}

/**
 * Every cash payment of the month beside the bank line that proves it: already posted, matched in a loaded statement,
 * suggested by the matcher, only a same-amount guess (nearest date, with whether the name agrees), or missing.
 */
export function reconcilePairs(
  payments: EhailingPayment[],
  posted: Array<{ row: BankReviewRow; account: string }>,
  statements: Array<{ rows: BankReviewRow[]; account: string }>,
  suggestions: Array<Map<number, PaymentSuggestion>>,
  looksLike: (description: string, driverName: string | null | undefined) => boolean = () => false,
): ReconcilePair[] {
  const postedBy = new Map(posted.flatMap((entry) => rowPaymentIds(entry.row).map((id) => [id, entry] as const)));
  const draftBy = new Map<string, { statement: number; row: BankReviewRow }>();
  const suggestedBy = new Map<string, { statement: number; row: BankReviewRow; confidence: PaymentSuggestion['confidence'] }>();
  statements.forEach((statement, index) => {
    for (const row of statement.rows) {
      for (const id of rowPaymentIds(row)) draftBy.set(id, { statement: index, row });
      const suggestion = row.decision === 'PENDING' ? suggestions[index]?.get(row.source_row) : undefined;
      if (suggestion) suggestedBy.set(suggestion.paymentId, { statement: index, row, confidence: suggestion.confidence });
    }
  });
  const rowsOf = statements.map((statement) => statement.rows);
  return payments
    .filter((payment) => payment.cash_amount > 0)
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date) || String(a.driver_name_snapshot ?? '').localeCompare(String(b.driver_name_snapshot ?? '')))
    .map((payment): ReconcilePair => {
      const id = payment.source_payment_id;
      const done = postedBy.get(id);
      if (done) return { payment, state: 'posted', bank: { statement: null, row: done.row, account: done.account }, shared: rowPaymentIds(done.row).length - 1 };
      const draft = draftBy.get(id);
      if (draft) return { payment, state: 'matched', bank: { ...draft, account: statements[draft.statement].account }, shared: rowPaymentIds(draft.row).length - 1 };
      const suggested = suggestedBy.get(id);
      if (isCashInHand(payment)) return { payment, state: 'cash' };
      if (suggested) return { payment, state: 'suggested', confidence: suggested.confidence, bank: { statement: suggested.statement, row: suggested.row, account: statements[suggested.statement].account } };
      // Open lines with the amount that no other payment's suggestion has claimed; a name that agrees comes first.
      const lines = bankLinesForPayment(payment, rowsOf).filter((line) => !suggestions[line.statement]?.has(line.row.source_row));
      if (!lines.length) return { payment, state: 'missing' };
      const ranked = [...lines].sort((a, b) => Number(looksLike(b.row.description, payment.driver_name_snapshot)) - Number(looksLike(a.row.description, payment.driver_name_snapshot)));
      const best = ranked[0];
      return { payment, state: 'guess', bank: { statement: best.statement, row: best.row, account: statements[best.statement].account }, sameName: looksLike(best.row.description, payment.driver_name_snapshot), others: lines.length - 1 };
    });
}
