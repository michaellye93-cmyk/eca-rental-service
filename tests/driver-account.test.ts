import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver } from '../types.ts';
import { DriverStatus } from '../types.ts';
import { driverAccount } from '../services/driverAccount.ts';
import { driverPortalView } from '../services/driverPortal.ts';
import { portalDate } from '../services/portalText.ts';
import { formatCurrency } from '../utils.ts';

// The phone page is worked out at the time of day the driver opens it; the admin row at Kuala Lumpur midnight of
// the same day (the dashboard's todayNormalized). Both must read the same facts.
const noon = (iso: string) => new Date(`${iso}T12:00:00`);
const midnight = (iso: string) => new Date(`${iso}T00:00:00`);
// Weekly RM100 rent from Saturday 1 Aug 2026, 10-week contract, no end date.
const weekly = (overrides: Partial<Driver> = {}): Driver => ({
  id: 'driver-1', nric: '', name: 'Fixture Driver A', carPlate: 'XAA1001',
  contractStartDate: '2026-08-01', rentalCycle: 'WEEKLY', contractDuration: 10, rentalRate: 100,
  totalAmountPaid: 0, paymentHistory: [], category: 'SEWABELI', ...overrides,
});
const paid = (date: string, amount: number, serviceClaim = 0) => ({ id: `p-${date}-${amount}`, date, amount, serviceClaim });

const BEHIND = { driver: weekly({ paymentHistory: [paid('2026-08-01', 100)] }), day: '2026-08-30' };
const UP_TO_DATE = { driver: weekly({ paymentHistory: [paid('2026-08-01', 100), paid('2026-08-08', 100)] }), day: '2026-08-10' };
const PART_PAID_DUE_TODAY = { driver: weekly({ paymentHistory: [paid('2026-08-01', 100), paid('2026-08-08', 40)] }), day: '2026-08-15' };
// Monthly RM1,000 on the 5th from 5 Aug 2026, paid through 5 Nov.
const MONTHLY_AHEAD = {
  driver: weekly({
    id: 'driver-4', name: 'Fixture Driver D', carPlate: 'XAD4001', contractStartDate: '2026-08-05', rentalCycle: 'MONTHLY', rentalRate: 1000, contractDuration: 12,
    paymentHistory: [paid('2026-10-10', 1000), paid('2026-10-04', 1000), paid('2026-09-05', 1000), paid('2026-08-05', 1000)],
  }),
  day: '2026-10-12',
};
const DELISTED = { driver: weekly({ id: 'driver-5', isDelisted: true, delistDate: '2026-08-20', paymentHistory: [paid('2026-08-01', 100)] }), day: '2026-08-30' };
const FIXTURES = { BEHIND, UP_TO_DATE, PART_PAID_DUE_TODAY, MONTHLY_AHEAD, DELISTED };

test('a weekly driver four weeks behind: the facts, worked out once', () => {
  const account = driverAccount(BEHIND.driver, noon(BEHIND.day));
  assert.equal(account.owed, 400);
  assert.equal(account.overdue, 400);
  assert.equal(account.status, DriverStatus.BAD);
  assert.equal(account.cyclesOwed, 4);
  assert.equal(account.oldestUnpaidDueDate, '2026-08-08');
  assert.equal(account.dueDate, '2026-08-08');
  assert.equal(account.dueToday, null);
  assert.equal(account.lateDays, 29);
  assert.deepEqual(account.lastPayment, { date: '2026-08-01', days: 29 });
  assert.deepEqual(account.payWarning, { days: 29, kind: 'withoutPayment' });
  assert.deepEqual(account.lastCashPayment, { date: '2026-08-01', amount: 100 });
  assert.deepEqual(account.nextStep, { amount: 100, leaves: 300 });
  assert.deepEqual(account.upcoming, [{ date: '2026-09-05', amount: 100 }, { date: '2026-09-12', amount: 100 }, { date: '2026-09-19', amount: 100 }]);
  assert.deepEqual(account.nextDue, { date: '2026-09-05', amount: 100 });
  assert.deepEqual(account.progress, { shown: 5, length: 10, percent: 50, pastLength: false });
  assert.ok(account.penalty && account.penalty.total > 0, 'the phone page keeps its 18% p.a. penalty figures');
});

