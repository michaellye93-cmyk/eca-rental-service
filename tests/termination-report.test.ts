import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver } from '../types.ts';
import { analyseTerminationEvidence, buildTerminationReport, getReportDate } from '../terminationReport.ts';

const driver = (overrides: Partial<Driver> = {}): Driver => ({
  id: 'test-account', name: 'Test account', nric: '', carPlate: 'TEST123',
  contractStartDate: '2026-07-13', rentalCycle: 'WEEKLY', rentalRate: 350,
  contractDuration: 104, totalAmountPaid: 0, paymentHistory: [], ...overrides,
});
const pay = (date: string, amount: number, serviceClaim = 0, id = date) => ({ id, date, amount, serviceClaim });
const date = '2026-09-06';

test('rolling observation covers exactly 56 KL calendar dates', () => {
  assert.equal(getReportDate(new Date('2026-09-05T17:00:00Z')), date);
  const r = analyseTerminationEvidence(driver(), date);
  assert.equal(r.windowStart, '2026-07-13');
  assert.equal(r.snapshotDate, '2026-07-12');
  assert.equal(r.weeks.length, 8);
  assert.equal(r.weeks[7].end, date);
  assert.equal(analyseTerminationEvidence(driver(), '2026-09-07').windowStart, '2026-07-14');
});

test('repeated zero weeks, cash shortfall and increasing arrears support recommendation', () => {
  const r = analyseTerminationEvidence(driver({ paymentHistory: [pay('2026-08-04', 1400)] }), date);
  assert.equal(r.recommended, true);
  assert.equal(r.rentalDue, 2800);
  assert.equal(r.cashReceived, 1400);
  assert.equal(r.fullWeeks, 1);
  assert.equal(r.zeroWeeks, 7);
  assert.equal(r.partialWeeks, 0);
  assert.equal(r.currentOutstanding, 1400);
  assert.equal(r.outstandingMovement, 1400);
  assert.equal(r.daysSinceLastCash, 33);
  assert.equal(r.lastCashPayment?.amount, 1400);
  assert.equal(r.averageDaysLate, 11.5);
  assert.equal(r.oldestUnpaidInvoice, '2026-08-10');
});

test('high historical debt with current coverage and falling arrears is excluded', () => {
  const dates = ['07-13','07-20','07-27','08-03','08-10','08-17','08-24','08-31'];
  const r = analyseTerminationEvidence(driver({ contractStartDate: '2026-01-05', paymentHistory: dates.map(d=>pay('2026-'+d,450)) }), date);
  assert(r.currentOutstanding > 5000);
  assert(r.outstandingMovement < 0);
  assert.equal(r.recommended, false);
  assert.equal(r.exclusion, 'RECOVERING_OR_CURRENTLY_COVERED');
});

test('recovery in the latest four weeks prevents a stale eight-week recommendation', () => {
  const r = analyseTerminationEvidence(driver({ contractStartDate: '2026-01-05', paymentHistory: ['08-10','08-17','08-24','08-31'].map(d=>pay('2026-'+d,400)) }), date);
  assert(r.cashCoverage < 0.7);
  assert.equal(r.recommended, false);
  assert.equal(r.exclusion, 'RECOVERING_OR_CURRENTLY_COVERED');
});

test('pre-commencement weeks have no due and new accounts are not penalised', () => {
  const r = analyseTerminationEvidence(driver({ contractStartDate: '2026-08-25' }), date);
  assert.equal(r.weeks.filter(w=>w.result==='NO_RENT_DUE').length, 6);
  assert.equal(r.failureWeeks, 2);
  assert.equal(r.recommended, false);
  assert.equal(r.exclusion, 'INSUFFICIENT_OBSERVATION');
});

test('service credits reduce balances but never count as cash, cash days or meaningful payments', () => {
  const r = analyseTerminationEvidence(driver({ paymentHistory: [pay('2026-08-04', 0, 2800)] }), date);
  assert.equal(r.cashReceived, 0);
  assert.equal(r.serviceCredits, 2800);
  assert.equal(r.currentOutstanding, 0);
  assert.equal(r.zeroWeeks, 8);
  assert.equal(r.lastCashPayment, null);
  assert.equal(r.averageDaysLate, null);
  assert.equal(r.recommended, false);
});

