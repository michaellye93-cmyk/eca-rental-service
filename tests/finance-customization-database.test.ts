import test from 'node:test';
import assert from 'node:assert/strict';
import { asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';
import type { FinanceInput } from '../types/finance.ts';
import { buildFinanceReport } from '../services/finance/calculations.ts';

const migration = '20260920070959_finance_editable_safe_imports.sql';
const august = '2026-08-01';

async function setup() {
  const db = await database();
  for (const file of [
    '20260915084108_secure_profile_roles.sql',
    '20260915084110_finance_foundation.sql',
    '20260915085705_finance_bank_statements.sql',
    '20260915104015_finance_section_workflows.sql',
    '20260915120802_finance_delete_vehicle.sql',
    '20260915122156_finance_insurance_responsibility.sql',
    '20260915124812_finance_insurance_premium_rules.sql',
    '20260915132423_finance_shared_recurring_opex.sql',
    migration,
  ]) await migrate(db, file);
  await db.exec(`reset role;
    insert into finance_private.vehicles(plate_key,display_plate,business_unit,ownership_type,status)
    values ('XAB2001','XAB 2001','SAMBUNG BAYAR','Owner','Active'),('ABC123','ABC 123','E-HAILING','Owner','Active');
    insert into finance_private.recurring_costs(plate_key,start_month,end_month,cost_type,monthly_amount,payee,notes)
    values ('ABC123','2026-07-01',null,'Owner Payout',750,'Owner A','Original rate');`);
  await asUser(db);
  return db;
}

const call = async <T>(db: any, name: string, args: unknown[]) =>
  (await db.query<{ value: T }>(`select public.${name}(${args.map((_, index) => '$' + (index + 1)).join(',')}) value`, args)).rows[0].value;
const read = (db: any, month = august) => call<FinanceInput>(db, 'finance_read_month', [month]);

test('legacy rows receive distinct stable identities and effective edits never overlap', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    const original = input.recurring_costs[0];
    assert.ok(original.id);
    assert.equal(original.obligation_id, original.id);
    input = await call(db, 'finance_mutate_record', ['recurring_cost', 'UPDATE', JSON.stringify({ ...original, monthly_amount: 900 }), august, input.month.revision, 'Rate revised from August']);
    const versions = input.recurring_costs.filter((row: any) => row.obligation_id === original.id && !row.cancelled_at);
    assert.deepEqual(versions.map((row: any) => [row.start_month, row.end_month, row.monthly_amount]), [
      ['2026-07-01', '2026-07-01', 750],
      ['2026-08-01', null, 900],
    ]);
    assert.equal(new Set(versions.map((row: any) => row.obligation_id)).size, 1);

    input = await call(db, 'finance_mutate_record', ['recurring_cost', 'ADD', JSON.stringify({ plate_key: 'ABC123', start_month: august, end_month: null, cost_type: 'Owner Payout', monthly_amount: 900, payee: 'Owner B', notes: 'Separate reviewed obligation' }), august, input.month.revision, 'Separate contract']);
    assert.equal(input.recurring_costs.filter((row: any) => row.start_month === august && !row.cancelled_at).length, 2);
  } finally { await db.close(); }
});

test('safe import preview is record-idempotent and stale or tampered approvals post nothing', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    const rows = [{ source_row: 2, sheet_name: 'Vehicle Monthly Costs', plate_key: 'ABC123', start_month: '2026-07-01', end_month: null, cost_type: 'Owner Payout', monthly_amount: 750, payee: 'Owner A', notes: 'Original rate' }];
    let preview: any = await call(db, 'finance_preview_section_import', ['RECURRING_COST', august, 'costs.xlsx', JSON.stringify(rows), input.month.revision, 'a'.repeat(64), 'UPDATE', null]);
    assert.equal(preview.counts.unchanged, 1);
    assert.equal(preview.current_total, 750);
    assert.equal(preview.proposed_total, 750);
    await assert.rejects(call(db, 'finance_apply_section_import', [preview.preview_token, JSON.stringify([{ ...preview.changes[0], action: 'NEW' }]), input.month.revision]), /confirmation.*changed|does not match/i);
    assert.equal((await read(db)).recurring_costs.length, 1);

    preview = await call(db, 'finance_preview_section_import', ['RECURRING_COST', august, 'renamed.xlsx', JSON.stringify(rows), input.month.revision, 'b'.repeat(64), 'UPDATE', null]);
    await db.query(`select public.finance_mutate_record('recurring_cost','ADD',$1::jsonb,$2,$3,$4)`, [JSON.stringify({ plate_key: 'ABC123', start_month: august, cost_type: 'Hire Purchase / Loan', monthly_amount: 10 }), august, input.month.revision, 'Concurrent edit']);
    await assert.rejects(call(db, 'finance_apply_section_import', [preview.preview_token, JSON.stringify(preview.changes), input.month.revision]), /changed.*reload|stale/i);
    assert.equal((await read(db)).recurring_costs.length, 2);
  } finally { await db.close(); }
});

