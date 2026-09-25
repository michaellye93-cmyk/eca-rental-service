import test from 'node:test';
import assert from 'node:assert/strict';
import { daysSinceLastPayment, lastPayment, lastPayWarning, lateAlertDays, rentDueAndPaid } from '../utils.ts';
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

// A newly recorded payment is listed first whatever its date, and dates can be unreadable or later than today
const backdated = weekly('backdated', '2026-09-01', [['2026-09-02', 100], ['2026-09-20', 100]]);
const unreadableFirst = weekly('unreadableFirst', '2026-09-01', [['not a date', 100], ['2026-09-20', 100]]);
const futureDated = weekly('futureDated', '2026-09-01', [['2026-10-10', 100], ['2026-09-02', 100]]);
const monthly = (id: string, paidOn: string) => weekly(id, '2026-01-01', [[paidOn, 1000]], { rentalCycle: 'MONTHLY', rentalRate: 1000, contractDuration: 12 });

test('the driver list shows the latest payment even when a backdated one is listed first', () => {
  assert.deepEqual(lastPayment(backdated, reference), { date: new Date(2026, 8, 20), days: 4 });
});

test('the driver list skips unreadable payment dates', () => {
  assert.deepEqual(lastPayment(unreadableFirst, reference), { date: new Date(2026, 8, 20), days: 4 });
  assert.equal(lastPayment(weekly('onlyUnreadable', '2026-09-01', [['', 100]]), reference), null);
});

test('the driver list shows a future-dated payment with negative days and no warning', () => {
  assert.deepEqual(lastPayment(futureDated, reference), { date: new Date(2026, 9, 10), days: -16 });
  assert.equal(lastPayWarning(futureDated, reference), null);
});

test('the driver list has no last payment for a driver who has never paid', () => {
  assert.equal(lastPayment(weekly('neverPaid', '2026-09-10'), reference), null);
});

test('the driver list counts the same days since the last payment as daysSinceLastPayment', () => {
  for (const driver of [backdated, unreadableFirst, futureDated, monthly('monthly30', '2026-08-25')]) {
    assert.equal(lastPayment(driver, reference)?.days, daysSinceLastPayment(driver, reference), driver.id);
  }
});

test('on weekly rent, the driver list and the late alerts count the same days since the last payment', () => {
  for (const driver of [backdated, unreadableFirst, futureDated]) {
    assert.equal(lastPayment(driver, reference)?.days, lateAlertDays(driver, reference), driver.id);
  }
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
