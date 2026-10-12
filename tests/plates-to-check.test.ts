import test from 'node:test';
import assert from 'node:assert/strict';
import { platesToCheck } from '../services/finance/plateCheck.ts';

const vehicle = (plate_key: string, extra: { deleted_at?: string | null; status?: string } = {}) =>
  ({ plate_key, display_plate: plate_key.replace(/(\d)/, ' $1'), status: 'ACTIVE', ...extra });
const car = (plateNumber: string, model = 'BEZZA') => ({ plateNumber, make: 'PERODUA', model });
const driver = (name: string, carPlate: string, isDelisted = false) => ({ name, carPlate, isDelisted });

test('lists Finance vehicles with no car on Fleet, Fleet cars with no Finance vehicle, and active drivers on neither', () => {
  const result = platesToCheck(
    [vehicle('XAA1001'), vehicle('XAA1002'), vehicle('XAA1003', { status: 'SOLD' }), vehicle('XAA1009', { deleted_at: '2026-09-01T00:00:00Z' })],
    [car('xaa 1001'), car('XAA1004', 'AXIA'), car('XAA 1004', 'AXIA'), car('  ')],
    [driver('Fixture Driver A', 'XAA1001'), driver('Fixture Driver B', 'XAA1005'), driver('Fixture Driver C', 'xaa 1005'),
      driver('Fixture Driver D', 'XAA1004'), driver('Fixture Driver E', 'XAA1002'), driver('Fixture Driver F', 'XAA1006', true), driver('Fixture Driver G', '')],
  );
  assert.deepEqual(result.financeOnly, [
    { plate: 'XAA1002', label: 'XAA 1002', detail: 'ACTIVE' },
    { plate: 'XAA1003', label: 'XAA 1003', detail: 'SOLD' },
  ], 'a vehicle deleted in Finance is not listed');
  assert.deepEqual(result.fleetOnly, [{ plate: 'XAA1004', label: 'XAA1004', detail: 'PERODUA AXIA' }], 'one line per plate');
  assert.deepEqual(result.driversOnNeither, [{ plate: 'XAA1005', label: 'XAA1005', detail: 'Fixture Driver B, Fixture Driver C' }],
    'delisted drivers and drivers without a plate are left out');
});

test('nothing to check when every plate matches, whatever the spacing or letter case', () => {
  const result = platesToCheck([vehicle('XAA1001')], [car('Xaa 1001')], [driver('Fixture Driver A', 'xaa1001')]);
  assert.deepEqual(result, { financeOnly: [], fleetOnly: [], driversOnNeither: [] });
});
