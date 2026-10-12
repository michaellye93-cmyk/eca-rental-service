import test from 'node:test';
import assert from 'node:assert/strict';
import { arrearsScenarios, cashLine, collectionRate, currentCash, depositRefundsDue, depositsHeldByDriver, monthlyOutlook, windowBills, windowOtherIncome, type CashOutlookData } from '../services/cashOutlook.ts';
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

test('a deposit forfeited against rent is not cash, so it does not lift the cash collection rate', () => {
  const forfeit: PaymentTransaction = { id: 'g', date: '2026-10-25', amount: 1000, serviceClaim: 0, paymentMethod: 'DEPOSIT CONTRA' };
  const inHand: PaymentTransaction = { id: 'h', date: '2026-10-26', amount: 200, serviceClaim: 0, paymentMethod: 'CASH' };
  assert.deepEqual(collectionRate([{ ...weekly, paymentHistory: [...weekly.paymentHistory, forfeit, inHand] }], TODAY), { rate: 0.825, cash: 6600, due: 8000 });
});

test('bills for a window weight each month by the days it covers and add insurance falling due', () => {
  const bills = windowBills(outlook(), '2026-11-01', '2026-11-30');
  // Averages use only months with data (September and October).
  assert.deepEqual(bills, { financing: 3000, fixed: 900, insurance: 1200, workshop: 900, vehicleCosts: 300, oneOffOpex: 300, depositRefunds: 0, total: 6600 });
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

test('with no bills recorded in Finance the line says so instead of showing Covered', () => {
  const noBills = outlook({
    balances: [balance('1', 'Maybank operating', 1000, '2026-10-30')],
    months: [{ month: '2026-11-01', recurring: 0, fixed: 0 }],
    insurance: [],
    history: [{ month: '2026-10-01', has_data: false, workshop: 0, vehicle_costs: 0, one_off_opex: 0, smart_drive_net: 0, other_income: 0 }],
  });
  const line = cashLine({ today: TODAY, outlook: noBills, drivers: [weekly], overdue: 0, overdueChange: 0 });
  assert.equal(line.bills.total, 0);
  assert.equal(line.status, 'WATCH');
  assert.equal(plain(line.sentence), 'Watch: no bills are recorded in Finance for the next 30 days, so the cash line cannot tell how long cash lasts. Add your monthly costs in Finance → Records.');
  assert.ok(!line.notes.some(note => note.startsWith('No bills are recorded')));
});

test('arrears scenarios show closing cash each month at different collection rates and arrears recovery', () => {
  const data = outlook({ balances: [balance('1', 'Maybank operating', 5000, '2026-11-15')] });
  const base = monthlyOutlook({ today: '2026-11-16', outlook: data, drivers: [weekly] });
  const scenarios = arrearsScenarios({ today: '2026-11-16', outlook: data, drivers: [weekly], overdue: 2000 });
  assert.deepEqual(scenarios.map((s) => s.key), ['current', 'rate85', 'all', 'allPlusArrears']);
  // The current-pace line is the Cash page outlook as it is today.
  assert.deepEqual(scenarios[0].closing, base.map((m) => m.closing));
  // Collecting all rent matches the outlook's "if all rent is paid" line.
  assert.deepEqual(scenarios[2].closing, base.map((m) => m.closingIfAllRentPaid));
  // 85% sits between nothing extra and all rent.
  const rate85 = scenarios[1].closing;
  assert.ok(rate85[3] <= scenarios[2].closing[3]);
  // Recovering 10% of the RM2,000 arrears each month adds RM200 a month (half a month first: 16–30 Nov is 15 of 30 days).
  assert.equal(round(scenarios[3].closing[0] - scenarios[2].closing[0]), 100);
  assert.equal(round(scenarios[3].closing[3] - scenarios[2].closing[3]), 700);
  assert.equal(scenarios[3].months.length, 4);
});

// Deposits (Sewa Biasa) are owed back to drivers; downpayments (Sewa Beli) never are.
const ledger = [
  { driver_id: 'd1', kind: 'DEPOSIT', entry: 'RECEIVED', amount: 1000 },
  { driver_id: 'd1', kind: 'DEPOSIT', entry: 'CONTRA', amount: 300 },
  { driver_id: 'd1', kind: 'DOWNPAYMENT', entry: 'RECEIVED', amount: 5000 },
  { driver_id: 'd3', kind: 'DEPOSIT', entry: 'RECEIVED', amount: 800 },
  { driver_id: 'd4', kind: 'DEPOSIT', entry: 'RECEIVED', amount: 500 },
  { driver_id: 'd4', kind: 'DEPOSIT', entry: 'REFUNDED', amount: 500 },
  { driver_id: 'd5', kind: 'DEPOSIT', entry: 'RECEIVED', amount: 600 },
  { driver_id: 'd5', kind: 'DEPOSIT', entry: 'FORFEITED', amount: 600 },
];
const ending = (id: string, name: string, contractEndDate: string, extra: Partial<Driver> = {}): Driver =>
  ({ ...weekly, id, name, carPlate: 'XAC3001', contractEndDate, paymentHistory: [], ...extra });

test('deposits held: received less used for rent, refunded or forfeited; downpayments are not held', () => {
  assert.deepEqual(depositsHeldByDriver(ledger), { d1: 700, d3: 800 });
  assert.deepEqual(depositsHeldByDriver([]), {});
});

test('an active driver whose contract ends in the window with a deposit held brings an expected refund on the end date', () => {
  const held = depositsHeldByDriver(ledger);
  const drivers = [
    ending('d1', 'Fixture Driver A', '2026-11-20'),
    ending('d3', 'Fixture Driver B', '2027-01-10'),                          // ends after the window
    ending('d4', 'Fixture Driver C', '2026-11-05'),                          // deposit already refunded
    ending('d3', 'Fixture Driver D', '2026-11-12', { id: 'd6' }),            // no deposit held
    ending('d1', 'Fixture Driver E', '2026-11-25', { id: 'd3', isDelisted: true }), // delisted: settled at delisting
  ];
  assert.deepEqual(depositRefundsDue(drivers, held, TODAY, '2026-11-30'), [
    { driver_id: 'd1', name: 'Fixture Driver A', plate: 'XAC3001', due_date: '2026-11-20', amount: 700 },
  ]);
  assert.deepEqual(depositRefundsDue(drivers, undefined, TODAY, '2026-11-30'), [], 'no deposit ledger read: nothing listed');

  // The refund counts in the bills of the window it falls in, so the cash line and the outlook allow for it.
  const data = outlook({ deposits_held: held, balances: [balance('1', 'Maybank operating', 20000, '2026-10-31')] });
  assert.equal(windowBills(data, TODAY, '2026-11-30', drivers).depositRefunds, 700);
  assert.equal(windowBills(data, TODAY, '2026-11-30', drivers).total, 7300);
  assert.equal(windowBills(data, '2026-12-01', '2026-12-31', drivers).depositRefunds, 0);
  const line = cashLine({ today: TODAY, outlook: data, drivers: [weekly, ...drivers], overdue: 0, overdueChange: 0 });
  assert.equal(line.bills.depositRefunds, 700);
  assert.equal(line.depositsHeld, 1500, 'of the cash in bank, RM1,500 is drivers deposits held');
  const months = monthlyOutlook({ today: TODAY, outlook: data, drivers });
  assert.equal(months[0].bills.depositRefunds, 700);
  // Without the deposit ledger nothing changes and no figure is shown.
  assert.equal(cashLine({ today: TODAY, outlook: outlook(), drivers: [weekly], overdue: 0, overdueChange: 0 }).depositsHeld, null);
});

test('a deposit still held after the contract end date is an overdue refund, counted once on the first day of the window holding today', () => {
  const held = depositsHeldByDriver(ledger);
  const drivers = [
    ending('d3', 'Fixture Driver B', '2026-10-20'),  // ended before today, deposit still held
    ending('d1', 'Fixture Driver A', '2026-11-20'),  // ends in the first window
  ];
  assert.deepEqual(depositRefundsDue(drivers, held, TODAY, '2026-11-30', TODAY), [
    { driver_id: 'd3', name: 'Fixture Driver B', plate: 'XAC3001', due_date: TODAY, amount: 800, overdue: true, ended: '2026-10-20' },
    { driver_id: 'd1', name: 'Fixture Driver A', plate: 'XAC3001', due_date: '2026-11-20', amount: 700 },
  ]);
  const data = outlook({ deposits_held: held });
  assert.equal(windowBills(data, TODAY, '2026-11-30', drivers, TODAY).depositRefunds, 1500);
  assert.equal(windowBills(data, '2026-12-01', '2026-12-31', drivers, TODAY).depositRefunds, 0);
  assert.equal(cashLine({ today: TODAY, outlook: data, drivers: [weekly, ...drivers], overdue: 0, overdueChange: 0 }).bills.depositRefunds, 1500);
  // The month-by-month outlook counts each refund once: in the window it falls in, an overdue one in the first.
  const months = monthlyOutlook({ today: TODAY, outlook: data, drivers });
  assert.deepEqual(months.map(m => m.bills.depositRefunds), [1500, 0, 0, 0]);
  assert.deepEqual(depositRefundsDue(drivers, held, '2026-12-01', '2026-12-31', TODAY), [], 'not again in a later window');
});