test('a weekly driver up to date: nothing owed, the next rent and date', () => {
  const account = driverAccount(UP_TO_DATE.driver, noon(UP_TO_DATE.day));
  assert.equal(account.owed, 0);
  assert.equal(account.status, DriverStatus.GOOD);
  assert.equal(account.cyclesOwed, 0);
  assert.equal(account.oldestUnpaidDueDate, null);
  assert.equal(account.dueDate, '2026-08-15');
  assert.equal(account.nextStep, null);
  assert.equal(account.payWarning, null);
  assert.equal(account.penalty, null);
  assert.deepEqual(account.upcoming.map(row => row.date), ['2026-08-15', '2026-08-22', '2026-08-29']);
  assert.deepEqual(account.progress, { shown: 2, length: 10, percent: 20, pastLength: false });
});

test('a part-paid week and rent falling due today', () => {
  const account = driverAccount(PART_PAID_DUE_TODAY.driver, noon(PART_PAID_DUE_TODAY.day));
  assert.equal(account.owed, 160);
  assert.equal(account.overdue, 60, 'rent falling due today is not overdue yet');
  assert.equal(account.status, DriverStatus.MID);
  assert.equal(account.oldestUnpaidDueDate, '2026-08-08');
  assert.deepEqual(account.dueToday, { amount: 100, unpaid: 100 });
  assert.equal(account.lateDays, 7);
  assert.equal(account.payWarning, null);
  assert.deepEqual(account.nextStep, { amount: 60, leaves: 100 });
  assert.deepEqual(account.lastCashPayment, { date: '2026-08-08', amount: 40 });
});

test('monthly rent paid ahead: no late days, the next unpaid month', () => {
  const account = driverAccount(MONTHLY_AHEAD.driver, noon(MONTHLY_AHEAD.day));
  assert.equal(account.owed, 0);
  assert.equal(account.lateDays, null);
  assert.equal(account.payWarning, null);
  assert.equal(account.dueDate, '2026-12-05');
  assert.deepEqual(account.upcoming.map(row => row.date), ['2026-12-05', '2027-01-05', '2027-02-05']);
  assert.deepEqual(account.lastPayment, { date: '2026-10-10', days: 2 });
  assert.deepEqual(account.progress, { shown: 3, length: 12, percent: 25, pastLength: false });
});

test('a delisted driver with rent left: no late days, no progress, nothing upcoming', () => {
  const account = driverAccount(DELISTED.driver, noon(DELISTED.day));
  assert.equal(account.owed, 200);
  assert.equal(account.status, DriverStatus.MID);
  assert.equal(account.lateDays, null);
  assert.deepEqual(account.payWarning, { days: 29, kind: 'withoutPayment' }, 'the admin row still shows rent left unpaid');
  assert.equal(account.dueDate, '2026-08-08');
  assert.equal(account.progress, null);
  assert.deepEqual(account.upcoming, []);
});

test('the phone page and the admin row read the same facts, whatever the time of day', () => {
  for (const [name, { driver, day }] of Object.entries(FIXTURES)) {
    const admin = driverAccount(driver, midnight(day));
    const view = driverPortalView(driver, noon(day));
    assert.deepEqual(view.account, admin, `${name}: the phone page's facts are the admin row's`);
    // Every figure the phone page prints comes from those facts
    if (admin.owed > 0.01) assert.ok(view.message.includes(formatCurrency(admin.owed)), `${name}: balance in the message`);
    if (admin.nextStep && admin.nextStep.leaves > 0.01) {
      assert.ok(view.milestone?.includes(formatCurrency(admin.nextStep.amount)) && view.milestone.includes(formatCurrency(admin.nextStep.leaves)), `${name}: next step`);
    }
    if (admin.owed <= 0.01 && !driver.isDelisted && admin.dueDate) assert.ok(view.message.includes(portalDate(admin.dueDate, 'en')), `${name}: next due date`);
    assert.deepEqual(view.upcoming, admin.upcoming.map(row => ({ date: portalDate(row.date, 'en'), amount: formatCurrency(row.amount) })), `${name}: upcoming dues`);
    if (admin.lastCashPayment) assert.ok(view.thanks?.includes(portalDate(admin.lastCashPayment.date, 'en')), `${name}: thanks for the latest payment`);
    if (admin.progress) assert.equal(view.progress?.percent, admin.progress.percent, `${name}: contract progress`);
  }
});

test('the facts hold calendar days, not Date objects, so every caller reads the same values', () => {
  const { metrics, ...facts } = driverAccount(BEHIND.driver, noon(BEHIND.day));
  assert.ok(metrics);
  assert.deepEqual(JSON.parse(JSON.stringify(facts)), facts);
});
