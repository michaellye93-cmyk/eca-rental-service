import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { previewBootstrap, previewSmartDrive, previewWorkshop, readFinanceWorkbook } from '../services/finance/imports.ts';
import type { FinanceVehicle } from '../types/finance.ts';

const vehicles: FinanceVehicle[] = [{ plate_key: 'XAA1001', display_plate: 'XAA 1001', business_unit: 'DAILY RENTAL', ownership_type: 'Owned', status: 'Active' }];
async function workbook(sheets: Array<{ name: string; headers: string[]; rows: unknown[][] }>) {
  const book = new ExcelJS.Workbook();
  for (const sheet of sheets) { const ws = book.addWorksheet(sheet.name); ws.addRow(sheet.headers); sheet.rows.forEach((row) => ws.addRow(row)); }
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

test('reads explicit sheets and strips customer identity fields from generic inspection', async () => {
  const buffer = await workbook([{ name: 'Sales Report', headers: ['Customer Name', 'Car Plate', 'Revenue'], rows: [['Private Person', 'XAA 1001', 100]] }]);
  const result = await readFinanceWorkbook(buffer);
  assert.deepEqual(result.sheets[0].headers, ['Car Plate', 'Revenue']);
  assert.deepEqual(result.sheets[0].rows[0], { source_row: 2, sheet_name: 'Sales Report', values: { 'Car Plate': 'XAA 1001', Revenue: 100 } });
});

test('previews Smart Drive report with finance fields, vehicle matching, and a confirmed report month', async () => {
  const buffer = await workbook([{ name: 'Sales Report', headers: ['Car Plate', 'Start Date', 'End Date', 'Revenue', 'Commission Paid', 'Transaction Status/Date'], rows: [['XAA 1001', '30/08/2026', '31/08/2026', 100, 30, '2026-08-31']] }]);
  const preview = await previewSmartDrive(buffer, 'august.xlsx', '2026-08', vehicles);
  assert.equal(preview.total_rows, 1); assert.equal(preview.matched_vehicles, 1); assert.equal(preview.gross_revenue, 100); assert.equal(preview.commission, 30);
  assert.deepEqual(preview.rows[0], { source_row: 2, sheet_name: 'Sales Report', reference: null, plate_key: 'XAA1001', display_plate: 'XAA 1001', pickup_date: '2026-08-30', return_date: '2026-08-31', gross_revenue: 100, commission: 30, status: '2026-08-31', payment_status: null });
});

test('retains Smart Drive invalid and unmatched rows as blocking issues instead of dropping them', async () => {
  const buffer = await workbook([{ name: 'Sales Report', headers: ['Car Plate', 'Start Date', 'End Date', 'Revenue', 'Commission Paid'], rows: [['BAD 1', '2026-09-01', '', '', 20]] }]);
  const preview = await previewSmartDrive(buffer, 'wrong-month.xlsx', '2026-08', vehicles);
  assert.equal(preview.rows.length, 1); assert.equal(preview.unmatched_vehicles, 1);
  assert.deepEqual(new Set(preview.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code)), new Set(['MISSING_REQUIRED_HEADER', 'MISSING_STATUS', 'MISSING_RETURN_DATE', 'MISSING_GROSS_REVENUE', 'UNMATCHED_PLATE']));
});

test('recalculates Smart Drive row and distinct vehicle matches on every parse of the same workbook', async () => {
  const buffer = await workbook([{name:'Sales',headers:['Car Plate','Start Date','End Date','Revenue','Commission Paid','Status'],rows:['xaa 1001','XAA1001','new 123','NEW123',''].map(plate=>[plate,'2026-08-01','2026-08-02',100,10,'Completed'])}]);
  const counts = (preview: Awaited<ReturnType<typeof previewSmartDrive>>) => [preview.matched_rows,preview.unmatched_rows,preview.matched_vehicles,preview.unmatched_vehicles];
  const before = await previewSmartDrive(buffer,'same.xlsx','2026-08',vehicles);
  assert.deepEqual(counts(before),[2,3,1,1]);
  const after = await previewSmartDrive(buffer,'same.xlsx','2026-08',[...vehicles,{...vehicles[0],plate_key:'NEW123',display_plate:'NEW 123'}]);
  assert.deepEqual(counts(after),[4,1,2,0]);
  assert.equal(after.issues.filter(issue=>issue.code==='UNMATCHED_PLATE').length,0);
  assert.equal(after.issues.filter(issue=>issue.code==='MISSING_PLATE').length,1);
  assert.deepEqual(after.rows,before.rows);
  assert.equal(after.gross_revenue,before.gross_revenue);
  assert.equal(after.commission,before.commission);
  const edited = await previewSmartDrive(buffer,'same.xlsx','2026-08',[{...vehicles[0],plate_key:'RENAMED123',display_plate:'RENAMED123'}]);
  assert.deepEqual(counts(edited),[0,5,0,2]);
});

test('rejects missing headers, status, invalid dates and inconsistent money without dropping rows', async () => {
  const buffer = await workbook([{ name: 'Sales Report', headers: ['Car Plate', 'Start Date', 'End Date', 'Revenue', 'Commission Paid', 'Transaction Status/Date'], rows: [['XAA 1001', '31/02/2026', '01/02/2026', -1, 2, '']] }]);
  const preview = await previewSmartDrive(buffer, 'bad.xlsx', '2026-08', vehicles);
  assert.equal(preview.rows.length, 1);
  assert.deepEqual(new Set(preview.issues.map((entry) => entry.code)), new Set(['MISSING_PICKUP_DATE', 'NEGATIVE_GROSS_REVENUE', 'COMMISSION_EXCEEDS_GROSS', 'MISSING_STATUS']));
});

