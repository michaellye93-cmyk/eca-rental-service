import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FinanceExpense, FinanceInput } from '../types/finance.ts';

// Finance → Records → Add expense: the "Existing record" list. Node cannot read JSX, so the forms file is bundled with
// esbuild (as in other-income-recurring-panel.test.ts) and rendered to HTML. Fixture data and round amounts only.
const ROOT = new URL('../', import.meta.url);
let loaded: Promise<any> | null = null;
function loadForms() {
  loaded ??= (async () => {
    const out = new URL('node_modules/.cache/eca-tests/record-forms.mjs', ROOT);
    await mkdir(new URL('.', out), { recursive: true });
    await build({
      entryPoints: [fileURLToPath(new URL('components/finance/FinanceRecordForms.tsx', ROOT))],
      bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
      define: { 'import.meta.env': '{}' }, packages: 'external', outfile: fileURLToPath(out),
    });
    return import(`${pathToFileURL(fileURLToPath(out)).href}?t=${Date.now()}`);
  })();
  return loaded;
}

const month = { finance_month: '2026-10-01', status: 'DRAFT' as const, revision: 1, refreshed_at: null, frozen_at: null,
  source_count: 0, total_cash: 0, total_claim: 0, earliest_date: null, latest_date: null };
const expense = (id: string, overrides: Partial<FinanceExpense> = {}): FinanceExpense => ({
  id, finance_month: '2026-10-01', billing_date: '2026-10-05', plate_key: 'XAA1001', category: 'Tyres', payment_source: 'Vehicle Direct Cost',
  supplier: 'Fixture Tyres', amount: 100, reference: null, description: null, record_version: 1, cancelled_at: null, ...overrides,
});
const input: FinanceInput = {
  month, vehicles: [{ plate_key: 'XAA1001', display_plate: 'XAA 1001', business_unit: 'E-HAILING', ownership_type: 'Own Fleet', status: 'Active' }],
  recurring_costs: [], insurance: [], ehailing: [], smart_import: null, smart_rows: [], imports: [], bootstrap_completed: true,
  expenses: [
    expense('live-1', { amount: 100 }),
    expense('deleted-1', { amount: 200, cancelled_at: '2026-10-10T00:00:00Z', cancellation_reason: 'Typed twice' }),
    expense('other-month', { amount: 300, finance_month: '2026-09-01' }),
  ],
};

test('the Add expense "Existing record" list leaves out deleted expenses and other months', async () => {
  const { ExpenseForm } = await loadForms();
  const html = renderToStaticMarkup(createElement(ExpenseForm, {
    input, month: '2026-10', source: 'Vehicle Direct Cost', disabled: false, onSave: async () => true,
  })) as string;
  const options = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter((v) => /^(live|deleted|other)/.test(v));
  assert.deepEqual(options, ['live-1']);
});
