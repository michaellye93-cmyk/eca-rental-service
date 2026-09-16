import test from 'node:test';
import assert from 'node:assert/strict';
import {asUser,database,migrate,STAFF_ID} from './finance-db-fixture.ts';
import {calculateFinance} from '../services/finance/calculations.ts';
const migration='20260915132423_finance_shared_recurring_opex.sql';
async function setup(){const db=await database();for(const file of ['20260915084108_secure_profile_roles.sql','20260915084110_finance_foundation.sql','20260915085705_finance_bank_statements.sql','20260915104015_finance_section_workflows.sql','20260915122156_finance_insurance_responsibility.sql','20260915124812_finance_insurance_premium_rules.sql',migration])await migrate(db,file);await asUser(db);return db;}
const call=async(db:any,name:string,args:unknown[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;
const read=(db:any,month='2026-08-01')=>call(db,'finance_read_month',[month]);
const row={source_row:4,sheet_name:'Shared Opex',finance_month:'2026-08-01',billing_date:null,plate_key:null,category:'Office Rental',payment_source:'Corporate Opex',supplier:'Landlord',amount:2800,description:'Office rent',frequency:'MONTHLY_RECURRING',start_month:'2026-08-01',end_month:null,source:'Workbook',notes:'Monthly'};
const post=async(db:any,rows:any[],hash='a',month='2026-08-01')=>call(db,'finance_post_section_workbook',['CORPORATE_EXPENSE',month,'shared.xlsx',JSON.stringify(rows),(await read(db,month)).month.revision,hash.repeat(64)]);

test('monthly shared expense saves null dates and metadata, reimports for another month, and rejects duplicates',async()=>{
 const db=await setup();const august=await post(db,[row]);const saved=august.expenses[0];
 assert.equal(saved.billing_date,null);assert.equal(saved.frequency,'MONTHLY_RECURRING');assert.equal(saved.start_month,'2026-08-01');assert.equal(saved.source,'Workbook');assert.equal(saved.notes,'Monthly');assert.equal(calculateFinance(august).corporate_opex,2800);
 await assert.rejects(post(db,[row]),/already imported/);
 await assert.rejects(post(db,[row],'b'),/already imported/);
 const sep=await post(db,[{...row,finance_month:'2026-09-01'}],'a','2026-09-01');assert.equal(sep.expenses[0].amount,2800);assert.equal(calculateFinance(await read(db)).corporate_opex,2800);
 await db.query(`select public.finance_save_record('expense',$1::jsonb)`,[JSON.stringify({...saved,amount:2900})]);assert.equal((await read(db)).expenses[0].billing_date,null);assert.equal((await read(db)).expenses[0].notes,'Monthly');
 await asUser(db,STAFF_ID);await assert.rejects(read(db),/Admin/);
 await db.close();
});
test('server enforces frequency and selected-month bounds atomically and retains one-off date requirements',async()=>{
 const db=await setup();
 for(const bad of [{...row,start_month:null},{...row,start_month:'2026-09-01'},{...row,end_month:'2026-07-01'},{...row,start_month:'2026-08-15'},{...row,frequency:'UNKNOWN'},{...row,frequency:'ONE_OFF',start_month:null},{...row,amount:-1},{...row,category:'Unapproved'}]){
  await assert.rejects(post(db,[row,{...bad,source_row:5}]),/Invalid|check constraint|null value/);assert.equal((await read(db)).expenses.length,0);
 }
 const once=await post(db,[{...row,frequency:'ONE_OFF',start_month:null,end_month:null,billing_date:'2026-08-31'}]);assert.equal(once.expenses[0].billing_date,'2026-08-31');
 await db.close();
});
test('copy previous respects recurring end months and keeps frozen history and legacy one-off date clamping',async()=>{
 const db=await setup();await post(db,[{...row,end_month:'2026-08-01'},{...row,source_row:5,category:'Internet',amount:20},{...row,source_row:6,frequency:'ONE_OFF',start_month:null,billing_date:'2026-08-31',category:'Salary',amount:100}]);
 await db.exec(`reset role;update finance_private.months set status='CLOSED',frozen_input=finance_private.input('2026-08-01'),frozen_at=now() where finance_month='2026-08-01'`);await asUser(db);
 const closed=await read(db);const copies=await call(db,'finance_preview_previous_shared_costs',['2026-09-01']);assert.equal(copies.length,2);assert.equal(copies.find((r:any)=>r.frequency==='MONTHLY_RECURRING').billing_date,null);assert.equal(copies.find((r:any)=>r.frequency==='ONE_OFF').billing_date,'2026-09-30');
 const data=await call(db,'finance_copy_previous_shared_costs',['2026-09-01',JSON.stringify(copies),(await read(db,'2026-09-01')).month.revision]);assert.equal(data.expenses.length,2);assert.equal(calculateFinance(data).corporate_opex,120);assert.equal(data.expenses.find((r:any)=>r.frequency==='MONTHLY_RECURRING').notes,'Monthly');
 await assert.rejects(call(db,'finance_copy_previous_shared_costs',['2026-09-01',JSON.stringify(copies),data.month.revision]),/already copied|already imported/);assert.deepEqual(await read(db),closed);
 await assert.rejects(post(db,[row],'d'),/closed|CLOSED|Reopen/);
 await db.close();
});
