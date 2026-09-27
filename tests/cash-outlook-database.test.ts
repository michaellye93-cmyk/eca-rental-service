import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_ID, asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';

const FINANCE_MIGRATIONS = [
  '20260915084108_secure_profile_roles.sql',
  '20260915084110_finance_foundation.sql',
  '20260915085705_finance_bank_statements.sql',
  '20260915104015_finance_section_workflows.sql',
  '20260915120802_finance_delete_vehicle.sql',
  '20260915122156_finance_insurance_responsibility.sql',
  '20260915124812_finance_insurance_premium_rules.sql',
  '20260915132423_finance_shared_recurring_opex.sql',
  '20260920070959_finance_editable_safe_imports.sql',
  '20260920103854_finance_fixed_cost_same_start_edit.sql',
  '20260920111527_simplify_operation_fixed_costs.sql',
];
const MIGRATION = '20260927090000_cash_position_and_outlook.sql';
const TODAY = '2026-09-27';

async function setup() {
  const db = await database();
  for (const file of [...FINANCE_MIGRATIONS, MIGRATION]) await migrate(db, file);
  await db.exec(`reset role;
    insert into finance_private.vehicles(plate_key,display_plate,business_unit,ownership_type,status,deleted_at) values
      ('XAA1001','XAA 1001','E-HAILING','Owner','Active',null),
      ('XAB2001','XAB 2001','DAILY RENTAL','Financed','Active',null),
      ('XAC3001','XAC 3001','E-HAILING','Owner','Returned',now()),
      ('XAD4001','XAD 4001','SAMBUNG BAYAR','Owner','Active',null);
    insert into finance_private.recurring_costs(id,plate_key,start_month,end_month,cost_type,monthly_amount) values
      ('10000000-0000-4000-8000-000000000001','XAA1001','2026-08-01',null,'Owner Payout',800),
      ('10000000-0000-4000-8000-000000000002','XAA1001','2026-08-01',null,'Owner Payout / Loan - To Classify',800),
      ('10000000-0000-4000-8000-000000000003','XAB2001','2026-08-01','2026-10-01','Hire Purchase / Loan',500),
      ('10000000-0000-4000-8000-000000000004','XAD4001','2026-09-01',null,'Owner Payout',300),
      ('10000000-0000-4000-8000-000000000005','XAD4001','2026-09-01',null,'Hire Purchase / Loan',300),
      ('10000000-0000-4000-8000-000000000006','XAA1001','2026-08-01',null,'Owner Payout',999);
    update finance_private.recurring_costs set cancelled_at=now(),cancelled_by='${ADMIN_ID}',cancellation_reason='entered twice' where id='10000000-0000-4000-8000-000000000006';
    -- XAD4001's two equal costs were confirmed as separate obligations, so they are not flagged as duplicates.
    insert into finance_private.recurring_duplicate_resolutions(obligation_a,obligation_b,fingerprint,reason,resolved_by)
      values('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','fixture','Two separate agreements','${ADMIN_ID}');
    insert into finance_private.fixed_cost_templates(id,category,monthly_amount,effective_from,effective_until) values
      ('20000000-0000-4000-8000-000000000001','Office Rental',1000,'2026-08-01',null),
      ('20000000-0000-4000-8000-000000000002','Internet',200,'2026-08-01','2026-09-01');
    insert into finance_private.insurance(plate_key,premium,coverage_start,coverage_end,responsibility) values
      ('XAA1001',1200,'2025-10-16','2026-10-15','ECA_PAID'),
      ('XAB2001',0,null,null,'OWNER_PAID'),
      ('XAB2001',900,'2026-10-20','2027-10-19','ECA_PAID'),
      ('XAC3001',700,'2025-10-02','2026-10-01','ECA_PAID'),
      ('XAD4001',650,'2025-06-01','2026-05-31','ECA_PAID');
    insert into finance_private.months(finance_month,refreshed_at) values('2026-07-01',now()),('2026-08-01',now());
    insert into finance_private.expenses(id,finance_month,billing_date,plate_key,category,payment_source,amount) values
      ('30000000-0000-4000-8000-000000000001','2026-08-01','2026-08-10','XAA1001','Service & Maintenance','Workshop Billing',2600),
      ('30000000-0000-4000-8000-000000000002','2026-08-01','2026-08-12','XAA1001','Service & Maintenance','Workshop Billing',400),
      ('30000000-0000-4000-8000-000000000003','2026-08-01','2026-08-15','XAB2001','Tyres','Vehicle Direct Cost',600),
      ('30000000-0000-4000-8000-000000000004','2026-08-01','2026-08-28',null,'Salary','Corporate Opex',900),
      ('30000000-0000-4000-8000-000000000005','2026-08-01','2026-08-05','XAB2001','Repair','Vehicle Direct Cost',5000);
    update finance_private.expenses set cancelled_at=now(),cancelled_by='${ADMIN_ID}',cancellation_reason='wrong month' where id='30000000-0000-4000-8000-000000000005';
    insert into finance_private.expenses(finance_month,billing_date,plate_key,category,payment_source,amount,fixed_cost_template_id)
      values('2026-08-01','2026-08-01',null,'Office Rental','Corporate Opex',1000,'20000000-0000-4000-8000-000000000001');
    insert into finance_private.workshop_summaries(id,finance_month,amount,created_by) values('40000000-0000-4000-8000-000000000001','2026-08-01',1000,'${ADMIN_ID}');
    insert into finance_private.workshop_allocations(summary_id,expense_id,allocated_by) values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','${ADMIN_ID}');
    insert into finance_private.imports(id,finance_month,kind,filename,imported_by,row_count,status) values('50000000-0000-4000-8000-000000000001','2026-08-01','SMART_DRIVE','smart.xlsx','${ADMIN_ID}',1,'POSTED');
    insert into finance_private.smart_rows(import_id,source_row,sheet_name,plate_key,display_plate,pickup_date,return_date,gross_revenue,commission,status)
      values('50000000-0000-4000-8000-000000000001',2,'Sales','XAB2001','XAB 2001','2026-08-03','2026-08-05',2000,300,'Completed');
    insert into finance_private.other_income(finance_month,status,income_type,amount,business_unit,confirmation_key,created_by)
      values('2026-08-01','CONFIRMED','Deposit forfeited',500,'E-HAILING','k1','${ADMIN_ID}'),
            ('2026-08-01','DRAFT','Not confirmed',9999,'E-HAILING','k2','${ADMIN_ID}');`);
  await asUser(db);
  return db;
}
const call = async <T>(db: any, sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0].value as T;
const outlook = (db: any) => call<any>(db, `select public.finance_cash_outlook($1::date) value`, [TODAY]);

