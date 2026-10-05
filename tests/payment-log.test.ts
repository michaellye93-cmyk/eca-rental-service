import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver } from '../types.ts';
import { actorLabel, findPossibleDuplicates, paymentNotes, paymentRecorders, type PaymentChange } from '../services/paymentLog.ts';

process.env.TZ = 'America/New_York'; // times must read in Kuala Lumpur time whatever the computer's zone

const driver = (id: string, payments: Driver['paymentHistory']): Driver => ({
  id, nric: '', name: `Driver ${id}`, carPlate: `XA${id}1001`, contractStartDate: '2026-08-01', rentalCycle: 'WEEKLY',
  contractDuration: 52, rentalRate: 450, totalAmountPaid: 0, paymentHistory: payments,
});
const drivers = [
  driver('A', [
    { id: 'pa1', date: '2026-09-15', amount: 1400, serviceClaim: 0, paymentMethod: 'BANK TRANSFER' },
    { id: 'pa2', date: '2026-08-17', amount: 450, serviceClaim: 0, paymentMethod: 'BANK TRANSFER', reference: 'DN 0817 AAA' },
    { id: 'pa3', date: '2026-09-20', amount: 0, serviceClaim: 80, paymentMethod: 'CLAIM' },
  ]),
  driver('B', [{ id: 'pb1', date: '2026-09-15', amount: 1400, serviceClaim: 0, paymentMethod: 'BANK TRANSFER', reference: 'RHB123456' }]),
];

test('a payment of the same amount on the same date for the same driver is a possible duplicate', () => {
  assert.deepEqual(findPossibleDuplicates(drivers, 'A', { amount: 1400, serviceClaim: 0, date: '2026-09-15' }).map(d => [d.payment.id, d.reason]), [['pa1', 'SAME_AMOUNT_AND_DATE']]);
  // Another driver paying the same amount that day is normal
  assert.deepEqual(findPossibleDuplicates(drivers, 'B', { amount: 450, serviceClaim: 0, date: '2026-08-17' }), []);
  // A different day or amount is not a duplicate
  assert.deepEqual(findPossibleDuplicates(drivers, 'A', { amount: 1400, serviceClaim: 0, date: '2026-09-16' }), []);
  assert.deepEqual(findPossibleDuplicates(drivers, 'A', { amount: 1450, serviceClaim: 0, date: '2026-09-15' }), []);
  // A claim-only entry compares the claim
  assert.deepEqual(findPossibleDuplicates(drivers, 'A', { amount: 0, serviceClaim: 80, date: '2026-09-20' }).map(d => d.payment.id), ['pa3']);
  assert.deepEqual(findPossibleDuplicates(drivers, 'A', { amount: 0, serviceClaim: 90, date: '2026-09-20' }), []);
});

test('a reference already used on any driver is a possible duplicate, however it is spaced or capitalised', () => {
  const found = findPossibleDuplicates(drivers, 'A', { amount: 300, serviceClaim: 0, date: '2026-09-28', reference: 'rhb 123456' });
  assert.deepEqual(found.map(d => [d.driver.id, d.payment.id, d.reason]), [['B', 'pb1', 'SAME_REFERENCE']]);
  assert.deepEqual(findPossibleDuplicates(drivers, 'A', { amount: 300, serviceClaim: 0, date: '2026-09-28', reference: 'DN0817AAA' }).map(d => d.payment.id), ['pa2']);
  assert.deepEqual(findPossibleDuplicates(drivers, 'A', { amount: 300, serviceClaim: 0, date: '2026-09-28', reference: '  ' }), []);
  // Both reasons on one payment are listed once
  assert.deepEqual(findPossibleDuplicates(drivers, 'B', { amount: 1400, serviceClaim: 0, date: '2026-09-15', reference: 'RHB123456' }).map(d => [d.payment.id, d.reason]), [['pb1', 'SAME_AMOUNT_AND_DATE']]);
});

