import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFinanceWorkbook } from '../services/finance/imports.ts';
import {
  parseExpenseRows,
  parseInsuranceRows,
  parseOtherIncomeRows,
  parseRecurringCostRows,
  parseVehicleRows,
  parseWorkshopRows,
  selectImportSheet,
  type SafeWorkbookSheet,
} from '../services/finance/safeImports.ts';
import { exportFinanceEditableWorkbook } from '../services/finance/exports.ts';

async function exportedSheet(kind: Parameters<typeof exportFinanceEditableWorkbook>[0], rows: Record<string, unknown>[]) {
  const buffer = await exportFinanceEditableWorkbook(kind, rows);
  const workbook = await readFinanceWorkbook(buffer);
  const destination = kind === 'vehicle_expenses' ? 'workshop' : kind;
  const selection = selectImportSheet(workbook.sheets, destination);
  assert.equal(selection.status, 'selected');
  return { buffer, sheet: selection.sheet as SafeWorkbookSheet };
}

test('round-trips vehicle, recurring obligation, and insurance identities through editable exports', async () => {
  const vehicle = await exportedSheet('vehicle_master', [{
    vehicle_id: 'vehicle-1', display_plate: 'XAA 1001', business_unit: 'E-HAILING', ownership_type: 'Owned', status: 'Active', model: 'Bezza',
  }]);
  assert.equal(parseVehicleRows(vehicle.sheet).rows[0].vehicle_id, 'vehicle-1');

  const recurring = await exportedSheet('vehicle_monthly_costs', [{
    id: 'cost-version-1', obligation_id: 'obligation-1', plate_key: 'XAA1001', cost_type: 'Owner Payout', monthly_amount: 750,
    start_month: '2026-08-01', end_month: null, payee: 'Owner', notes: null,
  }]);
  const parsedRecurring = parseRecurringCostRows(recurring.sheet, 'vehicle_monthly_costs');
  assert.equal(parsedRecurring.rows[0].obligation_id, 'obligation-1');

  const insurance = await exportedSheet('insurance', [{
    id: 'insurance-1', plate_key: 'XAA1001', premium: 1440, responsibility: 'ECA_PAID', coverage_start: '2026-01-01', coverage_end: '2026-12-31',
  }]);
  assert.equal(parseInsuranceRows(insurance.sheet).rows[0].id, 'insurance-1');
});

test('round-trips fixed cost, company expense, and Other Income record identities', async () => {
  const fixed = await exportedSheet('fixed_cost', [{
    id: 'fixed-1', category: 'Office rent', monthly_amount: 1500, effective_from: '2026-08-01', effective_until: null, payee: 'Landlord', note: 'HQ',
  }]);
  assert.equal(parseRecurringCostRows(fixed.sheet, 'fixed_cost').rows[0].id, 'fixed-1');

  const expense = await exportedSheet('company_expenses', [{
    id: 'expense-1', frequency: 'ONE_OFF', billing_date: '2026-08-18', category: 'Filing fee', amount: 50, supplier: 'SSM', reference: 'R-1', notes: null,
  }]);
  assert.equal(parseExpenseRows(expense.sheet, { expectedMonth: '2026-08' }).rows[0].id, 'expense-1');

  const income = await exportedSheet('other_income', [{
    id: 'income-1', finance_month: '2026-08-01', income_type: 'Rebate', amount: 25, plate_key: 'XAA1001', business_unit: 'E-HAILING', receipt_date: '2026-08-20', reference: 'I-1', notes: null,
  }]);
  assert.equal(parseOtherIncomeRows(income.sheet, { expectedMonth: '2026-08' }).rows[0].id, 'income-1');
});

test('exports workshop and vehicle-direct month totals as MONTHLY_SUMMARY without fabricating billing dates', async () => {
  for (const kind of ['workshop', 'vehicle_expenses'] as const) {
    const exported = await exportedSheet(kind, [{
      id: `${kind}-1`, finance_month: '2026-08-01', billing_date: null, plate_key: 'XAA1001', category: 'Service & Maintenance', amount: 300,
      supplier: 'Workshop A', reference: `${kind}-ref`, description: 'August total',
    }]);
    const parsed = parseWorkshopRows(exported.sheet, { expectedMonth: '2026-08' });
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.rows[0].id, `${kind}-1`);
    assert.equal(parsed.rows[0].frequency, 'MONTHLY_SUMMARY');
    assert.equal(parsed.rows[0].expense_date, null);
    assert.equal(parsed.rows[0].start_month, '2026-08-01');
    assert.equal(parsed.rows[0].end_month, '2026-08-01');
  }
});

test('locks identity cells while leaving exported finance fields editable', async () => {
  const { buffer } = await exportedSheet('vehicle_master', [{
    vehicle_id: 'vehicle-1', display_plate: 'XAA 1001', business_unit: 'E-HAILING', ownership_type: 'Owned', status: 'Active', model: null,
  }]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('Vehicle Master');
  assert.ok(worksheet);
  assert.equal(worksheet.sheetProtection?.sheet, true);
  assert.equal(worksheet.getCell('A2').protection?.locked ?? true, true);
  assert.equal(worksheet.getCell('B2').protection?.locked, false);
});
