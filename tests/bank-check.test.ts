import test from 'node:test';
import assert from 'node:assert/strict';
import { bankCheck, type CashBalanceEntry } from '../services/cashOutlook.ts';

let id = 0;
const entry = (account_label: string, balance: number, as_of: string, entered_at = '2026-10-01T00:00:00Z'): CashBalanceEntry =>
  ({ id: String(++id), account_label, balance, as_of, note: null, entered_at });

test('the bank should move by the month’s net cash flow; the rest is unexplained', () => {
  const balances = [entry('Bank A', 10000, '2026-07-31'), entry('Bank B', 5000, '2026-08-01'),
    entry('Bank A', 11000, '2026-08-31'), entry('Bank B', 6000, '2026-08-31')];
  assert.deepEqual(bankCheck(balances, '2026-08', 3898), {
    month: '2026-08', opening: 15000, netCashFlow: 3898, expected: 18898, closing: 17000, unexplained: -1898, flagged: true, missing: [],
  });
});

test('a small difference is not flagged; a balance dated the 1st of the next month counts as month end', () => {
  const balances = [entry('Bank A', 10000, '2026-08-01'), entry('Bank A', 13700, '2026-09-01')];
  const check = bankCheck(balances, '2026-08', 3898);
  assert.equal(check.unexplained, -198);
  assert.equal(check.flagged, false);
});

test('balances not on a month boundary do not count, and the missing ones are named', () => {
  const balances = [entry('Bank A', 10000, '2026-07-31'), entry('Bank A', 12000, '2026-08-20'), entry('Bank B', 7000, '2026-08-31')];
  const check = bankCheck(balances, '2026-08', 1000);
  assert.deepEqual(check.missing, [{ account: 'Bank A', when: 'end' }, { account: 'Bank B', when: 'start' }]);
  assert.equal(check.unexplained, null);
  assert.equal(check.expected, null);
  assert.equal(check.flagged, false);
});

test('when two balances share a boundary, the later date wins, then the later entry', () => {
  const balances = [entry('Bank A', 1, '2026-07-31'), entry('Bank A', 2, '2026-08-01'),
    entry('Bank A', 50, '2026-08-31', '2026-09-01T00:00:00Z'), entry('Bank A', 60, '2026-08-31', '2026-09-02T00:00:00Z')];
  const check = bankCheck(balances, '2026-08', 0);
  assert.equal(check.opening, 2);
  assert.equal(check.closing, 60);
});

test('an account with no balance within 45 days of the month is not in use then, so it is never "missing"', () => {
  const balances = [entry('Bank A', 10000, '2026-07-31'), entry('Bank A', 11000, '2026-08-31'), entry('Old bank', 50, '2026-03-31')];
  const check = bankCheck(balances, '2026-08', 1000);
  assert.deepEqual(check.missing, []);
  assert.equal(check.unexplained, 0);
});

test('Month close names each bank account in use that has no posted statement for the month', async () => {
  const { accountsWithoutStatement } = await import('../services/cashOutlook.ts');
  const balances = [entry('Fixture Bank A 9999', 1, '2026-08-31'), entry('Fixture Bank B 8888', 1, '2026-08-31'), entry('Old bank', 1, '2026-01-31')];
  assert.deepEqual(accountsWithoutStatement(balances, [{ account_label: 'RHB …9999' }], '2026-08'), ['Fixture Bank B 8888']);
  assert.deepEqual(accountsWithoutStatement(balances, [{ account_label: 'RHB …9999' }, { account_label: 'Fixture Bank B 8888' }], '2026-08'), []);
  assert.deepEqual(accountsWithoutStatement([], [], '2026-08'), []);
  // The same rule as statement balances (sameBankAccount): same trimmed name, or the same last four digits.
  const wallet = [entry('Fixture Wallet ', 1, '2026-08-31'), entry('Fixture Cash 99', 1, '2026-08-31')];
  assert.deepEqual(accountsWithoutStatement(wallet, [{ account_label: 'Fixture Wallet' }, { account_label: 'Fixture Bank 1099' }], '2026-08'), ['Fixture Cash 99']);
});

test('Month close: one posted statement is required; accounts without one need a tick, and nothing shows as reconciled while Cash is loading', async () => {
  const { bankCloseState } = await import('../services/cashOutlook.ts');
  const balances = [entry('Fixture Bank A 9999', 1, '2026-08-31'), entry('Fixture Wallet', 1, '2026-08-31'), entry('Fixture Cash in hand', 1, '2026-08-31')];
  const imports = [{ account_label: 'RHB …9999' }];
  assert.deepEqual(bankCloseState(undefined, imports, '2026-08', 'August 2026'),
    { status: 'checking', ready: false, accounts: [], label: 'Bank statement reconciled (Reconcile tab): checking…', acknowledgement: null });
  assert.deepEqual(bankCloseState(balances, [], '2026-08', 'August 2026'),
    { status: 'missing', ready: false, accounts: [], label: 'Bank statement reconciled (Reconcile tab)', acknowledgement: null });
  assert.deepEqual(bankCloseState(balances, imports, '2026-08', 'August 2026'), {
    status: 'needs-ack', ready: true, accounts: ['Fixture Cash in hand', 'Fixture Wallet'],
    label: 'Bank statement reconciled (Reconcile tab). No statement for Fixture Cash in hand, Fixture Wallet: confirm them before closing',
    acknowledgement: 'These accounts have no bank statement for August 2026: Fixture Cash in hand, Fixture Wallet. I have checked them.',
  });
  const all = [...imports, { account_label: 'Fixture Wallet' }, { account_label: 'Fixture Cash in hand' }];
  assert.deepEqual(bankCloseState(balances, all, '2026-08', 'August 2026'),
    { status: 'reconciled', ready: true, accounts: [], label: 'Bank statement reconciled (Reconcile tab)', acknowledgement: null });
  assert.equal(bankCloseState(null, imports, '2026-08', 'August 2026').status, 'reconciled', 'Cash could not be read: one statement will do, as before');
});
