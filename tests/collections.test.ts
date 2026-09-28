import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver, PaymentTransaction } from '../types.ts';
import { buildLateAlerts, generateDriverInvoices, mondayToSunday, rentDueAndPaid } from '../utils.ts';
import {
  balanceTrend, buildCollectionsData, catchUpStatus, collectionsJson, promiseStatus, segmentHistory, statementMoney, whatsappStatement,
  type CatchUpPlan, type PaymentPromise,
} from '../services/collections.ts';

const pay = (id: string, date: string, amount: number, reference?: string, serviceClaim = 0): PaymentTransaction =>
  ({ id, date, amount, serviceClaim, paymentMethod: 'BANK TRANSFER', ...(reference ? { reference } : {}) });
const base = { totalAmountPaid: 0, contractDuration: 52 };

// Weekly rent every Tuesday from 4 Aug 2026; paid to 8 Sept, RM200 towards 15 Sept.
const ALPHA: Driver = {
  ...base, id: 'a', nric: '900101-01-1234', email: 'alpha@example.test', phone: '60123456789', address: '1 Fixture Road',
  name: 'Fixture Driver Alpha', carPlate: 'XAA 1001', contractStartDate: '2026-08-04', rentalCycle: 'WEEKLY', rentalRate: 450,
  category: 'SEWABELI', tags: ['TUE'], whatsappGroup: 'ALPHA XAA1001 TUE',
  paymentHistory: [pay('a1', '2026-08-04', 450), pay('a2', '2026-08-11', 450), pay('a3', '2026-08-18', 450), pay('a4', '2026-08-25', 450),
    pay('a5', '2026-09-01', 450), pay('a6', '2026-09-08', 450), pay('a7', '2026-09-16', 200, 'DN0916A')],
};
// Monthly rent on the 31st, or the month's last day, from 31 May 2026; RM1,000 towards 31 Aug.
const BRAVO: Driver = {
  ...base, id: 'b', nric: '900202-02-2345', name: 'Fixture Driver Bravo binti Test', carPlate: 'XAB2001', contractStartDate: '2026-05-31',
  rentalCycle: 'MONTHLY', contractDuration: 12, rentalRate: 1500, category: 'SEWA_BIASA', tags: ['SAT'],
  paymentHistory: [pay('b1', '2026-06-01', 1500), pay('b2', '2026-07-01', 1500), pay('b3', '2026-08-02', 1500), pay('b4', '2026-09-05', 1000)],
};
// Delisted on 10 Sept with ten weeks unpaid.
const CHARLIE: Driver = {
  ...base, id: 'c', nric: '900303-03-3456', name: 'Fixture Driver Charlie', carPlate: 'XAC3001', contractStartDate: '2026-07-07', rentalCycle: 'WEEKLY',
  rentalRate: 400, isDelisted: true, delistDate: '2026-09-10', tags: ['TUE'], paymentHistory: [],
};
const NOW = new Date(2026, 8, 29, 10, 0); // Tuesday 29 Sept 2026, 10 am
const TODAY = new Date(2026, 8, 29);

test('statement amounts read like RM450, RM1,400 and RM450.50', () => {
  assert.equal(statementMoney(450), 'RM450');
  assert.equal(statementMoney(1400), 'RM1,400');
  assert.equal(statementMoney(450.5), 'RM450.50');
  assert.equal(statementMoney(0), 'RM0');
});

test('the WhatsApp statement lists the last 4 paid weeks, every unpaid or part-paid week, the balance, the next rent and the bank', () => {
  assert.equal(whatsappStatement(ALPHA, NOW, 'Fixture Bank 000 (ECA)'), [
    'Sewa XAA1001:',
    '✅ 18/8 RM450 – selesai',
    '✅ 25/8 RM450 – selesai',
    '✅ 1/9 RM450 – selesai',
    '✅ 8/9 RM450 – selesai',
    '⏳ 15/9 RM450 – dibayar RM200, baki RM250',
    '⏳ 22/9 RM450 – belum dibayar',
    '⏳ 29/9 RM450 – belum dibayar',
    'Baki tertunggak: RM1,150',
    'Sewa seterusnya: 6/10 RM450',
    'Bank in: Fixture Bank 000 (ECA)',
  ].join('\n'));
});

test('monthly statements follow the rent schedule, month ends included', () => {
  assert.equal(whatsappStatement(BRAVO, NOW, 'Fixture Bank 111'), [
    'Sewa XAB2001:',
    '✅ 31/5 RM1,500 – selesai',
    '✅ 30/6 RM1,500 – selesai',
    '✅ 31/7 RM1,500 – selesai',
    '⏳ 31/8 RM1,500 – dibayar RM1,000, baki RM500',
    'Baki tertunggak: RM500',
    'Sewa seterusnya: 30/9 RM1,500',
    'Bank in: Fixture Bank 111',
  ].join('\n'));
});