test('record cancellation is audited, affects open calculations only, and cannot rewrite a closed snapshot', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    const cost = input.recurring_costs[0];
    input = await call(db, 'finance_mutate_record', ['recurring_cost', 'CANCEL', JSON.stringify({ id: cost.id }), august, input.month.revision, 'Confirmed duplicate']);
    assert.ok(input.recurring_costs.find((row: any) => row.id === cost.id)?.cancelled_at);
    await db.exec('reset role');
    const audit = await db.query<{ action: string; details: any }>(`select action,details from finance_private.audit where action='CANCEL_FINANCE_RECORD'`);
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].details.before.id, cost.id);
    await db.exec(`update finance_private.months set status='CLOSED', frozen_input=finance_private.input('2026-08-01'), frozen_at=now() where finance_month='2026-08-01'`);
    await asUser(db);
    const frozen = JSON.stringify(await read(db));
    await assert.rejects(call(db, 'finance_mutate_record', ['recurring_cost', 'ADD', JSON.stringify({ plate_key: 'ABC123', start_month: august, cost_type: 'Loan', monthly_amount: 1 }), august, input.month.revision, 'No']), /closed|reopen/i);
    assert.equal(JSON.stringify(await read(db)), frozen);
  } finally { await db.close(); }
});

test('fixed defaults generate once, retain tombstones, and isolate one-month overrides', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    input = await call(db, 'finance_save_fixed_cost', ['ADD', JSON.stringify({ category: 'Utilities', monthly_amount: 400, effective_from: august, effective_until: null, payee: 'Utility Co', note: null }), august, input.month.revision]);
    assert.equal(input.expenses.filter((row: any) => row.fixed_cost_template_id).length, 1);
    const occurrence = input.expenses.find((row: any) => row.fixed_cost_template_id)!;
    input = await call(db, 'finance_mutate_record', ['expense', 'UPDATE', JSON.stringify({ ...occurrence, amount: 465 }), august, input.month.revision, 'August actual']);
    assert.equal(input.expenses.find((row: any) => row.id === occurrence.id)?.amount, 465);

    let september = await read(db, '2026-09-01');
    september = await call(db, 'finance_generate_fixed_costs', ['2026-09-01', september.month.revision]);
    assert.equal(september.expenses.find((row: any) => row.fixed_cost_template_id)?.amount, 400);
    const sepOccurrence = september.expenses.find((row: any) => row.fixed_cost_template_id)!;
    september = await call(db, 'finance_mutate_record', ['expense', 'CANCEL', JSON.stringify({ id: sepOccurrence.id }), '2026-09-01', september.month.revision, 'No bill this month']);
    september = await call(db, 'finance_generate_fixed_costs', ['2026-09-01', september.month.revision]);
    assert.equal(september.expenses.filter((row: any) => row.fixed_cost_template_id && !row.cancelled_at).length, 0);
  } finally { await db.close(); }
});

