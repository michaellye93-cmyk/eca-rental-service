import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {previewSectionWorkbook} from '../services/finance/workspace.ts';
import {previewBootstrap} from '../services/finance/imports.ts';
import {calculateFinance} from '../services/finance/calculations.ts';
import type {FinanceInput} from '../types/finance.ts';
const plates=['ANX6727','JVM9338','VPE6727','REVIEW1','FUTURE1','OWNER1'];
const vehicles=plates.map(plate_key=>({plate_key,display_plate:plate_key,business_unit:'E-HAILING',ownership_type:'Owned',status:'Active'}));
const input={vehicles} as FinanceInput;
async function workbook(headers:string[],rows:unknown[][]){
 const book=new ExcelJS.Workbook();const master=book.addWorksheet('Vehicle Master');master.addRow(['Car Plate','Business Unit','Ownership Type','Status']);vehicles.forEach(v=>master.addRow([v.plate_key,v.business_unit,v.ownership_type,v.status]));
 book.addWorksheet('Vehicle Monthly Costs').addRow(['Car Plate','Start Month','Cost Type','Monthly Amount']);
 const sheet=book.addWorksheet('Insurance');sheet.addRow(headers);rows.forEach(row=>sheet.addRow(row));return await book.xlsx.writeBuffer() as ArrayBuffer;
}
test('official insurance matrix imports zero-cost records, flags contradictions and totals only valid ECA premiums',async()=>{
 const bytes=await workbook(['Car Plate',' Premium  (RM) ','Coverage Start','Coverage End','RESPONSIBLITY','Cost Type','Supplier / Payee','Reference','Source'],[
  ['ANX6727',1681.62,'12-Sep-2025','11-Sep-2026',' eca paid ','Insurance','Insurer','POL1','Official workbook'],
  ['JVM9338',0,'30-Aug-2026','29-Aug-2027','ECA PAID','Insurance'],
  ['VPE6727',0,null,null,'OWNER PAID','Insurance'],
  ['REVIEW1',1500,null,null,'OWNER PAID','Insurance'],
  ['FUTURE1',0,null,null,'ECA PAID','Insurance'],
  ['OWNER1',0,'2026-01-01','2026-12-31','OWNER PAID',' insurance '],
  ['UNKNOWN','invalid',null,null,'invalid','Road Tax'],
 ]);
 const section=await previewSectionWorkbook(bytes,'insurance.xlsx','insurance','2026-08',input);
 const initial=await previewBootstrap(bytes,'initial.xlsx','2026-08');
 for(const [rows,issues,summary] of [[section.rows,section.issues,(section as any).insurance_summary],[initial.data.insurance,initial.issues,(initial as any).insurance_summary]] as const){
  assert.equal(rows.length,6);assert.equal(issues.filter(x=>x.severity==='error').length,0);
  assert.equal(issues.length,1);assert.match(issues[0].detail,/Vehicle is marked Owner Paid but an insurance premium has been entered\. Please review\./);
  assert.equal(rows[0].premium,1681.62);assert.equal(rows[0].coverage_start,'2025-09-12');assert.equal(rows[0].payment_date,'2025-09-12');
  assert.equal((rows[0] as any).supplier,'Insurer');assert.equal((rows[0] as any).reference,'POL1');assert.equal((rows[0] as any).source,'Official workbook');
  assert.equal(rows[2].coverage_start,null);assert.equal(rows[2].coverage_end,null);assert.equal(rows[2].payment_date,null);
  assert.deepEqual(summary,{records:6,total_eca_premium:1681.62,valid_eca_policies:1,future_eca_renewals:2,owner_paid_no_cost:2,review_items:1});
 }
 assert.equal(section.total_amount,1681.62);
});
test('insurance premium aliases and zero-only files work without a separate payment date or coverage columns',async()=>{
 for(const header of ['Premium (RM)','Premium','Insurance Premium','Cash Amount (RM)','Cash Amount']){
  const preview=await previewSectionWorkbook(await workbook(['Car Plate',header,'RESPONSIBILITY'],[['VPE6727',0,'OWNER PAID'],['JVM9338',0,'ECA PAID']]),'insurance.xlsx','insurance','2026-08',input);
  assert.equal(preview.issues.length,0,header);assert.equal(preview.rows.length,2);assert.equal(preview.rows[0].premium,0);
 }
});

