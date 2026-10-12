import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver, PaymentTransaction } from '../types.ts';
import { calculateDriverMetrics, lastPayment, lateAlertDays, overdueRent } from '../utils.ts';
import { buildDailyStatusRows, DAILY_STATUS_KEY, writeTodaysSnapshotOnce, type DailyStatusRow } from '../services/dailyStatus.ts';

const pay = (id: string, date: string, amount: number): PaymentTransaction => ({ id, date, amount, serviceClaim: 0, paymentMethod: 'BANK TRANSFER' });
const base = { totalAmountPaid: 0, contractDuration: 52, nric: '900101-01-0000', tags: [] as string[] };
const WEEKLY: Driver = { ...base, id: 'a', name: 'Fixture Driver A', carPlate: 'XAA1001', contractStartDate: '2026-08-04', rentalCycle: 'WEEKLY', rentalRate: 450,
  paymentHistory: [pay('a1', '2026-08-04', 450), pay('a2', '2026-08-11', 450), pay('a3', '2026-09-16', 200)] };
const MONTHLY: Driver = { ...base, id: 'b', name: 'Fixture Driver B', carPlate: 'XAB2001', contractStartDate: '2026-05-31', rentalCycle: 'MONTHLY', contractDuration: 12,
  rentalRate: 1500, paymentHistory: [pay('b1', '2026-06-01', 1500)] };
const NEW_DRIVER: Driver = { ...base, id: 'n', name: 'Fixture Driver N', carPlate: 'XAN3001', contractStartDate: '2026-10-20', rentalCycle: 'WEEKLY', rentalRate: 400, paymentHistory: [] };
const DELISTED: Driver = { ...WEEKLY, id: 'c', carPlate: 'XAC3001', isDelisted: true, delistDate: '2026-09-10' };
const NOW = new Date(2026, 9, 12, 9, 30);
const TODAY = '2026-10-12';
const round2 = (n: number) => Math.round(n * 100) / 100;

test('D1: one row per active driver for the day, every figure taken from the shared rent engine', () => {
  const rows = buildDailyStatusRows([WEEKLY, MONTHLY, NEW_DRIVER, DELISTED], NOW, TODAY);
  assert.deepEqual(rows.map(r => r.driver_id), ['a', 'b', 'n'], 'delisted drivers are left out');
  for (const driver of [WEEKLY, MONTHLY, NEW_DRIVER]) {
    const row = rows.find(r => r.driver_id === driver.id)!;
    const metrics = calculateDriverMetrics(driver, NOW);
    const last = lastPayment(driver, NOW);
    assert.deepEqual(row, {
      driver_id: driver.id, day: TODAY,
      owed: round2(metrics.principalOutstanding), overdue: round2(overdueRent(driver, NOW)), cycles_owed: round2(metrics.cyclesOwed),
      status: metrics.status, late_days: lateAlertDays(driver, NOW),
      last_payment_date: last ? `${last.date.getFullYear()}-${String(last.date.getMonth() + 1).padStart(2, '0')}-${String(last.date.getDate()).padStart(2, '0')}` : null,
    } satisfies DailyStatusRow);
  }
  assert.equal(rows.find(r => r.driver_id === 'a')!.last_payment_date, '2026-09-16');
  assert.equal(rows.find(r => r.driver_id === 'n')!.last_payment_date, null);
  assert.ok(rows.find(r => r.driver_id === 'a')!.owed > 0);
});

const memoryStorage = (start: Record<string, string> = {}) => {
  const data = new Map(Object.entries(start));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data };
};

test('D1: the snapshot is written once a Kuala Lumpur day, in one request, and remembered only after it is saved', async () => {
  const storage = memoryStorage();
  const sent: DailyStatusRow[][] = [];
  const write = async (rows: DailyStatusRow[]) => { sent.push(rows); };
  const attempted = { day: null as string | null };
  assert.equal(await writeTodaysSnapshotOnce({ drivers: [WEEKLY, MONTHLY], now: NOW, today: TODAY, storage, write, attempted }), 'written');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 2);
  assert.equal(storage.data.get(DAILY_STATUS_KEY), TODAY);
  // Later loads the same day (this page or a new one) send nothing
  assert.equal(await writeTodaysSnapshotOnce({ drivers: [WEEKLY], now: NOW, today: TODAY, storage, write, attempted: { day: null } }), 'already');
  assert.equal(sent.length, 1);
  // The next day writes again
  assert.equal(await writeTodaysSnapshotOnce({ drivers: [WEEKLY], now: NOW, today: '2026-10-13', storage, write, attempted }), 'written');
  assert.equal(sent.length, 2);
});

test('D1: when the table is missing the failure is silent, not remembered as written, and not retried on every reload of the page', async () => {
  const storage = memoryStorage();
  let calls = 0;
  const failing = async () => { calls += 1; throw new Error('relation "public.driver_daily_status" does not exist'); };
  const attempted = { day: null as string | null };
  assert.equal(await writeTodaysSnapshotOnce({ drivers: [WEEKLY], now: NOW, today: TODAY, storage, write: failing, attempted }), 'failed');
  assert.equal(storage.data.has(DAILY_STATUS_KEY), false);
  assert.equal(await writeTodaysSnapshotOnce({ drivers: [WEEKLY], now: NOW, today: TODAY, storage, write: failing, attempted }), 'already');
  assert.equal(calls, 1);
  // A browser that blocks storage still writes (at most once per page per day)
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  let written = 0;
  assert.equal(await writeTodaysSnapshotOnce({ drivers: [WEEKLY], now: NOW, today: TODAY, storage: blocked, write: async () => { written += 1; }, attempted: { day: null } }), 'written');
  assert.equal(written, 1);
});
