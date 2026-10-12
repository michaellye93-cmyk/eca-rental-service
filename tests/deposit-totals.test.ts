import test from 'node:test';
import assert from 'node:assert/strict';
import { depositPanelEntries, movementError, upfrontToRecord } from '../services/depositTotals.ts';

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

test('B4: the Deposits panel offers only later movements of a security deposit; money received at signing is entered in the driver form', () => {
  assert.deepEqual(depositPanelEntries(true), ['REFUNDED', 'FORFEITED', 'CONTRA']);
  assert.deepEqual(depositPanelEntries(false), ['REFUNDED', 'FORFEITED']);
  assert.ok(!depositPanelEntries(true).includes('RECEIVED'));
});

test('B4: a refund, forfeit or deposit forfeit cannot be more than the deposit held', () => {
  assert.equal(movementError(300, 500), null);
  assert.equal(movementError(500, 500), null);
  assert.match(movementError(600, 500) ?? '', /Only RM\s?500\.00 is held/);
  assert.match(movementError(100, 0) ?? '', /Edit Driver/);
});
