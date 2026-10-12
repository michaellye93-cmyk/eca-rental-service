import test from 'node:test';
import assert from 'node:assert/strict';
import { depositPanelEntries, movementError, upfrontToRecord } from '../services/depositTotals.ts';

const TODAY = '2026-10-12';
const typed = (deposit: string, downpayment: string, date = TODAY) => ({ deposit, downpayment, date });

test('Edit Driver records only what is new: the rise over what the Deposits panel already has', () => {
  assert.deepEqual(upfrontToRecord(typed('1000', ''), { DEPOSIT: 0, DOWNPAYMENT: 0 }, TODAY), { deposit: 1000, downpayment: 0, date: TODAY });
  assert.deepEqual(upfrontToRecord(typed('1500', '2000'), { DEPOSIT: 1000, DOWNPAYMENT: 2000 }, TODAY), { deposit: 500, downpayment: 0, date: TODAY });
  assert.deepEqual(upfrontToRecord(typed('1000', '2000'), { DEPOSIT: 1000, DOWNPAYMENT: 2000 }, TODAY), { deposit: 0, downpayment: 0, date: TODAY });
});

test('a lower amount is refused with where to change it; a negative or non-number amount is refused', () => {
  assert.match(String(upfrontToRecord(typed('500', ''), { DEPOSIT: 1000, DOWNPAYMENT: 0 }, TODAY)), /Deposits panel/);
  assert.match(String(upfrontToRecord(typed('-5', ''), { DEPOSIT: 0, DOWNPAYMENT: 0 }, TODAY)), /zero or more/);
  assert.match(String(upfrontToRecord(typed('abc', ''), { DEPOSIT: 0, DOWNPAYMENT: 0 }, TODAY)), /zero or more/);
});

test('money received at signing is recorded on the date it was received (Finance and Reconcile use that date), never a future one', () => {
  assert.deepEqual(upfrontToRecord(typed('1000', '2000', '2026-09-28'), { DEPOSIT: 0, DOWNPAYMENT: 0 }, TODAY), { deposit: 1000, downpayment: 2000, date: '2026-09-28' });
  assert.match(String(upfrontToRecord(typed('1000', '', '2026-10-13'), { DEPOSIT: 0, DOWNPAYMENT: 0 }, TODAY)), /future/);
  assert.match(String(upfrontToRecord(typed('1000', '', ''), { DEPOSIT: 0, DOWNPAYMENT: 0 }, TODAY)), /date received/);
  assert.match(String(upfrontToRecord(typed('1000', '', '2026-02-30'), { DEPOSIT: 0, DOWNPAYMENT: 0 }, TODAY)), /date received/);
  // Nothing new to record: the date does not matter
  assert.deepEqual(upfrontToRecord(typed('1000', '', ''), { DEPOSIT: 1000, DOWNPAYMENT: 0 }, TODAY), { deposit: 0, downpayment: 0, date: TODAY });
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
