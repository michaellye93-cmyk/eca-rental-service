import test from 'node:test';
import assert from 'node:assert/strict';
import { daysSinceLastPayment, rentDueAndPaid } from '../utils.ts';
import type { Driver, PaymentTransaction } from '../types.ts';

const reference = new Date(2026, 8, 24); // Thursday 24 Sep 2026, local midnight

const weekly = (id: string, start: string, payments: Array<[string, number]> = [], extra: Partial<Driver> = {}): Driver => ({
  id,
  nric: '',
  name: id,
  carPlate: 'XAA1001',
  contractStartDate: start,
  rentalCycle: 'WEEKLY',
  contractDuration: 52,
  rentalRate: 100,
  totalAmountPaid: payments.reduce((sum, [, amount]) => sum + amount, 0),
  paymentHistory: payments.map(([date, amount], i): PaymentTransaction => ({ id: `${id}-${i}`, date, amount })),
  ...extra,
});

test('days without payment count from the latest payment, or from the contract start when none has been made', () => {
  // Payments listed out of date order: the latest one (16 Sep) counts
  assert.equal(daysSinceLastPayment(weekly('paid', '2026-09-01', [['2026-09-16', 100], ['2026-09-02', 100]]), reference), 8);
  assert.equal(daysSinceLastPayment(weekly('neverPaid', '2026-09-10'), reference), 14);
  assert.equal(daysSinceLastPayment(weekly('futureStart', '2026-10-01'), reference), -7);
  assert.equal(daysSinceLastPayment(weekly('noDates', ''), reference), null);
});

test('days without payment skip unreadable payment dates and go negative for a future-dated payment', () => {
  assert.equal(daysSinceLastPayment(weekly('badDate', '2026-09-01', [['not a date', 100], ['2026-09-20', 100]]), reference), 4);
  assert.equal(daysSinceLastPayment(weekly('onlyBadDate', '2026-09-10', [['', 100]]), reference), 14);
  assert.equal(daysSinceLastPayment(weekly('futurePayment', '2026-09-01', [['2026-09-30', 100]]), reference), -6);
});

test('rentDueAndPaid sums active drivers\' rent falling due in a period and what has been applied to it', () => {
  const drivers = [
    weekly('a', '2026-09-01', [['2026-09-10', 150]]),
    weekly('gone', '2026-09-01', [], { isDelisted: true, delistDate: '2026-09-30' }),
  ];
  // Mon 21 - Sun 27 Sep: rent due 22 Sep; the 150 paid went to 1 Sep and half of 8 Sep.
  assert.deepEqual(rentDueAndPaid(drivers, new Date(2026, 8, 21), new Date(2026, 8, 27), reference), { due: 100, paid: 0 });
  // September, including rent due later this month: 1, 8, 15, 22 and 29 Sep.
  assert.deepEqual(rentDueAndPaid(drivers, new Date(2026, 8, 1), new Date(2026, 8, 30), reference), { due: 500, paid: 150 });
});
