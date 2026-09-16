import test from 'node:test';
import assert from 'node:assert/strict';
import {database,migrate,asUser} from './finance-db-fixture.ts';
import type {FinanceInput} from '../types/finance.ts';
const month='2026-08-01';
async function setup(){const db=await database();await migrate(db,'20260915084108_secure_profile_roles.sql');await migrate(db,'20260915084110_finance_foundation.sql');await migrate(db,'20260915085705_finance_bank_statements.sql');await asUser(db);return db;}
const row={source_row:1,transaction_date:'2026-08-10',description:'Office rental',reference:'R001',debit:1200,credit:0,decision:'EXPENSE',payment_source:'Corporate Opex',category:'Office Rental',plate_key:null,matched_kind:null,matched_id:null,review_note:'Reviewed office rent'};
test('bank import posts only approved debit expenses; credits are excluded without new revenue and all rows audited',async()=>{
 const db=await setup();try{
 const read=async()=>(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;
 let data=await read();
 const credit={...row,source_row:2,description:'Transfer',reference:'T001',debit:0,credit:10000,decision:'EXCLUDED',payment_source:null,category:null,review_note:'Transfer between company accounts'};
 await db.query(`select public.finance_post_bank_statement($1,'statement.csv','Operating',$2::jsonb,$3,$4)`,[month,JSON.stringify([row,credit]),data.month.revision,'b'.repeat(64)]);
 data=await read();assert.equal(data.expenses.length,1);assert.equal(data.expenses[0].amount,1200);assert.equal(data.bank_rows?.length,2);assert.equal(data.bank_imports?.[0].total_credits,10000);assert.equal(data.ehailing.length,0);
 await assert.rejects(db.query(`select public.finance_post_bank_statement($1,'renamed.csv','Operating',$2::jsonb,$3,$4)`,[month,JSON.stringify([row,credit]),data.month.revision,'b'.repeat(64)]),/already imported/);
 await assert.rejects(db.query(`select public.finance_post_bank_statement($1,'overlap.csv','Operating',$2::jsonb,$3,$4)`,[month,JSON.stringify([row]),data.month.revision,'c'.repeat(64)]),/duplicate|already imported/i);
 assert.equal((await read()).expenses.length,1);
 }finally{await db.close();}
});
test('bank server rejects pending rows, credit expenses, unreasoned exclusions and unknown matches atomically',async()=>{
 const db=await setup();try{
 const read=async()=>(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;
 let data=await read();
 for(const invalid of [{...row,decision:'PENDING'},{...row,debit:0,credit:1200},{...row,decision:'EXCLUDED',review_note:''},{...row,decision:'MATCHED',matched_kind:'expense',matched_id:'00000000-0000-4000-8000-000000000099'}]){
  await assert.rejects(db.query(`select public.finance_post_bank_statement($1,'invalid.csv','Operating',$2::jsonb,$3,$4)`,[month,JSON.stringify([invalid]),data.month.revision,'d'.repeat(64)]));
 }
 data=await read();assert.equal(data.expenses.length,0);assert.equal(data.bank_imports?.length,0);
 }finally{await db.close();}
});
test('matching an already recorded workshop bill creates no additional P&L expense',async()=>{
 const db=await setup();try{
 await db.query(`select public.finance_save_record('expense',$1::jsonb)`,[JSON.stringify({finance_month:month,billing_date:'2026-08-10',plate_key:'ABC123',category:'Service & Maintenance',payment_source:'Workshop Billing',supplier:'Workshop',amount:1200,reference:'R001',description:'Repair'})]);
 let data=(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;
 await db.query(`select public.finance_post_bank_statement($1,'statement.csv','Operating',$2::jsonb,$3,$4)`,[month,JSON.stringify([{...row,decision:'MATCHED',matched_kind:'expense',matched_id:data.expenses[0].id}]),data.month.revision,'e'.repeat(64)]);
 data=(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;assert.equal(data.expenses.length,1);assert.equal(data.bank_rows?.[0].decision,'MATCHED');
 }finally{await db.close();}
});
test('bank-linked expenses cannot drift and changed matches require explicit review before closure',async()=>{
 const db=await setup();try{
 let data=(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;
 await db.query(`select public.finance_post_bank_statement($1,'statement.csv','Operating',$2::jsonb,$3,$4)`,[month,JSON.stringify([row]),data.month.revision,'f'.repeat(64)]);
 data=(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;
 await assert.rejects(db.query(`select public.finance_save_record('expense',$1::jsonb)`,[JSON.stringify({...data.expenses[0],amount:12})]),/bank statement/i);
 const original={finance_month:month,billing_date:'2026-08-10',plate_key:'ABC123',category:'Repair',payment_source:'Vehicle Direct Cost',amount:50,supplier:null,reference:'D2',description:null};
 await db.query(`select public.finance_save_record('expense',$1::jsonb)`,[JSON.stringify(original)]);
 data=(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;
 const expense=data.expenses.find(x=>x.amount===50)!;
 await db.query(`select public.finance_post_bank_statement($1,'second.csv','Operating',$2::jsonb,$3,$4)`,[month,JSON.stringify([{...row,reference:'D2',debit:50,decision:'MATCHED',matched_kind:'expense',matched_id:expense.id}]),data.month.revision,'0'.repeat(64)]);
 await db.query(`select public.finance_save_record('expense',$1::jsonb)`,[JSON.stringify({...expense,amount:60})]);
 data=(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;
 const changed=data.bank_rows!.find(x=>x.debit===50)!;assert.equal(changed.match_valid,false);
 await db.exec('reset role');await assert.rejects(db.query(`select finance_private.validate_bank_links($1)`,[month]),/Review changed bank matches/i);await asUser(db);
 await db.query(`select public.finance_review_bank_match($1,$2,$3,'EXCLUDED',null,null,'Reviewed correction outside this expense',$4)`,[month,changed.import_id,changed.source_row,data.month.revision]);
 data=(await db.query<{v:FinanceInput}>(`select public.finance_read_month($1) v`,[month])).rows[0].v;assert.equal(data.bank_rows!.find(x=>x.debit===50)!.decision,'EXCLUDED');
 }finally{await db.close();}
});