test('a statement for a delisted driver has no next rent; rent paid in advance shows as paid', () => {
  const delisted = whatsappStatement(CHARLIE, NOW, 'Fixture Bank 000').split('\n');
  assert.equal(delisted.filter(line => line.endsWith('belum dibayar')).length, 10);
  assert.ok(delisted.includes('Baki tertunggak: RM4,000'));
  assert.ok(!delisted.some(line => line.startsWith('Sewa seterusnya')));
  const prepaid = whatsappStatement({ ...ALPHA, paymentHistory: [...ALPHA.paymentHistory, pay('a8', '2026-09-28', 1150 + 450)] }, NOW, 'Fixture Bank 000').split('\n');
  assert.deepEqual(prepaid.slice(1, 5), ['✅ 15/9 RM450 – selesai', '✅ 22/9 RM450 – selesai', '✅ 29/9 RM450 – selesai', '✅ 6/10 RM450 – selesai']);
  assert.ok(prepaid.includes('Baki tertunggak: RM0'));
  assert.ok(prepaid.includes('Sewa seterusnya: 13/10 RM450'));
});

const promise = (over: Partial<PaymentPromise> = {}): PaymentPromise => ({
  id: 'pr1', driver_id: 'a', amount: 900, promised_date: '2026-10-01', note: 'After Friday trips', logged_on: '2026-09-20',
  logged_at: '2026-09-20T02:00:00Z', logged_by_name: 'fixture-staff', logged_by_role: 'staff', ...over,
});

test('a promise is kept when payments from the day it was logged to the promised date reach the amount, and missed once that date passes', () => {
  assert.deepEqual(promiseStatus(promise(), ALPHA, '2026-09-29'), { state: 'OPEN', paid: 0, left: 900 });
  const paying = { ...ALPHA, paymentHistory: [...ALPHA.paymentHistory, pay('a9', '2026-09-30', 450), pay('a10', '2026-10-01', 400, undefined, 50)] };
  assert.deepEqual(promiseStatus(promise(), paying, '2026-10-02'), { state: 'KEPT', paid: 900, left: 0 });
  assert.deepEqual(promiseStatus(promise(), ALPHA, '2026-10-02'), { state: 'MISSED', paid: 0, left: 900 });
  // Payments before it was logged or after the promised date do not count
  const late = { ...ALPHA, paymentHistory: [...ALPHA.paymentHistory, pay('a11', '2026-10-02', 900)] };
  assert.equal(promiseStatus(promise({ logged_on: '2026-09-17' }), late, '2026-10-02').state, 'MISSED');
  assert.equal(promiseStatus(promise({ amount: 200, logged_on: '2026-09-16' }), ALPHA, '2026-09-29').state, 'KEPT');
});

const plan = (over: Partial<CatchUpPlan> = {}): CatchUpPlan => ({
  id: 'pl1', driver_id: 'd', extra_per_cycle: 100, start_date: '2026-08-22', end_date: null, note: null, stopped_on: null,
  created_at: '2026-08-21T02:00:00Z', created_by_name: 'fixture-admin', created_by_role: 'admin', ...over,
});
// Weekly rent RM400 every Saturday from 1 Aug; nothing paid until the plan, then RM500 every Saturday.
const DELTA: Driver = {
  ...base, id: 'd', nric: '', name: 'Fixture Driver Delta', carPlate: 'XAD3002', contractStartDate: '2026-08-01', rentalCycle: 'WEEKLY', rentalRate: 400,
  paymentHistory: ['2026-08-22', '2026-08-29', '2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'].map((date, i) => pay(`d${i}`, date, 500)),
};

test('a catch-up plan is on track while overdue rent is no more than the start balance less the extra for each rent since the start', () => {
  const status = catchUpStatus(plan(), DELTA, NOW);
  assert.equal(status.state, 'ON_TRACK');
  assert.deepEqual([status.startBalance, status.cyclesCounted, status.target, status.overdue, status.behindBy], [1200, 6, 600, 600, 0]);
  assert.equal(status.checkpoints.length, 6);
  assert.deepEqual(status.checkpoints[0], { due: '2026-08-22', target: 1100, overdue: 1100, onTrack: true });
  assert.deepEqual(status.checkpoints[5], { due: '2026-09-26', target: 600, overdue: 600, onTrack: true });
  // Already under 3 weeks owed (MID); RM600 left at RM100 extra a week reaches nothing owed on the 6th rent from now
  assert.equal(status.reachesMid, 'NOW');
  assert.equal(status.reachesGood, '2026-11-07');
  assert.equal(status.endsBeforeGood, false);
  assert.equal(catchUpStatus(plan({ end_date: '2026-10-31' }), DELTA, NOW).endsBeforeGood, true);
});

