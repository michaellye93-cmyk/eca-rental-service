import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateInsurance, calculateFinance, normalizePlate } from '../services/finance/calculations.ts';
import type { FinanceInput } from '../types/finance.ts';

const month = { finance_month: '2026-08', status: 'DRAFT' as const, revision: 1, refreshed_at: null, frozen_at: null,
  source_count: 0, total_cash: 0, total_claim: 0, earliest_date: null, latest_date: null };
const input = (overrides: Partial<FinanceInput> = {}): FinanceInput => ({
  month, vehicles: [{ plate_key: 'XAA1001', display_plate: 'XAA 1001', business_unit: 'E-HAILING', ownership_type: 'Owned', status: 'Active' }],
  recurring_costs: [], insurance: [], expenses: [], ehailing: [], smart_import: null, smart_rows: [], imports: [], bootstrap_completed: true, ...overrides,
});

test('normalizes plate keys by uppercasing and removing whitespace', () => {
  assert.equal(normalizePlate(' xaa  1001 '), 'XAA1001');
  assert.equal(normalizePlate(null), '');
});

test('owner-paid insurance has no ECA cost and an ECA-paid renewal uses its own premium and coverage',()=>{
 const owner={plate_key:'XAA1001',premium:1200,payment_date:null,coverage_start:'2026-01-01',coverage_end:'2026-12-31',responsibility:'OWNER_PAID' as const};
 const renewal={...owner,premium:1800,coverage_start:'2027-01-01',coverage_end:'2027-12-31',responsibility:'ECA_PAID' as const};
 assert.equal(allocateInsurance(owner,'2026-08'),0);assert.equal(allocateInsurance({...owner,responsibility:'ECA_PAID'},'2026-08'),100);
 assert.equal(calculateFinance(input({insurance:[owner,renewal]})).totals.insurance,0);
 assert.equal(calculateFinance(input({month:{...month,finance_month:'2027-08'},insurance:[owner,renewal]})).totals.insurance,150);
 assert.equal(owner.premium,1200);
});
test('flags changed bank matches and preserves unknown recurring classifications for review',()=>{
 const report=calculateFinance(input({recurring_costs:[{plate_key:'XAA1001',start_month:'2026-08-01',end_month:null,cost_type:'Owner Payout / Loan - To Classify',monthly_amount:100,payee:null,notes:null}],bank_rows:[{import_id:'bank1',source_row:1,transaction_date:'2026-08-01',description:'Loan',reference:null,debit:100,credit:0,decision:'MATCHED',payment_source:null,category:null,plate_key:'XAA1001',matched_kind:'recurring_cost',matched_id:'c1',review_note:'',match_valid:false}]}));
 assert.equal(report.totals.recurring,100);
 assert.ok(report.issues.some(x=>x.code==='BANK_MATCH_CHANGED' && x.severity==='error'));
 assert.ok(report.issues.some(x=>x.code==='UNCLASSIFIED_RECURRING_COST'));
});

test('calculates e-hailing revenue as cash plus claim while treating the claim as maintenance', () => {
  const report = calculateFinance(input({ ehailing: [{ source_payment_id: 'p1', driver_id: 'd1', driver_name_snapshot: null,
    car_plate_snapshot: 'XAA 1001', plate_key: 'xaa 1001', payment_date: '2026-08-03', cash_amount: 150, service_claim: 300,
    gross_rental_revenue: 450, payment_method: null, refreshed_at: '2026-08-31', finance_month: '2026-08', attribution_changed: false }] }));
  assert.deepEqual(report.totals, { cash: 150, revenue: 450, service_claim: 300, commission: 0, recurring: 0, workshop: 0,
    insurance: 0, direct_costs: 0, contribution: 150, margin: 1 / 3 });
  assert.equal(report.vehicles[0].service_claim, 300);
});

test('applies inclusive recurring month boundaries and leaves corporate opex out of vehicles', () => {
  const report = calculateFinance(input({ recurring_costs: [{ plate_key: 'XAA1001', start_month: '2026-08', end_month: '2026-08',
    cost_type: 'Loan', monthly_amount: 100, payee: null, notes: null }], expenses: [{ finance_month: '2026-08', billing_date: '2026-08-10',
    plate_key: null, category: 'Office Rental', payment_source: 'Corporate Opex', supplier: null, amount: 50, reference: null, description: null }] }));
  assert.equal(report.vehicles[0].recurring, 100);
  assert.equal(report.corporate_opex, 50);
  assert.equal(report.vehicles[0].contribution, -100);
  assert.equal(report.management_profit, -150);
});

