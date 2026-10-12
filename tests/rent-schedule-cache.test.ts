import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDriverMetrics, generateDriverInvoices, getNextDueDate, latestInvoices, monthlyOverdueDays, outstandingDaysAgo, overdueRent,
  rentAllocations, rentScheduleBuilds,
} from '../utils.ts';
import type { Driver, PaymentTransaction } from '../types.ts';

const at = (iso: string, time = '00:00:00') => new Date(`${iso}T${time}`);
const pay = (id: string, date: string, amount: number, serviceClaim = 0): PaymentTransaction => ({ id, date, amount, serviceClaim });
const base = (overrides: Partial<Driver>): Driver => ({
  id: 'cache-1', nric: '', name: 'Fixture Driver A', carPlate: 'XAA1001',
  contractStartDate: '2026-06-04', rentalCycle: 'WEEKLY', contractDuration: 8, rentalRate: 350,
  totalAmountPaid: 0, paymentHistory: [], ...overrides,
});
const FIXTURES: Driver[] = [
  base({}),
  base({ id: 'cache-2', paymentHistory: [pay('a', '2026-06-04', 700), pay('b', '2026-06-20', 350, 50), pay('c', '2026-08-01', 1000)] }),
  base({ id: 'cache-3', rentalCycle: 'MONTHLY', contractStartDate: '2026-01-31', contractDuration: 12, rentalRate: 1400,
    paymentHistory: [pay('a', '2026-02-01', 1400), pay('b', '2026-04-10', 2000), pay('c', '2026-07-02', 1400)] }),
  base({ id: 'cache-4', contractEndDate: '2026-07-30', paymentHistory: [pay('a', '2026-06-05', 3000)] }),
  base({ id: 'cache-5', isDelisted: true, delistDate: '2026-08-15', paymentHistory: [pay('a', '2026-06-11', 350), pay('b', '2026-09-01', 500)] }),
  base({ id: 'cache-6', contractDuration: 2, paymentHistory: [pay('a', '2026-10-30', 5000)] }),
];
const DATES = ['2026-05-30', '2026-06-04', '2026-06-30', '2026-07-31', '2026-08-15', '2026-09-30', '2026-10-12', '2027-01-05'].map(day => at(day, '13:45:10'));

/** Everything the rent engine answers for one driver and day, as text (Dates included). */
const answers = (driver: Driver, day: Date) => JSON.stringify({
  invoices: generateDriverInvoices(driver, day),
  horizon: generateDriverInvoices(driver, day, at('2027-03-01')),
  metrics: calculateDriverMetrics(driver, day),
  allocations: rentAllocations(driver, day),
  next: getNextDueDate(driver, day),
  latest: latestInvoices(driver, day),
  overdue: overdueRent(driver, day),
  monthlyLate: monthlyOverdueDays(driver, day),
  weekAgo: outstandingDaysAgo(driver, 7, day),
});

test('the cached rent schedule gives exactly what a fresh calculation gives', () => {
  for (const driver of FIXTURES) {
    for (const day of DATES) {
      const first = answers(driver, day);
      const builds = rentScheduleBuilds();
      const again = answers(driver, day);
      assert.equal(rentScheduleBuilds(), builds, 'the repeat comes from the cache');
      // A copy of the driver is a different object, so it is calculated afresh.
      const fresh = answers({ ...driver, paymentHistory: driver.paymentHistory.map(p => ({ ...p })) }, day);
      assert.equal(again, first, `${driver.id} on ${day.toDateString()}: repeat`);
      assert.equal(fresh, first, `${driver.id} on ${day.toDateString()}: fresh`);
    }
  }
});

test('only the calendar day of the reference date matters, not its time of day', () => {
  const driver = FIXTURES[1];
  const midnight = answers(driver, at('2026-08-01', '00:00:00'));
  assert.equal(answers(driver, at('2026-08-01', '12:34:56')), midnight);
  assert.equal(answers(driver, at('2026-08-01', '23:59:59.999')), midnight);
  // A fresh object at a time of day gives the same as the cached midnight answer.
  assert.equal(answers({ ...driver }, at('2026-08-01', '18:00:00')), midnight);
  assert.notEqual(answers(driver, at('2026-08-02', '00:00:00')), midnight, 'the next day is a different answer');
});

test('changing a returned value does not change the next answer', () => {
  const driver = FIXTURES[2];
  const day = at('2026-08-15');
  const before = answers(driver, day);
  const invoices = generateDriverInvoices(driver, day);
  invoices[0].amountPaid = -1;
  invoices[0].remainingBalance = 99999;
  invoices.reverse().push({ ...invoices[0], id: 'extra' });
  const allocations = rentAllocations(driver, day);
  allocations[0].amount = 12345;
  allocations.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  const next = getNextDueDate(driver, day);
  assert.ok(next);
  next.setDate(next.getDate() + 100);
  const metrics = calculateDriverMetrics(driver, day);
  metrics.principalOutstanding = 0;
  assert.equal(answers(driver, day), before);
});

test('a replaced driver object is calculated again', () => {
  const driver = FIXTURES[0];
  const day = at('2026-07-01');
  assert.equal(calculateDriverMetrics(driver, day).principalOutstanding, 1400);
  const paid = { ...driver, paymentHistory: [...driver.paymentHistory, pay('new', '2026-06-30', 700)] };
  const builds = rentScheduleBuilds();
  assert.equal(calculateDriverMetrics(paid, day).principalOutstanding, 700);
  assert.ok(rentScheduleBuilds() > builds, 'the new object is built, not read from the old one');
  assert.equal(calculateDriverMetrics(driver, day).principalOutstanding, 1400, 'the old object keeps its own answer');
});
