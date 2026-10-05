import test from 'node:test';
import assert from 'node:assert/strict';
import { nextContributionSort, sortByContribution } from '../services/finance/vehicleSort.ts';

const rows = [
  { plate_key: 'XAA1001', contribution: 120 },
  { plate_key: 'XAA1002', contribution: -40 },
  { plate_key: 'XAA1003', contribution: 900 },
  { plate_key: 'XAA1004', contribution: 120 },
];

test('contribution sort starts highest first and then flips to lowest first', () => {
  assert.equal(nextContributionSort(null), 'desc');
  assert.equal(nextContributionSort('desc'), 'asc');
  assert.equal(nextContributionSort('asc'), 'desc');
});

test('sortByContribution orders highest or lowest first and keeps ties in their original order', () => {
  assert.deepEqual(sortByContribution(rows, 'desc').map((row) => row.plate_key), ['XAA1003', 'XAA1001', 'XAA1004', 'XAA1002']);
  assert.deepEqual(sortByContribution(rows, 'asc').map((row) => row.plate_key), ['XAA1002', 'XAA1001', 'XAA1004', 'XAA1003']);
});

test('sortByContribution leaves the report order alone when no sort is chosen and never changes the input', () => {
  const before = rows.map((row) => row.plate_key);
  assert.deepEqual(sortByContribution(rows, null).map((row) => row.plate_key), before);
  sortByContribution(rows, 'desc');
  assert.deepEqual(rows.map((row) => row.plate_key), before);
});