test('a catch-up plan falls behind by what is overdue beyond its target', () => {
  const short = { ...DELTA, paymentHistory: DELTA.paymentHistory.map(p => (p.date === '2026-09-26' ? { ...p, amount: 450 } : p)) };
  const status = catchUpStatus(plan(), short, NOW);
  assert.deepEqual([status.state, status.target, status.overdue, status.behindBy], ['BEHIND', 600, 650, 50]);
  assert.equal(status.checkpoints[5].onTrack, false);
  assert.equal(status.checkpoints[4].onTrack, true);
});

test('a plan that has not started projects from its first rent; a stopped or ended plan says so', () => {
  const unpaid = { ...DELTA, paymentHistory: [] };
  const upcoming = catchUpStatus(plan({ start_date: '2026-10-03' }), unpaid, NOW);
  assert.equal(upcoming.state, 'NOT_STARTED');
  // RM3,600 owed; BAD from RM1,200 (3 weeks): under it after 25 rents with RM100 extra, nothing owed after 36
  assert.equal(upcoming.reachesMid, '2027-03-20');
  assert.equal(upcoming.reachesGood, '2027-06-05');
  assert.equal(catchUpStatus(plan({ stopped_on: '2026-09-20' }), DELTA, NOW).state, 'STOPPED');
  assert.equal(catchUpStatus(plan({ end_date: '2026-09-20' }), DELTA, NOW).state, 'ENDED');
});

test('improving means the balance fell over 28 days without rising in the last 7; anyone else who owes is not improving', () => {
  assert.deepEqual(balanceTrend(ALPHA, NOW), { outstanding: 1150, change7: 450, change28: 1150, trend: 'NOT_IMPROVING' });
  assert.deepEqual(balanceTrend(BRAVO, NOW), { outstanding: 500, change7: 0, change28: -1000, trend: 'IMPROVING' });
  const paidUp = { ...ALPHA, paymentHistory: [...ALPHA.paymentHistory, pay('a12', '2026-09-29', 1150)] };
  assert.equal(balanceTrend(paidUp, NOW).trend, 'UP_TO_DATE');
  // Down over 28 days but up again this week: not improving
  const slipping: Driver = { ...base, id: 'f', nric: '', name: 'Fixture Driver Foxtrot', carPlate: 'XAF4004', contractStartDate: '2026-06-02',
    rentalCycle: 'WEEKLY', rentalRate: 100, paymentHistory: [pay('f1', '2026-06-02', 1000), pay('f2', '2026-09-10', 700)] };
  assert.deepEqual(balanceTrend(slipping, NOW), { outstanding: 100, change7: 100, change28: -300, trend: 'NOT_IMPROVING' });
});

test('the weekly segment counts show GOOD, MID and BAD drivers at the end of each week, counting delisted drivers until they left', () => {
  assert.deepEqual(segmentHistory([ALPHA, BRAVO, CHARLIE], NOW, 5), [
    { week: '31/8', GOOD: 1, MID: 1, BAD: 1 },
    { week: '7/9', GOOD: 1, MID: 1, BAD: 0 },
    { week: '14/9', GOOD: 0, MID: 2, BAD: 0 },
    { week: '21/9', GOOD: 0, MID: 2, BAD: 0 },
    { week: '28/9', GOOD: 0, MID: 2, BAD: 0 },
  ]);
});

const dataInput = (over: Partial<Parameters<typeof buildCollectionsData>[0]> = {}) => ({
  drivers: [ALPHA, BRAVO, CHARLIE], now: NOW, today: '2026-09-29', bankIn: { SEWABELI: 'Fixture Bank 000 (ECA)', SEWA_BIASA: null },
  promises: [promise()], plans: [plan({ driver_id: 'a', start_date: '2026-09-22' })], ...over,
});

