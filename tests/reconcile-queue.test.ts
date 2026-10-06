import test from 'node:test';
import assert from 'node:assert/strict';
import { applySureMatches, bankLinesForPayment, paymentCheck, suggestAcrossStatements } from '../services/finance/reconcileQueue.ts';
import type { BankReviewRow } from '../types/finance-bank.ts';
import type { EhailingPayment } from '../types/finance.ts';

const credit = (source_row: number, transaction_date: string, amount: number, description: string): BankReviewRow => ({
  source_row, transaction_date, description, reference: null, debit: 0, credit: amount,
  decision: 'PENDING', payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, review_note: '',
});
const payment = (id: string, date: string, cash: number, name: string, plate: string, method = 'BANK TRANSFER'): EhailingPayment => ({
  source_payment_id: id, driver_id: `driver-${id}`, driver_name_snapshot: name, car_plate_snapshot: plate, plate_key: plate,
  payment_date: date, cash_amount: cash, service_claim: 0, gross_rental_revenue: cash, payment_method: method,
  refreshed_at: '2026-09-01T00:00:00Z', finance_month: '2026-08-01', attribution_changed: false,
});

test('matches are suggested across both bank statements at once, so one payment is never suggested twice', () => {
  // The same driver's RM400 appears in both statements by name; only the closer date may take the payment.
  const bankA = [credit(1, '2026-08-01', 400, 'RPP INWARD INST TRF FIXTURE DRIVER ALPHA')];
  const bankB = [credit(1, '2026-08-04', 400, 'IBG CREDIT FIXTURE DRIVER ALPHA'), credit(2, '2026-08-05', 250, 'IBG CREDIT FIXTURE DRIVER BETA')];
  const payments = [payment('p1', '2026-08-01', 400, 'Fixture Driver Alpha', 'XAA1001'), payment('p2', '2026-08-05', 250, 'Fixture Driver Beta', 'XAB2002')];
  const [a, b] = suggestAcrossStatements([bankA, bankB], payments);
  assert.equal(a.get(1)?.paymentId, 'p1');
  assert.equal(b.get(1), undefined);
  assert.equal(b.get(2)?.paymentId, 'p2');
});

test('certain and strong matches are applied straight away; weak ones are left for review', () => {
  const rows = [credit(1, '2026-08-01', 400, 'RPP INWARD INST TRF FIXTURE DRIVER ALPHA'), credit(2, '2026-08-20', 300, 'CDT CASH DEPOSIT')];
  const payments = [payment('p1', '2026-08-01', 400, 'Fixture Driver Alpha', 'XAA1001'), payment('p2', '2026-08-18', 300, 'Fixture Driver Gamma', 'XAC3003', 'CASH DEPOSIT')];
  const [suggestions] = suggestAcrossStatements([rows], payments);
  assert.equal(suggestions.get(2)?.confidence, 'WEAK');
  const applied = applySureMatches(rows, suggestions);
  assert.deepEqual([applied[0].decision, applied[0].matched_kind, applied[0].matched_id], ['MATCHED', 'payment', 'p1']);
  assert.match(applied[0].review_note, /^Auto-matched/);
  assert.equal(applied[1].decision, 'PENDING');
  assert.equal(rows[0].decision, 'PENDING'); // the input is not changed
});

test('the payment check counts solved payments (posted or waiting to post) and lists the unsolved ones oldest first', () => {
  const payments = [
    payment('p1', '2026-08-01', 400, 'A', 'XAA1001'), payment('p2', '2026-08-02', 250, 'B', 'XAB2002'),
    payment('p3', '2026-08-03', 300, 'C', 'XAC3003'), payment('p4', '2026-08-04', 0, 'D', 'XAD4004'), // claim only: not checked
  ];
  const check = paymentCheck(payments, new Set(['p1']), new Set(['p2']));
  assert.equal(check.total, 3);
  assert.equal(check.solved.length, 2);
  assert.equal(check.waitingToPost, 1);
  assert.deepEqual(check.unsolved.map((p) => p.source_payment_id), ['p3']);
  assert.equal(check.unsolvedAmount, 300);
});

test('for an unsolved payment, open bank lines with the same amount are listed nearest date first', () => {
  const bankA = [credit(1, '2026-08-09', 300, 'IBG CREDIT SOMEONE'), credit(2, '2026-08-03', 300, 'CDT CASH DEPOSIT'), credit(3, '2026-08-03', 450, 'IBG CREDIT OTHER')];
  const bankB = [{ ...credit(1, '2026-08-04', 300, 'RPP INWARD'), decision: 'MATCHED' as const, matched_kind: 'payment' as const, matched_id: 'p9' }, credit(2, '2026-08-05', 300, 'RPP INWARD FIXTURE')];
  const lines = bankLinesForPayment(payment('p3', '2026-08-03', 300, 'C', 'XAC3003'), [bankA, bankB]);
  assert.deepEqual(lines.map((line) => [line.statement, line.row.source_row]), [[0, 2], [1, 2], [0, 1]]);
});
