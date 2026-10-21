import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FinanceInput } from '../types/finance.ts';
import { OWNERSHIP_TYPES, ownershipChoices } from '../services/finance/vehicleOwnership.ts';

// Finance → Records → Vehicle Master: Ownership type is a fixed choice (Michael, 21 Oct 2026), not free text, because the
// Car Owner versus Company split reads it by exact value. Fixture data only.
const ROOT = new URL('../', import.meta.url);
async function loadForms() {
  const out = new URL('node_modules/.cache/eca-tests/record-forms-ownership.mjs', ROOT);
  await mkdir(new URL('.', out), { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL('components/finance/FinanceRecordForms.tsx', ROOT))],
    bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
    define: { 'import.meta.env': '{}' }, packages: 'external', outfile: fileURLToPath(out),
  });
  return import(`${pathToFileURL(fileURLToPath(out)).href}?t=${Date.now()}`);
}

test('the fixed ownership types are Car Owner, Company HP and Company', () => {
  assert.deepEqual([...OWNERSHIP_TYPES], ['Car Owner', 'Company HP', 'Company']);
});

test('the choices keep a saved value outside the list so editing another field does not change it silently', () => {
  assert.deepEqual(ownershipChoices('Company HP'), ['Car Owner', 'Company HP', 'Company']);
  assert.deepEqual(ownershipChoices(''), ['Car Owner', 'Company HP', 'Company']);
  assert.deepEqual(ownershipChoices('Own Fleet'), ['Car Owner', 'Company HP', 'Company', 'Own Fleet']);
});

test('Add vehicle offers Ownership type as a dropdown of the fixed values, with no free-text box', async () => {
  const { VehicleForm } = await loadForms();
  const month = { finance_month: '2026-10-01', status: 'DRAFT' as const, revision: 1, refreshed_at: null, frozen_at: null,
    source_count: 0, total_cash: 0, total_claim: 0, earliest_date: null, latest_date: null };
  const input: FinanceInput = {
    month, vehicles: [], recurring_costs: [], insurance: [], ehailing: [], smart_import: null, smart_rows: [], imports: [], bootstrap_completed: true, expenses: [],
  };
  const html = renderToStaticMarkup(createElement(VehicleForm, {
    input, month: '2026-10', disabled: false, onSave: async () => true, onDelete: async () => true,
  })) as string;
  const field = html.match(/Ownership type<\/span>(.*?)<\/label>/s)?.[1] ?? html.match(/Ownership type(.*?)<\/label>/s)?.[1] ?? '';
  assert.ok(field.includes('<select'), `expected a select for Ownership type, got: ${field.slice(0, 200)}`);
  assert.ok(!/<input/.test(field), 'Ownership type must not be a free-text input');
  const options = [...field.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(options, ['', 'Car Owner', 'Company HP', 'Company']);
  assert.ok(/<select[^>]*required/.test(field), 'a choice is required');
});
