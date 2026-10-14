import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyOutstanding, outstandingDirection, TREND_MONTHS } from '../services/outstandingTrend.ts';
import { calculateDriverMetrics } from '../utils.ts';
import type { Driver, PaymentTransaction } from '../types.ts';

const today = new Date(2026, 9, 14, 12, 0); // Wednesday 14 Oct 2026

const weekly = (id: string, start: string, payments: Array<[string, number]> = [], extra: Partial<Driver> = {}): Driver => ({
  id,
  nric: '',
  name: id,
  carPlate: 'XAA1001',
  contractStartDate: start,
  rentalCycle: 'WEEKLY',
  contractDuration: 104,
  rentalRate: 100,
  totalAmountPaid: payments.reduce((sum, [, amount]) => sum + amount, 0),
  paymentHistory: payments.map(([date, amount], i): PaymentTransaction => ({ id: `${id}-${i}`, date, amount })),
  ...extra,
});

const monthly = (id: string, start: string, payments: Array<[string, number]> = [], extra: Partial<Driver> = {}): Driver =>
  weekly(id, start, payments, { rentalCycle: 'MONTHLY', rentalRate: 1000, ...extra });

test('a driver older than a year gets the last 12 month-ends, this month as of today', () => {
  const driver = weekly('old', '2024-01-01');
  const points = monthlyOutstanding(driver, today);
  assert.equal(points.length, TREND_MONTHS);
  assert.equal(points[0].month, '2025-11');
  assert.equal(points.at(-1)!.month, '2026-10');
  assert.equal(points.at(-1)!.soFar, true);
  assert.ok(points.slice(0, -1).every(point => !point.soFar));
});

test('each balance is the shared rent schedule at that month-end, and this month uses today, not 31 Oct', () => {
  const driver = weekly('owing', '2026-08-03', [['2026-08-03', 100], ['2026-08-10', 100]]);
  const points = monthlyOutstanding(driver, today);
  assert.deepEqual(points.map(point => point.month), ['2026-08', '2026-09', '2026-10']);
  assert.equal(points[0].outstanding, calculateDriverMetrics(driver, new Date(2026, 7, 31)).principalOutstanding);
  assert.equal(points[1].outstanding, calculateDriverMetrics(driver, new Date(2026, 8, 30)).principalOutstanding);
  assert.equal(points[2].outstanding, calculateDriverMetrics(driver, today).principalOutstanding);
  // 11 weeks due by 12 Oct, 2 paid; rent due 19 and 26 Oct is not yet owed today
  assert.equal(points[2].outstanding, 900);
});

test('a contract starting in the future, or with no readable start, has no points', () => {
  assert.deepEqual(monthlyOutstanding(weekly('future', '2026-11-02'), today), []);
  assert.deepEqual(monthlyOutstanding(weekly('blank', ''), today), []);
});

test('one more weekly rent owed over the last 3 months reads as Rising', () => {
  // Pays every week except one in the last three months
  const payments: Array<[string, number]> = [];
  for (let day = new Date(2026, 0, 5); day <= today; day.setDate(day.getDate() + 7)) {
    if (day.getMonth() === 8 && day.getDate() === 7) continue;
    payments.push([`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, 100]);
  }
  const driver = weekly('slipping', '2026-01-05', payments);
  const trend = outstandingDirection(driver, monthlyOutstanding(driver, today));
  assert.equal(trend.direction, 'RISING');
  assert.equal(trend.change, 100);
  assert.equal(trend.months, 3);
});

test('one more monthly rent owed over the last 3 months reads as Rising too', () => {
  const driver = monthly('monthlySlip', '2026-01-01', [
    ['2026-01-01', 1000], ['2026-02-01', 1000], ['2026-03-01', 1000], ['2026-04-01', 1000],
    ['2026-05-01', 1000], ['2026-06-01', 1000], ['2026-07-01', 1000], ['2026-08-01', 1000], ['2026-09-01', 1000],
  ]);
  assert.equal(outstandingDirection(driver, monthlyOutstanding(driver, today)).direction, 'RISING');
});

test('a driver paying rent plus extra each week reads as Falling', () => {
  const payments: Array<[string, number]> = [];
  for (let day = new Date(2026, 4, 4); day <= today; day.setDate(day.getDate() + 7)) {
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    // Nothing paid until July, then rent plus 50
    if (day >= new Date(2026, 6, 1)) payments.push([iso, 150]);
  }
  const driver = weekly('catchingUp', '2026-05-04', payments);
  const trend = outstandingDirection(driver, monthlyOutstanding(driver, today));
  assert.equal(trend.direction, 'FALLING');
  assert.ok(trend.change < 0);
});

test('small moves under a week of rent, and a clear account, read as Flat', () => {
  const payments: Array<[string, number]> = [];
  for (let day = new Date(2026, 0, 5); day <= today; day.setDate(day.getDate() + 7)) {
    payments.push([`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, 100]);
  }
  const clear = weekly('clear', '2026-01-05', payments);
  assert.equal(outstandingDirection(clear, monthlyOutstanding(clear, today)).direction, 'FLAT');
  // Monthly: a few hundred either way is under a week's worth of monthly rent (1000 × 12 / 52 ≈ 231)
  const steady = monthly('steady', '2026-06-01', [['2026-06-01', 1000], ['2026-07-01', 1000], ['2026-08-01', 800], ['2026-09-01', 1000], ['2026-10-01', 1000]]);
  assert.equal(outstandingDirection(steady, monthlyOutstanding(steady, today)).direction, 'FLAT');
});

test('a contract younger than the window compares with its first month-end; a single month is too new to tell', () => {
  const young = weekly('young', '2026-09-07');
  const trend = outstandingDirection(young, monthlyOutstanding(young, today));
  assert.equal(trend.months, 1);
  assert.equal(trend.direction, 'RISING');
  const brandNew = weekly('brandNew', '2026-10-05');
  assert.equal(outstandingDirection(brandNew, monthlyOutstanding(brandNew, today)).direction, 'NEW');
});
