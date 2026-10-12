import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver, PaymentTransaction } from '../types.ts';
import type { CollectionContact, PaymentPromise } from '../services/collections.ts';
import { buildCollectionsData, collectionsJson } from '../services/collections.ts';
import { buildWorklist, nextCollectionStep, worklistJson, type StepInput } from '../services/worklist.ts';

// Monday 12 Oct 2026, 1 pm in Kuala Lumpur (the real moment)
const INSTANT = new Date('2026-10-12T13:00:00+08:00');
const TODAY = '2026-10-12';
const kl = (local: string) => new Date(`${local}+08:00`).toISOString();
const step = (input: Partial<StepInput>) => nextCollectionStep({
  now: INSTANT, today: TODAY, owed: 0, dueTodayUnpaid: 0, arrangement: null, lastPaymentDate: null, lastAskAt: null, lastThanksAt: null,
  promise: null, ...input,
});

test('nothing owed: nothing due, or a thank-you for a payment today or yesterday not yet thanked', () => {
  assert.equal(step({}), 'Nothing due');
  assert.equal(step({ lastPaymentDate: '2026-10-09' }), 'Nothing due');
  assert.equal(step({ lastPaymentDate: TODAY }), 'Thank for payment');
  assert.equal(step({ lastPaymentDate: '2026-10-11' }), 'Thank for payment');
  assert.equal(step({ lastPaymentDate: '2026-10-11', lastThanksAt: kl('2026-10-11T21:05:00') }), 'Nothing due', 'already thanked');
  assert.equal(step({ lastPaymentDate: TODAY, lastThanksAt: kl('2026-10-11T21:05:00') }), 'Thank for payment', 'thanked for an earlier payment only');
  assert.equal(step({ arrangement: 'Monthly RM1,000 by the 5th' }), 'Nothing due', 'an arrangement with nothing owed needs no step');
});

test('a standing arrangement replaces the ask, follow-up and due-day message (never a plain due-day message)', () => {
  const arrangement = 'Monthly RM1,000 by the 5th';
  const expected = 'Arrangement: Monthly RM1,000 by the 5th — check before asking';
  assert.equal(step({ arrangement, owed: 1000, dueTodayUnpaid: 1000 }), expected);
  assert.equal(step({ arrangement, owed: 1000, lastAskAt: kl('2026-10-08T13:00:00') }), expected);
  assert.equal(step({ arrangement, owed: 1000 }), expected, 'instead of a first ask');
  assert.equal(step({ arrangement: '   ', owed: 1000, dueTodayUnpaid: 1000 }), 'Due-day message', 'a blank arrangement is no arrangement');
});

test('a standing arrangement does not hold back a thank-you, a missed-promise follow-up or a wait', () => {
  const arrangement = 'Monthly RM1,000 by the 5th';
  assert.equal(step({ arrangement, owed: 1000, lastPaymentDate: TODAY }), 'Thank for payment', 'a part payment today is thanked first');
  assert.equal(step({ arrangement, owed: 1000, promise: { state: 'MISSED', date: '2026-10-10', loggedOn: '2026-10-08' } }), 'Promise missed: follow up');
  assert.equal(step({ arrangement, owed: 1000, dueTodayUnpaid: 1000, promise: { state: 'MISSED', date: '2026-10-10', loggedOn: '2026-10-08' } }), 'Promise missed: follow up');
  assert.equal(step({ arrangement, owed: 1000, lastAskAt: kl('2026-10-12T09:00:00') }), 'Wait: asked within 24 hours');
  assert.equal(step({ arrangement, owed: 1000, promise: { state: 'OPEN', date: '2026-10-14', loggedOn: '2026-10-08' }, lastAskAt: kl('2026-10-08T13:00:00') }), 'Wait: promised 14/10');
});

test('the due day: a due-day message even within 24 hours of an ask, once', () => {
  assert.equal(step({ owed: 450, dueTodayUnpaid: 450 }), 'Due-day message');
  assert.equal(step({ owed: 900, dueTodayUnpaid: 450, lastAskAt: kl('2026-10-11T21:00:00') }), 'Due-day message', 'asked last night');
  assert.equal(step({ owed: 450, dueTodayUnpaid: 450, lastAskAt: kl('2026-10-12T12:30:00') }), 'Wait: asked within 24 hours', 'already asked today');
});

test('the 24-hour rule, then a follow-up two days after an ask that is still unpaid', () => {
  assert.equal(step({ owed: 900, lastAskAt: kl('2026-10-11T14:00:00') }), 'Wait: asked within 24 hours');
  assert.equal(step({ owed: 900, lastAskAt: kl('2026-10-11T12:00:00') }), 'Wait: asked yesterday');
  assert.equal(step({ owed: 900, lastAskAt: kl('2026-10-10T21:00:00') }), 'Follow up (asked 2 days ago, still unpaid)');
  assert.equal(step({ owed: 900, lastAskAt: kl('2026-10-05T13:00:00') }), 'Follow up (asked 7 days ago, still unpaid)');
  assert.equal(step({ owed: 900 }), 'Ask: owing, no ask logged');
});

