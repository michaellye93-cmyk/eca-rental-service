import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceEntries, monthEndBalances, sameBankAccount } from '../services/finance/statementBalances.ts';

const line = (date: string, balance: number | null) => ({ date, balance });
const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };

test('a statement covering the month gives the balance at the end of the month before and at the end of the month', () => {
  assert.deepEqual(monthEndBalances([line('2026-09-02', 1500), line('2026-09-28', 900)], 1000, '2026-09', SEPTEMBER), { opening: 1000, closing: 900 });
});

test('lines outside the month are used to find both month-end balances', () => {
  const lines = [line('2026-08-30', 700), line('2026-09-02', 1500), line('2026-09-30', 950), line('2026-10-01', 2000)];
  assert.deepEqual(monthEndBalances(lines, 400, '2026-09', { from: '2026-08-16', to: '2026-10-15' }), { opening: 700, closing: 950 });
});

test('without a printed opening balance or running balances nothing is guessed', () => {
  assert.deepEqual(monthEndBalances([line('2026-09-02', null)], null, '2026-09', SEPTEMBER), { opening: null, closing: null });
  assert.deepEqual(monthEndBalances([line('2026-09-02', 1500)], null, '2026-09', SEPTEMBER), { opening: null, closing: 1500 });
  assert.deepEqual(monthEndBalances([], 1000, '2026-09', SEPTEMBER), { opening: null, closing: null }, 'no line in the month: no claim about the month');
});

test('a statement ending before the month does: no closing balance (1 to 15 September)', () => {
  const lines = [line('2026-09-02', 1500), line('2026-09-14', 1200)];
  assert.deepEqual(monthEndBalances(lines, 1000, '2026-09', { from: '2026-09-01', to: '2026-09-15' }), { opening: 1000, closing: null });
});

test('a statement starting after the 1st gives no opening from its Beginning Balance; one starting mid-August gives the 31 August balance only', () => {
  // 16 August to 15 September, read for September: the running balance after the last August line is the 31 August
  // balance; the statement ends before 30 September, so there is no closing balance.
  const lines = [line('2026-08-20', 700), line('2026-08-28', 650), line('2026-09-03', 900), line('2026-09-12', 800)];
  assert.deepEqual(monthEndBalances(lines, 500, '2026-09', { from: '2026-08-16', to: '2026-09-15' }), { opening: 650, closing: null });
  // Read for August, the same statement starts on the 16th: its Beginning Balance is not the 31 July balance.
  assert.deepEqual(monthEndBalances(lines, 500, '2026-08', { from: '2026-08-16', to: '2026-09-15' }), { opening: null, closing: 650 });
  // Starting before the 1st with no line before the month: the Beginning Balance is of another day, so no opening.
  assert.deepEqual(monthEndBalances([line('2026-09-03', 900)], 500, '2026-09', { from: '2026-08-16', to: '2026-09-30' }), { opening: null, closing: 900 });
});

test('without a statement period nothing is saved (never guessed)', () => {
  assert.deepEqual(monthEndBalances([line('2026-09-02', 1500), line('2026-09-28', 900)], 1000, '2026-09', null), { opening: null, closing: null });
});

test('balances are saved under the account on Cash that is the same bank account (same last four digits)', () => {
  const { entries, reason } = balanceEntries({ accountLabel: 'RHB …9999', filename: 'sep.xlsx', month: '2026-09', opening: 1000, closing: 900 }, ['Fixture Bank A 9999', 'Fixture Bank B 8888', 'Fixture Bank A 9999']);
  assert.deepEqual(entries, [
    { account: 'Fixture Bank A 9999', balance: 1000, asOf: '2026-08-31', note: 'Opening balance from bank statement sep.xlsx' },
    { account: 'Fixture Bank A 9999', balance: 900, asOf: '2026-09-30', note: 'Closing balance from bank statement sep.xlsx' },
  ]);
  assert.equal(reason, null);
  assert.deepEqual(balanceEntries({ accountLabel: ' Fixture Wallet ', filename: 'w.xlsx', month: '2026-02', opening: null, closing: 50 }, ['Fixture Wallet']).entries.map(e => e.account), ['Fixture Wallet'],
    'the same name (trimmed) is the same account');
});

test('with no account on Cash yet, the statement’s own label becomes the account', () => {
  const { entries, reason } = balanceEntries({ accountLabel: 'RHB …7777', filename: 'x.xlsx', month: '2026-02', opening: null, closing: 50 }, []);
  assert.deepEqual(entries, [{ account: 'RHB …7777', balance: 50, asOf: '2026-02-28', note: 'Closing balance from bank statement x.xlsx' }]);
  assert.equal(reason, null);
  assert.deepEqual(balanceEntries({ accountLabel: 'RHB …7777', filename: 'x.xlsx', month: '2026-10', opening: 10, closing: 50 }, [], '2026-10-12').entries.map(e => e.asOf), ['2026-09-30'],
    'a month still running has no month-end balance yet');
});

test('when Cash has accounts but none is this bank account, nothing is saved (no second label for one account) and the reason is given', () => {
  const { entries, reason } = balanceEntries({ accountLabel: 'RHB …7777', filename: 'x.xlsx', month: '2026-02', opening: 10, closing: 50 }, ['Fixture Bank A 9999', 'Fixture Bank B 8888']);
  assert.deepEqual(entries, []);
  assert.equal(reason, 'Bank balances not added: no account on Cash ends in 7777. Rename the account on Cash to end in those digits, or enter the balances by hand.');
  const typed = balanceEntries({ accountLabel: 'Fixture Wallet', filename: 'w.csv', month: '2026-02', opening: 10, closing: 50 }, ['Fixture Bank A 9999']);
  assert.deepEqual(typed.entries, []);
  assert.match(typed.reason ?? '', /^Bank balances not added: no account on Cash is named "Fixture Wallet"\./);
  assert.deepEqual(balanceEntries({ accountLabel: 'RHB …7777', filename: 'x.xlsx', month: '2026-02', opening: null, closing: null }, ['Fixture Bank A 9999']), { entries: [], reason: null },
    'a statement without balances has nothing to add and nothing to explain');
});

test('one rule says whether two labels are the same bank account, for statement balances and for Month close', () => {
  assert.equal(sameBankAccount('RHB …9999', 'Fixture Bank A 9999'), true);
  assert.equal(sameBankAccount(' Fixture Wallet', 'Fixture Wallet '), true);
  assert.equal(sameBankAccount('Fixture Bank A 9999', 'Fixture Bank B 8888'), false);
  assert.equal(sameBankAccount('Bank 99-99', 'Other 9999'), true, 'the last four digits, wherever the separators are');
  assert.equal(sameBankAccount('Fixture 999', 'Other 999'), false, 'fewer than four digits never match by digits');
  assert.equal(sameBankAccount('Fixture Wallet', 'Fixture Bank A 9999'), false);
});
