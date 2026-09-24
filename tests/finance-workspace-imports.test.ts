import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { previewSectionWorkbook } from '../services/finance/workspace.ts';
import type { FinanceInput } from '../types/finance.ts';

async function sheet(headers: string[], rows: unknown[][]) { const book = new ExcelJS.Workbook(); const ws = book.addWorksheet('Other Vehicle Costs'); ws.addRow(headers); rows.forEach(row => ws.addRow(row)); return (await book.xlsx.writeBuffer()) as ArrayBuffer; }
const input = { month: { finance_month: '2026-08-01', status: 'DRAFT', revision: 0, refreshed_at: null, frozen_at: null, source_count: 0, total_cash: 0, total_claim: 0, earliest_date: null, latest_date: null }, vehicles: [{ plate_key: 'ABC123', display_plate: 'ABC 123', business_unit: 'E-HAILING', ownership_type: 'Owned', status: 'Active' }], recurring_costs: [], insurance: [], expenses: [], ehailing: [], smart_import: null, smart_rows: [], imports: [], bootstrap_completed: false } satisfies FinanceInput;
test('section parser preserves source audit, accepts normal cents, and flags invalid values without dropping rows', async () => {
 const preview = await previewSectionWorkbook(await sheet(['Date', 'Car Plate', 'Category', 'Amount'], [['2026-08-01', 'ABC 123', 'Tyres', 19.99], ['not a date', 'MISSING', 'Tyres', 10.001]]), 'costs.xlsx', 'vehicle_expense', '2026-08', input);
 assert.equal(preview.rows.length, 2); assert.equal(preview.rows[0].amount, 19.99); assert.deepEqual(preview.rows[0].source_row, 2); assert.ok(preview.issues.some(x => x.code === 'INVALID_EXPENSE_DATE' && x.detail.includes('Row 3'))); assert.ok(preview.issues.some(x => x.code === 'INVALID_AMOUNT' && x.detail.includes('Row 3')));
});
