import assert from 'node:assert/strict';
import fs from 'node:fs';
import { asUser, database, migrate } from './finance-db-fixture.ts';
import { previewSectionWorkbook, type SectionKind } from '../services/finance/workspace.ts';

const source = 'C:/Users/user/Documents/Codex/2026-09-15/ECA_Management_PnL_Raw_Data_Template.xlsx';
const migration = '20260920070959_finance_editable_safe_imports.sql';
const august = '2026-08-01';

async function setup() {
  const db = await database();
  for (const file of ['20260915084108_secure_profile_roles.sql','20260915084110_finance_foundation.sql','20260915085705_finance_bank_statements.sql','20260915104015_finance_section_workflows.sql','20260915120802_finance_delete_vehicle.sql','20260915122156_finance_insurance_responsibility.sql','20260915124812_finance_insurance_premium_rules.sql','20260915132423_finance_shared_recurring_opex.sql',migration]) await migrate(db, file);
  await asUser(db);
  return db;
}
const call = async <T>(db: any, name: string, args: unknown[]) => (await db.query<{ value: T }>(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args)).rows[0].value;
const read = (db: any) => call<any>(db, 'finance_read_month', [august]);

async function apply(db: any, buffer: ArrayBuffer, kind: SectionKind, hash: string, expectedErrors = 0) {
  const input = await read(db);
  const parsed = await previewSectionWorkbook(buffer, source, kind, august, input);
  assert.equal(parsed.issues.filter((issue) => issue.severity === 'error').length, expectedErrors, `${kind}: ${parsed.issues.map((issue) => issue.detail).join('; ')}`);
  const known = new Set(input.vehicles.map((row: any) => row.plate_key));
  const rows = kind === 'insurance' ? parsed.rows.filter((row: any) => known.has(row.plate_key)) : parsed.rows;
  const preview: any = await call(db, 'finance_preview_section_import', [kind.toUpperCase(), august, source.split('/').at(-1), JSON.stringify(rows), input.month.revision, hash.repeat(64), 'UPDATE', null]);
  assert.equal(preview.counts.needs_review, 0, `${kind} server preview needs review`);
  return call<any>(db, 'finance_apply_section_import', [preview.preview_token, JSON.stringify(preview.changes), input.month.revision]);
}

const bytes = fs.readFileSync(source);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const db = await setup();
try {
  let input = await apply(db, buffer, 'vehicle', 'a');
  assert.equal(input.vehicles.filter((row: any) => !row.deleted_at).length, 77);
  assert.ok(input.vehicles.some((row: any) => row.model), 'vehicle model survives workbook import');
  input = await apply(db, buffer, 'recurring_cost', 'b');
  assert.equal(input.recurring_costs.filter((row: any) => !row.cancelled_at).length, 77);
  input = await apply(db, buffer, 'insurance', 'c', 2);
  assert.equal(input.insurance.filter((row: any) => !row.cancelled_at).length, 75);
  input = await apply(db, buffer, 'corporate_expense', 'd');
  assert.equal(input.expenses.filter((row: any) => row.payment_source === 'Corporate Opex' && !row.cancelled_at).length, 12);
  process.stdout.write(JSON.stringify({ vehicles: 77, recurring_costs: 77, insurance_valid_rows: 75, insurance_source_errors: 2, company_expenses: 12, status: 'PASS' }) + '\n');
} finally { await db.close(); }

const fixedDb = await setup();
try {
  const input = await apply(fixedDb, buffer, 'fixed_cost', 'e');
  assert.equal(input.fixed_cost_templates.filter((row: any) => !row.cancelled_at).length, 12);
  assert.ok(input.fixed_cost_templates.some((row: any) => row.category === 'Other Corporate Cost' && row.monthly_amount === 1013));
  process.stdout.write(JSON.stringify({ fixed_templates_from_source: 12, one_off_rows_skipped: 0, status: 'PASS' }) + '\n');
} finally { await fixedDb.close(); }