test('workshop summary allocation preserves group cost and enforces month, business and ceiling', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    input = await call(db, 'finance_save_workshop_summary', ['ADD', JSON.stringify({ finance_month: august, amount: 3000, business_unit: 'E-HAILING', supplier: 'Workshop A', reference: 'AUG', note: null }), input.month.revision]);
    const summary: any = input.workshop_summaries?.[0];
    input = await call(db, 'finance_mutate_record', ['expense', 'ADD', JSON.stringify({ finance_month: august, billing_date: '2026-08-15', plate_key: 'ABC123', category: 'Service & Maintenance', payment_source: 'Workshop Billing', supplier: 'Workshop A', amount: 2000, reference: 'AUG-ALLOC', description: null }), august, input.month.revision, 'Workshop allocation']);
    const expense = input.expenses.find((row: any) => row.reference === 'AUG-ALLOC')!;
    input = await call(db, 'finance_link_workshop_allocation', [summary.id, expense.id, input.month.revision]);
    assert.equal(input.workshop_summaries?.[0].allocated_amount, 2000);
    assert.equal(input.workshop_summaries?.[0].unallocated_amount, 1000);
    input = await call(db, 'finance_mutate_record', ['expense', 'ADD', JSON.stringify({ finance_month: august, billing_date: null, plate_key: 'XAB2001', category: 'Service & Maintenance', payment_source: 'Workshop Billing', supplier: 'Workshop B', amount: 300, reference: 'MONTH-TOTAL', description: 'Monthly vehicle service total', frequency: 'MONTHLY_SUMMARY', start_month: august, end_month: august }), august, input.month.revision, 'Monthly vehicle total without fabricated date']);
    const monthTotal = input.expenses.find((row: any) => row.reference === 'MONTH-TOTAL')!;
    assert.equal(monthTotal.billing_date, null);
    assert.equal(monthTotal.frequency, 'MONTHLY_SUMMARY');
    input = await call(db, 'finance_mutate_record', ['expense', 'ADD', JSON.stringify({ ...expense, id: undefined, amount: 1200, reference: 'OVER' }), august, input.month.revision, 'Separate workshop bill']);
    const over = input.expenses.find((row: any) => row.reference === 'OVER')!;
    await assert.rejects(call(db, 'finance_link_workshop_allocation', [summary.id, over.id, input.month.revision]), /exceed/i);
  } finally { await db.close(); }
});

test('confirmed Other Income is idempotent, derives vehicle business and excludes drafts', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    const record = { finance_month: august, status: 'CONFIRMED', income_type: 'Sambung Bayar', amount: 1400, plate_key: 'XAB2001', business_unit: null, receipt_date: null, reference: 'SB-AUG', notes: null };
    input = await call(db, 'finance_save_other_income', ['ADD', JSON.stringify(record), input.month.revision]);
    assert.equal(input.other_income?.[0].business_unit, 'SAMBUNG BAYAR');
    assert.equal(input.other_income?.[0].amount, 1400);
    const nextRevision = input.month.revision;
    input = await call(db, 'finance_save_other_income', ['ADD', JSON.stringify(record), nextRevision]);
    assert.equal(input.other_income?.length, 1);
    let september = await read(db, '2026-09-01');
    september = await call(db, 'finance_save_other_income', ['ADD', JSON.stringify({ ...record, status: 'DRAFT', finance_month: '2026-09-01', reference: 'SB-SEP-DRAFT' }), september.month.revision]);
    assert.equal(september.other_income?.filter((row: any) => row.status === 'CONFIRMED').length, 0);
    await asUser(db, STAFF_ID);
    await assert.rejects(call(db, 'finance_save_other_income', ['ADD', JSON.stringify(record), input.month.revision]), /Admin|permission/i);
  } finally { await db.close(); }
});