test('the cash outlook adds up monthly obligations, dated insurance and last three months, for Admins only', async () => {
  const db = await setup();
  try {
    const data = await outlook(db);
    assert.equal(data.today, TODAY);
    assert.deepEqual(data.balances, []);
    // Cancelled costs are ignored; XAB2001's loan ends in October; Internet ended in September.
    assert.deepEqual(data.months, [
      { month: '2026-09-01', recurring: 2700, fixed: 1200 },
      { month: '2026-10-01', recurring: 2700, fixed: 1000 },
      { month: '2026-11-01', recurring: 2200, fixed: 1000 },
      { month: '2026-12-01', recurring: 2200, fixed: 1000 },
    ]);
    // A renewal the day after cover ends at the last premium; a policy already recorded is paid on its start date.
    // Owner-paid, deleted-vehicle and long-lapsed policies are left out.
    assert.deepEqual(data.insurance, [
      { plate_key: 'XAA1001', display_plate: 'XAA 1001', due_date: '2026-10-16', amount: 1200, kind: 'RENEWAL' },
      { plate_key: 'XAB2001', display_plate: 'XAB 2001', due_date: '2026-10-20', amount: 900, kind: 'PAYMENT' },
    ]);
    assert.deepEqual(data.history, [
      { month: '2026-06-01', has_data: false, workshop: 0, vehicle_costs: 0, one_off_opex: 0, smart_drive_net: 0, other_income: 0 },
      { month: '2026-07-01', has_data: true, workshop: 0, vehicle_costs: 0, one_off_opex: 0, smart_drive_net: 0, other_income: 0 },
      // Workshop = bills 3,000 + the summary's unallocated 600; the template's Office Rental occurrence is not one-off.
      { month: '2026-08-01', has_data: true, workshop: 3600, vehicle_costs: 600, one_off_opex: 900, smart_drive_net: 1700, other_income: 500 },
    ]);
    // XAA1001 has the same RM800 twice; XAD4001's pair was confirmed as separate.
    assert.deepEqual(data.duplicate_recurring, { vehicles: 1, monthly_amount: 800 });

    await asUser(db, STAFF_ID);
    await assert.rejects(outlook(db), /Admin/);
    await db.exec('reset role; set role anon');
    await assert.rejects(outlook(db), /permission denied/);
  } finally { await db.close(); }
});

test('the bank balance entry keeps an audited list; the latest per account is what counts', async () => {
  const db = await setup();
  try {
    let rows = await call<any[]>(db, `select public.finance_save_cash_balance('Maybank operating', 12500.5, current_date - 1, 'Weekly check') value`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].account_label, 'Maybank operating');
    assert.equal(Number(rows[0].balance), 12500.5);
    // An overdraft is a negative balance; tomorrow is accepted because Malaysia is ahead of the database clock.
    rows = await call<any[]>(db, `select public.finance_save_cash_balance(' CIMB current ', -300, current_date + 1, null) value`);
    assert.deepEqual(rows.map(r => [r.account_label, Number(r.balance)]), [['CIMB current', -300], ['Maybank operating', 12500.5]]);
    await assert.rejects(db.query(`select public.finance_save_cash_balance('Maybank operating', 10, current_date + 2, null)`), /future/);
    await assert.rejects(db.query(`select public.finance_save_cash_balance('Maybank operating', 10.005, current_date, null)`), /two decimals/);
    await assert.rejects(db.query(`select public.finance_save_cash_balance('   ', 10, current_date, null)`), /account name/);

    const cimb = rows.find(r => r.account_label === 'CIMB current');
    await assert.rejects(db.query(`select public.finance_cancel_cash_balance($1, '  ')`, [cimb.id]), /reason/);
    rows = await call<any[]>(db, `select public.finance_cancel_cash_balance($1, 'Typed the wrong account') value`, [cimb.id]);
    assert.deepEqual(rows.map(r => r.account_label), ['Maybank operating']);
    await assert.rejects(db.query(`select public.finance_cancel_cash_balance($1, 'again')`, [cimb.id]), /not found/);
    assert.deepEqual((await outlook(db)).balances.map((r: any) => r.account_label), ['Maybank operating']);

    await assert.rejects(db.query(`select * from finance_private.cash_balances`), /permission denied/);
    await asUser(db, STAFF_ID);
    await assert.rejects(db.query(`select public.finance_save_cash_balance('Staff attempt', 1, current_date, null)`), /Admin/);
    await db.exec('reset role');
    const audit = await db.query<{ action: string }>(`select action from finance_private.audit where action like 'CASH_BALANCE%' order by occurred_at, action`);
    assert.deepEqual(audit.rows.map(r => r.action).sort(), ['CASH_BALANCE_REMOVED', 'CASH_BALANCE_SAVED', 'CASH_BALANCE_SAVED']);
  } finally { await db.close(); }
});
