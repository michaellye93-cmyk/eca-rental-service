import test from 'node:test';
import assert from 'node:assert/strict';
import { monthLoadNeeded, usesFinanceMonth } from '../services/finance/pages.ts';

test('only the pages that show the Finance month read it: Collections does not', () => {
  for (const page of ['overview', 'vehicles', 'close', 'expenses', 'reconcile'] as const) assert.equal(usesFinanceMonth(page), true, page);
  assert.equal(usesFinanceMonth('cash'), true, 'Cash uses the month for its bank check');
  assert.equal(usesFinanceMonth('collections'), false);
});

test('the month is read once per chosen month, not again on every page switch', () => {
  assert.equal(monthLoadNeeded('collections', '2026-09', null), false, 'opening Collections reads nothing');
  assert.equal(monthLoadNeeded('overview', '2026-09', null), true);
  assert.equal(monthLoadNeeded('vehicles', '2026-09', '2026-09'), false, 'already read (or being read) for this month');
  assert.equal(monthLoadNeeded('cash', '2026-10', '2026-09'), true, 'another month is read again');
});
