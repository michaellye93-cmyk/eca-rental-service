import test from 'node:test';
import assert from 'node:assert/strict';
import {database,migrate,asUser,ADMIN_ID,STAFF_ID} from './finance-db-fixture.ts';
import type {FinanceInput} from '../types/finance.ts';
const month='2026-08-01';
async function setup(){const db=await database();await migrate(db,'20260915084108_secure_profile_roles.sql');await migrate(db,'20260915084110_finance_foundation.sql');return db;}
test('Finance requires a current real Admin session and hides private data from clients',async()=>{
 const db=await setup();try{
  await db.exec('set role anon');
  await assert.rejects(db.query(`select public.finance_read_month($1)`,[month]),/permission denied/);
  await asUser(db,STAFF_ID);await assert.rejects(db.query(`select public.finance_read_month($1)`,[month]),/Admin/);
  await asUser(db);assert.equal((await db.query<{ok:boolean}>(`select public.finance_access() as ok`)).rows[0].ok,true);
  await assert.rejects(db.exec(`insert into finance_private.months(finance_month) values('2026-08-01')`),/permission denied/);
  await db.exec('reset role; delete from auth.sessions');await asUser(db);
  assert.equal((await db.query<{ok:boolean}>(`select public.finance_access() as ok`)).rows[0].ok,false);
 }finally{await db.close();}
});
test('complete ledger ingestion, close freezing, stale revision denial and explicit reopen',async()=>{
 const db=await setup();try{
  await db.exec(`insert into public.drivers values('10000000-0000-4000-8000-000000000001','Test Driver','XAA 1001');
  insert into public.payments select md5(n::text)::uuid,'10000000-0000-4000-8000-000000000001','2026-08-01',150,300,'BANK TRANSFER' from generate_series(1,1201) n;`);
  await asUser(db);
  const call=async(name:string,args:unknown[]) => (await db.query<{v:FinanceInput}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).rows[0].v;
  await db.query(`select public.finance_save_record('vehicle',$1::jsonb)`,[JSON.stringify({plate_key:'XAA1001',display_plate:'XAA 1001',business_unit:'E-HAILING',ownership_type:'Owned',status:'Active'})]);
  await db.query(`select public.finance_save_record('recurring_cost',$1::jsonb)`,[JSON.stringify({plate_key:'XAA1001',start_month:month,end_month:null,cost_type:'Owner Payout',monthly_amount:100,payee:null,notes:null})]);
  let data=await call('finance_refresh_payments',[month]);
  assert.equal(data.ehailing.length,1201);assert.equal(data.month.source_count,1201);assert.equal(data.month.total_cash,180150);assert.equal(data.month.total_claim,360300);
  await call('finance_post_smart_drive',[month,'empty-confirmed-report.xlsx',JSON.stringify([]),false,data.month.revision,null]);
  data=await call('finance_read_month',[month]);
  await assert.rejects(call('finance_transition_month',[month,'READY',data.month.revision-1,'']),/changed/);
  data=await call('finance_transition_month',[month,'READY',data.month.revision,'Reviewed historical attribution']);
  data=await call('finance_transition_month',[month,'CLOSE',data.month.revision,'Reviewed all sources and historical attribution']);
  const frozen=JSON.stringify(data);
  await db.exec(`reset role;update public.drivers set car_plate='NEW123';update public.payments set amount=999;delete from public.payments where id=md5('1')::uuid;`);
  await asUser(db);
  await db.query(`select public.finance_save_record('vehicle',$1::jsonb)`,[JSON.stringify({plate_key:'XAA1001',display_plate:'X A A 1001',business_unit:'SMART DRIVE',ownership_type:'Owned',status:'Active'})]);
  assert.equal(JSON.stringify(await call('finance_read_month',[month])),frozen);
  await assert.rejects(call('finance_refresh_payments',[month]),/Reopen/);
  await assert.rejects(call('finance_post_smart_drive',[month,'replacement.xlsx','[]',true,data.month.revision,null]),/Reopen/);
  data=await call('finance_transition_month',[month,'REOPEN',data.month.revision,'Correction']);
  data=await call('finance_refresh_payments',[month]);
  assert.equal(data.ehailing.length,1200);assert.equal(data.ehailing[0].plate_key,'NEW123');assert.equal(data.ehailing[0].attribution_changed,true);
 }finally{await db.close();}
});
test('imports are validated server-side, never silently append, and preserve source audit without customer identity',async()=>{
 const db=await setup();try{await asUser(db);
 const read=async()=> (await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;
 const row={source_row:2,sheet_name:'Sales',reference:'B1',plate_key:'ABC123',display_plate:'ABC 123',pickup_date:'2026-08-01',return_date:'2026-08-03',gross_revenue:500,commission:50,status:'Completed',payment_status:'Paid',customer_name:'MUST NOT STORE'};
 let d=await read();
 await db.query(`select public.finance_post_smart_drive($1,$2,$3::jsonb,false,$4,null)`,[month,'first.xlsx',JSON.stringify([row]),d.month.revision]);
 d=await read();assert.equal(d.smart_rows.length,1);assert.equal((d.smart_rows[0] as any).customer_name,undefined);
 await assert.rejects(db.query(`select public.finance_post_smart_drive($1,$2,$3::jsonb,false,$4,null)`,[month,'again.xlsx',JSON.stringify([row]),d.month.revision]),/already exists/);
 await assert.rejects(db.query(`select public.finance_post_smart_drive($1,$2,$3::jsonb,true,$4,null)`,[month,'invalid.xlsx',JSON.stringify([{...row,commission:-1}]),d.month.revision]),/invalid|constraint/i);
 assert.equal((await read()).smart_import?.filename,'first.xlsx');
 await db.query(`select public.finance_post_smart_drive($1,$2,$3::jsonb,true,$4,null)`,[month,'replace.xlsx',JSON.stringify([{...row,gross_revenue:800}]),d.month.revision]);
 d=await read();assert.equal(d.smart_rows.length,1);assert.equal(d.smart_rows[0].gross_revenue,800);assert.equal(d.imports.length,2);
 }finally{await db.close();}
});
test('workshop rows keep individual source audit, duplicate file protection and separate cash expense',async()=>{
 const db=await setup();try{await asUser(db);
 const call=async(name:string,args:unknown[]) => (await db.query<{v:FinanceInput}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).rows[0].v;
 let data=await call('finance_read_month',[month]);
 const rows=[2,3].map((source_row,i)=>({source_row,sheet_name:'Workshop',finance_month:month,billing_date:'2026-08-12',plate_key:'ABC123',category:'Service & Maintenance',payment_source:'Workshop Billing',amount:i?120:300,supplier:'Workshop',reference:'W'+source_row,description:null}));
 data=await call('finance_post_workshop',[month,'workshop.xlsx',JSON.stringify(rows),data.month.revision,'a'.repeat(64)]);
 assert.equal(data.expenses.length,2);assert.deepEqual(data.expenses.map((r:any)=>r.source_row).sort(),[2,3]);assert.equal(data.expenses.reduce((s,r)=>s+r.amount,0),420);
 await assert.rejects(call('finance_post_workshop',[month,'renamed.xlsx',JSON.stringify(rows),data.month.revision,'a'.repeat(64)]),/already imported/);
 assert.equal((await call('finance_read_month',[month])).expenses.length,2);
 }finally{await db.close();}
});
test('bootstrap is atomic, normalizes plates and rejects re-entry and invalid costs',async()=>{
 const db=await setup();try{await asUser(db);
 const payload={vehicles:[{plate_key:'ABC 123',display_plate:'ABC 123',business_unit:'DAILY RENTAL',ownership_type:'Owned',status:'ACTIVE',source_row:2,sheet_name:'Vehicle Master'}],recurring_costs:[{plate_key:'ABC123',start_month:month,end_month:null,cost_type:'Owner Payout',monthly_amount:-100,source_row:2,sheet_name:'Vehicle Monthly Costs'}],insurance:[]};
 await assert.rejects(db.query(`select public.finance_bootstrap($1::jsonb,'initial.xlsx')`,[JSON.stringify(payload)]),/constraint/);
 let data=(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;assert.equal(data.vehicles.length,0);
 payload.recurring_costs[0].monthly_amount=100;
 await db.query(`select public.finance_bootstrap($1::jsonb,'initial.xlsx')`,[JSON.stringify(payload)]);
 data=(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;assert.equal(data.vehicles[0].plate_key,'ABC123');assert.equal(data.bootstrap_completed,true);
 await assert.rejects(db.query(`select public.finance_bootstrap($1::jsonb,'again.xlsx')`,[JSON.stringify(payload)]),/already completed/);
 }finally{await db.close();}
});
test('a payment moved out of a closed period cannot silently enter another period',async()=>{
 const db=await setup();try{
 await db.exec(`insert into public.drivers values('10000000-0000-4000-8000-000000000001','Driver','ABC123');insert into public.payments values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-08-31',150,300,'CLAIM');`);
 await asUser(db);await db.query(`select public.finance_refresh_payments($1)`,[month]);
 await db.exec(`reset role;update public.payments set date='2026-09-01';`);await asUser(db);
 await assert.rejects(db.query(`select public.finance_refresh_payments('2026-09-01')`),/another Finance month/);
 await db.query(`select public.finance_refresh_payments($1)`,[month]);
 const sept=(await db.query<{v:FinanceInput}>(`select public.finance_refresh_payments('2026-09-01') v`)).rows[0].v;assert.equal(sept.ehailing.length,1);
 }finally{await db.close();}
});
