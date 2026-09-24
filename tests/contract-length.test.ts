import test from 'node:test';
import assert from 'node:assert/strict';
import { contractCyclesBetween } from '../utils.ts';

test('weekly contracts count started weeks between the start and end dates', () => {
  assert.equal(contractCyclesBetween('2026-01-05', '2026-12-28', 'WEEKLY'), 51);
  assert.equal(contractCyclesBetween('2026-01-05', '2026-01-20', 'WEEKLY'), 3);
});

test('monthly contracts approximate a month as 30 days (current rule)', () => {
  // 334 days: 11 calendar months, but 12 thirty-day periods.
  assert.equal(contractCyclesBetween('2026-01-05', '2026-12-05', 'MONTHLY'), 12);
  assert.equal(contractCyclesBetween('2026-01-05', '2026-02-04', 'MONTHLY'), 1);
});

test('no length is implied without a valid end date after the start', () => {
  assert.equal(contractCyclesBetween('2026-01-05', '', 'WEEKLY'), null);
  assert.equal(contractCyclesBetween('2026-01-05', '2026-01-05', 'WEEKLY'), null);
  assert.equal(contractCyclesBetween('2026-01-05', '2025-12-01', 'MONTHLY'), null);
  assert.equal(contractCyclesBetween('', '2026-12-05', 'WEEKLY'), null);
});
