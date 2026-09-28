import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionCount, byUrgency, carFormError, carFromRow, carToRow, daysUntil, expiryStatus, findDuplicatePlate,
  matchesSearch, needsAttention, newCar, type Car, type ExpiryStatus,
} from '../services/fleet/rules.ts';

const TODAY = '2026-09-29';
const car = (overrides: Partial<Car> = {}): Car => ({
  id: 'c1', make: 'PERODUA', model: 'BEZZA', plateNumber: 'TST 1001', roadtaxExpiry: '2027-01-01',
  insuranceExpiry: '2027-01-01', inspectionExpiry: '', notes: '', ownership: 'Own Fleet', ...overrides,
});
const shown = (status: ExpiryStatus) => [status.tone, status.text, status.needsAttention];

test('each date shows expired, due or days left, counted from today in Kuala Lumpur', () => {
  const cases: [string, string, string, boolean][] = [
    ['2026-09-28', 'expired', 'Expired 1 day ago', true],
    ['2026-09-19', 'expired', 'Expired 10 days ago', true],
    ['2026-09-29', 'due', 'Due today', true],
    ['2026-09-30', 'due', 'Due in 1 day', true],
    ['2026-10-29', 'due', 'Due in 30 days', true],
    ['2026-10-30', 'ok', '31 days left', false],
  ];
  for (const [date, tone, text, attention] of cases) assert.deepEqual(shown(expiryStatus('roadtax', date, TODAY)), [tone, text, attention], date);
});

test('an empty inspection is not an alert, but a missing or wrong road tax, insurance or inspection date is', () => {
  assert.deepEqual(shown(expiryStatus('inspection', '', TODAY)), ['none', 'No inspection', false]);
  assert.deepEqual(shown(expiryStatus('roadtax', '', TODAY)), ['missing', 'Not set', true]);
  assert.deepEqual(shown(expiryStatus('insurance', '31/12/2026', TODAY)), ['missing', 'Not set', true]);
  assert.deepEqual(shown(expiryStatus('inspection', '2026-02-30', TODAY)), ['missing', 'Not set', true]);
});

