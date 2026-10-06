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
  assert.deepEqual(suggestions.get(1), { sourceRow: 1, paymentId: 'p1', pass: 'NAME_OR_PLATE_1_DAY', reason: 'Name or plate matches, same amount, within 1 day', confidence: 'STRONG' });
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

test('a recorded payment reference found in the bank line is the strongest match, ahead of names and dates', () => {
  const references = new Map([['p2', 'RHB 7788 1234']]);
  const suggestions = suggestPaymentMatches(
    [credit(1, '2026-09-12', 400, 'DUITNOW TRANSFER FROM ALI BIN ABU', 'RHB77881234')],
    [payment('p1', '2026-09-12', 400, 'Ali bin Abu', 'XAA 1001'), payment('p2', '2026-09-05', 400, 'Chong Wei Ming', 'XAB 2001')],
    new Set(), references,
  );
  assert.deepEqual(suggestions.get(1), { sourceRow: 1, paymentId: 'p2', pass: 'REFERENCE', reason: 'Payment reference matches, same amount', confidence: 'CERTAIN' });
});

test('a reference match still needs the same amount, and short references are ignored', () => {
  const suggestions = suggestPaymentMatches(
    [credit(1, '2026-09-12', 450, 'IBG CREDIT', 'REF 99887766'), credit(2, '2026-09-12', 300, 'IBG CREDIT 12 SEWA')],
    [payment('p1', '2026-09-12', 400, 'Siti Aminah', 'XAA 1001'), payment('p2', '2026-09-12', 300, 'Rajesh Kumar', 'XAB 2001')],
    new Set(), new Map([['p1', '99887766'], ['p2', '12']]),
  );
  assert.equal(suggestions.get(1), undefined);
  assert.notEqual(suggestions.get(2)?.pass, 'REFERENCE');
});

test('each suggestion says how sure it is: reference certain, plate or close name within 5 days strong, the rest weak', () => {
  const suggestions = suggestPaymentMatches(
    [
      credit(1, '2026-09-10', 400, 'DUITNOW TRANSFER', 'DN20260910XYZ123'),
      credit(2, '2026-09-11', 300, 'INSTANT TRANSFER XAB 2001'),
      credit(3, '2026-09-12', 250, 'TRANSFER FROM ALI BIN ABU'),
      credit(4, '2026-09-30', 200, 'TRANSFER FROM CHONG WEI MING'),
      credit(5, '2026-09-13', 150, 'CASH DEPOSIT CDM'),
    ],
    [
      payment('p1', '2026-09-10', 400, 'Someone Else', 'XAC 3001'),
      payment('p2', '2026-09-10', 300, 'Another Person', 'XAB 2001'),
      payment('p3', '2026-09-12', 250, 'Ali bin Abu', 'XAA 1001'),
      payment('p4', '2026-09-15', 200, 'Chong Wei Ming', 'XAD 4001'),
      payment('p5', '2026-09-12', 150, 'Cash Payer', 'XAE 5001', 'CASH DEPOSIT'),
    ],
    new Set(),
    new Map([['p1', 'DN20260910XYZ123']]),
  );
  assert.deepEqual([1, 2, 3, 4, 5].map((row) => suggestions.get(row)?.confidence), ['CERTAIN', 'STRONG', 'STRONG', 'WEAK', 'WEAK']);
});
