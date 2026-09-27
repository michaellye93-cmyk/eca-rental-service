import test from 'node:test';
import assert from 'node:assert/strict';
import { cashLine, collectionRate, currentCash, monthlyOutlook, windowBills, windowOtherIncome, type CashOutlookData } from '../services/cashOutlook.ts';
import type { Driver, PaymentTransaction } from '../types.ts';

const plain = (text: string) => text.replace(/ /g, ' ');
const round = (n: number) => Math.round(n * 100) / 100;
const pay = (id: string, date: string, amount: number, serviceClaim = 0): PaymentTransaction => ({ id, date, amount, serviceClaim });

// Today is Sunday 1 Nov 2026, so the next 30 days are exactly November and every monthly figure counts once.
const TODAY = '2026-11-01';
const outlook = (overrides: Partial<CashOutlookData> = {}): CashOutlookData => ({
  today: TODAY,
  balances: [],
  months: [
    { month: '2026-11-01', recurring: 3000, fixed: 900 },
    { month: '2026-12-01', recurring: 3000, fixed: 900 },
    { month: '2027-01-01', recurring: 3100, fixed: 900 },
    { month: '2027-02-01', recurring: 3100, fixed: 900 },
  ],
  insurance: [
    { plate_key: 'XAA1001', display_plate: 'XAA 1001', due_date: '2026-11-16', amount: 1200, kind: 'RENEWAL' },
    { plate_key: 'XAB2001', display_plate: 'XAB 2001', due_date: '2026-12-20', amount: 800, kind: 'PAYMENT' },
  ],
  history: [
    { month: '2026-08-01', has_data: false, workshop: 0, vehicle_costs: 0, one_off_opex: 0, smart_drive_net: 0, other_income: 0 },
    { month: '2026-09-01', has_data: true, workshop: 600, vehicle_costs: 300, one_off_opex: 0, smart_drive_net: 900, other_income: 100 },
    { month: '2026-10-01', has_data: true, workshop: 1200, vehicle_costs: 300, one_off_opex: 600, smart_drive_net: 1500, other_income: 100 },
  ],
  duplicate_recurring: { vehicles: 0, monthly_amount: 0 },
  ...overrides,
});
const balance = (id: string, account_label: string, amount: number, as_of: string) =>
  ({ id, account_label, balance: amount, as_of, note: null, entered_at: `${as_of}T09:00:00Z` });

// One weekly driver, RM1,000 due every Monday from 3 Aug. August was paid on time; in the last 8 weeks (7 Sep - 1 Nov,
// RM8,000 due) RM6,400 of cash came in plus RM800 of repair credits, so the recent collection rate is 80%.
const weekly: Driver = {
  id: 'd1', nric: '', name: 'Fixture Driver', carPlate: 'XAA1001', contractStartDate: '2026-08-03', rentalCycle: 'WEEKLY',
  contractDuration: 52, rentalRate: 1000, totalAmountPaid: 0,
  paymentHistory: [
    pay('a', '2026-08-03', 5000),
    pay('b', '2026-09-08', 1600), pay('c', '2026-09-22', 1600, 800), pay('d', '2026-10-06', 1600), pay('e', '2026-10-20', 1600),
  ],
};
// A delisted driver counts neither for rent due nor for the collection rate.
const delisted: Driver = { ...weekly, id: 'd2', name: 'Gone', isDelisted: true, delistDate: '2026-09-01', paymentHistory: [pay('z', '2026-10-01', 999)] };

test('cash in bank is the latest entry per account; the age is the oldest of those', () => {
  const cash = currentCash([
    balance('1', 'Maybank operating', 2000, '2026-10-30'),
    balance('2', 'CIMB current', 500, '2026-10-25'),
    balance('3', 'Maybank operating', 9999, '2026-10-01'),
  ], TODAY);
  assert.equal(cash?.total, 2500);
  assert.deepEqual(cash?.accounts.map(a => [a.label, a.balance, a.ageDays]), [['Maybank operating', 2000, 2], ['CIMB current', 500, 7]]);
  assert.equal(cash?.ageDays, 7);
  assert.equal(currentCash([], TODAY), null);
});

test('the recent collection rate is cash received over rent due in the last 8 weeks, active drivers only, capped at 100%', () => {
  assert.deepEqual(collectionRate([weekly, delisted], TODAY), { rate: 0.8, cash: 6400, due: 8000 });
  const caughtUp = { ...weekly, paymentHistory: [...weekly.paymentHistory, pay('f', '2026-10-30', 5000)] };
  assert.equal(collectionRate([caughtUp], TODAY).rate, 1);
  assert.deepEqual(collectionRate([], TODAY), { rate: 1, cash: 0, due: 0 });
});

test('bills for a window weight each month by the days it covers and add insurance falling due', () => {
  const bills = windowBills(outlook(), '2026-11-01', '2026-11-30');
  // Averages use only months with data (September and October).
  assert.deepEqual(bills, { financing: 3000, fixed: 900, insurance: 1200, workshop: 900, vehicleCosts: 300, oneOffOpex: 300, total: 6600 });
  const half = windowBills(outlook(), '2026-11-16', '2026-11-30');
  assert.equal(half.financing, 1500);
  assert.equal(half.insurance, 1200);
  // Past the last month Finance returned, the last month's figures carry on.
  assert.equal(windowBills(outlook(), '2027-03-01', '2027-03-31').financing, 3100);
  assert.equal(windowOtherIncome(outlook(), '2026-11-01', '2026-11-30'), 1300);
});

