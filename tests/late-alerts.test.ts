import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLateAlerts, lateAlertDays } from '../utils.ts';
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

const monthly = (id: string, start: string, payments: Array<[string, number]> = [], extra: Partial<Driver> = {}): Driver =>
  weekly(id, start, payments, { rentalCycle: 'MONTHLY', ...extra });

/** Late alerts as [driver, days] pairs, in the order shown. */
const alerts = (drivers: Driver[]) => buildLateAlerts(drivers, reference).map(({ driver, days }) => [driver.id, days]);

test('weekly drivers are late alerts after 8 or more days without a payment, longest first', () => {
  assert.deepEqual(alerts([
    weekly('eightDays', '2026-09-01', [['2026-09-16', 400]]),
    weekly('sevenDays', '2026-09-01', [['2026-09-17', 400]]),
    weekly('neverPaidOld', '2026-09-10'),
    weekly('neverPaidNew', '2026-09-20'),
    weekly('futureStart', '2026-10-01'),
  ]), [['neverPaidOld', 14], ['eightDays', 8]]);
});

test('monthly drivers are late alerts once their oldest unpaid rent is 8 or more days past its due date', () => {
  assert.deepEqual(alerts([
    monthly('paidOnTime', '2026-08-01', [['2026-08-01', 100], ['2026-09-01', 100]]), // next rent due 1 Oct
    monthly('unpaidSeptember', '2026-08-01', [['2026-08-01', 100]]), // 1 Sep rent unpaid
    monthly('partPaidSeptember', '2026-08-01', [['2026-08-01', 100], ['2026-09-01', 50]]), // half of 1 Sep rent owed
    monthly('dueFourDaysAgo', '2026-08-20', [['2026-08-20', 100]]), // 20 Sep rent unpaid, only 4 days
    monthly('eightDaysOverdue', '2026-08-16', [['2026-08-16', 100]]), // 16 Sep rent unpaid
    monthly('sevenDaysOverdue', '2026-08-17', [['2026-08-17', 100]]), // 17 Sep rent unpaid
    monthly('neverPaid', '2026-09-10'), // first rent due 10 Sep
    monthly('notStarted', '2026-10-01'),
  ]), [['unpaidSeptember', 23], ['partPaidSeptember', 23], ['neverPaid', 14], ['eightDaysOverdue', 8]]);
});

test('late-alert days: monthly counts from the oldest unpaid due date, weekly from the last payment', () => {
  // Paid on 1 Sep: 23 days since that payment, but a monthly driver owes nothing until 1 Oct
  assert.equal(lateAlertDays(monthly('upToDate', '2026-08-01', [['2026-08-01', 100], ['2026-09-01', 100]]), reference), null);
  assert.equal(lateAlertDays(weekly('weeklyPaidFirst', '2026-09-01', [['2026-09-01', 100]]), reference), 23);
  // A future-dated payment does not settle monthly rent already due; for weekly drivers it counts as the last payment
  assert.equal(lateAlertDays(monthly('futurePayment', '2026-08-01', [['2026-08-01', 100], ['2026-09-30', 100]]), reference), 23);
  assert.equal(lateAlertDays(weekly('futurePayment', '2026-09-01', [['2026-09-30', 100]]), reference), -6);
});

test('delisted drivers are never late alerts', () => {
  assert.deepEqual(alerts([
    weekly('goneWeekly', '2026-09-01', [], { isDelisted: true, delistDate: '2026-09-20' }),
    monthly('goneMonthly', '2026-08-01', [], { isDelisted: true, delistDate: '2026-09-20' }),
  ]), []);
});
