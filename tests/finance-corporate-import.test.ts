import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {previewSectionWorkbook} from '../services/finance/workspace.ts';
import type {FinanceInput} from '../types/finance.ts';
const input={vehicles:[]} as unknown as FinanceInput;
export async function sharedWorkbook(headers:string[],rows:unknown[][]){const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Shared Opex');sheet.addRow(headers);rows.forEach(row=>sheet.addRow(row));return await book.xlsx.writeBuffer() as ArrayBuffer;}
const headers=['Frequency','Start Month','End Month','Expense Date','Category','Description','Amount (RM)','Business Unit','Payee','Source','Notes'];
const preview=(bytes:ArrayBuffer,month='2026-08')=>previewSectionWorkbook(bytes,'shared.xlsx','corporate_expense',month,input);

test('monthly Shared Opex accepts official amount and month range without an expense date',async()=>{
 const result=await preview(await sharedWorkbook(headers,[['Monthly Recurring','Aug-2026','Aug-2026',null,'Office Rental','Office rent',2800,'CORPORATE / SHARED','Landlord','Workbook','Recurring']]));
 assert.deepEqual(result.issues,[]);assert.equal(result.total_amount,2800);assert.equal(result.rows.length,1);
 assert.deepEqual(result.rows[0],{source_row:2,sheet_name:'Shared Opex',finance_month:'2026-08-01',billing_date:null,plate_key:null,category:'Office Rental',payment_source:'Corporate Opex',supplier:'Landlord',amount:2800,reference:null,description:'Office rent',frequency:'MONTHLY_RECURRING',start_month:'2026-08-01',end_month:'2026-08-01',source:'Workbook',notes:'Recurring'});
});
test('recurrence uses inclusive boundaries and excludes valid rows outside the selected month',async()=>{
 const bytes=await sharedWorkbook(headers,[['Monthly Recurring','Jul-2026','Jul-2026',null,'Salary','Expired',100],['monthly  recurring','Aug-2026','Sep-2026',null,'Office Rental','Current',2800],['MONTHLY RECURRING','Sep-2026',null,null,'Accounting Fee','Future',200],['Monthly Recurring','Jul-2026',null,null,'Internet / Unifi','Open',217.5]]);
 const aug=await preview(bytes);assert.deepEqual(aug.issues,[]);assert.equal(aug.rows.length,2);assert.equal(aug.total_amount,3017.5);assert.equal(aug.skipped_rows,2);assert.equal(aug.rows[1].category,'Internet');
 const sep=await preview(bytes,'2026-09');assert.deepEqual(sep.issues,[]);assert.equal(sep.total_amount,3217.5);assert.equal(sep.rows.length,3);
 const oct=await preview(bytes,'2026-10');assert.equal(oct.total_amount,417.5);
});
test('amount aliases, Excel month cells and approved category aliases normalize without inventing categories',async()=>{
 for(const name of ['Amount (RM)','Amount','Expense Amount','Monthly Amount']){
  const result=await preview(await sharedWorkbook(['Frequency','Start Month','Category',name],[['Monthly Recurring',new Date('2026-08-01T00:00:00Z'),' epf / kwsp ','RM 2,210.00']]));assert.deepEqual(result.issues,[]);assert.equal(result.rows[0].amount,2210);assert.equal(result.rows[0].category,'KWSP');
 }
 const preferred=await preview(await sharedWorkbook(['Frequency','Start Month','Category','Amount','Amount (RM)'],[['Monthly Recurring','2026-08','Utilities - Electric',999,400]]));assert.equal(preferred.total_amount,400);assert.equal(preferred.rows[0].category,'Utilities');
 const unknown=await preview(await sharedWorkbook(headers,[['Monthly Recurring','Aug-2026',null,null,'Company Loan / Financing','Needs classification',1500]]));assert.equal(unknown.rows.length,1);assert.ok(unknown.issues.some(x=>x.detail.includes('Company Loan / Financing')));
});
test('invalid recurring values remain blocking while one-off and legacy date validation are preserved',async()=>{
 const invalid=await preview(await sharedWorkbook(headers,[['Monthly Recurring',null,null,null,'Office Rental','Missing start',10],['Monthly Recurring','Sep-2026','Aug-2026',null,'Salary','Reversed',20],['Monthly Recurring','Aug-2026',null,null,'Salary','Missing amount',null],['Monthly Recurring','Aug-2026',null,'bad','Salary','Bad date',20],['Unspecified','Aug-2026',null,null,'Salary','Bad frequency',20],['Monthly Recurring','Aug-2026','bad',null,'Salary','Bad end',20]]));
 assert.equal(invalid.rows.length,6);for(let row=2;row<=7;row++)assert.ok(invalid.issues.some(x=>x.detail.includes(`Row ${row}:`)));
 const single=await preview(await sharedWorkbook(headers,[['One-off',null,null,'2026-08-05','Software','Subscription',100],['One Off',null,null,null,'Salary','Missing date',200]]));assert.equal(single.rows[0].category,'General Software');assert.ok(single.issues.some(x=>x.detail.includes('Expense Date')));
 const legacy=await preview(await sharedWorkbook(['Date','Category','Amount'],[['2026-08-01','Office Rental',2800]]));assert.deepEqual(legacy.issues,[]);assert.equal(legacy.rows[0].frequency,'ONE_OFF');assert.equal(legacy.rows[0].billing_date,'2026-08-01');
});