test('owner-paid blank formula coverage cells import without coverage errors in both workbook paths',async()=>{
 const blankFormula={formula:'IF(I2="","",EDATE(I2,-12)+1)'};
 const bytes=await workbook(['Car Plate','Premium (RM)','Coverage Start','Coverage End','RESPONSIBILITY'],[
  ['VPE6727',0,blankFormula,null,' owner paid '],
  ['OWNER1',0,{formula:'IF(1=1,"",TODAY())',result:''},{formula:'IF(1=1,"",TODAY())'},'OWNER_PAID'],
  ['REVIEW1',1500,blankFormula,null,'OWNER PAID'],
 ]);
 const section=await previewSectionWorkbook(bytes,'insurance.xlsx','insurance','2026-08',input);
 const initial=await previewBootstrap(bytes,'initial.xlsx','2026-08');
 for(const [rows,issues,summary] of [[section.rows,section.issues,section.insurance_summary],[initial.data.insurance,initial.issues,initial.insurance_summary]] as const){
  assert.deepEqual(issues.filter(x=>x.severity==='error'),[]);
  assert.equal(issues.length,1);assert.equal(issues[0].code,'INSURANCE_NEEDS_REVIEW');
  assert.ok(rows.every(row=>row.coverage_start===null&&row.coverage_end===null&&row.payment_date===null));
  assert.deepEqual(summary,{records:3,total_eca_premium:0,valid_eca_policies:0,future_eca_renewals:0,owner_paid_no_cost:2,review_items:1});
 }
});

test('positive ECA premiums still require dates when Excel formula results are blank',async()=>{
 const bytes=await workbook(['Car Plate','Premium (RM)','Coverage Start','Coverage End','RESPONSIBILITY'],[
  ['ANX6727',1200,{formula:'IF(1=1,"",TODAY())'},null,'ECA PAID'],
 ]);
 const preview=await previewSectionWorkbook(bytes,'insurance.xlsx','insurance','2026-08',input);
 assert.equal(preview.rows[0].coverage_start,null);
 assert.ok(preview.issues.some(issue=>issue.severity==='error'&&issue.detail.includes('Positive ECA-paid premiums require Coverage Start and Coverage End')));
 assert.equal(preview.total_amount,0);
});
test('positive ECA needs valid dates and genuine invalid values count once per review record',async()=>{
 const bytes=await workbook(['Car Plate','Premium (RM)','Coverage Start','Coverage End','RESPONSIBILITY'],[
  ['ANX6727',10,null,null,'ECA PAID'],['JVM9338',0,'31-Feb-2026',null,'ECA PAID'],['VPE6727',-1,null,null,'OWNER PAID'],['OWNER1',null,null,null,'OWNER PAID']
 ]);
 const preview=await previewSectionWorkbook(bytes,'insurance.xlsx','insurance','2026-08',input);
 assert.equal(preview.rows.length,4);assert.equal((preview as any).insurance_summary.review_items,4);assert.equal(preview.total_amount,0);assert.ok(preview.issues.every(x=>x.severity==='error'));
});
test('official premium takes precedence and explicit payment-date cells do not override coverage start',async()=>{
 const bytes=await workbook(['Car Plate','Cash Amount','Premium (RM)','Coverage Start','Coverage End','RESPONSIBILITY','Payment Date'],[['ANX6727',999,1200,'2026-01-01','2026-12-31','ECA PAID','2026-08-01']]);
 const preview=await previewSectionWorkbook(bytes,'insurance.xlsx','insurance','2026-08',input);
 assert.equal(preview.rows[0].premium,1200);assert.equal(preview.rows[0].payment_date,'2026-01-01');
});

test('new reports allocate only valid positive ECA policies and historical version 1 remains stable',()=>{
 const old={plate_key:'ANX6727',premium:1200,payment_date:'2026-01-01',coverage_start:'2026-01-01',coverage_end:'2026-12-31'};
 const snapshot={month:{finance_month:'2026-08-01',source_count:0,total_cash:0,total_claim:0},vehicles,recurring_costs:[],insurance:[old],expenses:[],ehailing:[],smart_rows:[],smart_import:null} as unknown as FinanceInput;
 assert.equal(calculateFinance({...snapshot,calculation_version:1}).totals.insurance,100);
 assert.equal(calculateFinance({...snapshot,calculation_version:2}).totals.insurance,0);
 assert.equal(calculateFinance({...snapshot,calculation_version:2,insurance:[{...old,responsibility:'UNKNOWN' as any}]}).totals.insurance,0);
 const policies=[{...old,premium:1681.62,coverage_start:'2025-09-12',coverage_end:'2026-09-11',responsibility:'ECA_PAID'}, {...old,premium:0,coverage_start:null,coverage_end:null,responsibility:'ECA_PAID'}, {...old,premium:0,coverage_start:null,coverage_end:null,responsibility:'OWNER_PAID'}, {...old,premium:1500,coverage_start:null,coverage_end:null,responsibility:'OWNER_PAID'}];
 const report=calculateFinance({...snapshot,calculation_version:2,insurance:policies as any});
 assert.equal(report.totals.insurance,140.14);assert.equal(report.issues.filter(x=>x.code==='INSURANCE_NEEDS_REVIEW').length,1);
});
