import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryLabel, dayTagCheck, displayPlate, normalizePlate, plateMatches, rentDayTag, shortName, withDayTag } from '../utils.ts';

test('plates are stored in capitals without spaces, like Finance vehicle keys (hyphens are kept)', () => {
  assert.equal(normalizePlate('xaa 1001'), 'XAA1001');
  assert.equal(normalizePlate('  XAA  1001 '), 'XAA1001');
  assert.equal(normalizePlate('Xspecial 9001'), 'XSPECIAL9001');
  assert.equal(normalizePlate('w 1234\tA'), 'W1234A');
  // Finance's plate_key only strips whitespace, so a hyphen must survive or the vehicle would no longer match
  assert.equal(normalizePlate('ABC-1234'), 'ABC-1234');
  assert.equal(normalizePlate(''), '');
});

test('a stored plate reads with a space where letters meet digits', () => {
  assert.equal(displayPlate('XAA1001'), 'XAA 1001');
  assert.equal(displayPlate('XSPECIAL9001'), 'XSPECIAL 9001');
  assert.equal(displayPlate('W1234A'), 'W 1234 A');
  assert.equal(displayPlate('xaa 1001'), 'XAA 1001');
});

test('plate search matches either form, with or without spaces', () => {
  assert.ok(plateMatches('XAA1001', 'XAA 1001'));
  assert.ok(plateMatches('XAA 1001', 'xaa1001'));
  assert.ok(plateMatches('XAA1001', '1001'));
  assert.ok(!plateMatches('XAA1001', 'XAB'));
  assert.ok(!plateMatches('XAA1001', '   '));
});

test('the day tag follows the rent day: the start weekday for weekly rent, MONTHLY for monthly rent', () => {
  assert.equal(rentDayTag({ contractStartDate: '2026-02-06', rentalCycle: 'WEEKLY' }), 'FRI');
  assert.equal(rentDayTag({ contractStartDate: '2026-09-27', rentalCycle: 'WEEKLY' }), 'SUN');
  assert.equal(rentDayTag({ contractStartDate: '2026-09-26', rentalCycle: 'MONTHLY' }), 'MONTHLY');
  assert.equal(rentDayTag({ contractStartDate: '', rentalCycle: 'WEEKLY' }), null);
});

test('a day tag that disagrees with the rent day, or a missing one, is flagged', () => {
  const weekly = { contractStartDate: '2026-02-07', rentalCycle: 'WEEKLY' as const };
  assert.deepEqual(dayTagCheck({ ...weekly, tags: ['SAT'] }), { expected: 'SAT', tagged: ['SAT'], ok: true });
  assert.deepEqual(dayTagCheck({ ...weekly, tags: ['sat', 'OFFICE'] }), { expected: 'SAT', tagged: ['SAT'], ok: true });
  assert.deepEqual(dayTagCheck({ ...weekly, tags: ['MON'] }), { expected: 'SAT', tagged: ['MON'], ok: false });
  assert.deepEqual(dayTagCheck({ ...weekly, tags: ['MONTHLY'] }), { expected: 'SAT', tagged: ['MONTHLY'], ok: false });
  assert.deepEqual(dayTagCheck({ ...weekly, tags: ['SAT', 'MON'] }), { expected: 'SAT', tagged: ['SAT', 'MON'], ok: false });
  assert.deepEqual(dayTagCheck({ ...weekly, tags: [] }), { expected: 'SAT', tagged: [], ok: false });
  assert.deepEqual(dayTagCheck({ contractStartDate: '2026-02-07', rentalCycle: 'MONTHLY', tags: ['SAT'] }), { expected: 'MONTHLY', tagged: ['SAT'], ok: false });
  assert.equal(dayTagCheck({ contractStartDate: 'bad', rentalCycle: 'WEEKLY', tags: ['SAT'] }), null);
});

test('the one-click fix puts the right day tag first and keeps the other tags', () => {
  assert.deepEqual(withDayTag(['MON', 'OFFICE'], 'SAT'), ['SAT', 'OFFICE']);
  assert.deepEqual(withDayTag(['OFFICE', 'monthly'], 'SAT'), ['SAT', 'OFFICE']);
  assert.deepEqual(withDayTag([], 'MONTHLY'), ['MONTHLY']);
  assert.deepEqual(withDayTag(undefined, 'TUE'), ['TUE']);
});

test('a short name is the first two words of the name, stopping before bin, binti, a/l and a/p', () => {
  assert.equal(shortName('Fixture Driver Alpha Beta'), 'Fixture Driver');
  assert.equal(shortName('Fixture binti Test'), 'Fixture');
  assert.equal(shortName('Mohd Fixture bin Test'), 'Mohd Fixture');
  assert.equal(shortName('Fixture Kumar a/l Test'), 'Fixture Kumar');
  assert.equal(shortName('  Fixture  '), 'Fixture');
  assert.equal(shortName(''), '');
});

test('the category reads Sewa Beli or Sewa Biasa; no category counts as Sewa Beli', () => {
  assert.equal(categoryLabel({ category: 'SEWABELI' }), 'Sewa Beli');
  assert.equal(categoryLabel({ category: 'SEWA_BIASA' }), 'Sewa Biasa');
  assert.equal(categoryLabel({}), 'Sewa Beli');
});
