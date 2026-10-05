import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVehicleSort, sortVehicles } from '../services/finance/vehicleSort.ts';

const rows = [
  { plate_key: 'XAA1001', business_unit: 'E-HAILING', contribution: 120 },
  { plate_key: 'XAA1002', business_unit: 'SAMBUNG BAYAR', contribution: -40 },
  { plate_key: 'XAA1003', business_unit: 'DAILY RENTAL', contribution: 900 },
  { plate_key: 'XAA1004', business_unit: 'E-HAILING', contribution: 120 },
  { plate_key: 'XAA1005', business_unit: 'E-HAILING', contribution: 300 },
];
const plates = (list: typeof rows) => list.map((row) => row.plate_key);

test('contribution starts highest first and business starts A to Z, each flipping on the next click', () => {
  assert.deepEqual(nextVehicleSort(null, 'contribution'), { key: 'contribution', direction: 'desc' });
  assert.deepEqual(nextVehicleSort({ key: 'contribution', direction: 'desc' }, 'contribution'), { key: 'contribution', direction: 'asc' });
  assert.deepEqual(nextVehicleSort({ key: 'contribution', direction: 'asc' }, 'contribution'), { key: 'contribution', direction: 'desc' });
  assert.deepEqual(nextVehicleSort(null, 'business'), { key: 'business', direction: 'asc' });
  assert.deepEqual(nextVehicleSort({ key: 'business', direction: 'asc' }, 'business'), { key: 'business', direction: 'desc' });
});

test('switching to another column starts that column at its own first direction', () => {
  assert.deepEqual(nextVehicleSort({ key: 'contribution', direction: 'asc' }, 'business'), { key: 'business', direction: 'asc' });
  assert.deepEqual(nextVehicleSort({ key: 'business', direction: 'desc' }, 'contribution'), { key: 'contribution', direction: 'desc' });
});

test('contribution sort orders highest or lowest first and keeps ties in their original order', () => {
  assert.deepEqual(plates(sortVehicles(rows, { key: 'contribution', direction: 'desc' })), ['XAA1003', 'XAA1005', 'XAA1001', 'XAA1004', 'XAA1002']);
  assert.deepEqual(plates(sortVehicles(rows, { key: 'contribution', direction: 'asc' })), ['XAA1002', 'XAA1001', 'XAA1004', 'XAA1005', 'XAA1003']);
});

test('business sort groups A to Z or Z to A, with cars in each business highest contribution first', () => {
  assert.deepEqual(plates(sortVehicles(rows, { key: 'business', direction: 'asc' })), ['XAA1003', 'XAA1005', 'XAA1001', 'XAA1004', 'XAA1002']);
  assert.deepEqual(plates(sortVehicles(rows, { key: 'business', direction: 'desc' })), ['XAA1002', 'XAA1005', 'XAA1001', 'XAA1004', 'XAA1003']);
});

test('no sort keeps the report order and the input is never changed', () => {
  const before = plates(rows);
  assert.deepEqual(plates(sortVehicles(rows, null)), before);
  sortVehicles(rows, { key: 'business', direction: 'desc' });
  assert.deepEqual(plates(rows), before);
});
