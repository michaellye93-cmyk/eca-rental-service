import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commitmentSeries,
  instalment,
  lastInstalmentMonth,
  loanSummary,
  nearPayoff,
  progress,
  sortLoans,
  type VehicleLoan,
} from '../services/finance/loans.ts';

// Fixture cars and made-up amounts only.
const loan = (overrides: Partial<VehicleLoan>): VehicleLoan => ({
  id: overrides.plate_key ?? 'XAA1001',
  plate_key: 'XAA1001',
  display_plate: 'XAA 1001',
  bank: 'Fixture Bank',
  finance_amount: 30000,
  flat_rate_percent: 3,
  tenure_months: 60,
  first_payment_date: '2023-03-05',
  downpayment: 3000,
  monthly_instalment: 575,
  status: 'ACTIVE',
  closed_on: null,
  notes: null,
  ...overrides,
});

test('the instalment is the flat-rate total spread over the tenure, rounded up to the next ringgit', () => {
  // 30,000 + 30,000 × 3% × 5 years = 34,500 over 60 months = 575 exactly: no rounding up.
  assert.equal(instalment(30000, 3, 60), 575);
  // 38,000 + 38,000 × 3% × 5 = 43,700 / 60 = 728.33… → 729.
  assert.equal(instalment(38000, 3, 60), 729);
  // 32,000 + 32,000 × 2.9% × 7 = 38,496 / 84 = 458.28… → 459.
  assert.equal(instalment(32000, 2.9, 84), 459);
  // A rate of zero is the amount over the tenure.
  assert.equal(instalment(12000, 0, 48), 250);
  // Floating-point dust never adds a ringgit: 10,000 × 2.1% × 3 = 630 → 10,630 / 36 = 295.27… → 296; 7,200 / 36 = 200.
  assert.equal(instalment(10000, 2.1, 36), 296);
  assert.equal(instalment(7200, 0, 36), 200);
  // Nothing to calculate without the three figures.
  assert.equal(instalment(0, 3, 60), 0);
  assert.equal(instalment(30000, 3, 0), 0);
});

test('the last instalment month is the first payment month plus the tenure less one, across year ends', () => {
  assert.equal(lastInstalmentMonth('2023-03-05', 60), '2028-02-01');
  assert.equal(lastInstalmentMonth('2026-01-31', 12), '2026-12-01');
  assert.equal(lastInstalmentMonth('2026-12-01', 1), '2026-12-01');
  assert.equal(lastInstalmentMonth('2026-11-15', 3), '2027-01-01');
});

test('progress counts whole months from the first payment month to this month, assuming every instalment is paid', () => {
  const running = loan({});
  assert.deepEqual(progress(running, '2026-10-21'), { paid: 44, left: 16, percent: 73, finishes: '2028-02-01' });
  // The first payment month counts as paid from its first day (whole months, not days).
  assert.deepEqual(progress(loan({ first_payment_date: '2026-10-25' }), '2026-10-01'), { paid: 1, left: 59, percent: 2, finishes: '2031-09-01' });
  // Before the first payment month nothing is paid.
  assert.deepEqual(progress(loan({ first_payment_date: '2027-01-05' }), '2026-10-21'), { paid: 0, left: 60, percent: 0, finishes: '2031-12-01' });
  // Capped at the tenure once the last month has passed.
  assert.deepEqual(progress(loan({ first_payment_date: '2020-01-05' }), '2026-10-21'), { paid: 60, left: 0, percent: 100, finishes: '2024-12-01' });
  // A settled or sold loan shows as paid in full, whatever the date.
  assert.deepEqual(progress(loan({ status: 'SETTLED', closed_on: '2026-06-10' }), '2026-10-21'), { paid: 60, left: 0, percent: 100, finishes: '2028-02-01' });
  assert.deepEqual(progress(loan({ status: 'SOLD', closed_on: '2026-06-10' }), '2026-10-21'), { paid: 60, left: 0, percent: 100, finishes: '2028-02-01' });
});

test('a loan is near payoff with six or fewer instalments left, and only while it is still running', () => {
  assert.equal(nearPayoff(loan({ first_payment_date: '2022-05-05' }), '2026-10-21'), true, '6 left');
  assert.equal(nearPayoff(loan({ first_payment_date: '2022-04-05' }), '2026-10-21'), true, '5 left');
  assert.equal(nearPayoff(loan({ first_payment_date: '2022-06-05' }), '2026-10-21'), false, '7 left');
  assert.equal(nearPayoff(loan({ first_payment_date: '2021-11-05' }), '2026-10-21'), true, 'last instalment due this month');
  assert.equal(nearPayoff(loan({ first_payment_date: '2020-01-05' }), '2026-10-21'), false, 'finished: nothing left');
  assert.equal(nearPayoff(loan({ first_payment_date: '2022-05-05', status: 'SETTLED', closed_on: '2026-06-01' }), '2026-10-21'), false, 'settled');
});

