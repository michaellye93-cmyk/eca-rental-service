import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { previewBankStatement } from '../services/finance/bankStatements.ts';
import { suggestPaymentMatches } from '../services/finance/bankMatchSuggestions.ts';
import type { FinanceInput } from '../types/finance.ts';

const input = { month: { finance_month: '2026-08-01', status: 'DRAFT', revision: 1, refreshed_at: 'x', frozen_at: null, source_count: 0, total_cash: 0, total_claim: 0, earliest_date: null, latest_date: null },
  vehicles: [], recurring_costs: [], insurance: [], expenses: [], ehailing: [], smart_import: null, smart_rows: [], imports: [], bootstrap_completed: true } as unknown as FinanceInput;
const d = (day: number) => new Date(Date.UTC(2026, 7, day));

/**
 * The shape of an RHB "Transaction Statement" PDF converted to Excel: one sheet per page, a summary block on page one,
 * repeated column headings, long cells wrapped onto the next row, "-" for an empty amount and a signed running balance.
 * Columns shift between pages.
 */
async function rhbWorkbook(options: { deposits?: string } = {}) {
  const workbook = new ExcelJS.Workbook();
  const page1 = workbook.addWorksheet('Table 1');
  page1.addRow(['FIXTURE COMPANY SDN BHD\nNO 1 FIXTURE ROAD', '', '', '', '', '', 'Statement Period', '', '', '', '', 'TRANSACTION STATEMENT']);
  page1.addRow(['01 August 2026      To      31 August 2026']);
  page1.addRow(['11112222339999']);
  page1.addRow(['Deposit Account Summary\nBeginning Balance as of 01 August 2026', '', '', '', '', '', '', '1,000.00+']);
  page1.addRow(['3\n2', '', '', 'Deposits (Plus) Withdraws (Minus)', '', '', options.deposits ?? '950.00\n120.50']);
  page1.addRow(['Ending Balance as of 31 August 2026', '', '', '', '', '', '', '1,829.50+']);
  page1.addRow(['Date            Branch Description']);
  page1.addRow(['', '', '', '', 'Name', 'Reference', '', '', 'Details']);
  page1.addRow([d(1), 980, 'RPP INWARD INST TRF', '', 'FIXTURE DRIVER ALPHA', '/ XAA1001', '', '', '/', 1001, '-', '', 400, '1,400.00+']);
  page1.addRow([d(2), 980, 'RFLX INSTANT TRF DR', '', 'FIXTURE OWNER', '10000000001\n0/ XAA1001 LOAN', '', '', '/', 1002, 120.5, '', '-', '1,279.50+']);
  const page2 = workbook.addWorksheet('Table 2');
  page2.addRow(['Date', 'Branch Description', '', "Sender's\n/ Beneficiary's Name", 'Reference 1', 'Reference 2', '', 'Amount (DR)', 'Amount (CR)', 'Balance']);
  page2.addRow([d(3), 980, 'RPP', 'FIXTURE', '/ Sewa', '/ 200', 1003, '-', 200, '1,479.50+']);
  page2.addRow(['', '', 'INWARD INST TRF', 'DRIVER BETA', '', '', '', '', '', '']);
  page2.addRow(['', '', '', '', '', d(16), '', '', '', '']);
  page2.addRow([d(4), 889, 'CDT CASH DEPOSIT', '', '/', '/', 1004, '-', 350, '1,829.50+']);
  page2.addRow(['', '', '', '', '', '', '', '', '', '']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const arrayBuffer = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

test('an RHB statement converted from PDF is read across all pages, joining wrapped lines', async () => {
  const preview = await previewBankStatement(arrayBuffer(await rhbWorkbook()), 'AUG.xlsx', '2026-08', input);
  assert.deepEqual(preview.issues.filter((issue) => issue.severity === 'error'), []);
  assert.equal(preview.rows.length, 4);
  assert.deepEqual(preview.rows.map((row) => [row.transaction_date, row.debit, row.credit]), [
    ['2026-08-01', 0, 400], ['2026-08-02', 120.5, 0], ['2026-08-03', 0, 200], ['2026-08-04', 0, 350],
  ]);
  // The wrapped name is joined back together; the bank's own transaction number is the reference.
  assert.match(preview.rows[2].description, /FIXTURE DRIVER BETA/);
  assert.equal(preview.rows[2].reference, '1003');
  assert.match(preview.rows[0].description, /XAA1001/);
  assert.match(preview.rows[3].description, /CASH DEPOSIT/);
  // The account number gives the account label.
  assert.equal(preview.account_label, 'RHB …9999');
  assert.equal(preview.total_credits, 950);
  assert.equal(preview.total_debits, 120.5);
});

test('the statement totals printed on page one are checked against the lines read', async () => {
  const preview = await previewBankStatement(arrayBuffer(await rhbWorkbook({ deposits: '999.00\n120.50' })), 'AUG.xlsx', '2026-08', input);
  assert.ok(preview.issues.some((issue) => issue.code === 'BANK_CONTROL_TOTAL_MISMATCH'));
});

test('payments are suggested for RHB lines by plate or sender name', async () => {
  const preview = await previewBankStatement(arrayBuffer(await rhbWorkbook()), 'AUG.xlsx', '2026-08', input);
  const payment = (id: string, name: string, plate: string, date: string, amount: number, method = 'BANK TRANSFER') => ({ source_payment_id: id, driver_id: id, driver_name_snapshot: name,
    car_plate_snapshot: plate, plate_key: plate, payment_date: date, cash_amount: amount, service_claim: 0, gross_rental_revenue: amount, payment_method: method,
    refreshed_at: 'x', finance_month: '2026-08', attribution_changed: false });
  const suggestions = suggestPaymentMatches(preview.rows, [
    payment('p1', 'Someone Else', 'XAA1001', '2026-08-01', 400),
    payment('p2', 'Fixture Driver Beta', 'XAB2002', '2026-08-03', 200),
    payment('p3', 'Fixture Driver Gamma', 'XAC3003', '2026-08-04', 350, 'CASH DEPOSIT'),
  ]);
  assert.deepEqual([...suggestions.values()].map((s) => [s.sourceRow, s.paymentId]).sort(), [
    [preview.rows[0].source_row, 'p1'], [preview.rows[2].source_row, 'p2'], [preview.rows[3].source_row, 'p3'],
  ].sort());
});
