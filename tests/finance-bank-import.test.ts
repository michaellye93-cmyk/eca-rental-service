import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { previewBankStatement, validateBankReview } from '../services/finance/bankStatements.ts';
import type { FinanceInput } from '../types/finance.ts';

const input: FinanceInput = { month: { finance_month: '2026-08-01', status: 'DRAFT', revision: 1, refreshed_at: 'x', frozen_at: null, source_count: 1, total_cash: 100, total_claim: 0, earliest_date: null, latest_date: null }, vehicles: [], recurring_costs: [], insurance: [], expenses: [], ehailing: [{ source_payment_id: 'p1', driver_id: 'd', driver_name_snapshot: 'D', car_plate_snapshot: 'VGA', plate_key: 'VGA', payment_date: '2026-08-01', cash_amount: 100, service_claim: 0, gross_rental_revenue: 100, payment_method: null, refreshed_at: 'x', finance_month: '2026-08-01', attribution_changed: false }], smart_import: null, smart_rows: [], imports: [], bootstrap_completed: true };

test('bank review excludes owner-paid insurance as an ECA debit match',async()=>{
 const policy={id:'insurance1',plate_key:'VGA',premium:1200,payment_date:'2026-08-01',coverage_start:'2026-01-01',coverage_end:'2026-12-31',responsibility:'OWNER_PAID' as const};
 const snapshot={...input,insurance:[policy]};
 const preview=await previewBankStatement(new TextEncoder().encode('Date,Description,Debit,Credit\n2026-08-01,Insurance,1200,0').buffer,'bank.csv','2026-08',snapshot);
 const row={...preview.rows[0],decision:'MATCHED' as const,matched_kind:'insurance' as const,matched_id:policy.id};
 assert.ok(validateBankReview([row],'2026-08',snapshot).some(issue=>issue.code==='BANK_MATCH_AMOUNT_MISMATCH'));
 assert.deepEqual(validateBankReview([row],'2026-08',{...snapshot,insurance:[{...policy,responsibility:'ECA_PAID'}]}),[]);
});

test('reviewed debit matches an existing workshop expense without creating a second expense',async()=>{
 const snapshot={...input,expenses:[{id:'expense1',finance_month:'2026-08-01',billing_date:'2026-08-01',plate_key:'VGA',category:'Service & Maintenance',payment_source:'Workshop Billing' as const,amount:50,supplier:'Workshop',reference:'W1',description:null}]};
 const preview=await previewBankStatement(new TextEncoder().encode('Date,Description,Debit,Credit\n2026-08-01,Workshop,50,0').buffer,'bank.csv','2026-08',snapshot);
 const row={...preview.rows[0],decision:'MATCHED' as const,matched_kind:'expense' as const,matched_id:'expense1'};
 assert.deepEqual(validateBankReview([row],'2026-08',snapshot),[]);
 assert.ok(validateBankReview([{...row,matched_id:'unknown'}],'2026-08',snapshot).some(x=>x.code==='UNKNOWN_BANK_MATCH'));
});
test('same-day equal expenses with distinct descriptions are not duplicate bank rows',async()=>{
 const preview=await previewBankStatement(new TextEncoder().encode('Date,Description,Debit,Credit\n2026-08-01,Parking A,10,0\n2026-08-01,Toll B,10,0').buffer,'bank.csv','2026-08',input);
 const rows=preview.rows.map(row=>({...row,decision:'EXCLUDED' as const,review_note:'Already reimbursed'}));
 assert.deepEqual(validateBankReview(rows,'2026-08',input),[]);
});

test('parses debit and credit CSV rows as pending review, without retaining account identity', async () => {
  const bytes = new TextEncoder().encode('Date,Description,Reference,Debit,Credit,Account Number\n01/08/2026,Workshop,REF-D,50,,REMOVED_LEGACY_PASSWORD\n02/08/2026,Rental,REF-C,,100,REMOVED_LEGACY_PASSWORD');
  const result = await previewBankStatement(bytes.buffer, 'statement.csv', '2026-08', input);
  assert.equal(result.rows.length, 2); assert.equal(result.total_debits, 50); assert.equal(result.total_credits, 100);
  assert.deepEqual(result.rows.map((row) => ({ date: row.transaction_date, debit: row.debit, credit: row.credit, decision: row.decision })), [{ date: '2026-08-01', debit: 50, credit: 0, decision: 'PENDING' }, { date: '2026-08-02', debit: 0, credit: 100, decision: 'PENDING' }]);
  assert.equal(JSON.stringify(result.rows).includes('REMOVED_LEGACY_PASSWORD'), false);
});

test('parses mapped XLSX rows and rejects blank amounts rather than coercing them to zero', async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Transactions'); sheet.addRow(['Txn Date', 'Details', 'Out', 'In']); sheet.addRow(['2026-08-01', 'Cost', 20, '']); sheet.addRow(['2026-08-02', 'Missing', '', '']);
  const result = await previewBankStatement(await workbook.xlsx.writeBuffer() as ArrayBuffer, 'statement.xlsx', '2026-08', input, { sheet: 'Transactions', date: 'Txn Date', description: 'Details', debit: 'Out', credit: 'In' });
  assert.equal(result.rows.length, 2); assert.equal(result.rows[1].debit, 0); assert.equal(result.issues.some((issue) => issue.code === 'MISSING_BANK_AMOUNT'), true);
});

test('allows only reviewed debit expenses and reviewed credit matches or exclusions', async () => {
  const preview = await previewBankStatement(new TextEncoder().encode('Date,Description,Debit,Credit\n2026-08-01,Cost,10,\n2026-08-02,Rental,,100').buffer, 'statement.csv', '2026-08', input);
  assert.equal(validateBankReview(preview.rows, '2026-08', input).some((issue) => issue.code === 'PENDING_BANK_REVIEW'), true);
  const rows = structuredClone(preview.rows); rows[0].decision = 'EXPENSE'; rows[0].payment_source = 'Vehicle Direct Cost'; rows[0].category = 'Repair'; rows[0].plate_key = 'VGA'; rows[1].decision = 'MATCHED'; rows[1].matched_kind = 'payment'; rows[1].matched_id = 'p1';
  assert.deepEqual(validateBankReview(rows, '2026-08-01', input), []);
});

test('rejects impossible dates, quotes in CSV, and payment matches with a wrong amount or month', async () => {
  const preview = await previewBankStatement(new TextEncoder().encode('Date,Description,Reference,Debit,Credit\n31/02/2026,"Cost, quoted",R,10,\n2026-08-02,Rental,R2,,99').buffer, 'statement.csv', '2026-08', input);
  assert.equal(preview.rows[0].description, 'Cost, quoted'); assert.equal(preview.issues.some((entry) => entry.code === 'INVALID_BANK_DATE'), true);
  const rows = structuredClone(preview.rows); rows[0].decision = 'EXCLUDED'; rows[0].review_note = 'Invalid source date'; rows[1].decision = 'MATCHED'; rows[1].matched_kind = 'payment'; rows[1].matched_id = 'p1';
  assert.equal(validateBankReview(rows, '2026-08', input).some((entry) => entry.code === 'BANK_MATCH_AMOUNT_MISMATCH'), true);
});