test('who made a change reads Admin or Staff; without an account it names the database', () => {
  assert.equal(actorLabel({ changed_by_role: 'admin', changed_by_name: 'Admin' }), 'Admin');
  assert.equal(actorLabel({ changed_by_role: 'staff', changed_by_name: 'Staff' }), 'Staff');
  assert.equal(actorLabel({ changed_by_role: null, changed_by_name: 'Database (SQL Editor)' }), 'Database (SQL Editor)');
  assert.equal(actorLabel({ changed_by_role: null, changed_by_name: '' }), 'Unknown account');
});

const change = (over: Partial<PaymentChange>): PaymentChange => ({
  id: 1, payment_id: 'p1', driver_id: 'A', action: 'INSERT', changed_at: '2026-09-29T06:05:00Z', changed_by_name: 'Staff', changed_by_role: 'staff',
  before: null, after: { id: 'p1', amount: 450, service_claim: 0, date: '2026-09-28', payment_method: 'BANK TRANSFER', reference: null }, ...over,
});

test('each payment carries who recorded it and every later edit, in Kuala Lumpur time; payments from before tracking carry nothing', () => {
  const notes = paymentNotes([
    change({}),
    change({ id: 2, action: 'UPDATE', changed_at: '2026-09-29T07:10:00Z', changed_by_role: 'admin', changed_by_name: 'Admin',
      before: { id: 'p1', amount: 450, service_claim: 0, date: '2026-09-28', payment_method: 'BANK TRANSFER', reference: null },
      after: { id: 'p1', amount: '500.00', service_claim: 0, date: '2026-09-27', payment_method: 'BANK TRANSFER', reference: 'DN77' } }),
    change({ id: 3, action: 'UPDATE', changed_at: '2026-09-29T08:00:00Z', changed_by_role: null, changed_by_name: 'Database (SQL Editor)',
      before: { id: 'p1', amount: 500, service_claim: 0, date: '2026-09-27', payment_method: 'BANK TRANSFER', reference: 'DN77' },
      after: { id: 'p1', amount: 500, service_claim: 50, date: '2026-09-27', payment_method: 'CASH DEPOSIT', reference: 'DN77' } }),
  ]);
  const lines = notes.get('p1') ?? [];
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Recorded by Staff · 29 Sept? 2026, 2:05 pm$/);
  assert.match(lines[1], /^Edited by Admin · 29 Sept? 2026, 3:10 pm: amount RM\s450\.00 → RM\s500\.00; date 28 Sept? 2026 → 27 Sept? 2026; reference none → DN77$/);
  assert.match(lines[2], /^Edited by Database \(SQL Editor\) · 29 Sept? 2026, 4:00 pm: claim RM\s0\.00 → RM\s50\.00; method BANK TRANSFER → CASH DEPOSIT$/);
  assert.equal(notes.has('an-older-payment'), false);
});

test('deleted payments are listed with who deleted them and what they were', () => {
  const notes = paymentNotes([change({}), change({ id: 2, action: 'DELETE', changed_at: '2026-09-29T09:30:00Z', changed_by_role: 'admin', changed_by_name: 'Admin',
    before: { id: 'p1', amount: 450, service_claim: 0, date: '2026-09-28', payment_method: 'BANK TRANSFER', reference: null }, after: null })]);
  assert.match((notes.get('p1') ?? [])[1], /^Deleted by Admin · 29 Sept? 2026, 5:30 pm: RM\s450\.00 on 28 Sept? 2026$/);
});

test('each payment is tagged with the account that recorded it, not whoever edited it later; older payments have no tag', () => {
  const recorders = paymentRecorders([
    change({}),
    change({ id: 2, action: 'UPDATE', changed_by_role: 'admin', changed_by_name: 'Admin' }),
    change({ id: 3, payment_id: 'p2', changed_by_role: 'admin', changed_by_name: 'Admin' }),
    change({ id: 4, payment_id: 'p3', changed_by_role: null, changed_by_name: 'Database (SQL Editor)' }),
    change({ id: 5, payment_id: 'p4', action: 'UPDATE', changed_by_role: 'staff' }),
  ]);
  assert.deepEqual([...recorders], [['p1', 'Staff'], ['p2', 'Admin'], ['p3', 'Database (SQL Editor)']]);
});
