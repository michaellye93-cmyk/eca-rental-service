import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver } from '../types.ts';
import { withPayments, type DriverRow } from '../utils.ts';
import {
  applyLiveChanges, changesFrom, isMissingTable, latestChangedAt, refreshKind, unseenChanges, type PaymentChangeRow,
} from '../services/liveChanges.ts';

const profile = (id: string, name: string, plate: string) => ({
  id, nric: '', name, carPlate: plate, contractStartDate: '2026-09-07', rentalCycle: 'WEEKLY' as const, contractDuration: 52, rentalRate: 450,
  category: 'SEWABELI' as const, tags: [] as string[],
});
const payment = (id: string, date: string, amount: number) => ({ id, date, amount, serviceClaim: 0, paymentMethod: 'BANK TRANSFER' as const });
const A = withPayments(profile('d1', 'Fixture Driver A', 'XAA1001'), [payment('p1', '2026-09-07', 450)]);
const B = withPayments(profile('d2', 'Fixture Driver B', 'XAB2001'), [payment('p2', '2026-09-08', 450)]);
const LIST: Driver[] = [A, B];

let nextId = 100;
const change = (action: PaymentChangeRow['action'], paymentId: string, driverId: string, after: { date: string; amount: number } | null, changedAt = '2026-10-12T05:00:00+00:00', id = nextId++): PaymentChangeRow => ({
  id, payment_id: paymentId, driver_id: driverId, action, changed_at: changedAt,
  after: after ? { id: paymentId, driver_id: driverId, date: after.date, amount: after.amount, service_claim: 0, payment_method: 'BANK TRANSFER', reference: null } : null,
});
const ids = (driver: Driver | undefined) => driver?.paymentHistory.map(p => `${p.id}:${p.amount}`);

test('a payment recorded elsewhere is added to its driver, newest first, and the total follows', () => {
  const { drivers, unknownDrivers } = applyLiveChanges(LIST, { payments: [change('INSERT', 'p3', 'd1', { date: '2026-09-14', amount: 450 })] });
  assert.deepEqual(ids(drivers[0]), ['p3:450', 'p1:450']);
  assert.equal(drivers[0].totalAmountPaid, 900);
  assert.equal(drivers[1], B, 'other drivers keep the same object (their rent figures stay cached)');
  assert.notEqual(drivers[0], A, 'a changed driver is a new object, never changed in place');
  assert.deepEqual(ids(A), ['p1:450'], 'the old driver object is untouched');
  assert.deepEqual(unknownDrivers, []);
});

test('an edited payment replaces the old one; a deleted payment is removed', () => {
  const edited = applyLiveChanges(LIST, { payments: [change('UPDATE', 'p1', 'd1', { date: '2026-09-07', amount: 400 })] }).drivers;
  assert.deepEqual(ids(edited[0]), ['p1:400']);
  assert.equal(edited[0].totalAmountPaid, 400);
  const deleted = applyLiveChanges(LIST, { payments: [change('DELETE', 'p2', 'd2', null)] }).drivers;
  assert.deepEqual(ids(deleted[1]), []);
  assert.equal(deleted[1].totalAmountPaid, 0);
});

test('a payment moved to another driver leaves the first and joins the second', () => {
  const { drivers } = applyLiveChanges(LIST, { payments: [change('UPDATE', 'p1', 'd2', { date: '2026-09-07', amount: 450 })] });
  assert.deepEqual(ids(drivers[0]), []);
  assert.deepEqual(ids(drivers[1]), ['p2:450', 'p1:450']);
});

test('a change for a driver not loaded is left out and reported (the caller reloads in full)', () => {
  const result = applyLiveChanges(LIST, { payments: [change('INSERT', 'p9', 'd9', { date: '2026-10-01', amount: 450 })] });
  assert.equal(result.drivers, LIST, 'nothing changed: the same list');
  assert.deepEqual(result.unknownDrivers, ['d9']);
});

test('a payment for a driver deleted in the same read, or deleted again later in it, needs no full reload', () => {
  const forGone = applyLiveChanges(LIST, {
    driverRows: new Map([['d9', null]]),
    payments: [change('INSERT', 'p9', 'd9', { date: '2026-10-01', amount: 450 })],
  });
  assert.deepEqual(forGone.unknownDrivers, []);
  const removedLater = applyLiveChanges(LIST, {
    payments: [change('INSERT', 'p9', 'd9', { date: '2026-10-01', amount: 450 }, undefined, 401), change('DELETE', 'p9', 'd9', null, undefined, 402)],
  });
  assert.deepEqual(removedLater.unknownDrivers, []);
  assert.equal(removedLater.drivers, LIST);
});

test('rows are applied in the order they were logged (id), whatever order they arrive in or their times say', () => {
  // The edit's transaction started first (earlier changed_at) but was logged after the insert
  const insert = change('INSERT', 'p4', 'd1', { date: '2026-09-21', amount: 450 }, '2026-10-12T05:00:02+00:00', 201);
  const edit = change('UPDATE', 'p4', 'd1', { date: '2026-09-21', amount: 300 }, '2026-10-12T05:00:01+00:00', 202);
  assert.deepEqual(ids(applyLiveChanges(LIST, { payments: [edit, insert] }).drivers[0]), ['p4:300', 'p1:450']);
  const remove = change('DELETE', 'p4', 'd1', null, '2026-10-12T05:00:03+00:00', 203);
  assert.deepEqual(ids(applyLiveChanges(LIST, { payments: [remove, edit, insert] }).drivers[0]), ['p1:450']);
});

