import test from 'node:test';
import assert from 'node:assert/strict';
import {database,migrate,asUser,STAFF_ID} from './finance-db-fixture.ts';
import {buildFinanceReport} from '../services/finance/calculations.ts';
import type {FinanceInput} from '../types/finance.ts';
const august='2026-08-01',september='2026-09-01';
const vehicle={plate_key:'OLD123',display_plate:'OLD 123',business_unit:'E-HAILING',ownership_type:'Owned',status:'Active'};
async function setup(){
 const db=await database();for(const file of ['20260915084108_secure_profile_roles.sql','20260915084110_finance_foundation.sql','20260915085705_finance_bank_statements.sql','20260915104015_finance_section_workflows.sql','20260915120802_finance_delete_vehicle.sql'])await migrate(db,file);
 await asUser(db);await db.query(`select public.finance_save_record('vehicle',$1::jsonb)`,[JSON.stringify(vehicle)]);return db;
}
async function read(db:any,month=august):Promise<FinanceInput>{return (await db.query(`select public.finance_read_month($1) v`,[month])).rows[0].v;}
async function remove(db:any,revision:number,month=august,plate='OLD123'){return db.query(`select public.finance_delete_vehicle($1,$2,$3)`,[month,plate,revision]);}

test('Admin deletion preserves financial records, source links and frozen reports',async()=>{
 const db=await setup();try{
 await db.exec(`reset role;insert into public.drivers values('10000000-0000-4000-8000-000000000001','Fixture Driver','OLD 123');insert into public.payments values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-08-01',150,20,'BANK');`);await asUser(db);
 const save=async(kind:string,record:object)=>db.query(`select public.finance_save_record($1,$2::jsonb)`,[kind,JSON.stringify(record)]);
 await save('recurring_cost',{plate_key:'OLD123',start_month:august,end_month:null,cost_type:'Owner Payout',monthly_amount:100});
 await save('insurance',{plate_key:'OLD123',premium:1200,coverage_start:'2026-01-01',coverage_end:'2026-12-31'});
 await save('expense',{finance_month:august,billing_date:'2026-08-03',plate_key:'OLD123',category:'Service & Maintenance',payment_source:'Workshop Billing',amount:10});
 await db.query(`select public.finance_refresh_payments($1)`,[august]);let data=await read(db);
 await db.query(`select public.finance_post_smart_drive($1,'empty-report.xlsx','[]',false,$2,null)`,[august,data.month.revision]);data=await read(db);
 await db.query(`select public.finance_transition_month($1,'READY',$2,'Reviewed sources')`,[august,data.month.revision]);data=await read(db);
 await assert.rejects(remove(db,data.month.revision),/Draft/i);
 await db.query(`select public.finance_transition_month($1,'CLOSE',$2,'Reviewed warnings')`,[august,data.month.revision]);
 const frozen=await read(db);await assert.rejects(remove(db,frozen.month.revision),/closed month/i);const open=await read(db,september);const beforeReport=buildFinanceReport(open);
 await remove(db,open.month.revision,september);const after=await read(db,september);
 assert.ok(after.vehicles[0].deleted_at);assert.equal(after.vehicles.length,1);assert.deepEqual(after.recurring_costs,open.recurring_costs);assert.deepEqual(after.insurance,open.insurance);assert.deepEqual(buildFinanceReport(after),beforeReport);
 assert.deepEqual(await read(db),frozen,'Closed snapshot must remain byte-equivalent');
 await db.exec('reset role');assert.equal((await db.query('select car_plate from public.drivers')).rows[0].car_plate,'OLD 123');
 const audit=(await db.query(`select action,details from finance_private.audit where action='DELETE_VEHICLE'`)).rows;
 assert.equal(audit.length,1);assert.equal((audit[0].details as any).plate_key,'OLD123');
 await asUser(db);await db.query(`select public.finance_transition_month($1,'REOPEN',$2,'Review preserved history')`,[august,frozen.month.revision]);
 const reopened=await read(db);assert.deepEqual(reopened.expenses,frozen.expenses);assert.deepEqual(reopened.ehailing,frozen.ehailing);assert.deepEqual(buildFinanceReport(reopened),buildFinanceReport(frozen));
 }finally{await db.close();}
});

test('deletion rejects unauthorized, stale, missing and closed requests without changing records',async()=>{
 const db=await setup();try{
 const initial=await read(db);await db.exec('reset role;set role anon');await assert.rejects(remove(db,initial.month.revision),/permission denied/i);
 await asUser(db,STAFF_ID);await assert.rejects(remove(db,initial.month.revision),/Admin/i);
 await asUser(db,undefined,'00000000-0000-4000-8000-000000000099');await assert.rejects(remove(db,initial.month.revision),/Admin/i);
 await asUser(db);await assert.rejects(remove(db,initial.month.revision-1),/changed/i);await assert.rejects(remove(db,initial.month.revision,august,'MISSING'),/no longer exists/i);
 assert.deepEqual(await read(db),initial);
 await remove(db,initial.month.revision);const deleted=await read(db);await assert.rejects(remove(db,deleted.month.revision),/already deleted/i);
 await assert.rejects(db.query(`select public.finance_save_record('vehicle',$1::jsonb)`,[JSON.stringify({...vehicle,status:'Active'})]),/deleted/i);
 const workbook=[{...vehicle,plate_key:'NEW123',display_plate:'NEW123',sheet_name:'Vehicles',source_row:2},{...vehicle,sheet_name:'Vehicles',source_row:3}];
 await assert.rejects(db.query(`select public.finance_post_section_workbook('VEHICLE',$1,'old-master.xlsx',$2::jsonb,$3,$4)`,[august,JSON.stringify(workbook),deleted.month.revision,'a'.repeat(64)]),/deleted/i);
 assert.deepEqual(await read(db),deleted,'Rejected upload rolls back all rows and month changes');
 await db.exec('reset role');const denied=(await db.query(`select has_function_privilege('anon','public.finance_delete_vehicle(date,text,integer)','execute') permitted`)).rows[0];assert.equal(denied.permitted,false);
 }finally{await db.close();}
});

test('deleted vehicles without financial activity disappear from the current vehicle report',async()=>{
 const db=await setup();try{const data=await read(db);assert.equal(buildFinanceReport(data).vehicles.length,1);await remove(db,data.month.revision);assert.equal(buildFinanceReport(await read(db)).vehicles.length,0);}finally{await db.close();}
});

test('expired insurance does not keep a deleted vehicle in months without activity',async()=>{
 const db=await setup();try{
 await db.query(`select public.finance_save_record('insurance',$1::jsonb)`,[JSON.stringify({plate_key:'OLD123',premium:1200,coverage_start:'2025-01-01',coverage_end:'2025-12-31'})]);
 const data=await read(db);await remove(db,data.month.revision);const after=await read(db);
 assert.equal(after.insurance.length,1);assert.equal(buildFinanceReport(after).vehicles.length,0);
 }finally{await db.close();}
});