test('the collections data view has every active driver and never NRIC, phone, email or address', () => {
  const data = buildCollectionsData(dataInput());
  const json = collectionsJson(data);
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(data)));
  for (const secret of ['900101', '900202', '60123456789', 'Fixture Road', 'alpha@example.test']) assert.ok(!json.includes(secret), secret);
  // Late alerts first, longest late at the top (Bravo 29 days overdue, Alpha 13 days without payment); no delisted drivers
  assert.deepEqual(data.drivers.map(d => d.plate), ['XAB2001', 'XAA1001']);
  const alpha = data.drivers[1];
  assert.deepEqual([alpha.plate, alpha.plate_display, alpha.short_name, alpha.category, alpha.day_tag, alpha.day_tag_ok, alpha.whatsapp_group],
    ['XAA1001', 'XAA 1001', 'Fixture Driver', 'SEWA BELI', 'TUE', true, 'ALPHA XAA1001 TUE']);
  assert.deepEqual(alpha.rent, { cycle: 'WEEKLY', amount: 450, due_day: 'TUE', next_due_date: '2026-10-06', oldest_unpaid_due_date: '2026-09-15' });
  assert.deepEqual(alpha.status, { risk: 'MID', outstanding: 1150, cycles_owed: 2.6, last_payment_date: '2026-09-16', late_days: 13, balance_change_7d: 450, balance_change_28d: 1150, trend: 'NOT_IMPROVING' });
  assert.deepEqual(data.drivers[0].rent.due_day, '31st of each month');
  assert.deepEqual([data.drivers[0].day_tag, data.drivers[0].day_tag_ok, data.drivers[0].short_name], ['SAT', false, 'Fixture Driver']);
});

test('each driver carries the last 8 rent cycles, 60 days of payments, the latest promise, the plan and the statement', () => {
  const data = buildCollectionsData(dataInput());
  const [bravo, alpha] = data.drivers;
  assert.deepEqual(alpha.last_cycles.map(c => [c.due, c.status, c.paid]), [
    ['2026-08-18', 'PAID', 450], ['2026-08-25', 'PAID', 450], ['2026-09-01', 'PAID', 450], ['2026-09-08', 'PAID', 450],
    ['2026-09-15', 'PARTIAL', 200], ['2026-09-22', 'UNPAID', 0], ['2026-09-29', 'UNPAID', 0], ['2026-10-06', 'FUTURE', 0],
  ]);
  assert.ok(alpha.last_cycles.every(c => c.amount === 450));
  assert.deepEqual(alpha.payments_60d[0], { date: '2026-09-16', amount: 200, claim: 0, method: 'BANK TRANSFER', reference: 'DN0916A' });
  assert.equal(alpha.payments_60d.length, 7);
  assert.deepEqual(bravo.payments_60d.map(p => p.date), ['2026-09-05', '2026-08-02']);
  assert.deepEqual(alpha.promise, { amount: 900, date: '2026-10-01', note: 'After Friday trips', logged_on: '2026-09-20', logged_by: 'Staff', status: 'OPEN', paid_so_far: 0 });
  assert.equal(bravo.promise, null);
  assert.deepEqual(alpha.catch_up_plan && [alpha.catch_up_plan.extra_per_cycle, alpha.catch_up_plan.status, alpha.catch_up_plan.behind_by, alpha.catch_up_plan.reaches_good],
    [100, 'BEHIND', 550, '2026-12-22']);
  assert.equal(alpha.statement, whatsappStatement(ALPHA, NOW, 'Fixture Bank 000 (ECA)'));
  // No bank-in details for Sewa Biasa: no statement rather than one with the wrong account
  assert.equal(bravo.statement, null);
  assert.ok(data.warnings.some(w => /Sewa Biasa/.test(w)));
});

test('the summary matches the dashboard: risk counts, total outstanding, this week\'s target and late alerts', () => {
  const data = buildCollectionsData(dataInput());
  const { start, end } = mondayToSunday(TODAY);
  const week = rentDueAndPaid([ALPHA, BRAVO, CHARLIE], start, end, TODAY);
  assert.deepEqual(data.summary, {
    active_drivers: 2, good: 0, mid: 2, bad: 0, total_outstanding: 1650,
    week: { from: '2026-09-28', to: '2026-10-04', target: week.due, settled: week.paid, percent: 0, cash_received: 0 },
    late_alerts: buildLateAlerts([ALPHA, BRAVO], TODAY).length, not_improving: 1,
  });
  assert.equal(week.due, 1950);
  assert.equal(data.today, '2026-09-29');
  // A table that is not installed yet is reported instead of silently empty
  const missing = buildCollectionsData(dataInput({ promises: null, plans: null }));
  assert.ok(missing.warnings.some(w => /promises/i.test(w)) && missing.warnings.some(w => /plans/i.test(w)));
  assert.equal(missing.drivers[1].promise, null);
});

test('the invoice list the data view reads is the shared rent schedule', () => {
  const horizon = new Date(2026, 9, 31);
  assert.equal(generateDriverInvoices(ALPHA, NOW, horizon).find(inv => inv.dueDate === '2026-10-06')?.status, 'FUTURE');
});
