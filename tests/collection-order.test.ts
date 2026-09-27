import test from 'node:test';
import assert from 'node:assert/strict';
import { cashAtRiskOrder, LATE_ALERT_DAYS, startOfMonthBaseline } from '../utils.ts';

const key = (name: string, lateDays: number | null, outstanding: number) => ({ name, lateDays, outstanding });

test('the driver list opens with late alerts first, longest late at the top, then everyone else by amount owed', () => {
  const rows = [
    key('Owes most, not late', 3, 3000),
    key('Late 9 days', LATE_ALERT_DAYS + 1, 200),
    key('Up to date', 2, 0),
    key('Late 30 days', 30, 100),
    key('Owes some', 5, 800),
    key('Delisted', null, 1200),
  ];
  assert.deepEqual([...rows].sort(cashAtRiskOrder).map(r => r.name), [
    'Late 30 days', 'Late 9 days', 'Owes most, not late', 'Delisted', 'Owes some', 'Up to date',
  ]);
});

test('seven days late is not yet a late alert, so it sorts by amount owed', () => {
  const rows = [key('Seven days', LATE_ALERT_DAYS - 1, 100), key('Owes more', 0, 500)];
  assert.deepEqual([...rows].sort(cashAtRiskOrder).map(r => r.name), ['Owes more', 'Seven days']);
});

test('ties fall back to the name so the order is stable', () => {
  const rows = [key('Zul', 10, 100), key('Abu', 10, 100)];
  assert.deepEqual([...rows].sort(cashAtRiskOrder).map(r => r.name), ['Abu', 'Zul']);
});

test('the recovery bar measures from the end of the previous month', () => {
  const baseline = startOfMonthBaseline(new Date(2026, 8, 27, 10, 30));
  assert.equal(baseline.getFullYear(), 2026);
  assert.equal(baseline.getMonth(), 7); // 31 August, end of day
  assert.equal(baseline.getDate(), 31);
  assert.equal(baseline.getHours(), 23);
  assert.equal(startOfMonthBaseline(new Date(2026, 0, 5)).getFullYear(), 2025); // January looks back to 31 December
});