test('same-day split payments count together towards a meaningful payment', () => {
  const r = analyseTerminationEvidence(driver({ paymentHistory: [pay('2026-08-20',200,0,'a'),pay('2026-08-20',150,0,'b'),pay('2026-09-01',10)] }), date);
  assert.deepEqual(r.lastMeaningfulPayment, { date:'2026-08-20', amount:350 });
  assert.equal(r.lastCashPayment?.amount, 10);
  assert.equal(r.daysSinceLastMeaningful, 17);
});

test('monthly contracts use billing cycles rather than weekly failure counts', () => {
  const r = analyseTerminationEvidence(driver({ rentalCycle:'MONTHLY',rentalRate:1900,contractStartDate:'2026-01-18',contractDuration:12,paymentHistory:[pay('2026-08-29',800)] }), date);
  assert.equal(r.rentalDue, 3800);
  assert.equal(r.cashReceived, 800);
  assert.equal(r.outstandingMovement, 3000);
  assert.equal(r.weeks.length, 0);
  assert.equal(r.failureWeeks, null);
  assert.equal(r.billingCycles.length, 2);
  assert.equal(r.underpaidCycles, 2);
  assert.equal(r.recommended, true);
});

test('a monthly cycle only just due does not create persistent non-performance', () => {
  const r = analyseTerminationEvidence(driver({ rentalCycle:'MONTHLY',rentalRate:1900,contractStartDate:'2026-09-01',contractDuration:12 }), date);
  assert.equal(r.recommended, false);
});

test('moderate repeated partial payments can qualify when deterioration and old arrears corroborate them', () => {
  const r = analyseTerminationEvidence(driver({ contractStartDate:'2026-01-05',paymentHistory:['07-13','07-20','07-27','08-03','08-10','08-17','08-24','08-31'].map(d=>pay('2026-'+d,260)) }), date);
  assert(r.cashCoverage > .7);
  assert.equal(r.partialWeeks,8);
  assert.equal(r.recommended,true);
});

test('high debt alone and isolated missed payments never suffice', () => {
  const r = analyseTerminationEvidence(driver({contractStartDate:'2026-01-05',paymentHistory:['07-13','07-20','07-27','08-03','08-10','08-17','08-24'].map(d=>pay('2026-'+d,350))}),date);
  assert.equal(r.failureWeeks,1);
  assert(r.currentOutstanding > 5000);
  assert.equal(r.recommended,false);
});

test('future payments cannot reduce current or historical arrears', () => {
  const a=analyseTerminationEvidence(driver(),date);
  const b=analyseTerminationEvidence(driver({paymentHistory:[pay('2026-09-07',50000)]}),date);
  assert.equal(a.currentOutstanding,b.currentOutstanding);
  assert.equal(b.lastCashPayment,null);
  assert.equal(b.cashReceived,0);
});

test('unverified post-duration accrual is shown as a data issue and cannot justify recommendation', () => {
  const r=analyseTerminationEvidence(driver({contractDuration:6}),date);
  assert.equal(r.currentOutstanding,2800);
  assert.equal(r.recommended,false);
  assert.equal(r.exclusion,'DATA_EXCEPTION');
  assert(r.dataIssues.some(x=>x.includes('duration')));
});

test('invalid or negative ledger entries block recommendations rather than silently disappearing', () => {
  for(const p of [pay('invalid',500),pay('2026-08-01',-50)]){
    const r=analyseTerminationEvidence(driver({paymentHistory:[p]}),date);
    assert.equal(r.recommended,false);
    assert.equal(r.exclusion,'DATA_EXCEPTION');
  }
});

test('only active recommended accounts appear, with deterministic severity ordering and no mutation', () => {
  const worse=driver({id:'worse'}),less=driver({id:'less',paymentHistory:[pay('2026-08-04',1400)]}),delisted=driver({id:'delisted',isDelisted:true});
  const input=[less,delisted,worse],before=JSON.stringify(input);
  const report=buildTerminationReport(input,date);
  assert.deepEqual(report.recommendations.map(r=>r.driver.id),['worse','less']);
  assert.equal(JSON.stringify(input),before);
  assert.equal('score' in report.recommendations[0],false);
});

test('an active flag cannot trigger termination of a contract already recorded as ended', () => {
  const r=analyseTerminationEvidence(driver({contractEndDate:'2026-08-31'}),date);
  assert.equal(r.currentOutstanding,2450);
  assert.equal(r.recommended,false);
  assert.equal(r.exclusion,'DATA_EXCEPTION');
});
