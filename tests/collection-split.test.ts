import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver, PaymentTransaction } from '../types.ts';
import { rentAllocations } from '../utils.ts';
import { collectionSplit } from '../services/driverLedger.ts';

const pay = (id: string, date: string, amount: number, serviceClaim = 0, paymentMethod: PaymentTransaction['paymentMethod'] = 'BANK TRANSFER'): PaymentTransaction =>
  ({ id, date, amount, serviceClaim, paymentMethod });
// Weekly rent of RM100 every Monday from 3 Aug 2026 (5 Mondays in August, 4 in September).
const WEEKLY: Driver = {
  id: 'd1', nric: '', name: 'Fixture Driver Alpha', carPlate: 'XAA1001', contractStartDate: '2026-08-03', rentalCycle: 'WEEKLY',
  contractDuration: 52, rentalRate: 100, totalAmountPaid: 0, category: 'SEWABELI', tags: ['MON'],
  paymentHistory: [pay('a', '2026-08-03', 100), pay('b', '2026-08-20', 150, 50), pay('c', '2026-09-28', 100)],
};
const OCT_6 = new Date('2026-10-06T12:00:00');
const identity = (row: { collected: number; current: number; arrears: number; ahead: number }) =>
  assert.equal(Math.round((row.current + row.arrears + row.ahead) * 100) / 100, row.collected);

test('each ringgit is matched to the rent it settled, oldest rent first, with the day it was paid', () => {
  assert.deepEqual(rentAllocations(WEEKLY, OCT_6), [
    { paymentDate: '2026-08-03', dueDate: '2026-08-03', amount: 100 },
    { paymentDate: '2026-08-20', dueDate: '2026-08-10', amount: 100 },
    { paymentDate: '2026-08-20', dueDate: '2026-08-17', amount: 100 },
    { paymentDate: '2026-09-28', dueDate: '2026-08-24', amount: 100 },
  ]);
});

test('money paid in a month is split into that month’s rent and old arrears', () => {
  const [august, september] = collectionSplit([WEEKLY], ['2026-08', '2026-09'], OCT_6);
  // August: three weeks paid on time (one with a RM50 service claim). September: the only payment settles 24 Aug rent.
  assert.deepEqual(august, { month: '2026-08', due: 500, collected: 300, current: 300, arrears: 0, ahead: 0, notCash: 50 });
  assert.deepEqual(september, { month: '2026-09', due: 400, collected: 100, current: 0, arrears: 100, ahead: 0, notCash: 0 });
  identity(august); identity(september);
});

test('rent paid before it falls due, or beyond the recorded contract, counts as paid ahead', () => {
  const monthly: Driver = { ...WEEKLY, id: 'd2', contractStartDate: '2026-08-01', rentalCycle: 'MONTHLY', contractDuration: 2, rentalRate: 1000,
    tags: [], paymentHistory: [pay('m', '2026-08-01', 2500)] };
  const allocations = rentAllocations(monthly, new Date('2026-08-15T12:00:00'));
  assert.deepEqual(allocations, [
    { paymentDate: '2026-08-01', dueDate: '2026-08-01', amount: 1000 },
    { paymentDate: '2026-08-01', dueDate: '2026-09-01', amount: 1000 },
    { paymentDate: '2026-08-01', dueDate: null, amount: 500 },
  ]);
  const [august] = collectionSplit([monthly], ['2026-08'], new Date('2026-08-15T12:00:00'));
  assert.deepEqual(august, { month: '2026-08', due: 1000, collected: 2500, current: 1000, arrears: 0, ahead: 1500, notCash: 0 });
});

test('a delisted driver paying old rent is arrears; deposit contra and claims are settled rent but not cash', () => {
  const delisted: Driver = { ...WEEKLY, id: 'd3', isDelisted: true, delistDate: '2026-08-12',
    paymentHistory: [pay('x', '2026-09-05', 150), pay('y', '2026-09-09', 50, 0, 'DEPOSIT CONTRA')] };
  const [september] = collectionSplit([delisted], ['2026-09'], OCT_6);
  assert.deepEqual(september, { month: '2026-09', due: 0, collected: 200, current: 0, arrears: 200, ahead: 0, notCash: 50 });
});

test('drivers add up, and the month in progress counts only what has happened by today', () => {
  const rows = collectionSplit([WEEKLY, { ...WEEKLY, id: 'd4', paymentHistory: [pay('z', '2026-09-08', 200)] }], ['2026-09'], new Date('2026-09-10T12:00:00'));
  // By 10 Sept only the 7 Sept rent is due (RM100 each). The second driver's RM200 settles 3 Aug and 10 Aug rent.
  assert.deepEqual(rows, [{ month: '2026-09', due: 200, collected: 200, current: 0, arrears: 200, ahead: 0, notCash: 0 }]);
});
