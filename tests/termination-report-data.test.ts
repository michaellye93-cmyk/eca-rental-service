import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTerminationDrivers } from '../terminationReportData.ts';

const account = { id:'driver',name:'Test',car_plate:'TEST',contract_start_date:'2026-01-01',contract_duration_weeks:104,rental_cycle:'WEEKLY',rental_rate:350,is_delisted:false };
test('reads every payment page and does not drop history beyond the API limit',async()=>{
 const payments=Array.from({length:1001},(_,i)=>({id:String(i),driver_id:'driver',date:'2026-08-01',amount:1,service_claim:0}));
 const calls: string[]=[];
 const data=await loadTerminationDrivers(async(table,from,to)=>{calls.push(table+':'+from);return table==='drivers'?[account]:payments.slice(from,to+1);});
 assert.equal(data[0].paymentHistory.length,1001);
 assert.deepEqual(calls,['drivers:0','payments:0','payments:1000']);
 assert.equal(data[0].totalAmountPaid,1001);
});
test('a failed payment page rejects the entire report instead of recommending from partial history',async()=>{
 await assert.rejects(loadTerminationDrivers(async(table)=>{if(table==='drivers')return [account];throw new Error('Ledger unavailable');}),/Ledger unavailable/);
});
test('inactive accounts are excluded and no payments are requested for an empty active population',async()=>{
 const rows=await loadTerminationDrivers(async table=>{assert.equal(table,'drivers');return [{...account,is_delisted:true}];});
 assert.deepEqual(rows,[]);
});
