import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeImportHeader,
  parseExpenseRows,
  parseImportDate,
  parseImportMoney,
  parseImportMonth,
  parseInsuranceRows,
  parseOtherIncomeRows,
  parseRecurringCostRows,
  parseVehicleRows,
  parseWorkshopRows,
  requiredHeaderIssues,
  selectImportSheet,
  unwrapFormulaValue,
  type SafeWorkbookSheet,
} from '../services/finance/safeImports.ts';

const sheet = (name: string, headers: string[], rows: unknown[][] = []): SafeWorkbookSheet => ({
  name,
  headers,
  rows: rows.map((cells, index) => ({
    source_row: index + 2,
    sheet_name: name,
    values: Object.fromEntries(headers.map((header, column) => [header, cells[column]])),
  })),
});

test('selects only accepted exact worksheet names and requires an explicit choice when accepted sheets are ambiguous', () => {
  const sheets = [
    sheet('Vehicle Master', ['Car Plate']),
    sheet('Vehicle Other Costs', ['Car Plate']),
    sheet('Vehicle Monthly Costs', ['Car Plate']),
  ];
  const selected = selectImportSheet(sheets, 'vehicle_monthly_costs');
  assert.equal(selected.status, 'selected');
  assert.equal(selected.sheet?.name, 'Vehicle Monthly Costs');

  const expenses = [sheet('Company Expenses', []), sheet('Shared Opex', [])];
  const ambiguous = selectImportSheet(expenses, 'company_expenses');
  assert.equal(ambiguous.status, 'ambiguous');
  assert.deepEqual(ambiguous.candidates, ['Company Expenses', 'Shared Opex']);
  assert.equal(ambiguous.issue?.code, 'AMBIGUOUS_WORKSHEET');

  const explicit = selectImportSheet(expenses, 'company_expenses', 'Shared Opex');
  assert.equal(explicit.status, 'selected');
  assert.equal(explicit.sheet?.name, 'Shared Opex');

  const broadOnly = selectImportSheet([sheet('Vehicle Cost Scratchpad', [])], 'workshop');
  assert.equal(broadOnly.status, 'missing');
  assert.equal(broadOnly.sheet, null);
});

test('normalizes header case and spacing while reporting required headers once at workbook scope', () => {
  assert.equal(normalizeImportHeader('  Monthly Amount (RM)  '), 'monthlyamountrm');
  assert.deepEqual(requiredHeaderIssues([' car plate ', 'PREMIUM (RM)', 'Responsibility'], 'insurance'), []);

  const issues = requiredHeaderIssues(['Car Plate', 'Business Unit', 'Ownership Type'], 'vehicle_master');
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0], {
    code: 'MISSING_REQUIRED_HEADER',
    severity: 'error',
    scope: 'workbook',
    detail: 'Workbook is missing required Status column',
    field: 'status',
  });

  assert.deepEqual(requiredHeaderIssues(['Expense Name', 'Amount (RM)', 'Start Month'], 'fixed_cost'), []);
});

test('unwraps cached formula results and parses money without converting blanks to zero', () => {
  assert.equal(unwrapFormulaValue({ formula: '1-1', result: 0 }), 0);
  assert.equal(parseImportMoney({ formula: '1-1', result: 0 }), 0);
  assert.equal(parseImportMoney(' RM 1,234.50 '), 1234.5);
  assert.equal(parseImportMoney('RM1,234.50'), 1234.5);
  assert.equal(parseImportMoney('(RM 25.10)'), -25.1);
  assert.equal(parseImportMoney(''), null);
  assert.equal(parseImportMoney({ formula: 'A1', result: '' }), null);
  assert.equal(parseImportMoney('12.345'), null);
});

test('parses approved dates and canonical months including Aug-2026 without fabricating missing values', () => {
  assert.equal(parseImportDate('15/08/2026'), '2026-08-15');
  assert.equal(parseImportDate({ formula: 'DATE(2026,8,16)', result: new Date('2026-08-16T00:00:00Z') }), '2026-08-16');
  assert.equal(parseImportDate(''), null);
  assert.equal(parseImportDate('31/02/2026'), null);
  assert.equal(parseImportMonth('Aug-2026'), '2026-08-01');
  assert.equal(parseImportMonth('August 2026'), '2026-08-01');
  assert.equal(parseImportMonth('2026-08'), '2026-08-01');
  assert.equal(parseImportMonth(''), null);
});

test('parses Other Income rows, preserves explicit zero, validates the selected period, and excludes unrelated private fields', () => {
  const source = sheet('Other Income', [
    'Record ID', 'Finance Month', 'Income Type', 'Amount (RM)', 'Car Plate', 'Business Unit',
    'Receipt Date', 'Reference', 'Notes', 'Customer Name',
  ], [
    ['income-1', 'Aug-2026', 'Rebate', { formula: '1-1', result: 0 }, 'XAA 1001', '', '', 'R-1', 'Approved', 'Private Person'],
    ['', '2026-09', 'Grant', 50, '', 'E-HAILING', '2026-09-02', '', '', 'Another Person'],
  ]);
  const parsed = parseOtherIncomeRows(source, { expectedMonth: '2026-08' });

  assert.equal(parsed.rows[0].amount, 0);
  assert.equal(parsed.rows[0].id, 'income-1');
  assert.equal(parsed.rows[0].finance_month, '2026-08-01');
  assert.equal(parsed.rows[0].plate_key, 'XAA1001');
  assert.equal(parsed.rows[0].receipt_date, null);
  assert.equal('Customer Name' in parsed.rows[0], false);
  assert.equal(parsed.issues.filter((issue) => issue.code === 'MONTH_MISMATCH').length, 1);
  assert.equal(parsed.issues.some((issue) => issue.source_row === 2), false);
});

