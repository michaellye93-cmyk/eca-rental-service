import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLateAlerts, LATE_ALERT_DAYS, lastPayWarning } from '../utils.ts';
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

test('weekly rent: the driver list warns from 7 whole days without payment, at any time of day', () => {
  const evening = new Date(2026, 8, 24, 21, 30);
  assert.equal(lastPayWarning(weekly('sixDays', '2026-09-01', [['2026-09-18', 100]]), evening), null);
  assert.deepEqual(lastPayWarning(weekly('sevenDays', '2026-09-01', [['2026-09-17', 100]]), evening), { days: 7, kind: 'withoutPayment' });
  assert.deepEqual(lastPayWarning(weekly('sevenDays', '2026-09-01', [['2026-09-17', 100]]), reference), { days: 7, kind: 'withoutPayment' });
  // Before the first payment a weekly row shows no warning
  assert.equal(lastPayWarning(weekly('neverPaid', '2026-09-01'), reference), null);
});

test('monthly rent paid ahead shows no warning, however long ago the last payment was', () => {
  // One payment on 1 Jun covers the June to September rent; the next rent is due 1 Oct
  assert.equal(lastPayWarning(monthly('prepaid', '2026-06-01', [['2026-06-01', 400]]), reference), null);
  assert.equal(lastPayWarning(monthly('paidOnTime', '2026-08-01', [['2026-08-01', 100], ['2026-09-01', 100]]), reference), null);
});

test('monthly rent warns from 8 days past the oldest unpaid due date, even right after a payment', () => {
  // Paid 4 days ago, but the 16 Aug rent is still part-paid: 39 days overdue
  assert.deepEqual(lastPayWarning(monthly('recentPartPayment', '2026-07-16', [['2026-07-16', 100], ['2026-09-20', 50]]), reference), { days: 39, kind: 'overdue' });
  assert.deepEqual(lastPayWarning(monthly('eightDaysOverdue', '2026-08-16', [['2026-08-16', 100]]), reference), { days: 8, kind: 'overdue' });
  assert.equal(lastPayWarning(monthly('sevenDaysOverdue', '2026-08-17', [['2026-08-17', 100]]), reference), null);
});

test('monthly rent warns before any payment once the first rent is 8 days overdue', () => {
  assert.deepEqual(lastPayWarning(monthly('neverPaid', '2026-09-10'), reference), { days: 14, kind: 'overdue' });
  assert.equal(lastPayWarning(monthly('neverPaidRecent', '2026-09-20'), reference), null);
});

test('an active monthly driver shows the warning exactly when they are a late alert, with the same days', () => {
  assert.equal(LATE_ALERT_DAYS, 8);
  const drivers = [
    monthly('prepaid', '2026-06-01', [['2026-06-01', 400]]),
    monthly('paidOnTime', '2026-08-01', [['2026-08-01', 100], ['2026-09-01', 100]]),
    monthly('recentPartPayment', '2026-07-16', [['2026-07-16', 100], ['2026-09-20', 50]]),
    monthly('eightDaysOverdue', '2026-08-16', [['2026-08-16', 100]]),
    monthly('sevenDaysOverdue', '2026-08-17', [['2026-08-17', 100]]),
    monthly('neverPaid', '2026-09-10'),
    monthly('neverPaidRecent', '2026-09-20'),
    monthly('futurePayment', '2026-08-01', [['2026-08-01', 100], ['2026-09-30', 100]]),
  ];
  for (const driver of drivers) {
    const alert = buildLateAlerts([driver], reference)[0];
    const warning = lastPayWarning(driver, reference);
    assert.equal(warning?.days, alert?.days, driver.id);
  }
});
