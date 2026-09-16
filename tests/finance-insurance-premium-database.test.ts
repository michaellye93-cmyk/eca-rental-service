import test from 'node:test';
import assert from 'node:assert/strict';
import {database,migrate,asUser,STAFF_ID} from './finance-db-fixture.ts';
import {calculateFinance} from '../services/finance/calculations.ts';
const files=['20260915084108_secure_profile_roles.sql','20260915084110_finance_foundation.sql','20260915085705_finance_bank_statements.sql','20260915104015_finance_section_workflows.sql','20260915120802_finance_delete_vehicle.sql','20260915122156_finance_insurance_responsibility.sql'];
const migration='20260915124812_finance_insurance_premium_rules.sql',month='2026-08-01';
const vehicle={plate_key:'ABC123',display_plate:'ABC123',business_unit:'E-HAILING',ownership_type:'Owned',status:'Active'};
async function setup(upgrade=true){const db=await database();for(const file of files)await migrate(db,file);if(upgrade)await migrate(db,migration);await asUser(db);await save(db,'vehicle',vehicle);return db;}
const save=(db:any,kind:string,record:object)=>db.query(`select public.finance_save_record($1,$2::jsonb)`,[kind,JSON.stringify(record)]);
const read=async(db:any,period=month)=>(await db.query(`select public.finance_read_month($1) v`,[period])).rows[0].v;
const zero={plate_key:'ABC123',premium:0,coverage_start:null,coverage_end:null,responsibility:'ECA_PAID'};
test('Admin can save and update zero-cost responsibility records; payment date follows positive ECA coverage',async()=>{
 const db=await setup();try{
  await save(db,'insurance',zero);let data=await read(db);assert.equal(data.calculation_version,2);const original=data.insurance[0];assert.equal(original.payment_date,null);assert.equal(calculateFinance(data).totals.insurance,0);
  await save(db,'insurance',{...original,premium:1200,coverage_start:'2026-01-01',coverage_end:'2026-12-31',payment_date:'2026-08-10',supplier:'Insurer',reference:'POL1',source:'Excel'});
  data=await read(db);assert.equal(data.insurance.length,1);assert.equal(data.insurance[0].id,original.id);assert.equal(data.insurance[0].payment_date,'2026-01-01');assert.equal(data.insurance[0].supplier,'Insurer');assert.equal(calculateFinance(data).totals.insurance,100);
  await save(db,'insurance',{...data.insurance[0],responsibility:'OWNER_PAID',coverage_start:null,coverage_end:null});data=await read(db);assert.equal(data.insurance[0].premium,1200);assert.equal(data.insurance[0].payment_date,null);assert.equal(calculateFinance(data).totals.insurance,0);assert.ok(calculateFinance(data).issues.some(x=>x.code==='INSURANCE_NEEDS_REVIEW'));
  await save(db,'insurance',{...data.insurance[0],premium:0});data=await read(db);assert.equal(calculateFinance(data).issues.some(x=>x.code==='INSURANCE_NEEDS_REVIEW'),false);
  await assert.rejects(save(db,'insurance',{...data.insurance[0],responsibility:'ECA_PAID',premium:100}),/coverage/i);
  await asUser(db,STAFF_ID);await assert.rejects(save(db,'insurance',zero),/Admin/i);
 }finally{await db.close();}
});
test('section import retains zero-cost and review rows, totals ECA only, and upserts undated records safely',async()=>{
 const db=await setup();try{
  const rows=[{...zero,source_row:2,sheet_name:'Insurance'}];
  const post=async(rows:object[],hash:string)=>db.query(`select public.finance_post_section_workbook('INSURANCE',$1,'policies.xlsx',$2::jsonb,$3,$4)`,[month,JSON.stringify(rows),(await read(db)).month.revision,hash.repeat(64)]);
  await post(rows,'a');let data=await read(db);const id=data.insurance[0].id;
  await post([{...rows[0],responsibility:'OWNER_PAID'}],'b');data=await read(db);assert.equal(data.insurance.length,1);assert.equal(data.insurance[0].id,id);
  await post([{...rows[0],premium:1500,responsibility:'OWNER_PAID'}],'c');assert.equal((await read(db)).insurance[0].premium,1500);
  await post([{...rows[0],premium:1681.62,coverage_start:'2025-09-12',coverage_end:'2026-09-11',responsibility:'ECA_PAID',supplier:'Insurer',reference:'R1',source:'Official workbook'}],'d');
  data=await read(db);assert.equal(data.insurance.length,2);assert.equal(data.insurance.find((p:any)=>p.premium===1681.62).payment_date,'2025-09-12');
  const uploads=(await db.query(`select public.finance_workspace_meta($1) v`,[month])).rows[0].v.uploads;assert.deepEqual(uploads.map((u:any)=>u.total_amount).sort((a:number,b:number)=>a-b),[0,0,0,1681.62]);
  await assert.rejects(post([{...rows[0],premium:100,coverage_start:null,coverage_end:null}],'e'),/coverage/i);assert.deepEqual(await read(db),data);
 }finally{await db.close();}
});
test('migration preserves closed input and version-1 totals while new reads use version 2',async()=>{
 const db=await setup(false);try{
  await save(db,'insurance',{...zero,premium:1200,responsibility:'ECA_PAID',coverage_start:'2026-01-01',coverage_end:'2026-12-31',payment_date:'2026-08-10'});
  await db.query(`select public.finance_refresh_payments($1)`,[month]);let data=await read(db);
  await db.query(`select public.finance_post_smart_drive($1,'empty.xlsx','[]',false,$2,null)`,[month,data.month.revision]);data=await read(db);
  await db.query(`select public.finance_transition_month($1,'READY',$2,'Reviewed')`,[month,data.month.revision]);data=await read(db);await db.query(`select public.finance_transition_month($1,'CLOSE',$2,'Reviewed')`,[month,data.month.revision]);
  const frozen=await read(db),report=calculateFinance(frozen);await db.exec('reset role');await migrate(db,migration);await asUser(db);
  assert.deepEqual(await read(db),frozen);assert.deepEqual(calculateFinance(await read(db)),report);
  const open=await read(db,'2026-09-01');assert.equal(open.calculation_version,2);assert.equal(open.insurance[0].payment_date,'2026-01-01');
 }finally{await db.close();}
});
