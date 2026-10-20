import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportHpScheduleWorkbook, hpScheduleFileName } from '../services/finance/hpScheduleExport.ts';
import type { VehicleLoan } from '../services/finance/loans.ts';

// Fixture cars and made-up amounts only.
const LOAN: VehicleLoan = {
  id: 'loan-1', plate_key: 'XAA1001', display_plate: 'XAA 1001', bank: 'Fixture Bank', finance_amount: 30000,
  flat_rate_percent: 3, tenure_months: 60, first_payment_date: '2024-01-15', downpayment: 3000, monthly_instalment: 575,
  status: 'ACTIVE', closed_on: null, notes: null,
};
const HEADERS = ['Year', 'Ins. No', 'Sum of Digit', 'Instalment', 'Interest', 'Principal', 'Total Instalment', 'Total Interest', 'Total Principal', 'Bal Due'];

async function sheetOf(loan: VehicleLoan, model?: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportHpScheduleWorkbook(loan, model));
  assert.equal(workbook.worksheets.length, 1);
  return workbook.worksheets[0];
}
const valuesOf = (sheet: ExcelJS.Worksheet, row: number) => HEADERS.map((_, i) => sheet.getRow(row).getCell(i + 1).value);

test('the HP schedule workbook is one sheet named after the plate, with the loan header block then the table', async () => {
  assert.equal(hpScheduleFileName('XAA 1001'), 'HP schedule XAA 1001.xlsx');
  const sheet = await sheetOf(LOAN, 'Fixture Bezza 1.3');
  assert.equal(sheet.name, 'XAA 1001');
  const header = Array.from({ length: 12 }, (_, i) => [sheet.getCell(i + 1, 1).value, sheet.getCell(i + 1, 2).value, sheet.getCell(i + 1, 3).value]);
  assert.deepEqual(header.map(([label]) => label), [
    'Plate', 'Model', 'Loan provider', 'Cost', 'Less downpayment', 'HP financing', 'Interest @ 3.00% flat', 'Total',
    'First payment date', 'Number of instalments', 'Monthly instalment × 59 months', 'Final instalment × 1 month',
  ]);
  assert.deepEqual(header.map(([, value]) => value), [
    'XAA 1001', 'Fixture Bezza 1.3', 'Fixture Bank', 33000, 3000, 30000, 4500, 34500, '15.01.2024', 60, 575, 575,
  ]);
  assert.equal(header[10][2], 575 * 59, 'the monthly instalments add up beside them');
  assert.equal(sheet.getRow(13).cellCount, 0, 'a blank row before the table');
  assert.deepEqual(valuesOf(sheet, 14), HEADERS);
  assert.deepEqual(valuesOf(sheet, 15), [null, 1, 60, 575, 147.54, 427.46, null, null, null, null]);
  const yearEnd = valuesOf(sheet, 17);
  assert.equal(yearEnd[0], '31.03.2024');
  assert.equal(yearEnd[6], 1725);
  assert.equal(sheet.getCell(17, 1).font?.bold, true, 'year-end rows are bold');
  const last = valuesOf(sheet, 74);
  assert.deepEqual(last.slice(0, 4), ['15.12.2028', 60, 1, 575]);
  assert.equal(last[9], 0, 'nothing due after the last instalment');
  assert.equal(sheet.rowCount, 74);
});

test('without a known model the header block skips the Model line; a rounded loan shows its own final instalment', async () => {
  const sheet = await sheetOf({ ...LOAN, finance_amount: 38000, monthly_instalment: 729 });
  const labels = Array.from({ length: 11 }, (_, i) => sheet.getCell(i + 1, 1).value);
  assert.ok(!labels.includes('Model'));
  assert.equal(labels[9], 'Monthly instalment × 59 months');
  assert.equal(labels[10], 'Final instalment × 1 month');
  assert.equal(sheet.getCell(11, 2).value, 43700 - 59 * 729);
  assert.deepEqual(valuesOf(sheet, 13), HEADERS);
});
