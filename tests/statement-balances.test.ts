import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceEntries, monthEndBalances } from '../services/finance/statementBalances.ts';

const line = (date: string, balance: number | null) => ({ date, balance });

test('a statement covering the month gives the balance at the end of the month before and at the end of the month', () => {
  assert.deepEqual(monthEndBalances([line('2026-09-02', 1500), line('2026-09-28', 900)], 1000, '2026-09'), { opening: 1000, closing: 900 });
});

test('lines outside the month are used to find both month-end balances', () => {
  const lines = [line('2026-08-30', 700), line('2026-09-02', 1500), line('2026-09-30', 950), line('2026-10-01', 2000)];
  assert.deepEqual(monthEndBalances(lines, 400, '2026-09'), { opening: 700, closing: 950 });
});

test('without a printed opening balance or running balances nothing is guessed', () => {
  assert.deepEqual(monthEndBalances([line('2026-09-02', null)], null, '2026-09'), { opening: null, closing: null });
  assert.deepEqual(monthEndBalances([line('2026-09-02', 1500)], null, '2026-09'), { opening: null, closing: 1500 });
  assert.deepEqual(monthEndBalances([], 1000, '2026-09'), { opening: null, closing: null }, 'no line in the month: no claim about the month');
});

test('balances are saved under the account already used on Cash when the last four digits match, else the statement name', () => {
  const entries = balanceEntries({ accountLabel: 'RHB …4281', filename: 'sep.xlsx', month: '2026-09', opening: 1000, closing: 900 }, ['RHB Sewa Beli 4281', 'RHB Biasa 1109']);
  assert.deepEqual(entries, [
    { account: 'RHB Sewa Beli 4281', balance: 1000, asOf: '2026-08-31', note: 'Opening balance from bank statement sep.xlsx' },
    { account: 'RHB Sewa Beli 4281', balance: 900, asOf: '2026-09-30', note: 'Closing balance from bank statement sep.xlsx' },
  ]);
  const unknown = balanceEntries({ accountLabel: 'RHB …7777', filename: 'x.xlsx', month: '2026-02', opening: null, closing: 50 }, ['RHB Sewa Beli 4281']);
  assert.deepEqual(unknown, [{ account: 'RHB …7777', balance: 50, asOf: '2026-02-28', note: 'Closing balance from bank statement x.xlsx' }]);
  assert.deepEqual(balanceEntries({ accountLabel: 'RHB …7777', filename: 'x.xlsx', month: '2026-10', opening: 10, closing: 50 }, [], '2026-10-12').map(e => e.asOf), ['2026-09-30'],
    'a month still running has no month-end balance yet');
});
