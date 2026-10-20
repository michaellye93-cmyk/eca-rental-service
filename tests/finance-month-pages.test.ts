import test from 'node:test';
import assert from 'node:assert/strict';
import { MONEY_PAGE_GROUPS, monthLoadNeeded, paymentsRefreshNeeded, usesFinanceMonth } from '../services/finance/pages.ts';

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

test('the tab bar has Reports then Work, Month close last, and every page exactly once', () => {
  assert.deepEqual(MONEY_PAGE_GROUPS.map((group) => group.label), ['Reports', 'Work']);
  assert.deepEqual(MONEY_PAGE_GROUPS.map((group) => group.pages.map(([id]) => id)), [
    ['overview', 'cash', 'collections', 'vehicles'],
    ['expenses', 'loans', 'reconcile', 'close'],
  ]);
  assert.deepEqual(MONEY_PAGE_GROUPS.flatMap((group) => group.pages.map(([, label]) => label)),
    ['Overview', 'Cash', 'Collections', 'Vehicles', 'Records', 'Vehicle loans', 'Reconcile', 'Month close']);
});

test('a Draft month refreshes its E-Hailing figures once when opened; Ready and Closed months never do', () => {
  const month = (status: string) => ({ finance_month: '2026-09-01', status });
  assert.equal(paymentsRefreshNeeded(month('DRAFT'), null), true, 'first open of a Draft month');
  assert.equal(paymentsRefreshNeeded(month('DRAFT'), '2026-09'), false, 'already refreshed on this open: no loop on later reloads');
  assert.equal(paymentsRefreshNeeded(month('DRAFT'), '2026-08'), true, 'another month was refreshed before');
  assert.equal(paymentsRefreshNeeded(month('READY FOR REVIEW'), null), false);
  assert.equal(paymentsRefreshNeeded(month('CLOSED'), null), false);
});

test('Vehicle loans does not read the Finance month: it works from the loan records only', () => {
  assert.equal(usesFinanceMonth('loans'), false);
  assert.equal(monthLoadNeeded('loans', '2026-09', null), false, 'opening Vehicle loans reads nothing month-based');
  assert.equal(monthLoadNeeded('loans', '2026-10', '2026-09'), false);
});