test('a missed promise is followed up even within 24 hours of an ask, until a follow-up after the promised date', () => {
  const missed = { state: 'MISSED' as const, date: '2026-10-11', loggedOn: '2026-10-08' };
  assert.equal(step({ owed: 900, promise: missed, lastAskAt: kl('2026-10-11T20:00:00') }), 'Promise missed: follow up');
  assert.equal(step({ owed: 900, promise: missed }), 'Promise missed: follow up');
  assert.equal(step({ owed: 900, promise: missed, lastAskAt: kl('2026-10-12T09:00:00') }), 'Wait: asked within 24 hours', 'followed up this morning');
  assert.equal(step({ owed: 900, promise: { state: 'KEPT', date: '2026-10-11', loggedOn: '2026-10-08' }, lastAskAt: kl('2026-10-09T13:00:00') }), 'Follow up (asked 3 days ago, still unpaid)');
});

test('an open promise date is waited for (no follow-up), except on the due day', () => {
  const open = { state: 'OPEN' as const, date: '2026-10-14', loggedOn: '2026-10-08' };
  assert.equal(step({ owed: 900, promise: open, lastAskAt: kl('2026-10-09T13:00:00') }), 'Wait: promised 14/10');
  assert.equal(step({ owed: 900, dueTodayUnpaid: 450, promise: open }), 'Due-day message');
});

test('a promise logged today or yesterday is waited for even on the due day (no due-day message over a fresh promise)', () => {
  const promise = (loggedOn: string) => ({ state: 'OPEN' as const, date: '2026-10-14', loggedOn });
  assert.equal(step({ owed: 900, dueTodayUnpaid: 450, promise: promise(TODAY) }), 'Wait: promised 14/10');
  assert.equal(step({ owed: 900, dueTodayUnpaid: 450, promise: promise('2026-10-11') }), 'Wait: promised 14/10');
  assert.equal(step({ owed: 900, dueTodayUnpaid: 450, promise: promise('2026-10-10') }), 'Due-day message', 'logged two days ago');
  assert.equal(step({ owed: 900, dueTodayUnpaid: 450, arrangement: 'Weekly', promise: promise(TODAY) }), 'Wait: promised 14/10');
  assert.equal(step({ owed: 900, dueTodayUnpaid: 450, promise: { state: 'MISSED', date: '2026-10-11', loggedOn: '2026-10-11' } }), 'Promise missed: follow up');
});

test('a payment today or yesterday is thanked before anything else is asked (the conversation continues)', () => {
  assert.equal(step({ owed: 450, lastPaymentDate: TODAY, lastAskAt: kl('2026-10-09T13:00:00') }), 'Thank for payment');
  assert.equal(step({ owed: 450, lastPaymentDate: TODAY, lastThanksAt: kl('2026-10-12T12:50:00'), lastAskAt: kl('2026-10-09T13:00:00') }),
    'Follow up (asked 3 days ago, still unpaid)');
});

// --- The worklist rows -------------------------------------------------------------------------------------------------
const pay = (id: string, date: string, amount: number): PaymentTransaction => ({ id, date, amount, serviceClaim: 0, paymentMethod: 'BANK TRANSFER' });
const base = { totalAmountPaid: 0, contractDuration: 52, nric: '900101-01-1234', category: 'SEWABELI', rentalCycle: 'WEEKLY' as const, rentalRate: 450 };
// Weekly every Monday from 7 Sept: due today, paid to 5 Oct
const DUE_TODAY: Driver = { ...base, id: 'd1', name: 'Fixture Driver Alpha', carPlate: 'XAA1001', contractStartDate: '2026-09-07', whatsappGroup: 'ALPHA XAA1001 MON',
  paymentHistory: [pay('p1', '2026-09-07', 450), pay('p2', '2026-09-14', 450), pay('p3', '2026-09-21', 450), pay('p4', '2026-09-28', 450), pay('p5', '2026-10-05', 450)] };
// Weekly every Tuesday from 1 Sept: last paid 15 Sept, a late alert
const LATE: Driver = { ...base, id: 'd2', name: 'Fixture Driver Bravo', carPlate: 'XAB2001', contractStartDate: '2026-09-01',
  paymentHistory: [pay('q1', '2026-09-01', 450), pay('q2', '2026-09-08', 450), pay('q3', '2026-09-15', 450)] };
// Weekly every Wednesday from 2 Sept: one week owed, last paid 7 Oct
const OWES: Driver = { ...base, id: 'd3', name: 'Fixture Driver Charlie', carPlate: 'XAC3001', contractStartDate: '2026-09-02',
  paymentHistory: [pay('r1', '2026-09-02', 450), pay('r2', '2026-09-09', 450), pay('r3', '2026-09-16', 450), pay('r4', '2026-09-23', 450), pay('r5', '2026-10-07', 450)] };
