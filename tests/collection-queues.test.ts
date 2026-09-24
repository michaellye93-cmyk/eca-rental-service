import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectionQueues, rentDueAndPaid } from '../utils.ts';
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

test('each active driver is queued once, by the age of their oldest unpaid rent', () => {
  const queues = buildCollectionQueues([
    weekly('today', '2026-09-24'), // first rent due today
    weekly('twoDays', '2026-09-22'), // first rent due 2 days ago
    weekly('threeDays', '2026-09-21'), // 3 days ago is still "1-3 days"
    weekly('fourDays', '2026-09-20'), // 4 days ago starts "4+ days"
    weekly('oldAndToday', '2026-09-10', [['2026-09-10', 100]]), // owes 17 Sep (7 days) and 24 Sep (today)
    weekly('paidUp', '2026-09-17', [['2026-09-17', 100], ['2026-09-24', 100]]),
  ], reference);
  assert.deepEqual([...queues.dueToday], ['today']);
  assert.deepEqual([...queues.late1to3].sort(), ['threeDays', 'twoDays']);
  assert.deepEqual([...queues.late4plus].sort(), ['fourDays', 'oldAndToday']);
});

test('partly paid rent still counts as unpaid for the queue', () => {
  const queues = buildCollectionQueues([weekly('partial', '2026-09-22', [['2026-09-22', 60]])], reference);
  assert.deepEqual([...queues.late1to3], ['partial']);
});

test('drivers with no payment for 8 or more days are flagged separately', () => {
  const queues = buildCollectionQueues([
    weekly('eightDays', '2026-09-01', [['2026-09-16', 400]]),
    weekly('sevenDays', '2026-09-01', [['2026-09-17', 400]]),
    weekly('neverPaidOld', '2026-09-10'),
    weekly('neverPaidNew', '2026-09-20'),
    weekly('futureStart', '2026-10-01'),
  ], reference);
  assert.deepEqual([...queues.noPayment8plus].sort(), ['eightDays', 'neverPaidOld']);
});

test('delisted drivers are not queued', () => {
  const queues = buildCollectionQueues([weekly('gone', '2026-09-01', [], { isDelisted: true, delistDate: '2026-09-20' })], reference);
  assert.equal(queues.dueToday.size + queues.late1to3.size + queues.late4plus.size + queues.noPayment8plus.size, 0);
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
