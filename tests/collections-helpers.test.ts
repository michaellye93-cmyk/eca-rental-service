import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver } from '../types.ts';
import { badThresholdCycles, calculateDriverMetrics, mondayToSunday, outstandingDaysAgo } from '../utils.ts';

const weekly: Driver = {
  id: 'w', nric: '', name: 'Weekly', carPlate: 'XAA1001', contractStartDate: '2026-08-04', rentalCycle: 'WEEKLY', contractDuration: 52,
  rentalRate: 450, totalAmountPaid: 0, paymentHistory: [{ id: 'p1', date: '2026-08-04', amount: 900, serviceClaim: 0 }],
};

test('the week runs Monday to Sunday around any day, as the weekly target counts it', () => {
  const tuesday = mondayToSunday(new Date(2026, 8, 29));
  assert.deepEqual([tuesday.start.toDateString(), tuesday.end.toDateString()], [new Date(2026, 8, 28).toDateString(), new Date(2026, 9, 4).toDateString()]);
  const sunday = mondayToSunday(new Date(2026, 9, 4, 18, 30));
  assert.deepEqual([sunday.start.toDateString(), sunday.end.toDateString()], [new Date(2026, 8, 28).toDateString(), new Date(2026, 9, 4).toDateString()]);
  assert.equal(sunday.start.getHours(), 0);
});

test('the balance some days ago is the outstanding at the end of that day', () => {
  const now = new Date(2026, 8, 29, 10, 0);
  // 8 Sept end of day: rent due 4 Aug to 8 Sept (6 cycles) less the RM900 paid
  assert.equal(outstandingDaysAgo(weekly, 21, now), 6 * 450 - 900);
  assert.equal(outstandingDaysAgo(weekly, 0, now), calculateDriverMetrics(weekly, now).principalOutstanding);
});

test('drivers turn BAD at 3 weeks of rent owed, or 1.1 months', () => {
  assert.equal(badThresholdCycles('WEEKLY'), 3);
  assert.equal(badThresholdCycles('MONTHLY'), 1.1);
  const bad = calculateDriverMetrics({ ...weekly, paymentHistory: [] }, new Date(2026, 7, 18));
  assert.equal(bad.cyclesOwed, 3);
  assert.equal(bad.status, 'BAD');
});