test('the commitment series sums active loans month by month and steps down as each one ends', () => {
  const loans = [
    loan({ plate_key: 'XAA1001', monthly_instalment: 500, first_payment_date: '2026-01-05', tenure_months: 12 }), // ends Dec 2026
    loan({ plate_key: 'XAA1002', monthly_instalment: 300, first_payment_date: '2026-12-01', tenure_months: 3 }), // Dec 2026 – Feb 2027
    loan({ plate_key: 'XAA1003', monthly_instalment: 900, status: 'SETTLED', closed_on: '2026-06-01' }), // never counted
  ];
  const series = commitmentSeries(loans, '2026-10-21', 6);
  assert.deepEqual(series.months, ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01']);
  assert.deepEqual(series.committed, [500, 500, 800, 300, 300, 0]);
  assert.equal(series.withWhatIf, null, 'no what-if loan typed');
  assert.deepEqual(series.ends.map((end) => [end.plate_key, end.index]), [['XAA1001', 2], ['XAA1002', 4]], 'each running loan ends at its last instalment month inside the window');
});

test('a what-if loan is added on top as a second series from its first payment month', () => {
  const loans = [loan({ monthly_instalment: 500, first_payment_date: '2026-01-05', tenure_months: 12 })];
  const series = commitmentSeries(loans, '2026-10-21', 5, { finance_amount: 12000, flat_rate_percent: 0, tenure_months: 2, first_payment_month: '2026-11' });
  assert.deepEqual(series.committed, [500, 500, 500, 0, 0]);
  // 12,000 over 2 months = 6,000 a month, in Nov and Dec 2026 only.
  assert.deepEqual(series.withWhatIf, [500, 6500, 6500, 0, 0]);
  assert.equal(series.whatIfInstalment, 6000);
  // An incomplete what-if adds nothing.
  assert.equal(commitmentSeries(loans, '2026-10-21', 5, { finance_amount: 0, flat_rate_percent: 3, tenure_months: 12, first_payment_month: '2026-11' }).withWhatIf, null);
});

test('the summary gives this month\'s instalments, the next loan to finish, the balance left and the near-payoff count', () => {
  const loans = [
    loan({ plate_key: 'XAA1001', display_plate: 'XAA 1001', monthly_instalment: 500, first_payment_date: '2022-05-05', tenure_months: 60 }), // 6 left, ends Apr 2027
    loan({ plate_key: 'XAA1002', display_plate: 'XAA 1002', monthly_instalment: 300, first_payment_date: '2026-01-05', tenure_months: 24 }), // 14 left
    loan({ plate_key: 'XAA1003', display_plate: 'XAA 1003', monthly_instalment: 900, status: 'SOLD', closed_on: '2026-06-01' }),
    loan({ plate_key: 'XAA1004', display_plate: 'XAA 1004', monthly_instalment: 400, first_payment_date: '2027-01-05', tenure_months: 12 }), // starts later
  ];
  const summary = loanSummary(loans, '2026-10-21');
  assert.equal(summary.thisMonth, 800, 'only loans paying this month');
  assert.equal(summary.activeCount, 3, 'every active loan still to pay, including one that starts later');
  assert.deepEqual(summary.nextFinish, { plate: 'XAA 1001', month: '2027-04-01' });
  assert.equal(summary.balanceLeft, 500 * 6 + 300 * 14 + 400 * 12);
  assert.equal(summary.nearPayoffCount, 1);
  assert.deepEqual(loanSummary([], '2026-10-21'), { thisMonth: 0, activeCount: 0, nextFinish: null, balanceLeft: 0, nearPayoffCount: 0 });
  // A loan paying its last instalment this month is still one of this month's loans, and the next to finish.
  const lastMonth = loanSummary([...loans, loan({ plate_key: 'XAA1005', display_plate: 'XAA 1005', monthly_instalment: 200, first_payment_date: '2025-11-05', tenure_months: 12 })], '2026-10-21');
  assert.equal(lastMonth.thisMonth, 1000);
  assert.equal(lastMonth.activeCount, 4);
  assert.deepEqual(lastMonth.nextFinish, { plate: 'XAA 1005', month: '2026-10-01' });
  assert.equal(lastMonth.balanceLeft, 500 * 6 + 300 * 14 + 400 * 12, 'nothing left to pay after this month');
  // Once that month has passed it drops out.
  assert.equal(loanSummary([loan({ first_payment_date: '2025-10-05', tenure_months: 12 })], '2026-10-21').activeCount, 0);
});

test('loans are listed soonest to finish first, with settled and sold loans last', () => {
  const loans = [
    loan({ plate_key: 'XAA1003', status: 'SETTLED', closed_on: '2026-06-01' }),
    loan({ plate_key: 'XAA1002', first_payment_date: '2026-01-05' }),
    loan({ plate_key: 'XAA1001', first_payment_date: '2022-05-05' }),
  ];
  assert.deepEqual(sortLoans(loans, '2026-10-21').map((row) => row.plate_key), ['XAA1001', 'XAA1002', 'XAA1003']);
});
