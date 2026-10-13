import test from 'node:test';
import assert from 'node:assert/strict';
import {insuranceHeaderTotals, overlappingInsurance} from '../services/finance/insurance.ts';
import type {Insurance} from '../types/finance.ts';

const policy = (id: string, plate_key: string, premium: number, coverage_start: string | null, coverage_end: string | null, extra: Partial<Insurance> = {}) =>
  ({id, plate_key, premium, coverage_start, coverage_end, responsibility: 'ECA_PAID', ...extra}) as Insurance;

test('header splits ECA-paid premiums into cover active today and all years on record', () => {
  const policies = [
    policy('old', 'XAA1001', 1200.75, '2025-10-02', '2026-10-01'),
    policy('new', 'XAA1001', 1054.65, '2026-10-02', '2027-10-01'),
    policy('other', 'XAA1002', 900, '2026-01-01', '2026-12-31'),
    policy('owner', 'XAA1003', 500, '2026-01-01', '2026-12-31', {responsibility: 'OWNER_PAID'}),
    policy('deleted', 'XAA1004', 700, '2026-01-01', '2026-12-31', {cancelled_at: '2026-05-01T00:00:00Z'}),
    policy('zero', 'XAA1005', 0, null, null),
  ];
  assert.deepEqual(insuranceHeaderTotals(policies, '2026-10-14'), {active: 1954.65, allYears: 3155.4});
  // Cover dates are inclusive on both ends.
  assert.deepEqual(insuranceHeaderTotals(policies, '2026-10-01'), {active: 2100.75, allYears: 3155.4});
});

test('a renewal that starts the day after the old cover ends is not an overlap', () => {
  const policies = [
    policy('old', 'XAA1001', 1200.75, '2025-10-02', '2026-10-01'),
    policy('new', 'XAA1001', 1054.65, '2026-10-02', '2027-10-01'),
  ];
  assert.equal(overlappingInsurance(policies).size, 0);
});

test('two charged policies for one car with shared days are both flagged, naming the other', () => {
  const old = policy('old', 'XAA1001', 1200.75, '2025-10-02', '2026-10-01');
  const dup = policy('dup', 'xaa 1001', 1054.65, '2026-09-15', '2027-09-14');
  const otherCar = policy('car2', 'XAA1002', 900, '2026-01-01', '2026-12-31');
  const result = overlappingInsurance([old, dup, otherCar]);
  assert.deepEqual(result.get(old), [dup]);
  assert.deepEqual(result.get(dup), [old]);
  assert.equal(result.has(otherCar), false);
});

test('deleted, owner-paid and RM0 policies never count as overlaps because they are not charged', () => {
  const live = policy('live', 'XAA1001', 1000, '2026-01-01', '2026-12-31');
  const policies = [
    live,
    policy('deleted', 'XAA1001', 1000, '2026-01-01', '2026-12-31', {cancelled_at: '2026-05-01T00:00:00Z'}),
    policy('owner', 'XAA1001', 0, '2026-01-01', '2026-12-31', {responsibility: 'OWNER_PAID'}),
    policy('zero', 'XAA1001', 0, '2026-03-01', '2027-02-28'),
  ];
  assert.equal(overlappingInsurance(policies).size, 0);
});
