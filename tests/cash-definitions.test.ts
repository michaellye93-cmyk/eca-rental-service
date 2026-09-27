import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyReceipts, overdueRent } from '../utils.ts';
import type { Driver, PaymentTransaction } from '../types.ts';

const pay = (id: string, date: string, amount: number, serviceClaim = 0): PaymentTransaction => ({ id, date, amount, serviceClaim });
const driver = (id: string, payments: PaymentTransaction[], extra: Partial<Driver> = {}): Driver => ({
  id, nric: '', name: id, carPlate: 'XAA1001', contractStartDate: '2026-07-01', rentalCycle: 'WEEKLY',
  contractDuration: 52, rentalRate: 100, totalAmountPaid: 0, paymentHistory: payments, ...extra,
});

test('monthly receipts split money received from repair credits, oldest month first', () => {
  const drivers = [
    driver('a', [pay('a1', '2026-08-31', 300), pay('a2', '2026-09-01', 0, 120), pay('a3', '2026-09-15', 200, 50)]),
    // A delisted driver's payments are still money received.
    driver('b', [pay('b1', '2026-08-02', 100)], { isDelisted: true, delistDate: '2026-08-20' }),
  ];
  assert.deepEqual(monthlyReceipts(drivers), [
    { month: '2026-08', cash: 400, repairCredits: 0 },
    { month: '2026-09', cash: 200, repairCredits: 170 },
  ]);
});

test('monthly receipts skip unreadable payment dates', () => {
  assert.deepEqual(monthlyReceipts([driver('a', [pay('a1', 'not a date', 100), pay('a2', '2026-09-03', 80)])]), [
    { month: '2026-09', cash: 80, repairCredits: 0 },
  ]);
});

test('overdue rent counts only rent that fell due before today, so a due day does not look like growth', () => {
  // RM100 due every Monday from 7 Sep, paid on each due day up to 21 Sep.
  const d = driver('a', [pay('a1', '2026-09-07', 100), pay('a2', '2026-09-14', 100), pay('a3', '2026-09-21', 100)], { contractStartDate: '2026-09-07' });
  // Monday 28 Sep before the transfer: today's rent is due but not overdue.
  assert.equal(overdueRent(d, new Date(2026, 8, 28, 9, 0)), 0);
  // A week earlier the same was true, so nothing "grew".
  assert.equal(overdueRent(d, new Date(2026, 8, 21, 9, 0)), 0);
  // Tuesday 29 Sep with nothing paid: Monday's rent is now overdue.
  assert.equal(overdueRent(d, new Date(2026, 8, 29, 9, 0)), 100);
  // A payment made today settles the overdue rent first.
  const paidToday = { ...d, paymentHistory: [...d.paymentHistory, pay('a4', '2026-09-29', 100)] };
  assert.equal(overdueRent(paidToday, new Date(2026, 8, 29, 9, 0)), 0);
});
