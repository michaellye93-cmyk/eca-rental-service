import test from 'node:test';
import assert from 'node:assert/strict';
import { driverNotCreatedText } from '../utils.ts';

test('a second active driver with the same IC is explained in plain words, not the database message', () => {
  const err = { code: '23505', message: 'duplicate key value violates unique constraint "drivers_one_active_per_nric"' };
  const text = driverNotCreatedText(err);
  assert.doesNotMatch(text, /duplicate key|constraint/);
  assert.match(text, /already saved|already/i);
  assert.match(text, /IC/);
});

test('any other failure keeps the database message', () => {
  assert.equal(driverNotCreatedText({ message: 'network down' }), 'Driver not created: network down');
});