test('parses vehicle and fixed recurring costs with canonical months and distinguishes blank from zero amounts', () => {
  const vehicle = sheet('Vehicle Monthly Costs', [
    'Obligation ID', 'Car Plate', 'Cost Type', 'Monthly Amount (RM)', 'Start Month', 'End Month', 'Payee / Lender', 'Notes',
  ], [
    ['obligation-1', 'XAA 1001', 'Owner Payout', 0, 'Aug-2026', '', 'Owner', ''],
    ['', 'XAA 1002', 'Loan', '', '2026-08', '', 'Bank', 'Missing amount'],
  ]);
  const parsedVehicle = parseRecurringCostRows(vehicle, 'vehicle_monthly_costs');
  assert.equal(parsedVehicle.rows[0].obligation_id, 'obligation-1');
  assert.equal(parsedVehicle.rows[0].monthly_amount, 0);
  assert.equal(parsedVehicle.rows[0].start_month, '2026-08-01');
  assert.equal(parsedVehicle.rows[0].end_month, null);
  assert.equal(parsedVehicle.issues.filter((issue) => issue.code === 'INVALID_AMOUNT').length, 1);

  const fixed = sheet('Fixed Operating Costs', ['Record ID', 'Expense Name', 'Amount (RM)', 'Start Month', 'End Month', 'Payee', 'Note'], [
    ['fixed-1', 'Office rent', 'RM 1,500', 'Aug-2026', '2026-12', 'Landlord', 'HQ'],
  ]);
  const parsedFixed = parseRecurringCostRows(fixed, 'fixed_cost');
  assert.equal(parsedFixed.rows[0].id, 'fixed-1');
  assert.equal(parsedFixed.rows[0].category, 'Office rent');
  assert.equal(parsedFixed.rows[0].monthly_amount, 1500);
  assert.equal(parsedFixed.rows[0].end_month, '2026-12-01');
});

test('parses one-off and recurring company expenses without requiring a fabricated date for recurring rows', () => {
  const source = sheet('Company Expenses', [
    'Record ID', 'Frequency', 'Start Month', 'End Month', 'Expense Date', 'Category', 'Amount (RM)', 'Payee', 'Notes',
  ], [
    ['expense-1', 'Monthly', 'Aug-2026', '', '', 'Accounting', 400, 'Firm', ''],
    ['expense-2', 'One-off', '', '', '18/08/2026', 'Filing fee', 0, 'SSM', ''],
    ['expense-3', 'One-off', '', '', '', 'Missing date', 25, '', ''],
    ['expense-4', 'MONTHLY_SUMMARY', '2026-08', '2026-08', '', 'Workshop total', 300, '', ''],
  ]);
  const parsed = parseExpenseRows(source, { expectedMonth: '2026-08' });

  assert.equal(parsed.rows[0].expense_date, null);
  assert.equal(parsed.rows[0].id, 'expense-1');
  assert.equal(parsed.rows[0].start_month, '2026-08-01');
  assert.equal(parsed.rows[1].amount, 0);
  assert.equal(parsed.rows[1].expense_date, '2026-08-18');
  assert.equal(parsed.rows[3].frequency, 'MONTHLY_SUMMARY');
  assert.equal(parsed.rows[3].expense_date, null);
  assert.equal(parsed.issues.filter((issue) => issue.code === 'MISSING_EXPENSE_DATE').length, 1);
});

test('preserves optional vehicle and insurance identities without making legacy IDs required', () => {
  const vehicles = parseVehicleRows(sheet('Vehicle Master', [
    'Vehicle ID', 'Car Plate', 'Business Unit', 'Ownership Type', 'Status', 'Vehicle Model',
  ], [['vehicle-1', 'XAA 1001', 'E-HAILING', 'Owned', 'Active', 'Perodua Bezza']]));
  assert.equal(vehicles.rows[0].vehicle_id, 'vehicle-1');
  assert.equal(vehicles.rows[0].model, 'Perodua Bezza');

  const insurance = parseInsuranceRows(sheet('Insurance', [
    'Record ID', 'Car Plate', 'Premium (RM)', 'RESPONSIBILITY', 'Coverage Start', 'Coverage End',
  ], [['insurance-1', 'XAA 1001', 1440, 'ECA_PAID', '2026-01-01', '2026-12-31']]));
  assert.equal(insurance.rows[0].id, 'insurance-1');
  assert.equal(insurance.rows[0].premium, 1440);
  assert.deepEqual(insurance.issues, []);

  assert.deepEqual(requiredHeaderIssues(['Car Plate', 'Business Unit', 'Ownership Type', 'Status'], 'vehicle_master'), []);
});

test('parses workshop legacy amount/date aliases and returns only finance fields', () => {
  const source = sheet('Workshop', [
    'Record ID', 'Frequency', 'Start Month', 'End Month', 'Car Plate', 'Cost Date', 'Cash Amount (RM)', 'Workshop', 'Invoice No', 'Description', 'Customer Name',
  ], [
    ['workshop-1', 'ONE_OFF', '', '', 'XAA 1001', '20/08/2026', 'RM 80.00', 'Workshop A', 'W-1', 'Oil service', 'Private Person'],
  ]);
  const parsed = parseWorkshopRows(source, { expectedMonth: '2026-08', impliedCategory: 'Service & Maintenance' });

  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows[0], {
    source_row: 2,
    sheet_name: 'Workshop',
    id: 'workshop-1',
    frequency: 'ONE_OFF',
    start_month: null,
    end_month: null,
    plate_key: 'XAA1001',
    expense_date: '2026-08-20',
    amount: 80,
    category: 'Service & Maintenance',
    supplier: 'Workshop A',
    reference: 'W-1',
    description: 'Oil service',
  });
});
