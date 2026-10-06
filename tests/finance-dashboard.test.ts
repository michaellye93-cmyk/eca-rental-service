import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver, PaymentTransaction } from '../types.ts';
import type { FinanceInput } from '../types/finance.ts';
import { calculateFinance } from '../services/finance/calculations.ts';
import { marginTarget, monthCashFlow, trendMonths, trendRow } from '../services/finance/dashboard.ts';
import { arrearsAgeing, driverMonthlyLedger, monthCollection } from '../services/driverLedger.ts';

const month = { finance_month: '2026-08', status: 'DRAFT' as const, revision: 1, refreshed_at: '2026-09-01', frozen_at: null,
  source_count: 1, total_cash: 900, total_claim: 100, earliest_date: '2026-08-03', latest_date: '2026-08-03' };
const vehicle = (plate_key: string, business_unit: 'E-HAILING' | 'DAILY RENTAL' = 'E-HAILING') =>
  ({ plate_key, display_plate: plate_key, business_unit, ownership_type: 'Car Owner', status: 'Active' });
const input: FinanceInput = {
  month, bootstrap_completed: true, imports: [], smart_import: null,
  vehicles: [vehicle('XAA1001'), vehicle('XAA2002'), vehicle('XAA3003', 'DAILY RENTAL')],
  ehailing: [{ source_payment_id: 'p1', driver_id: 'd1', driver_name_snapshot: null, car_plate_snapshot: 'XAA1001', plate_key: 'XAA1001',
    payment_date: '2026-08-03', cash_amount: 900, service_claim: 100, gross_rental_revenue: 1000, payment_method: null,
    refreshed_at: '2026-09-01', finance_month: '2026-08', attribution_changed: false }],
  smart_rows: [{ plate_key: 'XAA3003', display_plate: 'XAA3003', pickup_date: '2026-08-10', return_date: '2026-08-11', gross_revenue: 500, commission: 150, status: 'Completed', reference: 'r1' } as any],
  recurring_costs: [
    { plate_key: 'XAA1001', start_month: '2026-08-01', end_month: null, cost_type: 'Owner Payout', monthly_amount: 300, payee: null, notes: null },
    { plate_key: 'XAA2002', start_month: '2026-08-01', end_month: null, cost_type: 'Owner Payout', monthly_amount: 200, payee: null, notes: null },
  ],
  insurance: [{ plate_key: 'XAA1001', premium: 1200, payment_date: '2026-08-15', coverage_start: '2026-08-15', coverage_end: '2027-08-14', responsibility: 'ECA_PAID' } as any],
  expenses: [
    { id: 'w1', finance_month: '2026-08-01', billing_date: '2026-08-31', plate_key: 'XAA1001', category: 'Service & Maintenance', payment_source: 'Workshop Billing', supplier: null, amount: 80, reference: null, description: null },
    { id: 'o1', finance_month: '2026-08-01', billing_date: null, plate_key: null, category: 'Tax instalment', payment_source: 'Corporate Opex', supplier: null, amount: 60, reference: null, description: null, frequency: 'MONTHLY_RECURRING', fixed_cost_template_id: 't1' },
    { id: 'o2', finance_month: '2026-08-01', billing_date: null, plate_key: null, category: 'Office Rental', payment_source: 'Corporate Opex', supplier: null, amount: 40, reference: null, description: null, frequency: 'MONTHLY_RECURRING', fixed_cost_template_id: 't2' },
  ],
  fixed_cost_templates: [
    { id: 't1', series_id: 's1', version_no: 1, category: 'Tax instalment', monthly_amount: 60, effective_from: '2026-08-01', effective_until: null, payee: null, note: null, source: null, linked_expense_id: null, record_version: 1, cancelled_at: null },
    { id: 't2', series_id: 's2', version_no: 1, category: 'Office Rental', monthly_amount: 40, effective_from: '2026-08-01', effective_until: null, payee: null, note: null, source: null, linked_expense_id: null, record_version: 1, cancelled_at: null },
  ],
  fixed_cost_treatments: [{ series_id: 's1', treatment: 'CASH_FLOW_ONLY' }],
  other_income: [{ id: 'i1', finance_month: '2026-08-01', income_type: 'Instalment', amount: 70, plate_key: 'XAA2002', business_unit: 'E-HAILING', status: 'CONFIRMED', cancelled_at: null } as any,
    { id: 'i2', finance_month: '2026-08-01', income_type: 'Instalment', amount: 999, plate_key: 'XAA2002', business_unit: 'E-HAILING', status: 'DRAFT', cancelled_at: null } as any],
};

test('the month’s cash flow counts cash only: claims and accrued insurance are left out, tax instalments are in', () => {
  const report = calculateFinance(input);
  const flow = monthCashFlow(input, report);
  assert.deepEqual(flow.in, { rent_cash: 900, smart_drive_net: 350, other_income: 70, total: 1320 });
  // Insurance is the premium paid this month (cover starts 15 Aug), not the monthly share the P&L uses.
  assert.deepEqual(flow.out, { monthly_vehicle: 500, workshop: 80, other_vehicle: 0, insurance: 1200, operation_fix: 40, cash_flow_only: 60, total: 1880 });
  assert.equal(flow.net, -560);
});

