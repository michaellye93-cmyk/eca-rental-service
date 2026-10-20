import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesAccountFilter, needsReceivedInto, receivedIntoLabel, type PaymentAccount } from '../services/paymentAccounts.ts';
import { paymentFromRow } from '../utils.ts';

const ACCOUNTS: PaymentAccount[] = [
  { id: 'a1', label: 'Fixture Bank 1001', entity: 'SDN_BHD' },
  { id: 'a2', label: 'Fixture QR', entity: 'ENTERPRISE' },
];

test('only money that reaches a bank asks which account it went into', () => {
  assert.equal(needsReceivedInto(400, 'BANK TRANSFER'), true);
  assert.equal(needsReceivedInto(400, 'CASH DEPOSIT'), true);
  assert.equal(needsReceivedInto(400, 'CASH'), false);
  assert.equal(needsReceivedInto(400, 'DEPOSIT CONTRA'), false);
  assert.equal(needsReceivedInto(0, 'CLAIM'), false);
  assert.equal(needsReceivedInto(0, 'BANK TRANSFER'), false);
});

test('a tag reads as the account and its company; an empty bank payment reads Untagged', () => {
  assert.equal(receivedIntoLabel(ACCOUNTS, 'a1'), 'Fixture Bank 1001 · SDN BHD');
  assert.equal(receivedIntoLabel(ACCOUNTS, 'a2'), 'Fixture QR · Enterprise');
  assert.equal(receivedIntoLabel(ACCOUNTS, undefined), 'Untagged');
  assert.equal(receivedIntoLabel(ACCOUNTS, 'gone'), 'Untagged');
});

test('the bank check filter keeps one company, or the untagged payments', () => {
  assert.equal(matchesAccountFilter('all', undefined, ACCOUNTS), true);
  assert.equal(matchesAccountFilter('SDN_BHD', 'a1', ACCOUNTS), true);
  assert.equal(matchesAccountFilter('SDN_BHD', 'a2', ACCOUNTS), false);
  assert.equal(matchesAccountFilter('ENTERPRISE', 'a2', ACCOUNTS), true);
  assert.equal(matchesAccountFilter('UNTAGGED', undefined, ACCOUNTS), true);
  assert.equal(matchesAccountFilter('UNTAGGED', 'a1', ACCOUNTS), false);
  assert.equal(matchesAccountFilter('ENTERPRISE', undefined, ACCOUNTS), false);
});

test('a payments row carries its received-into account only when one is set', () => {
  assert.equal(paymentFromRow({ id: '1', date: '2026-10-01', amount: 400, received_into: 'a1' }).receivedInto, 'a1');
  assert.equal('receivedInto' in paymentFromRow({ id: '2', date: '2026-10-01', amount: 400, received_into: null }), false);
});