test('vehicle and workshop imports round-trip by stable identity and undo only their own records', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    const vehicleRows = [{ source_row: 2, sheet_name: 'Vehicle Master', plate_key: 'ABC123', display_plate: 'ABC 123', business_unit: 'E-HAILING', ownership_type: 'Owner', status: 'Active' }];
    const vehiclePreview: any = await call(db, 'finance_preview_section_import', ['VEHICLE', august, 'vehicles.xlsx', JSON.stringify(vehicleRows), input.month.revision, 'c'.repeat(64), 'UPDATE', null]);
    assert.equal(vehiclePreview.counts.unchanged, 1);

    const workshopRows = [{ source_row: 2, sheet_name: 'Workshop', finance_month: august, billing_date: '2026-08-12', plate_key: 'ABC123', category: 'Service & Maintenance', payment_source: 'Workshop Billing', supplier: 'Workshop A', amount: 80, reference: 'W-1', description: 'Service', frequency: 'ONE_OFF' }];
    const preview: any = await call(db, 'finance_preview_section_import', ['WORKSHOP', august, 'workshop.xlsx', JSON.stringify(workshopRows), input.month.revision, 'd'.repeat(64), 'UPDATE', null]);
    input = await call(db, 'finance_apply_section_import', [preview.preview_token, JSON.stringify(preview.changes), input.month.revision]);
    assert.equal(input.expenses.filter((row: any) => !row.cancelled_at).length, 1);
    let repeat: any = await call(db, 'finance_preview_section_import', ['WORKSHOP', august, 'renamed.xlsx', JSON.stringify(workshopRows), input.month.revision, 'e'.repeat(64), 'UPDATE', null]);
    assert.equal(repeat.counts.needs_review, 1);
    repeat = await call(db, 'finance_preview_section_import', ['WORKSHOP', august, 'renamed.xlsx', JSON.stringify([{ ...workshopRows[0], resolution: 'KEEP_EXISTING' }]), input.month.revision, 'e'.repeat(64), 'UPDATE', null]);
    assert.equal(repeat.counts.unchanged, 1);
    const meta: any = await call(db, 'finance_workspace_meta', [august]);
    const upload = meta.uploads.find((row: any) => row.kind === 'workshop');
    input = await call(db, 'finance_undo_section_import', [upload.id, input.month.revision]);
    assert.equal(input.expenses.filter((row: any) => !row.cancelled_at).length, 0);
  } finally { await db.close(); }
});

test('safe imports flag repeated rows and undo both sides of a rate version', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    const duplicateRows = [2, 3].map((source_row) => ({ source_row, sheet_name: 'Vehicle Monthly Costs', plate_key: 'ABC123', start_month: august, end_month: null, cost_type: 'Hire Purchase / Loan', monthly_amount: 250, payee: 'Lender B', notes: null }));
    const duplicates: any = await call(db, 'finance_preview_section_import', ['RECURRING_COST', august, 'duplicate.xlsx', JSON.stringify(duplicateRows), input.month.revision, 'f'.repeat(64), 'UPDATE', null]);
    assert.equal(duplicates.counts.needs_review, 2);

    const original = input.recurring_costs[0];
    const versionRows = [{ source_row: 2, sheet_name: 'Vehicle Monthly Costs', record_id: original.id, plate_key: 'ABC123', start_month: august, end_month: null, cost_type: 'Owner Payout', monthly_amount: 900, payee: 'Owner A', notes: 'August rate' }];
    const preview: any = await call(db, 'finance_preview_section_import', ['RECURRING_COST', august, 'rates.xlsx', JSON.stringify(versionRows), input.month.revision, '1'.repeat(64), 'UPDATE', null]);
    input = await call(db, 'finance_apply_section_import', [preview.preview_token, JSON.stringify(preview.changes), input.month.revision]);
    assert.deepEqual(input.recurring_costs.filter((row: any) => !row.cancelled_at).map((row: any) => [row.start_month, row.end_month, row.monthly_amount]), [
      ['2026-07-01', '2026-07-01', 750],
      ['2026-08-01', null, 900],
    ]);
    const meta: any = await call(db, 'finance_workspace_meta', [august]);
    const upload = meta.uploads.find((row: any) => row.kind === 'recurring_cost');
    input = await call(db, 'finance_undo_section_import', [upload.id, input.month.revision]);
    const active = input.recurring_costs.filter((row: any) => !row.cancelled_at);
    assert.deepEqual(active.map((row: any) => [row.start_month, row.end_month, row.monthly_amount]), [['2026-07-01', null, 750]]);
  } finally { await db.close(); }
});

