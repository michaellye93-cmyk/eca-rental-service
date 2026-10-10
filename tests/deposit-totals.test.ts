import test from 'node:test';
import assert from 'node:assert/strict';
import { upfrontToRecord } from '../services/depositTotals.ts';

test('Edit Driver records only what is new: the rise over what the Deposits panel already has', () => {
  assert.deepEqual(upfrontToRecord({ deposit: '1000', downpayment: '' }, { DEPOSIT: 0, DOWNPAYMENT: 0 }), { deposit: 1000, downpayment: 0 });
  assert.deepEqual(upfrontToRecord({ deposit: '1500', downpayment: '2000' }, { DEPOSIT: 1000, DOWNPAYMENT: 2000 }), { deposit: 500, downpayment: 0 });
  assert.deepEqual(upfrontToRecord({ deposit: '1000', downpayment: '2000' }, { DEPOSIT: 1000, DOWNPAYMENT: 2000 }), { deposit: 0, downpayment: 0 });
});

test('a lower amount is refused with where to change it; a negative or non-number amount is refused', () => {
  assert.match(String(upfrontToRecord({ deposit: '500', downpayment: '' }, { DEPOSIT: 1000, DOWNPAYMENT: 0 })), /Deposits panel/);
  assert.match(String(upfrontToRecord({ deposit: '-5', downpayment: '' }, { DEPOSIT: 0, DOWNPAYMENT: 0 })), /zero or more/);
  assert.match(String(upfrontToRecord({ deposit: 'abc', downpayment: '' }, { DEPOSIT: 0, DOWNPAYMENT: 0 })), /zero or more/);
});
