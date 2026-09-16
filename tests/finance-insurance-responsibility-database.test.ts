import test from 'node:test';
import assert from 'node:assert/strict';
import {database,migrate,asUser,STAFF_ID} from './finance-db-fixture.ts';
const month='2026-08-01';
const vehicle={plate_key:'ABC123',display_plate:'ABC123',business_unit:'E-HAILING',ownership_type:'Owned',status:'Active'};
const policy={plate_key:'ABC123',premium:1200,payment_date:'2026-01-01',coverage_start:'2026-01-01',coverage_end:'2026-12-31'};
const files=['20260915084108_secure_profile_roles.sql','20260915084110_finance_foundation.sql','20260915085705_finance_bank_statements.sql','20260915104015_finance_section_workflows.sql','20260915120802_finance_delete_vehicle.sql','20260915122156_finance_insurance_responsibility.sql'];
async function setup(){const db=await database();for(const file of files)await migrate(db,file);await asUser(db);return db;}
const save=async(db:any,kind:string,record:object)=>db.query(`select public.finance_save_record($1,$2::jsonb)`,[kind,JSON.stringify(record)]);
const read=async(db:any)=>(await db.query(`select public.finance_read_month($1) v`,[month])).rows[0].v;
const upload=async(db:any,rows:object[],revision:number,hash='a')=>db.query(`select public.finance_post_section_workbook('INSURANCE',$1,'insurance.xlsx',$2::jsonb,$3,$4)`,[month,JSON.stringify(rows),revision,hash.repeat(64)]);

test('Admin insurance saves normalize responsibility and legacy saves preserve the stored selection',async()=>{
 const db=await setup();try{
  await save(db,'vehicle',vehicle);await save(db,'insurance',{...policy,responsibility:'  eCa PaId  '});
  let data=await read(db);const stored=data.insurance[0];assert.equal(stored.responsibility,'ECA_PAID');assert.equal(stored.premium,1200);
  await save(db,'insurance',{...stored,responsibility:'\tOwner paid\n'});data=await read(db);assert.equal(data.insurance[0].responsibility,'OWNER_PAID');
  await save(db,'insurance',{...policy,id:stored.id,payment_date:'2026-01-02'});data=await read(db);assert.equal(data.insurance[0].responsibility,'OWNER_PAID');assert.equal(data.insurance.length,1);
  for(const value of ['ECA','OWNER','',null,'COMPANY_PAID'])await assert.rejects(save(db,'insurance',{...policy,id:stored.id,responsibility:value}),/responsibility/i);
  assert.deepEqual(await read(db),data);
  await asUser(db,STAFF_ID);await assert.rejects(save(db,'insurance',{...policy,id:stored.id,responsibility:'ECA_PAID'}),/Admin/i);
  await db.exec('reset role;set role anon');await assert.rejects(save(db,'insurance',{...policy,responsibility:'ECA_PAID'}),/permission denied/i);
 }finally{await db.close();}
});
test('section import persists responsibility through natural-key updates and rejects invalid uploads atomically',async()=>{
 const db=await setup();try{
  await save(db,'vehicle',vehicle);const row={...policy,responsibility:'owner paid',source_row:2,sheet_name:'Insurance'};
  await upload(db,[row],(await read(db)).month.revision);let data=await read(db);const id=data.insurance[0].id;assert.equal(data.insurance[0].responsibility,'OWNER_PAID');
  await upload(db,[{...row,responsibility:' ECA PAID '}],data.month.revision,'b');data=await read(db);assert.equal(data.insurance.length,1);assert.equal(data.insurance[0].id,id);assert.equal(data.insurance[0].responsibility,'ECA_PAID');
  await upload(db,[{...policy,source_row:2,sheet_name:'Insurance'}],data.month.revision,'c');data=await read(db);assert.equal(data.insurance[0].responsibility,'ECA_PAID');
  await assert.rejects(upload(db,[{...row,coverage_start:'2027-01-01',coverage_end:'2027-12-31'}, {...row,responsibility:'UNKNOWN',source_row:3}],data.month.revision,'d'),/responsibility/i);
  assert.deepEqual(await read(db),data);
  const meta=(await db.query(`select public.finance_workspace_meta($1) v`,[month])).rows[0].v;assert.equal(meta.uploads.length,3);assert.equal(meta.uploads[0].source_audit[0].record_id,id);
  await db.exec('reset role');await assert.rejects(db.query(`update finance_private.insurance set responsibility='OTHER' where id=$1`,[id]),/check constraint/i);
 }finally{await db.close();}
});
test('initial import retains responsibility and changes never rewrite a closed snapshot',async()=>{
 const db=await setup();try{
  await db.query(`select public.finance_bootstrap($1::jsonb,'initial.xlsx')`,[JSON.stringify({vehicles:[vehicle],recurring_costs:[],insurance:[{...policy,responsibility:'OWNER PAID'}]})]);
  let data=await read(db);assert.equal(data.insurance[0].responsibility,'OWNER_PAID');
  await db.query(`select public.finance_refresh_payments($1)`,[month]);data=await read(db);
  await db.query(`select public.finance_post_smart_drive($1,'empty.xlsx','[]',false,$2,null)`,[month,data.month.revision]);data=await read(db);
  await db.query(`select public.finance_transition_month($1,'READY',$2,'Reviewed')`,[month,data.month.revision]);data=await read(db);
  await db.query(`select public.finance_transition_month($1,'CLOSE',$2,'Reviewed')`,[month,data.month.revision]);const frozen=await read(db);
  await save(db,'insurance',{...frozen.insurance[0],responsibility:'ECA_PAID'});assert.deepEqual(await read(db),frozen);
  await db.query(`select public.finance_transition_month($1,'REOPEN',$2,'Review changed responsibility')`,[month,frozen.month.revision]);assert.equal((await read(db)).insurance[0].responsibility,'ECA_PAID');
 }finally{await db.close();}
});

test('owner-paid policies cannot settle ECA bank debits and changed responsibility invalidates an existing match',async()=>{
 const db=await setup();try{
  await save(db,'vehicle',vehicle);await save(db,'insurance',{...policy,payment_date:'2026-08-10',responsibility:'OWNER_PAID'});
  let data=await read(db);const stored=data.insurance[0];
  const bank={source_row:1,transaction_date:'2026-08-10',description:'Insurance',reference:'INS1',debit:1200,credit:0,decision:'MATCHED',payment_source:null,category:null,plate_key:'ABC123',matched_kind:'insurance',matched_id:stored.id,review_note:'Reviewed'};
  const post=(revision:number)=>db.query(`select public.finance_post_bank_statement($1,'statement.csv','Operating',$2::jsonb,$3,$4)`,[month,JSON.stringify([bank]),revision,'e'.repeat(64)]);
  await assert.rejects(post(data.month.revision),/match/i);assert.deepEqual(await read(db),data);
  await save(db,'insurance',{...stored,responsibility:'ECA_PAID'});data=await read(db);await post(data.month.revision);data=await read(db);assert.equal(data.bank_rows[0].match_valid,true);
  await save(db,'insurance',{...stored,responsibility:'OWNER_PAID'});data=await read(db);assert.equal(data.bank_rows[0].match_valid,false);
  await db.exec('reset role');await assert.rejects(db.query(`select finance_private.validate_bank_links($1)`,[month]),/Review changed bank matches/i);
 }finally{await db.close();}
});