test('the 20% target shows the margin, the profit needed, the gap in RM and the idle cars', () => {
  const report = calculateFinance(input);
  // Revenue 1,000 + 500 + 70 = 1,570. Costs: claim 100, commission 150, recurring 500, workshop 80 and this month's insurance share.
  assert.equal(report.totals.revenue, 1570);
  const insurance = report.totals.insurance;
  assert.ok(insurance > 0 && insurance < 1200);
  const target = marginTarget(report, 0.2);
  const contribution = 1570 - 100 - 150 - 500 - 80 - insurance;
  assert.equal(target.profit, Math.round((contribution - 40) * 100) / 100); // the RM40 office rental; the tax instalment is not in the P&L
  assert.equal(target.target_profit, 314);
  assert.equal(target.gap, Math.max(0, Math.round((314 - target.profit) * 100) / 100));
  assert.equal(target.margin, target.profit / 1570);
  assert.equal(target.contribution_margin, report.totals.contribution / 1570);
  assert.deepEqual(target.idle, { count: 0, cost: 0, plates: [] });
  const idle = marginTarget(calculateFinance({ ...input, other_income: [] }), 0.2).idle;
  assert.deepEqual(idle, { count: 1, cost: 200, plates: ['XAA2002'] });
  assert.equal(marginTarget(calculateFinance({ ...input, ehailing: [], smart_rows: [], other_income: [] }), 0.2).margin, null);
});

const pay = (id: string, date: string, amount: number, serviceClaim = 0): PaymentTransaction => ({ id, date, amount, serviceClaim, paymentMethod: 'BANK TRANSFER' });
// Weekly rent of RM100 every Monday from 3 Aug 2026 (5 Mondays in August, 4 in September).
const DRIVER: Driver = {
  id: 'd1', nric: '', name: 'Fixture Driver Alpha', carPlate: 'XAA1001', contractStartDate: '2026-08-03', rentalCycle: 'WEEKLY',
  contractDuration: 52, rentalRate: 100, totalAmountPaid: 0, category: 'SEWABELI', tags: ['MON'],
  paymentHistory: [pay('a', '2026-08-03', 100), pay('b', '2026-08-20', 150, 50), pay('c', '2026-09-28', 100)],
};

test('driver profitability by month: rent billed, collected (cash and claims) and the balance owed at month end', () => {
  const ledger = driverMonthlyLedger(DRIVER, ['2026-08', '2026-09'], new Date('2026-10-06T12:00:00'));
  assert.deepEqual(ledger, [
    { month: '2026-08', billed: 500, collected: 300, balance: 200, rate: 0.6 },
    { month: '2026-09', billed: 400, collected: 100, balance: 500, rate: 0.25 },
  ]);
});

test('month collection adds every driver’s rent billed and money collected in that month, delisted drivers included', () => {
  const delisted: Driver = { ...DRIVER, id: 'd2', isDelisted: true, delistDate: '2026-08-12', paymentHistory: [pay('x', '2026-08-04', 100)] };
  assert.deepEqual(monthCollection([DRIVER, delisted], '2026-08', new Date('2026-10-06T12:00:00')), { billed: 700, collected: 400, rate: 400 / 700 });
});

test('in the current month only rent already due counts as billed or owed', () => {
  // 10 Sept: only the 7 Sept rent of September is due; the 28 Sept payment has not happened yet.
  const [september] = driverMonthlyLedger(DRIVER, ['2026-09'], new Date('2026-09-10T12:00:00'));
  assert.deepEqual(september, { month: '2026-09', billed: 100, collected: 0, balance: 300, rate: 0 });
});

test('the trend covers every month from August 2026 to the chosen month, oldest first', () => {
  assert.deepEqual(trendMonths('2026-08'), ['2026-08']);
  assert.deepEqual(trendMonths('2026-11'), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(trendMonths('2027-02').at(-1), '2027-02');
  assert.deepEqual(trendMonths('2026-07'), []);
  assert.equal(trendMonths('2028-12').length, 12); // at most the last 12 months
});

test('a trend row carries revenue, contribution, operating profit and margin for one month', () => {
  const report = calculateFinance(input);
  const row = trendRow('2026-08', 'DRAFT', report);
  assert.deepEqual({ ...row, margin: Math.round((row.margin ?? 0) * 1000) },
    { month: '2026-08', status: 'DRAFT', revenue: report.totals.revenue, contribution: report.totals.contribution, profit: report.management_profit, margin: Math.round(report.management_profit / report.totals.revenue * 1000) });
});

test('arrears by age: unpaid rent grouped by days past its due date', () => {
  // Weekly RM100 from Mon 3 Aug; RM400 collected (cash and claim) settles 3, 10, 17 and 24 Aug, oldest first.
  // On 10 Oct the unpaid weeks are 31 Aug (40 days), 7 Sep (33), 14 Sep (26), 21 Sep (19), 28 Sep (12) and 5 Oct (5).
  const ageing = arrearsAgeing([DRIVER], new Date('2026-10-10T12:00:00'));
  assert.deepEqual(ageing, [
    { label: '0–30 days', amount: 400, drivers: 1 },
    { label: '31–60 days', amount: 200, drivers: 1 },
    { label: '61–90 days', amount: 0, drivers: 0 },
    { label: 'Over 90 days', amount: 0, drivers: 0 },
  ]);
});
