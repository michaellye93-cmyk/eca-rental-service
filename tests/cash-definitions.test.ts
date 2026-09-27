import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyReceipts } from '../utils.ts';
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
