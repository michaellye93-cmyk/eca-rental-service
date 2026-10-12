import test from 'node:test';
import assert from 'node:assert/strict';
import type { FinanceExpense, FinanceInput, FixedCostTemplate } from '../types/finance.ts';
import { fixedCostsMissing } from '../services/finance/calculations.ts';

const template = (id: string, series_id: string, effective_from: string, effective_until: string | null = null, cancelled_at: string | null = null): FixedCostTemplate =>
  ({ id, series_id, version_no: 1, category: 'Office Rental', monthly_amount: 400, effective_from, effective_until, payee: null, note: null, source: null,
    linked_expense_id: null, record_version: 1, cancelled_at });
const occurrence = (templateId: string, finance_month: string, cancelled_at: string | null = null): FinanceExpense =>
  ({ id: `e-${templateId}-${finance_month}`, finance_month, billing_date: null, plate_key: null, category: 'Office Rental', payment_source: 'Corporate Opex',
    supplier: null, amount: 400, reference: null, description: null, fixed_cost_template_id: templateId, cancelled_at });
const input = (status: string, templates: FixedCostTemplate[], expenses: FinanceExpense[]) =>
  ({ month: { finance_month: '2026-09-01', status }, fixed_cost_templates: templates, expenses } as unknown as FinanceInput);

test('a draft month whose fixed costs have not been created yet needs them created', () => {
  assert.equal(fixedCostsMissing(input('DRAFT', [template('t1', 's1', '2026-08-01')], [])), true);
});

test('nothing to create once every running fixed cost has its line this month, even a line deleted for the month', () => {
  assert.equal(fixedCostsMissing(input('DRAFT', [template('t1', 's1', '2026-08-01')], [occurrence('t1', '2026-09-01')])), false);
  assert.equal(fixedCostsMissing(input('DRAFT', [template('t1', 's1', '2026-08-01')], [occurrence('t1', '2026-09-01', '2026-09-30')])), false);
  // A later version of the same cost counts as the same line.
  assert.equal(fixedCostsMissing(input('DRAFT', [template('t1', 's1', '2026-08-01', '2026-08-31'), template('t2', 's1', '2026-09-01')], [occurrence('t1', '2026-09-01')])), false);
});

test('costs not running this month, stopped costs and months not in Draft are left alone', () => {
  assert.equal(fixedCostsMissing(input('DRAFT', [template('t1', 's1', '2026-10-01')], [])), false);
  assert.equal(fixedCostsMissing(input('DRAFT', [template('t1', 's1', '2026-07-01', '2026-08-31')], [])), false);
  assert.equal(fixedCostsMissing(input('DRAFT', [template('t1', 's1', '2026-08-01', null, '2026-09-02')], [])), false);
  assert.equal(fixedCostsMissing(input('CLOSED', [template('t1', 's1', '2026-08-01')], [])), false);
  assert.equal(fixedCostsMissing(input('READY FOR REVIEW', [template('t1', 's1', '2026-08-01')], [])), false);
  // A line from another month does not count for this one.
  assert.equal(fixedCostsMissing(input('DRAFT', [template('t1', 's1', '2026-08-01')], [occurrence('t1', '2026-08-01')])), true);
});
