import test from 'node:test';
import assert from 'node:assert/strict';
import { cashOf, COLLECTED_INCLUDES, collectedOf, isCashMethod, notCashOf } from '../services/moneyDefinitions.ts';
import type { PaymentTransaction } from '../types.ts';

const payment = (amount: number, serviceClaim: number, paymentMethod?: PaymentTransaction['paymentMethod']): PaymentTransaction =>
  ({ id: 'p', date: '2026-10-01', amount, serviceClaim, ...(paymentMethod ? { paymentMethod } : {}) });

test('cash is money that reached the business: bank transfer, cash deposit or cash in hand (no method reads as bank transfer)', () => {
  for (const method of ['BANK TRANSFER', 'CASH DEPOSIT', 'CASH', undefined] as const) assert.equal(isCashMethod(method), true, String(method));
  assert.equal(isCashMethod('DEPOSIT CONTRA'), false);
  assert.equal(isCashMethod('CLAIM'), false);
  assert.equal(cashOf(payment(400, 0, 'BANK TRANSFER')), 400);
  assert.equal(cashOf(payment(150, 250, 'CASH DEPOSIT')), 150, 'the claim part is not cash');
  assert.equal(cashOf(payment(300, 0, 'DEPOSIT CONTRA')), 0, 'a deposit set against rent brings in no cash');
  assert.equal(cashOf(payment(0, 263, 'CLAIM')), 0);
});

test('collected is everything that settled rent: cash, service claims (the driver paid on our behalf) and deposit forfeits', () => {
  assert.equal(collectedOf(payment(150, 250, 'BANK TRANSFER')), 400);
  assert.equal(collectedOf(payment(300, 0, 'DEPOSIT CONTRA')), 300);
  assert.equal(collectedOf(payment(0, 263, 'CLAIM')), 263);
  assert.equal(notCashOf(payment(150, 250, 'BANK TRANSFER')), 250);
  assert.equal(notCashOf(payment(300, 0, 'DEPOSIT CONTRA')), 300);
});

test('a screen showing collected money names all three parts', () => {
  assert.equal(COLLECTED_INCLUDES, 'cash, service claims and deposit forfeits');
});
