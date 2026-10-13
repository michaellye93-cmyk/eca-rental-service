import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetReminderText, FLEET_REMINDER_MAX_CHARS } from '../services/fleet/reminder.ts';
import type { Car } from '../services/fleet/rules.ts';

const TODAY = '2026-10-13';
const car = (overrides: Partial<Car> = {}): Car => ({
  id: overrides.plateNumber ?? 'c1', make: 'PERODUA', model: 'BEZZA', plateNumber: 'XAA1001', roadtaxExpiry: '2027-06-01',
  insuranceExpiry: '2027-06-01', inspectionExpiry: '', notes: '', ownership: 'Own Fleet', ...overrides,
});

test('lists cars due within 30 days, expired or missing, grouped road tax, insurance, inspection, with plate and date', () => {
  const text = fleetReminderText([
    car({ plateNumber: 'XAA1001', roadtaxExpiry: '2026-10-20' }),
    car({ plateNumber: 'XAA1002', roadtaxExpiry: '2026-10-01', insuranceExpiry: '2026-11-12' }),
    car({ plateNumber: 'XAA1003', insuranceExpiry: '' }),
    car({ plateNumber: 'XAA1004', inspectionExpiry: '2026-10-13' }),
    car({ plateNumber: 'XAA1005' }),
  ], TODAY);
  assert.equal(text, [
    'ECA Fleet reminders, 13 Oct 2026',
    'Due in the next 30 days, expired or missing:',
    '',
    'Road tax',
    'XAA1002 - 1 Oct 2026 (Expired 12 days ago)',
    'XAA1001 - 20 Oct 2026 (Due in 7 days)',
    '',
    'Insurance',
    'XAA1003 - Not set',
    'XAA1002 - 12 Nov 2026 (Due in 30 days)',
    '',
    'Inspection',
    'XAA1004 - 13 Oct 2026 (Due today)',
  ].join('\n'));
});

test('dates more than 30 days away and an empty inspection are left out; nothing due gives one plain line', () => {
  const text = fleetReminderText([car({ roadtaxExpiry: '2026-11-13' }), car({ plateNumber: 'XAA1002' })], TODAY);
  assert.equal(text, 'ECA Fleet reminders, 13 Oct 2026\nNo road tax, insurance or inspection is due in the next 30 days, expired or missing.');
});

test("Finance's later insurance date is used where the Fleet page uses it (admins)", () => {
  const cars = [car({ plateNumber: 'XAA 1001', insuranceExpiry: '2026-10-20' })];
  assert.match(fleetReminderText(cars, TODAY), /XAA 1001 - 20 Oct 2026 \(Due in 7 days\)/);
  const cover = new Map([['XAA1001', '2027-10-20']]);
  assert.doesNotMatch(fleetReminderText(cars, TODAY, cover), /XAA 1001/);
});

test('a long list stays under the limit and says how many more there are', () => {
  const cars = Array.from({ length: 80 }, (_, i) => car({ plateNumber: `XAA${String(2000 + i)}`, roadtaxExpiry: '2026-10-20', insuranceExpiry: '2026-10-21' }));
  const text = fleetReminderText(cars, TODAY);
  assert.ok(text.length <= FLEET_REMINDER_MAX_CHARS, `${text.length} characters`);
  const shown = text.split('\n').filter(line => /^XAA\d{4} - /.test(line)).length;
  assert.ok(shown > 10, 'still lists plenty of cars');
  assert.match(text, new RegExp(`\\nand ${160 - shown} more$`));
});

test('plain text only: no WhatsApp bold, italic or strike markup and no emoji', () => {
  const text = fleetReminderText([car({ plateNumber: 'XAA1001', roadtaxExpiry: '' }), car({ plateNumber: 'XAA1002', insuranceExpiry: '2026-10-01' })], TODAY);
  assert.doesNotMatch(text, /[*_~`]|\p{Extended_Pictographic}/u);
});
