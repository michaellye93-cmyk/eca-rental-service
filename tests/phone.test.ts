import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, normalizeMalaysianPhone, whatsappLink } from '../utils.ts';

test('Malaysian phone numbers are stored as 60 followed by the number, however they are typed', () => {
  for (const typed of ['012-345 6789', '+60 12-345 6789', '60123456789', '0123456789', '(012) 345-6789']) {
    assert.equal(normalizeMalaysianPhone(typed), '60123456789', typed);
  }
  assert.equal(normalizeMalaysianPhone('011-2345 6789'), '601123456789');
  assert.equal(normalizeMalaysianPhone('03-2123 4567'), '60321234567');
});

test('anything that is not a phone number is refused', () => {
  for (const typed of ['abc', '', '   ', '0', '12345', '0123456789012345']) {
    assert.equal(normalizeMalaysianPhone(typed), null, typed);
  }
});

test('stored numbers display in the usual Malaysian format', () => {
  assert.equal(formatPhone('60123456789'), '+60 12-345 6789');
  assert.equal(formatPhone('601123456789'), '+60 11-2345 6789');
  assert.equal(formatPhone('60321234567'), '+60 321234567');
});

test('a WhatsApp link opens a chat with the number and an optional message ready to edit', () => {
  assert.equal(whatsappLink('60123456789'), 'https://wa.me/60123456789');
  assert.equal(whatsappLink('60123456789', 'Rent for XAA1001 is 9 days late & RM400.00 is owed.'),
    'https://wa.me/60123456789?text=Rent%20for%20XAA1001%20is%209%20days%20late%20%26%20RM400.00%20is%20owed.');
});