test('applying a change the list already has (twice, or a payment saved in this tab) changes nothing', () => {
  const insert = change('INSERT', 'p3', 'd1', { date: '2026-09-14', amount: 450 });
  const once = applyLiveChanges(LIST, { payments: [insert] }).drivers;
  const twice = applyLiveChanges(once, { payments: [insert] });
  assert.equal(twice.drivers, once);
  assert.deepEqual(ids(applyLiveChanges(LIST, { payments: [insert, insert] }).drivers[0]), ['p3:450', 'p1:450'], 'never two copies');
  const deleteMissing = applyLiveChanges(LIST, { payments: [change('DELETE', 'p8', 'd1', null)] });
  assert.equal(deleteMissing.drivers, LIST);
});

test('a changed driver is re-read: its details replaced, its payments kept; a new driver is added; a deleted one goes', () => {
  const row = (id: string, name: string, rate: number): DriverRow => ({
    id, nric: '', name, car_plate: 'XAA1001', contract_start_date: '2026-09-07', category: 'SEWABELI', rental_cycle: 'WEEKLY',
    contract_duration_weeks: 52, rental_rate: rate, tags: [], is_delisted: false,
  } as DriverRow);
  const driverRows = new Map<string, DriverRow | null>([['d1', row('d1', 'Fixture Driver A', 500)], ['d3', row('d3', 'Fixture Driver C', 450)], ['d2', null]]);
  const { drivers } = applyLiveChanges(LIST, {
    driverRows,
    payments: [change('INSERT', 'p5', 'd3', { date: '2026-10-12', amount: 450 })],
  });
  assert.deepEqual(drivers.map(d => d.id), ['d3', 'd1'], 'the new driver first (the list loads newest first); the deleted one gone');
  assert.equal(drivers[1].rentalRate, 500);
  assert.deepEqual(ids(drivers[1]), ['p1:450']);
  assert.deepEqual(ids(drivers[0]), ['p5:450'], "the new driver's payment arrives with it");
});

test('the read window starts a little before the last change seen, and seen rows are not applied again', () => {
  assert.equal(changesFrom(null), null, 'nothing seen yet: read from the beginning');
  assert.equal(changesFrom('2026-10-12T05:00:00+00:00', 120_000), '2026-10-12T04:58:00.000Z');
  const rows = [change('INSERT', 'p6', 'd1', { date: '2026-10-12', amount: 1 }, '2026-10-12T05:01:00+00:00', 301), change('INSERT', 'p7', 'd1', { date: '2026-10-12', amount: 1 }, '2026-10-12T05:00:30+00:00', 302)];
  assert.deepEqual(unseenChanges(rows, new Set([301])).map(r => r.id), [302]);
  assert.equal(latestChangedAt(rows, '2026-10-12T05:00:00+00:00'), '2026-10-12T05:01:00+00:00');
  assert.equal(latestChangedAt([], '2026-10-12T05:00:00+00:00'), '2026-10-12T05:00:00+00:00');
});

test('when to read only the changes and when to reload everything', () => {
  const base = { now: 1_000_000_000, lastFullLoad: 1_000_000_000 - 90_000, fullLoadDay: '2026-10-12', today: '2026-10-12', awayMs: 0 };
  assert.equal(refreshKind('timer', { ...base, live: 'all' }), 'light');
  assert.equal(refreshKind('return', { ...base, live: 'all', awayMs: 9 * 60_000 }), 'light');
  assert.equal(refreshKind('return', { ...base, live: 'all', awayMs: 11 * 60_000 }), 'full', 'back after more than 10 minutes away');
  assert.equal(refreshKind('timer', { ...base, live: 'all', today: '2026-10-13' }), 'full', 'a new Kuala Lumpur day');
  // No driver change log yet: payments still arrive as changes, drivers by the old full reload every 3 minutes
  assert.equal(refreshKind('timer', { ...base, live: 'payments' }), 'light');
  assert.equal(refreshKind('timer', { ...base, live: 'payments', lastFullLoad: base.now - 180_000 }), 'full');
  // No change log at all: the old schedule (every 3 minutes, and on return at most once a minute)
  assert.equal(refreshKind('timer', { ...base, live: 'off' }), 'none');
  assert.equal(refreshKind('timer', { ...base, live: 'off', lastFullLoad: base.now - 180_000 }), 'full');
  assert.equal(refreshKind('return', { ...base, live: 'off' }), 'full');
  assert.equal(refreshKind('return', { ...base, live: 'off', lastFullLoad: base.now - 30_000 }), 'none');
});

test('a missing table is told apart from other errors', () => {
  assert.equal(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.driver_changes' in the schema cache" }), true);
  assert.equal(isMissingTable({ code: '42P01', message: 'relation "public.driver_changes" does not exist' }), true);
  assert.equal(isMissingTable({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
  assert.equal(isMissingTable(new TypeError('Failed to fetch')), false);
});
