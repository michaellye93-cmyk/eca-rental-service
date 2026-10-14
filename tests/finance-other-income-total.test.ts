import test from 'node:test';
import assert from 'node:assert/strict';
import { otherIncomeTotals } from '../services/finance/calculations.ts';

const row = (amount: number, status: 'DRAFT' | 'CONFIRMED') => ({ amount, status });

test('the Other Income panel splits income the P&L counts from Draft lines it does not', () => {
  assert.deepEqual(otherIncomeTotals([row(1400, 'DRAFT'), row(857.5, 'CONFIRMED'), row(548, 'DRAFT'), row(100.25, 'CONFIRMED')]), { counted: 957.75, draft: 1948 });
  assert.deepEqual(otherIncomeTotals([]), { counted: 0, draft: 0 });
});
