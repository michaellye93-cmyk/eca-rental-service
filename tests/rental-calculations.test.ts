import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDriverMetrics, generateDriverInvoices } from '../utils.ts';
import type { Driver, PaymentTransaction } from '../types.ts';

const on = (iso: string) => new Date(`${iso}T00:00:00`);
const pay = (date: string, amount: number, serviceClaim = 0): PaymentTransaction => ({ id: `p-${date}-${amount}`, date, amount, serviceClaim });
const driver = (overrides: Partial<Driver> = {}): Driver => ({
  id: 'driver-1', nric: '', name: 'Fixture Driver', carPlate: 'ABC 123',
  contractStartDate: '2026-08-01', rentalCycle: 'WEEKLY', contractDuration: 2, rentalRate: 100,
  totalAmountPaid: 0, paymentHistory: [], ...overrides,
});
const dueBy = (d: Driver, reference: Date) => generateDriverInvoices(d, reference).filter(inv => on(inv.dueDate) <= reference);
const owedOnSchedule = (d: Driver, reference: Date) => dueBy(d, reference).reduce((sum, inv) => sum + inv.remainingBalance, 0);

// Behaviour that must stay the same.

test('an end date stops rent before the obligation dated on that end date', () => {
  const d = driver({ contractDuration: 4, contractEndDate: '2026-08-15' });
  assert.equal(calculateDriverMetrics(d, on('2026-08-31')).cyclesElapsed, 2);
  assert.deepEqual(generateDriverInvoices(d, on('2026-08-31')).map(inv => inv.dueDate), ['2026-08-01', '2026-08-08']);
});

test('delisting stops rent before the delist date', () => {
  const d = driver({ contractDuration: 10, isDelisted: true, delistDate: '2026-08-10' });
  assert.equal(calculateDriverMetrics(d, on('2026-08-31')).cyclesElapsed, 2);
  assert.deepEqual(generateDriverInvoices(d, on('2026-08-31')).map(inv => inv.dueDate), ['2026-08-01', '2026-08-08']);
});

test('cash and service claims settle the oldest obligations first', () => {
  const d = driver({ contractDuration: 4, paymentHistory: [pay('2026-08-03', 120, 30)] });
  const invoices = generateDriverInvoices(d, on('2026-08-15'));
  assert.deepEqual(invoices.map(inv => inv.status), ['PAID', 'PARTIAL', 'UNPAID', 'FUTURE']);
  assert.deepEqual(invoices.map(inv => inv.amountPaid), [100, 50, 0, 0]);
  const metrics = calculateDriverMetrics(d, on('2026-08-15'));
  assert.equal(metrics.principalOutstanding, 150);
  assert.equal(metrics.status, 'MID');
});

test('payments dated after the reference day are ignored', () => {
  const d = driver({ contractDuration: 4, paymentHistory: [pay('2026-08-20', 400)] });
  assert.equal(calculateDriverMetrics(d, on('2026-08-15')).principalOutstanding, 300);
  assert.deepEqual(generateDriverInvoices(d, on('2026-08-15')).map(inv => inv.status), ['UNPAID', 'UNPAID', 'UNPAID', 'FUTURE']);
});

test('arrears of three weekly cycles or 1.1 monthly cycles are BAD', () => {
  assert.equal(calculateDriverMetrics(driver({ contractDuration: 10 }), on('2026-08-08')).status, 'MID');
  assert.equal(calculateDriverMetrics(driver({ contractDuration: 10 }), on('2026-08-15')).status, 'BAD');
  const monthly = driver({ rentalCycle: 'MONTHLY', rentalRate: 1000, contractDuration: 12, contractStartDate: '2026-06-01', paymentHistory: [pay('2026-06-01', 1000), pay('2026-07-01', 900)] });
  assert.equal(calculateDriverMetrics(monthly, on('2026-07-15')).status, 'MID');
  assert.equal(calculateDriverMetrics(monthly, on('2026-08-15')).status, 'BAD');
});

test('unpaid principal compounds penalty daily from the second day after it falls due', () => {
  const d = driver({ contractDuration: 1, contractEndDate: '2026-08-02' });
  const expected = 100 * (Math.pow(1 + 0.18 / 365, 10) - 1);
  assert.ok(Math.abs(calculateDriverMetrics(d, on('2026-08-11')).penaltyAmount - expected) < 1e-9);
});

test('monthly obligations are anchored to the start date with calendar rollover', () => {
  const d = driver({ rentalCycle: 'MONTHLY', rentalRate: 1000, contractDuration: 4, contractStartDate: '2026-01-31' });
  assert.deepEqual(generateDriverInvoices(d, on('2026-01-31')).map(inv => inv.dueDate), ['2026-01-31', '2026-03-03', '2026-03-31', '2026-05-01']);
});

test('future obligations within the recorded contract length are listed as FUTURE', () => {
  assert.deepEqual(generateDriverInvoices(driver({ contractDuration: 4 }), on('2026-08-08')).map(inv => inv.status), ['UNPAID', 'UNPAID', 'FUTURE', 'FUTURE']);
});

// Decision 2026-09-24: with no end date, rent keeps accruing past the recorded length until an end date or delist.

test('without an end date the invoice schedule keeps accruing past the recorded contract length', () => {
  const d = driver({ contractDuration: 2, paymentHistory: [pay('2026-08-02', 50, 25)] });
  assert.deepEqual(generateDriverInvoices(d, on('2026-08-22')).map(inv => inv.dueDate), ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22']);
  assert.equal(owedOnSchedule(d, on('2026-08-22')), 325);
  assert.equal(calculateDriverMetrics(d, on('2026-08-22')).principalOutstanding, 325);
});

test('the balance and the invoice schedule agree on how many obligations are due and what is owed', () => {
  const scenarios: Array<[string, Driver, string]> = [
    ['past recorded length', driver({ contractDuration: 2, paymentHistory: [pay('2026-08-02', 50, 25)] }), '2026-08-22'],
    ['month-end monthly start', driver({ rentalCycle: 'MONTHLY', rentalRate: 1000, contractDuration: 12, contractStartDate: '2026-01-31', paymentHistory: [pay('2026-02-15', 1500)] }), '2026-03-31'],
    ['ended contract', driver({ contractDuration: 4, contractEndDate: '2026-08-15', paymentHistory: [pay('2026-08-01', 100)] }), '2026-08-31'],
    ['delisted', driver({ contractDuration: 10, isDelisted: true, delistDate: '2026-08-10' }), '2026-08-31'],
    ['prepaid', driver({ contractDuration: 4, paymentHistory: [pay('2026-08-01', 400)] }), '2026-08-15'],
  ];
  for (const [name, d, reference] of scenarios) {
    const metrics = calculateDriverMetrics(d, on(reference));
    assert.equal(metrics.cyclesElapsed, dueBy(d, on(reference)).length, `${name}: obligations due`);
    assert.ok(Math.abs(metrics.principalOutstanding - owedOnSchedule(d, on(reference))) < 0.005, `${name}: amount owed`);
  }
});