test('allocates a full calendar-year premium evenly and balances to the premium', () => {
  const insurance = { plate_key: 'XAA1001', premium: 1440, payment_date: null, coverage_start: '2026-01-01', coverage_end: '2026-12-31' };
  const allocations = Array.from({ length: 12 }, (_, i) => allocateInsurance(insurance, `2026-${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(allocations, Array(12).fill(120));
  assert.equal(allocations.reduce((sum, value) => sum + value, 0), 1440);
});

test('accepts canonical database month dates while the UI supplies a year-month', () => {
  const policy = { plate_key: 'XAA1001', premium: 1440, payment_date: null, coverage_start: '2026-01-01', coverage_end: '2026-12-31' };
  const report = calculateFinance(input({ month: { ...month, finance_month: '2026-08-01' }, recurring_costs: [{ plate_key: 'XAA1001', start_month: '2026-08-01', end_month: '2026-08-01', cost_type: 'Zero-cost contract', monthly_amount: 0, payee: null, notes: null }], insurance: [policy] }));
  assert.equal(allocateInsurance(policy, '2026-08-01'), 120);
  assert.equal(report.vehicles[0].insurance, 120);
  assert.equal(report.vehicles[0].recurring, 0);
  assert.equal(report.issues.some((entry) => entry.code === 'MISSING_COST_MASTER'), false);
});

test('reports snapshot controls and editable historical attribution even on first ingestion', () => {
  const report = calculateFinance(input({ month: { ...month, source_count: 2, total_cash: 99, total_claim: 2 }, smart_import: null, ehailing: [{ source_payment_id: 'p1', driver_id: 'd1', driver_name_snapshot: '', car_plate_snapshot: 'XAA 1001', plate_key: 'XAA1001', payment_date: '2026-08-01', cash_amount: 100, service_claim: 2, gross_rental_revenue: 102, payment_method: null, refreshed_at: '', finance_month: '2026-08-01', attribution_changed: false }] }));
  assert.deepEqual(new Set(report.issues.map((entry) => entry.code)), new Set(['MISSING_DRIVER', 'HISTORICAL_ATTRIBUTION_POSSIBLE', 'MISSING_REFRESHED_AT', 'SOURCE_COUNT_MISMATCH', 'SOURCE_CASH_MISMATCH', 'MISSING_SMART_IMPORT', 'MISSING_COST_MASTER']));
});

test('uses coverage fractions for partial months and keeps the premium balanced', () => {
  const insurance = { plate_key: 'XAA1001', premium: 310, payment_date: null, coverage_start: '2026-01-16', coverage_end: '2026-02-14' };
  assert.equal(allocateInsurance(insurance, '2026-01'), 157.46);
  assert.equal(allocateInsurance(insurance, '2026-02'), 152.54);
  assert.equal(allocateInsurance(insurance, '2026-03'), 0);
});

test('retains unmatched revenue and reports duplicate and incomplete source data', () => {
  const report = calculateFinance(input({ ehailing: [
    { source_payment_id: 'dup', driver_id: null, driver_name_snapshot: null, car_plate_snapshot: null, plate_key: null, payment_date: '2026-08-01', cash_amount: 20, service_claim: 0, gross_rental_revenue: 20, payment_method: null, refreshed_at: '', finance_month: '2026-08', attribution_changed: true },
    { source_payment_id: 'dup', driver_id: 'd2', driver_name_snapshot: null, car_plate_snapshot: 'BAD 1', plate_key: 'BAD1', payment_date: '2026-08-02', cash_amount: 30, service_claim: 0, gross_rental_revenue: 30, payment_method: null, refreshed_at: '', finance_month: '2026-08', attribution_changed: false },
  ] }));
  const unmatched = report.vehicles.find((vehicle) => vehicle.plate_key === 'UNMATCHED')!;
  assert.equal(unmatched.revenue, 50);
  const codes = new Set(report.issues.map((issue) => issue.code));
  for (const code of ['DUPLICATE_SOURCE_ID', 'MISSING_DRIVER', 'MISSING_PLATE', 'HISTORICAL_ATTRIBUTION_CHANGED', 'HISTORICAL_ATTRIBUTION_POSSIBLE', 'UNMATCHED_PLATE']) assert.equal(codes.has(code), true);
});
