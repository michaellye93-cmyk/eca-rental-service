import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDriverMetrics, portalPenalty } from '../utils.ts';
import type { Driver } from '../types.ts';

const on = (iso: string) => new Date(`${iso}T00:00:00`);
// One RM100 rent due on 1 Aug and never paid: by 11 Aug the penalty has compounded for 10 days at 18% a year.
const driver = (overrides: Partial<Driver> = {}): Driver => ({
  id: 'driver-1', nric: '', name: 'Fixture Driver', carPlate: 'ABC 123',
  contractStartDate: '2026-08-01', contractEndDate: '2026-08-02', rentalCycle: 'WEEKLY', contractDuration: 1, rentalRate: 100,
  totalAmountPaid: 0, paymentHistory: [], ...overrides,
});
const penaltyOn = (d: Driver, iso: string) => portalPenalty(d, calculateDriverMetrics(d, on(iso)));

test('a rent-to-own driver who owes rent sees the accrued 18% penalty and what it adds today', () => {
  const d = driver({ category: 'SEWABELI' });
  const metrics = calculateDriverMetrics(d, on('2026-08-11'));
  const penalty = portalPenalty(d, metrics);
  assert.ok(penalty);
  assert.ok(Math.abs(penalty.total - 100 * (Math.pow(1 + 0.18 / 365, 10) - 1)) < 1e-9);
  assert.ok(penalty.addedToday > 0);
  assert.equal(penalty.addedToday, metrics.dailyInterest);
});

test('a driver with no category counts as rent-to-own, as before', () => {
  assert.ok(penaltyOn(driver({ category: undefined }), '2026-08-11'));
});

test('normal rental drivers (SEWA BIASA) never see the penalty, however the category is written', () => {
  assert.equal(penaltyOn(driver({ category: 'SEWA_BIASA' }), '2026-08-11'), null);
  assert.equal(penaltyOn(driver({ category: 'Sewa Biasa' as Driver['category'] }), '2026-08-11'), null);
});

test('a driver who owes nothing sees no penalty', () => {
  const paid = driver({ category: 'SEWABELI', paymentHistory: [{ id: 'p1', date: '2026-08-01', amount: 100, serviceClaim: 0 }] });
  assert.equal(penaltyOn(paid, '2026-08-11'), null);
});

test('a delisted rent-to-own driver who still owes sees the penalty beside the final settlement, as before', () => {
  assert.ok(penaltyOn(driver({ category: 'SEWABELI', isDelisted: true, delistDate: '2026-08-05' }), '2026-08-11'));
});
