import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {previewSectionWorkbook} from '../services/finance/workspace.ts';
import {previewBootstrap} from '../services/finance/imports.ts';
import type {FinanceInput} from '../types/finance.ts';

const vehicle={plate_key:'ABC123',display_plate:'ABC123',business_unit:'E-HAILING',ownership_type:'Owned',status:'Active'};
const input={vehicles:[vehicle]} as FinanceInput;
async function workbook(values:unknown[],header:string|null='RESPONSIBILITY'){
 const book=new ExcelJS.Workbook();const master=book.addWorksheet('Vehicle Master');
 master.addRow(['Car Plate','Business Unit','Ownership Type','Status']);master.addRow(['ABC123','E-HAILING','Owned','Active']);
 book.addWorksheet('Vehicle Monthly Costs').addRow(['Car Plate','Start Month','Cost Type','Monthly Amount']);
 const sheet=book.addWorksheet('Vehicle Insurance');
 sheet.addRow(['Car Plate','Premium','Coverage Start','Coverage End',...(header===null?[]:[header])]);
 values.forEach((value,index)=>sheet.addRow(['ABC123',1200,`${2026+index}-01-01`,`${2026+index}-12-31`,...(header===null?[]:[value])]));
 return await book.xlsx.writeBuffer() as ArrayBuffer;
}
test('section and initial workbook import normalize insurance responsibility without changing policy data',async()=>{
 const bytes=await workbook(['  eca paid  ','\tOwNeR PaId\n','ECA_PAID','OWNER_PAID'],' responsibility ');
 const section=await previewSectionWorkbook(bytes,'insurance.xlsx','insurance','2026-08',input);
 const bootstrap=await previewBootstrap(bytes,'initial.xlsx','2026-08');
 for(const [rows,issues] of [[section.rows,section.issues],[bootstrap.data.insurance,bootstrap.issues]] as const){
  assert.deepEqual(rows.map(row=>(row as any).responsibility),['ECA_PAID','OWNER_PAID','ECA_PAID','OWNER_PAID']);
  assert.equal(issues.some(issue=>issue.severity==='error'),false);
  assert.equal(rows[0].premium,1200);assert.equal(rows[0].coverage_start,'2026-01-01');
  assert.equal((rows[0] as any).sheet_name,'Vehicle Insurance');assert.equal((rows[0] as any).source_row,2);
 }
});
test('invalid or blank responsibility cells block approval instead of guessing who pays',async()=>{
 const bytes=await workbook(['ECA','OWNER','company paid','   ',null]);
 const section=await previewSectionWorkbook(bytes,'insurance.xlsx','insurance','2026-08',input);
 const bootstrap=await previewBootstrap(bytes,'initial.xlsx','2026-08');
 assert.equal(section.rows.length,5);
 for(const preview of [section,bootstrap])assert.equal(preview.issues.filter(issue=>issue.code==='INVALID_INSURANCE_RESPONSIBILITY'&&issue.severity==='error').length,5);
});
test('unclassified legacy workbook rows retain their premium but require responsibility before posting',async()=>{
 const bytes=await workbook([null],null);
 const section=await previewSectionWorkbook(bytes,'insurance.xlsx','insurance','2026-08',input);
 const bootstrap=await previewBootstrap(bytes,'initial.xlsx','2026-08');
 for(const [rows,issues] of [[section.rows,section.issues],[bootstrap.data.insurance,bootstrap.issues]] as const){
  assert.equal(rows.length,1);assert.equal(rows[0].responsibility,null);assert.equal(rows[0].premium,1200);
  assert.equal(issues.some(issue=>issue.code==='INVALID_INSURANCE_RESPONSIBILITY'&&issue.severity==='error'),true);
 }
});