test('keeps source audit fields and canonical database months in bootstrap and workshop previews', async () => {
  const buffer = await workbook([
    { name: 'Vehicle Master', headers: ['Car Plate', 'Business Unit', 'Ownership Type', 'Status'], rows: [['XAA 1001', 'E-HAILING', 'Owned', 'Active']] },
    { name: 'Vehicle Monthly Costs', headers: ['Car Plate', 'Start Month', 'End Month', 'Cost Type', 'Monthly Amount', 'Payee', 'Notes'], rows: [['XAA 1001', '2026-08', '', 'Loan', 0, 'Lender Name', '']] },
    { name: 'Vehicle Insurance', headers: ['Car Plate', 'Premium', 'Payment Date', 'Coverage Start', 'Coverage End'], rows: [['XAA 1001', 1440, '2026-01-01', '2026-01-01', '2026-12-31']] },
  ]);
  const bootstrap = await previewBootstrap(buffer, 'bootstrap.xlsx', '2026-08');
  assert.equal(bootstrap.data.recurring_costs[0].start_month, '2026-08-01');
  assert.equal((bootstrap.data.recurring_costs[0] as any).source_row, 2);
  assert.equal((bootstrap.data.insurance[0] as any).sheet_name, 'Vehicle Insurance');
  const workshop = await previewWorkshop(await workbook([{ name: 'Workshop', headers: ['Billing Date', 'Car Plate', 'Supplier Name', 'Amount'], rows: [['2026-08-15', 'XAA 1001', 'Vendor', 20]] }]), 'workshop.xlsx', '2026-08', vehicles);
  assert.equal(workshop.rows[0].finance_month, '2026-08-01'); assert.equal(workshop.rows[0].category, 'Service & Maintenance'); assert.equal((workshop.rows[0] as any).source_row, 2);
});

test('keeps every row in a report larger than the usual API page size and flags duplicate references', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => [`B${index === 1000 ? 0 : index}`, 'XAA 1001', '2026-08-01', '2026-08-02', 10, 3]);
  const buffer = await workbook([{ name: 'Sales Report', headers: ['Booking Reference', 'Car Plate', 'Start Date', 'End Date', 'Revenue', 'Commission Paid'], rows }]);
  const preview = await previewSmartDrive(buffer, 'large.xlsx', '2026-08', vehicles);
  assert.equal(preview.total_rows, 1001); assert.equal(preview.gross_revenue, 10010); assert.equal(preview.commission, 3003);
  assert.equal(preview.issues.filter((entry) => entry.code === 'DUPLICATE_SOURCE_REFERENCE').length, 1);
});

test('imports bootstrap master, recurring cost, and insurance sheets', async () => {
  const buffer = await workbook([
    { name: 'Vehicle Master', headers: ['Car Plate', 'Business Unit', 'Ownership Type', 'Status'], rows: [['XAA 1001', 'E-HAILING', 'Owned', 'Active']] },
    { name: 'Monthly Costs', headers: ['Car Plate', 'Start Month', 'End Month', 'Cost Type', 'Monthly Amount', 'Payee', 'Notes'], rows: [['XAA 1001', '2026-08', '', 'Loan', 100, 'Bank', '']] },
    { name: 'Insurance', headers: ['Car Plate', 'Premium', 'Payment Date', 'Coverage Start', 'Coverage End', 'RESPONSIBILITY'], rows: [['XAA 1001', 1440, '2026-01-01', '2026-01-01', '2026-12-31', 'ECA PAID']] },
  ]);
  const result = await previewBootstrap(buffer, 'bootstrap.xlsx', '2026-08');
  assert.equal(result.data.vehicles.length, 1); assert.equal(result.data.recurring_costs[0].monthly_amount, 100); assert.equal(result.data.insurance[0].premium, 1440); assert.equal(result.issues.length, 0);
});

test('keeps unclassified recurring source labels and warns without moving their start month', async () => {
  const buffer = await workbook([
    { name: 'Vehicle Master', headers: ['Car Plate', 'Business Unit', 'Ownership Type', 'Status'], rows: [['XAA 1001', 'E-HAILING', 'Owned', 'Active']] },
    { name: 'Vehicle Monthly Costs', headers: ['Car Plate', 'Start Month', 'Cost Type', 'Monthly Amount'], rows: [['XAA 1001', '2026-09-01', 'Owner Payout / Loan - To Classify', 100]] },
    { name: 'Vehicle Insurance', headers: ['Car Plate', 'Premium', 'Coverage Start', 'Coverage End'], rows: [] },
  ]);
  const result = await previewBootstrap(buffer, 'template.xlsx', '2026-08');
  assert.equal(result.data.recurring_costs[0].start_month, '2026-09-01');
  assert.equal(result.data.recurring_costs[0].cost_type, 'Owner Payout / Loan - To Classify');
  assert.equal(result.issues.some((entry) => entry.code === 'UNCLASSIFIED_RECURRING_COST'), true);
});

test('parses workshop rows without customer fields and requires finance month, amount, and plate', async () => {
  const buffer = await workbook([{ name: 'Workshop', headers: ['Billing Date', 'Car Plate', 'Supplier', 'Amount', 'Reference', 'Description'], rows: [['15/08/2026', 'XAA 1001', 'Workshop A', 80, 'W1', 'Oil']] }]);
  const preview = await previewWorkshop(buffer, 'workshop.xlsx', '2026-08', vehicles);
  assert.equal(preview.rows.length, 1); assert.equal(preview.gross_revenue, 0); assert.equal(preview.rows[0].amount, 80);
});
