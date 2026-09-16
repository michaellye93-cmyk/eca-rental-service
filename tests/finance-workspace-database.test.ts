import test from 'node:test';
import assert from 'node:assert/strict';
import { asUser, database, migrate, STAFF_ID } from './finance-db-fixture.ts';
import type { FinanceInput } from '../types/finance.ts';

const month = '2026-08-01';
async function setup() { const db = await database(); await migrate(db, '20260915084108_secure_profile_roles.sql'); await migrate(db, '20260915084110_finance_foundation.sql'); await migrate(db, '20260915104015_finance_section_workflows.sql'); await asUser(db); return db; }
const call = async <T>(db: any, name: string, args: unknown[]) => (await db.query<{ value: T }>(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args)).rows[0].value;
const saveVehicle = (db: any, plate = 'ABC123') => db.query(`select public.finance_save_record('vehicle',$1::jsonb)`, [JSON.stringify({ plate_key: plate, display_plate: plate, business_unit: 'E-HAILING', ownership_type: 'Owned', status: 'Active' })]);
const expense = { source_row: 2, sheet_name: 'Costs', finance_month: month, billing_date: '2026-08-31', plate_key: 'ABC123', category: 'Tyres', payment_source: 'Vehicle Direct Cost', supplier: 'Vendor', amount: 10, reference: 'T1', description: null };

test('section posting is atomic, deduplicated, validates staff, and preserves closed months', async () => {
 const db = await setup(); await saveVehicle(db); let data = await call<FinanceInput>(db, 'finance_read_month', [month]);
 await assert.rejects(call(db, 'finance_post_section_workbook', ['VEHICLE_EXPENSE', month, 'bad.xlsx', JSON.stringify([expense, { ...expense, source_row: 3, amount: 1.001 }]), data.month.revision, 'a'.repeat(64)]), /Invalid expense/);
 assert.equal((await call<FinanceInput>(db, 'finance_read_month', [month])).expenses.length, 0);
 data = await call(db, 'finance_post_section_workbook', ['VEHICLE_EXPENSE', month, 'costs.xlsx', JSON.stringify([expense]), data.month.revision, 'a'.repeat(64)]);
 const metadata = await call<any>(db, 'finance_workspace_meta', [month]); const audit = metadata.uploads[0].source_audit[0];
 assert.equal(audit.record_id, data.expenses[0].id); assert.deepEqual(Object.keys(audit).sort(), ['record_id', 'record_kind', 'sheet_name', 'source_row']);
 await assert.rejects(call(db, 'finance_post_section_workbook', ['VEHICLE_EXPENSE', month, 'renamed.xlsx', JSON.stringify([expense]), data.month.revision, 'a'.repeat(64)]), /already imported/);
 await assert.rejects(call(db, 'finance_post_section_workbook', ['VEHICLE_EXPENSE', month, 'changed-metadata.xlsx', JSON.stringify([expense]), data.month.revision, 'c'.repeat(64)]), /already imported/);
 await asUser(db, STAFF_ID); await assert.rejects(call(db, 'finance_workspace_meta', [month]), /Admin/); await asUser(db);
 await assert.rejects(db.query(`select finance_private.section_fingerprint($1,'vehicle_expense')`, [month]), /permission denied/);
});

test('section review stays metadata-only and invalidates after an expense edit', async () => {
 const db = await setup(); await saveVehicle(db); let data = await call<FinanceInput>(db, 'finance_read_month', [month]);
 data = await call(db, 'finance_post_section_workbook', ['VEHICLE_EXPENSE', month, 'costs.xlsx', JSON.stringify([expense]), data.month.revision, 'b'.repeat(64)]);
 const before = data.month.revision; const meta = await call<any>(db, 'finance_review_section', [month, 'vehicle_expense', 'REVIEWED', before]);
 assert.equal(meta.reviews.find((x: any) => x.section === 'vehicle_expense').valid, true);
 assert.equal((await call<FinanceInput>(db, 'finance_read_month', [month])).month.revision, before);
 await db.query(`select public.finance_save_record('expense',$1::jsonb)`, [JSON.stringify({ ...data.expenses[0], amount: 11 })]);
 const after = await call<any>(db, 'finance_workspace_meta', [month]); assert.equal(after.reviews.find((x: any) => x.section === 'vehicle_expense').valid, false);
 await assert.rejects(call(db, 'finance_review_section', [month, 'vehicle_expense', 'NONE', before]), /changed/);
});

test('previous shared costs are frozen, date-clamped, stale-safe, and cannot be copied twice', async () => {
 const db = await setup(); const previous = '2026-01-01'; const targetMonth = '2026-02-01'; let prior = await call<FinanceInput>(db, 'finance_read_month', [previous]);
 await db.query(`select public.finance_save_record('expense',$1::jsonb)`, [JSON.stringify({ finance_month: previous, billing_date: '2026-01-31', plate_key: null, category: 'General Software', payment_source: 'Corporate Opex', supplier: 'SaaS', amount: 100, reference: 'S1', description: 'January' })]);
 prior = await call(db, 'finance_read_month', [previous]);
 // A closed source is represented by frozen_input in production. Set it explicitly here to isolate copy semantics.
 await db.exec(`reset role; update finance_private.months set status='CLOSED', frozen_input=finance_private.input('2026-01-01'::date), frozen_at=now() where finance_month='2026-01-01'; update finance_private.expenses set amount=999 where finance_month='2026-01-01'`); await asUser(db);
 const preview = await call<any[]>(db, 'finance_preview_previous_shared_costs', [targetMonth]); assert.equal(preview[0].billing_date, '2026-02-28'); assert.equal(preview[0].amount, 100); assert.equal(preview[0].category, 'General Software');
 let target = await call<FinanceInput>(db, 'finance_read_month', [targetMonth]);
 target = await call(db, 'finance_copy_previous_shared_costs', [targetMonth, JSON.stringify(preview), target.month.revision]); assert.equal(target.expenses.length, 1);
 await assert.rejects(call(db, 'finance_copy_previous_shared_costs', [targetMonth, JSON.stringify(preview), target.month.revision]), /already copied/);
});