test('fixed-cost and Other Income imports apply with stable records and editable fields round-trip', async () => {
  const db = await setup();
  try {
    let input = await read(db);
    const fixedRows = [{ source_row: 2, sheet_name: 'Fixed Operating Costs', category: 'Company Loan / Financing', monthly_amount: 1013, effective_from: august, effective_until: august, payee: 'Bank A', notes: 'Management cash-burden item' }];
    const fixedPreview: any = await call(db, 'finance_preview_section_import', ['FIXED_COST', august, 'fixed.xlsx', JSON.stringify(fixedRows), input.month.revision, '2'.repeat(64), 'UPDATE', null]);
    input = await call(db, 'finance_apply_section_import', [fixedPreview.preview_token, JSON.stringify(fixedPreview.changes), input.month.revision]);
    assert.equal(input.fixed_cost_templates?.[0].category, 'Company Loan / Financing');
    assert.equal(input.expenses.find((row: any) => row.fixed_cost_template_id)?.amount, 1013);

    const incomeRows = [{ source_row: 2, sheet_name: 'Other Income', finance_month: august, status: 'CONFIRMED', income_type: 'Insurance reimbursement', amount: 125, plate_key: 'ABC123', business_unit: null, receipt_date: '2026-08-20', reference: 'REF-125', notes: 'Approved refund' }];
    const incomePreview: any = await call(db, 'finance_preview_section_import', ['OTHER_INCOME', august, 'income.xlsx', JSON.stringify(incomeRows), input.month.revision, '3'.repeat(64), 'UPDATE', null]);
    input = await call(db, 'finance_apply_section_import', [incomePreview.preview_token, JSON.stringify(incomePreview.changes), input.month.revision]);
    assert.equal(input.other_income?.[0].business_unit, 'E-HAILING');
    assert.equal(input.other_income?.[0].reference, 'REF-125');
    const revenueBefore = buildFinanceReport(input).totals.revenue;

    const vehicle: any = input.vehicles.find((row: any) => row.plate_key === 'ABC123');
    input = await call(db, 'finance_mutate_record', ['vehicle', 'UPDATE', JSON.stringify({ ...vehicle, model: 'Perodua Bezza 1.3', status: 'Active' }), august, input.month.revision, 'Model corrected']);
    assert.equal(input.vehicles.find((row: any) => row.plate_key === 'ABC123')?.model, 'Perodua Bezza 1.3');
    input = await call(db, 'finance_mutate_record', ['vehicle', 'CORRECT_PLATE', JSON.stringify({ old_plate: 'ABC123', plate_key: 'ABC124', display_plate: 'ABC 124' }), august, input.month.revision, 'Corrected registration typo']);
    assert.equal(input.other_income?.[0].plate_key, 'ABC124');
    assert.equal(buildFinanceReport(input).totals.revenue, revenueBefore);

    await db.exec(`reset role;
      insert into public.drivers values('10000000-0000-4000-8000-000000000124','Alias Driver','ABC 123');
      insert into public.payments values('20000000-0000-4000-8000-000000000124','10000000-0000-4000-8000-000000000124','2026-08-10',100,10,'BANK');`);
    assert.equal((await db.query<{ plate: string }>(`select finance_private.canonical_plate('ABC 123') plate`)).rows[0].plate, 'ABC124');
    await asUser(db);
    input = await call(db, 'finance_refresh_payments', [august]);
    assert.equal(input.ehailing[0].plate_key, 'ABC124');
    const smartRows = [{ source_row: 2, sheet_name: 'Sales', reference: 'SD-ALIAS', plate_key: 'ABC123', display_plate: 'ABC 123', pickup_date: '2026-08-12', return_date: '2026-08-13', gross_revenue: 200, commission: 20, status: 'Completed', payment_status: 'Paid' }];
    input = await call(db, 'finance_post_smart_drive', [august, 'sales.xlsx', JSON.stringify(smartRows), false, input.month.revision, '4'.repeat(64)]);
    assert.equal(input.smart_rows[0].plate_key, 'ABC124');
    const revenueAfterSources = buildFinanceReport(input).totals.revenue;
    input = await call(db, 'finance_refresh_payments', [august]);
    input = await call(db, 'finance_post_smart_drive', [august, 'sales-replacement.xlsx', JSON.stringify(smartRows), true, input.month.revision, '5'.repeat(64)]);
    assert.equal(input.ehailing[0].plate_key, 'ABC124');
    assert.equal(input.smart_rows[0].plate_key, 'ABC124');
    assert.equal(buildFinanceReport(input).totals.revenue, revenueAfterSources);
    input = await call(db, 'finance_mutate_record', ['insurance', 'ADD', JSON.stringify({ plate_key: 'ABC124', premium: 500, payment_date: '2026-08-10', coverage_start: '2026-08-01', coverage_end: '2027-07-31', responsibility: 'ECA_PAID', supplier: 'Insurer A', reference: 'POL-1', source: 'Manual' }), august, input.month.revision, 'New policy']);
    assert.equal(input.insurance[0].reference, 'POL-1');
  } finally { await db.close(); }
});