test('dates count whole calendar days whatever time zone the computer uses, across daylight-saving changes', () => {
  const saved = process.env.TZ;
  try {
    for (const zone of ['Asia/Kuala_Lumpur', 'America/Los_Angeles', 'Europe/London', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      assert.equal(daysUntil('2026-11-02', '2026-11-01'), 1, `${zone}: autumn change`);
      assert.equal(daysUntil('2026-03-09', '2026-03-08'), 1, `${zone}: spring change`);
      assert.equal(daysUntil('2027-03-01', '2027-02-28'), 1, `${zone}: month end`);
      assert.equal(daysUntil('2026-09-28', '2026-09-29'), -1, zone);
    }
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
});

test('a car needs attention when any of its dates does, and the count adds up cars, not dates', () => {
  const cars = [
    car({ id: 'fine' }),
    car({ id: 'insurance-due', insuranceExpiry: '2026-10-05' }),
    car({ id: 'two-due', roadtaxExpiry: '2026-09-01', insuranceExpiry: '2026-10-05' }),
    car({ id: 'inspection-due', inspectionExpiry: '2026-10-01' }),
  ];
  assert.deepEqual(cars.map(c => needsAttention(c, TODAY)), [false, true, true, true]);
  assert.equal(attentionCount(cars, TODAY), 3);
});

test('the most urgent car comes first: a missing required date, then the soonest date of any kind, ties by plate', () => {
  const cars = [
    car({ id: 'later', plateNumber: 'TST 3', roadtaxExpiry: '2027-05-01', insuranceExpiry: '2027-06-01' }),
    car({ id: 'inspection-soonest', plateNumber: 'TST 4', roadtaxExpiry: '2027-05-01', insuranceExpiry: '2027-06-01', inspectionExpiry: '2026-10-01' }),
    car({ id: 'no-roadtax', plateNumber: 'TST 5', roadtaxExpiry: '' }),
    car({ id: 'tie-b', plateNumber: 'TST 2', roadtaxExpiry: '2026-12-01', insuranceExpiry: '2027-01-01' }),
    car({ id: 'tie-a', plateNumber: 'TST 1', roadtaxExpiry: '2026-12-01', insuranceExpiry: '2027-01-01' }),
  ];
  assert.deepEqual(byUrgency(cars).map(c => c.id), ['no-roadtax', 'inspection-soonest', 'tie-a', 'tie-b', 'later']);
  assert.equal(cars[0].id, 'later', 'the list passed in keeps its order');
});

test('search finds a plate however it is spaced or cased, and make, model or notes', () => {
  const bezza = car({ plateNumber: 'TST 1001', make: 'PERODUA', model: 'BEZZA', notes: 'Spare key in office' });
  for (const query of ['tst1001', ' TST 1001 ', 't s t 1 0', 'bezza', 'Perodua', 'spare KEY', '']) assert.equal(matchesSearch(bezza, query), true, query);
  for (const query of ['TST 1002', 'myvi']) assert.equal(matchesSearch(bezza, query), false, query);
});

test('the form refuses a plate already in the list, however it is typed, but a car may keep its own plate', () => {
  const cars = [car({ id: 'a', plateNumber: 'TST 1001' }), car({ id: 'b', plateNumber: 'TST 2002' })];
  assert.equal(findDuplicatePlate(cars, 'tst1001')?.id, 'a');
  assert.equal(findDuplicatePlate(cars, 'TST 1001', 'a'), undefined);
  assert.equal(findDuplicatePlate(cars, '  '), undefined);
  assert.match(carFormError(car({ id: 'new', plateNumber: 'tst 1001' }), cars) ?? '', /already in the list/);
  assert.equal(carFormError(car({ id: 'a', plateNumber: 'TST 1001', notes: 'edited' }), cars), null);
});

test('the form needs make, model, plate, road tax and insurance; inspection may be empty but not a wrong date', () => {
  assert.equal(carFormError(car({ inspectionExpiry: '' }), []), null);
  assert.match(carFormError(car({ make: ' ' }), []) ?? '', /make, model and plate/);
  assert.match(carFormError(car({ plateNumber: '' }), []) ?? '', /make, model and plate/);
  assert.match(carFormError(car({ roadtaxExpiry: '' }), []) ?? '', /road tax/);
  assert.match(carFormError(car({ insuranceExpiry: '2026-13-01' }), []) ?? '', /insurance/);
  assert.match(carFormError(car({ inspectionExpiry: '2026-02-30' }), []) ?? '', /inspection/);
});

test('a cars row becomes a car: only the notes column is shown, and only "Others" is Others', () => {
  const row = { id: 'r1', make: ' PERODUA ', model: 'BEZZA', plateNumber: 'TST 1001', roadtaxExpiry: '2026-10-01',
    insuranceExpiry: '2026-10-02', inspectionExpiry: null, notes: ' Fixture note ', label: 'Older fixture label', ownership: 'others' };
  assert.deepEqual(carFromRow(row), { id: 'r1', make: 'PERODUA', model: 'BEZZA', plateNumber: 'TST 1001',
    roadtaxExpiry: '2026-10-01', insuranceExpiry: '2026-10-02', inspectionExpiry: '', notes: 'Fixture note', ownership: 'Others' });
  assert.equal(carFromRow({ id: 'r3', ownership: 'Company' }).ownership, 'Own Fleet');
  assert.equal(carFromRow({ id: 'r4', ownership: null }).ownership, 'Own Fleet');
});

test('a note cleared in the form stays cleared after saving and reloading, even if the older label column held it', () => {
  // Live data: 54 cars hold the same text in notes and in Guardian's older label column; 2 hold different text.
  const stored = { id: 'r5', make: 'PERODUA', model: 'BEZZA', plateNumber: 'TST 1005', roadtaxExpiry: '2026-10-01',
    insuranceExpiry: '2026-10-02', inspectionExpiry: '', notes: 'Fixture note', label: 'Fixture note', ownership: 'Others' };
  const cleared = carToRow({ ...carFromRow(stored), notes: '' });
  const reloaded = carFromRow({ ...stored, ...cleared });
  assert.equal(reloaded.notes, '');
});

test('saving writes notes but never the older label column, and trims what was typed', () => {
  const row = carToRow(car({ id: 'x', make: ' PERODUA ', plateNumber: ' TST 1001 ', notes: ' note ' }));
  assert.equal('label' in row, false);
  assert.deepEqual([row.id, row.make, row.plateNumber, row.notes], ['x', 'PERODUA', 'TST 1001', 'note']);
});

test('a new car starts empty as Own Fleet, with a fresh id each time', () => {
  const [first, second] = [newCar(), newCar()];
  assert.deepEqual([first.make, first.plateNumber, first.roadtaxExpiry, first.ownership], ['', '', '', 'Own Fleet']);
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.id, second.id);
});