// Monthly on the 5th with a standing arrangement, this month paid on 4 Oct
const MONTHLY: Driver = { ...base, id: 'd4', name: 'Fixture Driver Delta', carPlate: 'XAD4001', contractStartDate: '2026-08-05', rentalCycle: 'MONTHLY', rentalRate: 1000,
  contractDuration: 12, category: 'SEWA_BIASA', collectionArrangement: 'Monthly RM1,000 by the 5th', collectionTone: 'FIRM', collectionLanguage: 'BM', contactWindow: 'weekday mornings',
  paymentHistory: [pay('s1', '2026-08-05', 1000), pay('s2', '2026-09-05', 1000), pay('s3', '2026-10-04', 1000)] };
const DELISTED: Driver = { ...base, id: 'd5', name: 'Fixture Driver Echo', carPlate: 'XAE5001', contractStartDate: '2026-09-01', isDelisted: true, delistDate: '2026-09-20', paymentHistory: [] };
const DRIVERS = [OWES, MONTHLY, LATE, DUE_TODAY, DELISTED];
const NOW = new Date(2026, 9, 12, 13, 0); // Kuala Lumpur wall-clock time
const contact = (id: string, driver_id: string, kind: CollectionContact['kind'], at: string): CollectionContact =>
  ({ id, driver_id, kind, contacted_at: kl(at), run_slot: '1PM', message: 'Fixture message', logged_by_name: 'Staff', logged_by_role: 'staff' });
const CONTACTS = [contact('c1', 'd3', 'ASK', '2026-10-09T13:00:00'), contact('c2', 'd2', 'STATEMENT', '2026-10-12T09:00:00'), contact('c3', 'd2', 'NOTE', '2026-10-12T10:00:00')];
const PROMISE: PaymentPromise = { id: 'pr1', driver_id: 'd2', amount: 900, promised_date: '2026-10-10', note: null, logged_on: '2026-10-08', logged_at: kl('2026-10-08T13:00:00'), logged_by_name: 'Staff', logged_by_role: 'staff' };
const INPUT = { drivers: DRIVERS, now: NOW, today: TODAY, instant: INSTANT, bankIn: { SEWABELI: 'Fixture Bank 000', SEWA_BIASA: 'Fixture Bank 111' }, promises: [PROMISE], plans: [], contacts: CONTACTS };

test('one row per active driver: rent due today first, then late alerts (longest first), then by amount owed', () => {
  const rows = buildWorklist(INPUT).drivers;
  assert.deepEqual(rows.map(row => row.plate), ['XAA1001', 'XAB2001', 'XAC3001', 'XAD4001']);
  const [due, late, owes, monthly] = rows;
  assert.equal(due.name, 'Fixture Driver', 'the short name, as in the data view');
  assert.deepEqual(due.due_today, { amount: 450, unpaid: 450 });
  assert.equal(due.next_step, 'Due-day message');
  assert.equal(due.whatsapp_group, 'ALPHA XAA1001 MON');
  assert.equal(due.status, 'MID');
  assert.equal(due.owed, 450);
  assert.equal(due.last_payment_date, '2026-10-05');
  assert.equal(late.due_today, null);
  assert.equal(late.status, 'BAD');
  assert.equal(late.late_days, 27);
  assert.deepEqual(late.promise, { amount: 900, date: '2026-10-10', status: 'MISSED', paid_so_far: 0 });
  assert.deepEqual(late.last_contact, { at: kl('2026-10-12T10:00:00'), kind: 'NOTE', run_slot: '1PM' });
  assert.equal(late.next_step, 'Wait: asked within 24 hours', 'the statement this morning came after the promised date');
  assert.equal(owes.owed, 450);
  assert.equal(owes.next_step, 'Follow up (asked 3 days ago, still unpaid)');
  assert.equal(monthly.owed, 0);
  assert.equal(monthly.next_step, 'Nothing due');
  assert.deepEqual(monthly.collection, { arrangement: 'Monthly RM1,000 by the 5th', tone: 'FIRM', language: 'BM', contact_window: 'weekday mornings', note: null });
});

test('without the contact log or promises (database update not run) the worklist still works', () => {
  const rows = buildWorklist({ ...INPUT, promises: null, plans: null, contacts: null }).drivers;
  assert.equal(rows.length, 4);
  assert.equal(rows[1].promise, null);
  assert.equal(rows[1].last_contact, null);
  assert.equal(rows[1].next_step, 'Ask: owing, no ask logged');
});

test('the worklist JSON has one line per driver, and the collections data view is unchanged', () => {
  const data = buildWorklist(INPUT);
  const json = worklistJson(data);
  const parsed = JSON.parse(json);
  assert.equal(parsed.today, TODAY);
  assert.equal(parsed.drivers.length, 4);
  const lines = json.split('\n');
  for (const row of data.drivers) assert.ok(lines.some(line => line.replace(/,$/, '') === JSON.stringify(row)), row.plate);
  assert.ok(!json.includes('900101-01-1234'), 'no NRIC');
  // Additive only: the existing data view's JSON has no worklist fields
  const view = collectionsJson(buildCollectionsData(INPUT));
  assert.ok(!view.includes('next_step') && !view.includes('due_today'));
});
