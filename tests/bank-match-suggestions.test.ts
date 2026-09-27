import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPaymentMatches, unsolvedPayments } from '../services/finance/bankMatchSuggestions.ts';
import type { BankReviewRow } from '../types/finance-bank.ts';
import type { EhailingPayment } from '../types/finance.ts';

const credit = (source_row: number, transaction_date: string, amount: number, description: string, reference: string | null = null): BankReviewRow => ({
  source_row, transaction_date, description, reference, debit: 0, credit: amount,
  decision: 'PENDING', payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, review_note: '',
});
const payment = (id: string, date: string, cash: number, name: string, plate: string, method = 'BANK TRANSFER', claim = 0): EhailingPayment => ({
  source_payment_id: id, driver_id: `driver-${id}`, driver_name_snapshot: name, car_plate_snapshot: plate, plate_key: plate.replace(/\s/g, ''),
  payment_date: date, cash_amount: cash, service_claim: claim, gross_rental_revenue: cash + claim, payment_method: method,
  refreshed_at: '2026-10-01T00:00:00Z', finance_month: '2026-09-01', attribution_changed: false,
});

test('a transfer whose description carries banking words still matches the driver by name on the same day', () => {
  const suggestions = suggestPaymentMatches(
    [credit(1, '2026-09-10', 400, 'DUITNOW INSTANT TRANSFER FROM ALI BIN ABU REF 00123456')],
    [payment('p1', '2026-09-10', 400, 'Ali bin Abu', 'XAA 1001'), payment('p2', '2026-09-10', 400, 'Chong Wei Ming', 'XAB 2001')],
  );
  assert.deepEqual(suggestions.get(1), { sourceRow: 1, paymentId: 'p1', pass: 'NAME_OR_PLATE_1_DAY', reason: 'Name or plate matches, same amount, within 1 day' });
});

test('a plate in the reference wins over another payment of the same amount a few days away', () => {
  const suggestions = suggestPaymentMatches(
    [credit(1, '2026-09-14', 350, 'IBG CREDIT', 'SEWA XAB-2001')],
    [payment('p1', '2026-09-12', 350, 'Siti Aminah', 'XAA 1001'), payment('p2', '2026-09-10', 350, 'Rajesh Kumar', 'XAB 2001')],
  );
  assert.equal(suggestions.get(1)?.paymentId, 'p2');
  assert.equal(suggestions.get(1)?.pass, 'NAME_OR_PLATE_5_DAYS');
});

test('a cash deposit machine credit matches a payment recorded as cash deposit', () => {
  const suggestions = suggestPaymentMatches(
    [credit(1, '2026-09-20', 500, 'CDM CASH DEPOSIT 0012')],
    [payment('p1', '2026-09-17', 500, 'Tan Ah Kow', 'XAC 3001', 'CASH DEPOSIT'), payment('p2', '2026-09-19', 500, 'Lim Mei', 'XAD 4001', 'BANK TRANSFER')],
  );
  assert.deepEqual([suggestions.get(1)?.paymentId, suggestions.get(1)?.pass], ['p1', 'CASH_DEPOSIT_5_DAYS']);
});

test('a cash deposit with no cash-deposit payment falls back to the closest payment of the same amount within 12 days', () => {
  const suggestions = suggestPaymentMatches(
    [credit(1, '2026-09-20', 500, 'CASH DEPOSIT')],
    [payment('p1', '2026-09-10', 500, 'Tan Ah Kow', 'XAC 3001'), payment('p2', '2026-09-18', 500, 'Lim Mei', 'XAD 4001')],
  );
  assert.deepEqual([suggestions.get(1)?.paymentId, suggestions.get(1)?.pass], ['p2', 'CASH_DEPOSIT_CLOSEST']);
});

test('no suggestion for a different amount, a claim-only payment, a payment already matched, or a second identical credit', () => {
  const payments = [
    payment('p1', '2026-09-10', 400, 'Ali bin Abu', 'XAA 1001'),
    payment('claim', '2026-09-10', 0, 'Ali bin Abu', 'XAA 1001', 'CLAIM', 400),
    payment('taken', '2026-09-10', 300, 'Ali bin Abu', 'XAA 1001'),
  ];
  const suggestions = suggestPaymentMatches([
    credit(1, '2026-09-10', 400, 'ALI BIN ABU'),
    credit(2, '2026-09-10', 400, 'ALI BIN ABU'),
    credit(3, '2026-09-10', 250, 'ALI BIN ABU'),
    credit(4, '2026-09-10', 300, 'ALI BIN ABU'),
  ], payments, new Set(['taken']));
  assert.equal(suggestions.get(1)?.paymentId, 'p1');
  assert.equal(suggestions.has(2), false);
  assert.equal(suggestions.has(3), false);
  assert.equal(suggestions.has(4), false);
});

test('rows already decided and debits are not given suggestions', () => {
  const matched = { ...credit(1, '2026-09-10', 400, 'ALI BIN ABU'), decision: 'EXCLUDED' as const };
  const debit = { ...credit(2, '2026-09-10', 0, 'ALI BIN ABU'), debit: 400 };
  assert.equal(suggestPaymentMatches([matched, debit], [payment('p1', '2026-09-10', 400, 'Ali bin Abu', 'XAA 1001')]).size, 0);
});

test('system unsolved lists recorded cash payments that no bank credit was matched to, oldest first', () => {
  const payments = [
    payment('p3', '2026-09-20', 300, 'Chong Wei Ming', 'XAB 2001', 'CASH DEPOSIT'),
    payment('p1', '2026-09-05', 400, 'Ali bin Abu', 'XAA 1001'),
    payment('p2', '2026-09-06', 350, 'Siti Aminah', 'XAC 3001'),
    payment('claim', '2026-09-07', 0, 'Siti Aminah', 'XAC 3001', 'CLAIM', 200),
  ];
  assert.deepEqual(unsolvedPayments(payments, new Set(['p2'])).map(p => p.source_payment_id), ['p1', 'p3']);
});