test('Tight: the line says how few days of bills would be left and what better collection is worth', () => {
  const line = cashLine({
    today: TODAY, outlook: outlook({ balances: [balance('1', 'Maybank operating', 2000, '2026-10-30'), balance('2', 'CIMB current', 500, '2026-10-25')] }),
    drivers: [weekly, delisted], overdue: 800, overdueChange: 0,
  });
  assert.equal(line.rent.due, 5000); // 2, 9, 16, 23 and 30 Nov
  assert.equal(line.rent.expected, 4000);
  assert.equal(line.expectedIn, 5300);
  assert.equal(line.bills.total, 6600);
  assert.equal(line.left, 1200);
  assert.equal(round(line.daysLeft ?? 0), 5.45);
  assert.equal(line.status, 'TIGHT');
  assert.equal(plain(line.sentence), 'Tight: after the next 30 days of bills you would have RM 1,200.00 left, under 6 days of bills.');
  assert.equal(line.leverPerTenPoints, 500);
  assert.ok(line.notes.map(plain).includes('Collecting 90% of rent due instead of 80% would add RM 500.00.'));
});

test('Short, Watch and Covered follow the same figures', () => {
  const withCash = (amount: number, asOf = '2026-10-30', extra: Partial<Parameters<typeof cashLine>[0]> = {}) =>
    cashLine({ today: TODAY, outlook: outlook({ balances: [balance('1', 'Maybank operating', amount, asOf)] }), drivers: [weekly], overdue: 800, overdueChange: 0, ...extra });

  const short = withCash(0);
  assert.equal(short.status, 'SHORT');
  assert.equal(plain(short.sentence), 'Short: the next 30 days of bills are RM 1,300.00 more than your cash plus the money expected in.');

  const covered = withCash(10000);
  assert.equal(covered.status, 'COVERED');
  assert.equal(plain(covered.sentence), 'Covered: RM 8,700.00 left after the next 30 days of bills, about 39 days of bills.');

  const growing = withCash(10000, '2026-10-30', { overdueChange: 300 });
  assert.equal(growing.status, 'WATCH');
  assert.equal(plain(growing.sentence), 'Watch: overdue rent grew RM 300.00 this week.');

  const stale = withCash(10000, '2026-10-20');
  assert.equal(stale.status, 'WATCH');
  assert.equal(plain(stale.sentence), 'Watch: the bank balance is 12 days old. Update it on the Cash page.');
  // A stale balance is still mentioned when a worse status leads.
  assert.ok(withCash(0, '2026-10-20').notes.map(plain).includes('The bank balance is 12 days old. Update it on the Cash page.'));
});

test('without a bank balance the line asks for one and never shows RM0 as cash', () => {
  const line = cashLine({ today: TODAY, outlook: outlook(), drivers: [weekly], overdue: 800, overdueChange: 0 });
  assert.equal(line.cash, null);
  assert.equal(line.left, null);
  assert.equal(line.status, 'WATCH');
  assert.equal(plain(line.sentence), 'Enter your bank balance on the Cash page to see how long cash lasts. The next 30 days bring about RM 5,300.00 in and RM 6,600.00 of bills.');
});

test('duplicate-looking monthly costs are called out, because they overstate the bills', () => {
  const line = cashLine({ today: TODAY, outlook: outlook({ duplicate_recurring: { vehicles: 3, monthly_amount: 2400 } }), drivers: [weekly], overdue: 0, overdueChange: 0 });
  assert.ok(line.notes.map(plain).includes('3 vehicles carry the same monthly cost twice (RM 2,400.00 a month), so bills may be overstated. Check Finance → Expenses → Monthly Vehicle Costs.'));
});

test('the Cash page outlook runs from today to the end of the third month ahead, carrying cash forward', () => {
  const months = monthlyOutlook({ today: '2026-11-16', outlook: outlook({ balances: [balance('1', 'Maybank operating', 5000, '2026-11-15')] }), drivers: [weekly] });
  assert.deepEqual(months.map(m => [m.label, m.from, m.to]), [
    ['Rest of Nov', '2026-11-16', '2026-11-30'],
    ['Dec 2026', '2026-12-01', '2026-12-31'],
    ['Jan 2027', '2027-01-01', '2027-01-31'],
    ['Feb 2027', '2027-02-01', '2027-02-28'],
  ]);
  const [rest, december] = months;
  assert.equal(rest.opening, 5000);
  // Rent 16, 23 and 30 Nov is RM3,000, none of it paid in advance.
  assert.equal(rest.rent.full, 3000);
  assert.equal(rest.closing, round(rest.opening + rest.moneyIn - rest.bills.total));
  assert.equal(december.opening, rest.closing);
  assert.equal(december.bills.insurance, 800);
  assert.equal(december.closingIfAllRentPaid, round(rest.closingIfAllRentPaid + december.rent.full + december.otherIncome - december.bills.total));
});
