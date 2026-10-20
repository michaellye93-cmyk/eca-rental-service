import test from 'node:test';
import assert from 'node:assert/strict';
import { hpSchedule, type VehicleLoan } from '../services/finance/loans.ts';

// Fixture cars and made-up amounts only.
const loan = (overrides: Partial<VehicleLoan> = {}): VehicleLoan => ({
  id: 'loan-1', plate_key: 'XAA1001', display_plate: 'XAA 1001', bank: 'Fixture Bank', finance_amount: 30000,
  flat_rate_percent: 3, tenure_months: 60, first_payment_date: '2024-01-15', downpayment: 3000, monthly_instalment: 575,
  status: 'ACTIVE', closed_on: null, notes: null, ...overrides,
});
const sen = (value: number) => Math.round(value * 100);
const round2 = (value: number) => Math.round(value * 100) / 100;

test('the HP schedule has one row per instalment, digits counting down, and the bank absorbs rounding in the last one', () => {
  const schedule = hpSchedule(loan());
  assert.equal(schedule.rows.length, 60);
  assert.equal(schedule.sumOfDigits, 1830);
  assert.equal(schedule.totalInterest, 4500);
  assert.equal(schedule.totalPayable, 34500);
  assert.deepEqual(schedule.rows.map((row) => row.digit), Array.from({ length: 60 }, (_, i) => 60 - i));
  assert.deepEqual(schedule.rows.map((row) => row.number), Array.from({ length: 60 }, (_, i) => i + 1));
  for (const row of schedule.rows.slice(0, 59)) assert.equal(row.amount, 575);
  assert.equal(schedule.rows[59].amount, round2(34500 - 59 * 575));
  // A rounded bank instalment: the final one makes up the difference, above or below the rest.
  const rounded = hpSchedule(loan({ finance_amount: 38000, monthly_instalment: 729 }));
  assert.equal(rounded.totalPayable, 43700);
  assert.equal(rounded.rows[59].amount, round2(43700 - 59 * 729));
});

test('the interest is split by the Rule of 78 and sums exactly to the total; principal sums to the finance amount', () => {
  for (const fixture of [loan(), loan({ finance_amount: 38000, monthly_instalment: 729 }), loan({ finance_amount: 32000, flat_rate_percent: 2.9, tenure_months: 84, monthly_instalment: 459 })]) {
    const schedule = hpSchedule(fixture);
    const interest = schedule.rows.reduce((sum, row) => sum + sen(row.interest), 0);
    const principal = schedule.rows.reduce((sum, row) => sum + sen(row.principal), 0);
    assert.equal(interest, sen(schedule.totalInterest), 'interest to the sen');
    assert.equal(principal, sen(fixture.finance_amount), 'principal to the sen');
    for (const row of schedule.rows) assert.equal(sen(row.amount), sen(row.interest) + sen(row.principal));
  }
  const schedule = hpSchedule(loan());
  assert.equal(schedule.rows[0].interest, round2((4500 * 60) / 1830));
  assert.equal(schedule.rows[0].principal, round2(575 - round2((4500 * 60) / 1830)));
  assert.ok(schedule.rows[0].interest > schedule.rows[58].interest, 'interest falls month by month');
});

test('instalment dates keep the day of month, capped at the month end, from the first payment date', () => {
  const schedule = hpSchedule(loan());
  assert.equal(schedule.rows[0].date, '2024-01-15');
  assert.equal(schedule.rows[30].date, '2026-07-15');
  assert.equal(schedule.rows[59].date, '2028-12-15');
  const monthEnd = hpSchedule(loan({ first_payment_date: '2024-01-31' }));
  assert.deepEqual(monthEnd.rows.slice(0, 4).map((row) => row.date), ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
  assert.equal(monthEnd.rows[13].date, '2025-02-28');
});

test('year-end rows fall at each March and the last instalment, with the financial year totals and the balance due', () => {
  const schedule = hpSchedule(loan());
  const yearEnds = schedule.rows.filter((row) => row.yearEnd);
  assert.deepEqual(yearEnds.map((row) => row.number), [3, 15, 27, 39, 51, 60]);
  for (const row of schedule.rows) assert.equal(Boolean(row.yearEnd), row.date.slice(5, 7) === '03' || row.number === 60);
  const first = schedule.rows[2].yearEnd!;
  const firstThree = schedule.rows.slice(0, 3);
  assert.equal(first.label, '31.03.2024');
  assert.equal(first.instalments, round2(firstThree.reduce((sum, row) => sum + row.amount, 0)));
  assert.equal(first.interest, round2(firstThree.reduce((sum, row) => sum + row.interest, 0)));
  assert.equal(first.principal, round2(firstThree.reduce((sum, row) => sum + row.principal, 0)));
  assert.equal(first.balance, round2(30000 - firstThree.reduce((sum, row) => sum + row.principal, 0)));
  // The next year counts only its own twelve instalments.
  const second = schedule.rows[14].yearEnd!;
  assert.equal(second.label, '31.03.2025');
  assert.equal(second.instalments, 575 * 12);
  const last = schedule.rows[59].yearEnd!;
  assert.equal(last.label, '15.12.2028', 'the last instalment is not in March: its own date');
  assert.equal(last.balance, 0);
  // The year totals add up to the whole loan.
  assert.equal(yearEnds.reduce((sum, row) => sum + sen(row.yearEnd!.interest), 0), sen(4500));
  assert.equal(yearEnds.reduce((sum, row) => sum + sen(row.yearEnd!.principal), 0), sen(30000));
});

test('a one-instalment loan is a single year-end row, and a last instalment in March keeps the 31.03 label', () => {
  const single = hpSchedule(loan({ tenure_months: 1, finance_amount: 1200, flat_rate_percent: 0, monthly_instalment: 1200, first_payment_date: '2025-06-10' }));
  assert.equal(single.rows.length, 1);
  assert.equal(single.sumOfDigits, 1);
  assert.deepEqual(single.rows[0], { date: '2025-06-10', number: 1, digit: 1, amount: 1200, interest: 0, principal: 1200, yearEnd: { label: '10.06.2025', instalments: 1200, interest: 0, principal: 1200, balance: 0 } });
  const march = hpSchedule(loan({ first_payment_date: '2024-04-05' }));
  assert.equal(march.rows[59].date, '2029-03-05');
  assert.equal(march.rows[59].yearEnd!.label, '31.03.2029');
  // Figures read back as text from the database still work.
  const strings = hpSchedule(loan({ finance_amount: '30000' as unknown as number, flat_rate_percent: '3' as unknown as number, monthly_instalment: '575' as unknown as number }));
  assert.equal(strings.totalPayable, 34500);
});
