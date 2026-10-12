import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver, PaymentTransaction } from '../types.ts';
import type { CollectionContact, PaymentPromise } from '../services/collections.ts';
import type { PaymentChange } from '../services/paymentLog.ts';
import { categoryCounts, defaultRunSlot, runStartAt, runSummaryPrefill } from '../services/collectionRuns.ts';

const kl = (local: string) => new Date(`${local}+08:00`).toISOString();
const START = new Date('2026-10-12T13:00:00+08:00');

test('a run starts at 1 pm or 9 pm Kuala Lumpur time on the day, or at the time typed', () => {
  assert.equal(runStartAt('2026-10-12', '1PM').toISOString(), '2026-10-12T05:00:00.000Z');
  assert.equal(runStartAt('2026-10-12', '9PM').toISOString(), '2026-10-12T13:00:00.000Z');
  assert.equal(runStartAt('2026-10-12', '9PM', '20:45').toISOString(), '2026-10-12T12:45:00.000Z');
  assert.equal(runStartAt('2026-10-12', '1PM', 'nonsense').toISOString(), '2026-10-12T05:00:00.000Z');
  // The slot being recorded: the 9PM run from 8 pm, otherwise the 1PM run (Kuala Lumpur wall-clock times)
  assert.equal(defaultRunSlot(new Date(2026, 9, 12, 14, 30)), '1PM');
  assert.equal(defaultRunSlot(new Date(2026, 9, 12, 18, 0)), '1PM');
  assert.equal(defaultRunSlot(new Date(2026, 9, 12, 21, 40)), '9PM');
});

const change = (id: number, payment_id: string, action: PaymentChange['action'], at: string, after: Record<string, unknown> | null): PaymentChange =>
  ({ id, payment_id, driver_id: 'd1', action, changed_at: kl(at), changed_by_name: 'Staff', changed_by_role: 'staff', before: null, after });
const contact = (id: string, kind: CollectionContact['kind'], at: string): CollectionContact =>
  ({ id, driver_id: 'd1', kind, contacted_at: kl(at), run_slot: '1PM', message: 'Fixture message', logged_by_name: 'Staff', logged_by_role: 'staff' });
const promise = (id: string, at: string): PaymentPromise =>
  ({ id, driver_id: 'd1', amount: 450, promised_date: '2026-10-14', note: null, logged_on: '2026-10-12', logged_at: kl(at), logged_by_name: 'Staff', logged_by_role: 'staff' });
const pay = (id: string, date: string, amount: number): PaymentTransaction => ({ id, date, amount, serviceClaim: 0, paymentMethod: 'BANK TRANSFER' });
const base = { totalAmountPaid: 0, contractDuration: 52, nric: '900101-01-1234', rentalCycle: 'WEEKLY' as const, rentalRate: 450, contractStartDate: '2026-09-07' };
const DRIVERS: Driver[] = [
  { ...base, id: 'd1', name: 'Fixture Driver Alpha', carPlate: 'XAA1001', paymentHistory: [pay('a', '2026-09-07', 2700)] }, // paid ahead: GOOD
  { ...base, id: 'd2', name: 'Fixture Driver Bravo', carPlate: 'XAB2001', paymentHistory: [pay('b', '2026-09-07', 1800)] }, // 2 weeks owed: MID
  { ...base, id: 'd3', name: 'Fixture Driver Charlie', carPlate: 'XAC3001', paymentHistory: [] }, // 6 weeks owed: BAD
  { ...base, id: 'd4', name: 'Fixture Driver Delta', carPlate: 'XAD4001', paymentHistory: [], isDelisted: true, delistDate: '2026-09-20' },
];
const NOW = new Date(2026, 9, 12, 14, 0);

test('the run summary is pre-filled from what the system recorded since the run started', () => {
  const prefill = runSummaryPrefill({
    startedAt: START,
    now: NOW,
    drivers: DRIVERS,
    changes: [
      change(1, 'p-before', 'INSERT', '2026-10-12T12:30:00', { amount: 900, payment_method: 'BANK TRANSFER' }), // before the run
      change(2, 'p1', 'INSERT', '2026-10-12T13:05:00', { amount: 450, payment_method: 'BANK TRANSFER' }),
      change(3, 'p2', 'INSERT', '2026-10-12T13:10:00', { amount: 400, payment_method: 'CASH DEPOSIT', service_claim: 50 }),
      change(4, 'p2', 'UPDATE', '2026-10-12T13:12:00', { amount: 420, payment_method: 'CASH DEPOSIT', service_claim: 30 }), // corrected
      change(5, 'p3', 'INSERT', '2026-10-12T13:20:00', { amount: 0, payment_method: 'CLAIM', service_claim: 200 }), // a claim is not cash
      change(6, 'p4', 'INSERT', '2026-10-12T13:25:00', { amount: 300, payment_method: 'BANK TRANSFER' }),
      change(7, 'p4', 'DELETE', '2026-10-12T13:26:00', null), // recorded by mistake
      change(8, 'p-before', 'UPDATE', '2026-10-12T13:30:00', { amount: 950, payment_method: 'BANK TRANSFER' }), // an older payment edited
    ],
    contacts: [contact('c0', 'ASK', '2026-10-12T12:59:00'), contact('c1', 'STATEMENT', '2026-10-12T13:01:00'), contact('c2', 'ASK', '2026-10-12T13:02:00'),
      contact('c3', 'FOLLOW_UP', '2026-10-12T13:03:00'), contact('c4', 'THANKS', '2026-10-12T13:04:00'), contact('c5', 'REPLY', '2026-10-12T13:06:00')],
    promises: [promise('pr0', '2026-10-11T21:00:00'), promise('pr1', '2026-10-12T13:15:00')],
    snapshot: [{ status: 'GOOD' }, { status: 'BAD' }, { status: 'BAD' }],
  });
  assert.deepEqual(prefill, {
    payments_recorded: 3,
    collected: 870,
    asks_sent: 3,
    promises_logged: 1,
    categories_before: { good: 1, mid: 0, bad: 2 },
    categories_after: { good: 1, mid: 1, bad: 1 },
  });
});

test('without the contact log, promises or the day snapshot (database updates not run) those parts are left empty', () => {
  const prefill = runSummaryPrefill({ startedAt: START, now: NOW, drivers: DRIVERS, changes: null, contacts: null, promises: null, snapshot: null });
  assert.deepEqual(prefill, { payments_recorded: 0, collected: 0, asks_sent: 0, promises_logged: 0, categories_before: null, categories_after: { good: 1, mid: 1, bad: 1 } });
  assert.equal(runSummaryPrefill({ startedAt: START, now: NOW, drivers: DRIVERS, changes: [], contacts: [], promises: [], snapshot: [] }).categories_before, null,
    'no snapshot written today');
});

test('category counts are the active drivers by GOOD / MID / BAD from the rent engine', () => {
  assert.deepEqual(categoryCounts(DRIVERS, NOW), { good: 1, mid: 1, bad: 1 });
  assert.deepEqual(categoryCounts([], NOW), { good: 0, mid: 0, bad: 0 });
});
