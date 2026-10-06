import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePairs, summarizeProblems, withinMonth } from '../services/finance/reconcileQueue.ts';
import type { PaymentSuggestion } from '../services/finance/bankMatchSuggestions.ts';
import type { BankReviewRow } from '../types/finance-bank.ts';
import type { EhailingPayment } from '../types/finance.ts';

const credit = (source_row: number, transaction_date: string, amount: number, description: string, extra: Partial<BankReviewRow> = {}): BankReviewRow => ({
  source_row, transaction_date, description, reference: null, debit: 0, credit: amount,
  decision: 'PENDING', payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, review_note: '', ...extra,
});
const payment = (id: string, date: string, cash: number, name: string): EhailingPayment => ({
  source_payment_id: id, driver_id: `d-${id}`, driver_name_snapshot: name, car_plate_snapshot: 'XAA1001', plate_key: 'XAA1001',
  payment_date: date, cash_amount: cash, service_claim: 0, gross_rental_revenue: cash, payment_method: 'BANK TRANSFER',
  refreshed_at: '2026-09-01T00:00:00Z', finance_month: '2026-08-01', attribution_changed: false,
});
const matched = (id: string) => ({ decision: 'MATCHED' as const, matched_kind: 'payment' as const, matched_id: id });

test('lines dated outside the reporting month are left out and counted', () => {
  const kept = withinMonth([credit(1, '2026-08-31', 100, 'A'), credit(2, '2026-09-01', 200, 'B'), credit(3, '', 50, 'C')], '2026-09');
  assert.deepEqual(kept.rows.map((r) => r.source_row), [2]);
  assert.equal(kept.outside, 2);
});

test('problems are summarised in a few lines, not one per bank row', () => {
  const issue = (code: string, detail: string) => ({ code, severity: 'error' as const, detail });
  const lines = summarizeProblems([
    issue('BANK_MONTH_MISMATCH', 'Bank row 1 ...'), issue('BANK_MONTH_MISMATCH', 'Bank row 2 ...'),
    issue('PENDING_BANK_REVIEW', 'Bank row 1 still needs Admin review'), issue('PENDING_BANK_REVIEW', 'x'), issue('PENDING_BANK_REVIEW', 'y'),
    issue('MISSING_BANK_EXCLUSION_REASON', 'Excluded row 9 needs a review reason'),
  ], 'September 2026');
  assert.deepEqual(lines, ['2 lines are dated outside September 2026', '3 lines still to decide', 'Excluded row 9 needs a review reason']);
});

test('each system payment is paired with its bank line: posted, matched, suggested, a same-amount guess, or missing', () => {
  const payments = [
    payment('p1', '2026-08-01', 400, 'Fixture Driver Alpha'), // posted earlier
    payment('p2', '2026-08-02', 250, 'Fixture Driver Beta'), // matched in a loaded statement
    payment('p3', '2026-08-03', 300, 'Fixture Driver Gamma'), // weak suggestion
    payment('p4', '2026-08-04', 450, 'Fixture Driver Delta'), // only a same-amount line from someone else
    payment('p5', '2026-08-05', 999, 'Fixture Driver Zeta'), // nothing
  ];
  const posted = [{ row: credit(7, '2026-08-01', 400, 'IBG FIXTURE DRIVER ALPHA', matched('p1')), account: 'Bank A' }];
  const statements = [{ account: 'Bank B', rows: [
    credit(1, '2026-08-02', 250, 'IBG FIXTURE DRIVER BETA', matched('p2')),
    credit(2, '2026-08-03', 300, 'CDT CASH DEPOSIT'),
    credit(3, '2026-08-06', 450, 'RPP INWARD SOMEONE ELSE ENTIRELY'),
  ] }];
  const suggestions: Array<Map<number, PaymentSuggestion>> = [new Map([[2, { sourceRow: 2, paymentId: 'p3', pass: 'CASH_DEPOSIT_5_DAYS', reason: 'Cash deposit', confidence: 'WEAK' }]])];
  const pairs = reconcilePairs(payments, posted, statements, suggestions);
  assert.deepEqual(pairs.map((p) => [p.payment.source_payment_id, p.state, p.bank?.row.source_row ?? null, p.bank?.account ?? null]), [
    ['p1', 'posted', 7, 'Bank A'], ['p2', 'matched', 1, 'Bank B'], ['p3', 'suggested', 2, 'Bank B'], ['p4', 'guess', 3, 'Bank B'], ['p5', 'missing', null, null],
  ]);
  assert.equal(pairs[3].sameName, false);
  assert.equal(pairs[3].others, 0);
});

test('a bank line matched to several payments ticks each of them, and the review accepts it only when they add up', async () => {
  const { matchRows, rowPaymentIds } = await import('../services/finance/reconcileQueue.ts');
  const { validateBankReview } = await import('../services/finance/bankStatements.ts');
  const rent = payment('p1', '2026-08-25', 500, 'Fixture Driver Alpha');
  const penalty = payment('p2', '2026-08-25', 10, 'Fixture Driver Alpha');
  const other = payment('p3', '2026-08-26', 20, 'Fixture Driver Alpha');
  const row = matchRows(credit(1, '2026-08-25', 510, 'IBG FIXTURE DRIVER ALPHA'), ['p1', 'p2'], 'Rent and penalty in one transfer');
  assert.deepEqual([row.matched_id, row.matched_ids, rowPaymentIds(row)], ['p1', ['p1', 'p2'], ['p1', 'p2']]);
  assert.equal(matchRows(credit(2, '2026-08-25', 500, 'X'), ['p1'], 'one').matched_ids, null); // one payment stays a plain match
  const pairs = reconcilePairs([rent, penalty, other], [], [{ account: 'Bank A', rows: [row] }], [new Map()]);
  assert.deepEqual(pairs.map((p) => [p.payment.source_payment_id, p.state, p.shared ?? 0]), [['p1', 'matched', 1], ['p2', 'matched', 1], ['p3', 'missing', 0]]);
  const input = { month: { finance_month: '2026-08-01' }, ehailing: [rent, penalty, other], smart_import: null, recurring_costs: [], insurance: [], expenses: [] } as any;
  assert.deepEqual(validateBankReview([row], '2026-08', input), []);
  const wrong = matchRows(credit(1, '2026-08-25', 510, 'IBG FIXTURE DRIVER ALPHA'), ['p1', 'p3'], 'x');
  assert.ok(validateBankReview([wrong], '2026-08', input).some((issue) => /match/i.test(issue.code)));
});

test('a payment recorded as cash in hand is not expected in the bank, unless a bank line was matched to it', () => {
  const cash = { ...payment('p1', '2026-08-03', 300, 'Fixture Driver Alpha'), payment_method: 'CASH' };
  const deposited = { ...payment('p2', '2026-08-04', 200, 'Fixture Driver Beta'), payment_method: 'CASH' };
  const statements = [{ account: 'Bank A', rows: [
    credit(1, '2026-08-03', 300, 'IBG SOMEONE ELSE'), // same amount: no guess is offered for a cash payment
    credit(2, '2026-08-04', 200, 'CDT CASH DEPOSIT', matched('p2')),
  ] }];
  const pairs = reconcilePairs([cash, deposited], [], statements, [new Map()]);
  assert.deepEqual(pairs.map((p) => [p.payment.source_payment_id, p.state]), [['p1', 'cash'], ['p2', 'matched']]);
});
