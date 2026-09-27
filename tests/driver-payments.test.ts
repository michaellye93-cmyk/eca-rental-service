import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMomentum, paymentFromRow, withPayments } from '../utils.ts';
import type { Driver } from '../types.ts';

const profile: Omit<Driver, 'totalAmountPaid' | 'paymentHistory'> = {
  id: 'd1', nric: '', name: 'Fixture Driver', carPlate: 'XAA1001',
  contractStartDate: '2026-08-03', rentalCycle: 'WEEKLY', contractDuration: 52, rentalRate: 100,
};

test('a payments row becomes a payment, with no claim and bank transfer when those are empty', () => {
  assert.deepEqual(paymentFromRow({ id: 'p1', date: '2026-08-04', amount: 100, service_claim: null, payment_method: null }),
    { id: 'p1', date: '2026-08-04', amount: 100, serviceClaim: 0, paymentMethod: 'BANK TRANSFER' });
  assert.deepEqual(paymentFromRow({ id: 'p2', date: '2026-08-11', amount: '0', service_claim: '40', payment_method: 'CLAIM' }),
    { id: 'p2', date: '2026-08-11', amount: 0, serviceClaim: 40, paymentMethod: 'CLAIM' });
});

test('a driver\'s ledger lists payments newest first, totals cash and claims, and carries the payment-timing figures', () => {
  const payments = [
    paymentFromRow({ id: 'p1', date: '2026-08-04', amount: 100, service_claim: 0, payment_method: 'BANK TRANSFER' }),
    paymentFromRow({ id: 'p3', date: '2026-08-20', amount: 60, service_claim: 40, payment_method: 'CASH DEPOSIT' }),
    paymentFromRow({ id: 'p2', date: '2026-08-11', amount: 100, service_claim: 0, payment_method: 'BANK TRANSFER' }),
  ];
  const driver = withPayments(profile, payments);
  assert.deepEqual(driver.paymentHistory.map(p => p.id), ['p3', 'p2', 'p1']);
  assert.equal(driver.totalAmountPaid, 300);
  const momentum = calculateMomentum(driver);
  assert.equal(driver.avgDaysLate, momentum.avgLateness);
  assert.equal(driver.lastDaysLate, momentum.lastLateness);
  assert.equal(driver.performanceVelocity, momentum.velocity);
});
