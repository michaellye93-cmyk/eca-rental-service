import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FinanceInput, OtherIncome, OtherIncomeSeries } from '../types/finance.ts';
import { recurringOtherIncomeMissing } from '../services/finance/calculations.ts';

// Finance → Records → Other Income with monthly recurring lines. Node cannot read JSX, so the forms file is bundled with
// esbuild (as in vehicle-loans-form.test.ts) and rendered to HTML. Fixture data and round amounts only.
const ROOT = new URL('../', import.meta.url);
let loaded: Promise<any> | null = null;
function loadForms() {
  loaded ??= (async () => {
    const out = new URL('node_modules/.cache/eca-tests/other-income-forms.mjs', ROOT);
    await mkdir(new URL('.', out), { recursive: true });
    await build({
      entryPoints: [fileURLToPath(new URL('components/finance/FinanceCustomizationForms.tsx', ROOT))],
      bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
      define: { 'import.meta.env': '{}' }, packages: 'external', outfile: fileURLToPath(out),
    });
    return import(`${pathToFileURL(fileURLToPath(out)).href}?t=${Date.now()}`);
  })();
  return loaded;
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const line = (overrides: Partial<OtherIncome> = {}): OtherIncome => ({
  id: 'oi-1', finance_month: '2026-10-01', status: 'CONFIRMED', income_type: 'Fixture parking rent', amount: 500, plate_key: null,
  business_unit: 'E-HAILING', receipt_date: null, reference: 'FIX-1', notes: null, source: 'Manual / Other Income', confirmation_key: 'k1',
  record_version: 1, cancelled_at: null, series_id: null, ...overrides,
});

test('the list tags a line from a monthly recurring series and offers Stop recurring on it only', async () => {
  const { OtherIncomePanel } = await loadForms();
  const html = renderToStaticMarkup(createElement(OtherIncomePanel, {
    records: [line(), line({ id: 'oi-2', income_type: 'Fixture storage rent', reference: 'FIX-2', series_id: 'series-1' })],
    vehicles: [], month: '2026-10-01', onSave: async () => true,
  })) as string;
  const rows = html.split('<tr').slice(2).map(text);
  assert.equal(rows.length, 2);
  assert.doesNotMatch(rows[0], /Monthly recurring|Stop recurring/);
  assert.match(rows[1], /Monthly recurring/);
  assert.match(rows[1], /Stop recurring/);
});

test('Add Other Income asks how often: One-off by default, or Monthly recurring with an optional Until month', async () => {
  const { RecurringFields } = await loadForms();
  const oneOff = renderToStaticMarkup(createElement(RecurringFields, { frequency: 'ONE_OFF', untilMonth: '', month: '2026-10-01', disabled: false, onChange: () => {} })) as string;
  assert.match(oneOff, /Frequency/);
  assert.match(oneOff, /<option value="ONE_OFF" selected="">One-off<\/option>/);
  assert.match(oneOff, /<option value="MONTHLY_RECURRING">Monthly recurring<\/option>/);
  assert.doesNotMatch(oneOff, /Until month/);
  const monthly = renderToStaticMarkup(createElement(RecurringFields, { frequency: 'MONTHLY_RECURRING', untilMonth: '', month: '2026-10-01', disabled: false, onChange: () => {} })) as string;
  assert.match(monthly, /Until month/);
  assert.match(monthly, /type="month"/);
  assert.match(monthly, /min="2026-10"/);
  assert.match(text(monthly), /Leave blank to keep going until you stop it/);
});

test('the saved record carries the frequency and Until month on Add only', async () => {
  const { otherIncomePayload } = await loadForms();
  const values = { status: 'CONFIRMED', source_type: ' Fixture parking rent ', source_record_id: 'FIX-1', amount: '500', description: '', plate_key: '',
    business_unit: 'E-HAILING', receipt_date: '2026-10-05', frequency: 'MONTHLY_RECURRING', until_month: '2026-12' };
  const added = otherIncomePayload(values, '2026-10-01', new Map());
  assert.equal(added.frequency, 'MONTHLY_RECURRING');
  assert.equal(added.end_month, '2026-12');
  assert.equal(added.income_type, 'Fixture parking rent');
  assert.equal(otherIncomePayload({ ...values, until_month: '' }, '2026-10-01', new Map()).end_month, null);
  assert.equal(otherIncomePayload({ ...values, frequency: 'ONE_OFF' }, '2026-10-01', new Map()).end_month, null);
  const edited = otherIncomePayload(values, '2026-10-01', new Map(), line({ series_id: 'series-1' }));
  assert.equal(edited.id, 'oi-1');
  assert.equal('frequency' in edited, false, 'an edit changes this month\'s line only');
  assert.equal('end_month' in edited, false);
});

const series = (overrides: Partial<OtherIncomeSeries> = {}): OtherIncomeSeries => ({
  id: 'series-1', income_type: 'Fixture parking rent', amount: 500, plate_key: null, business_unit: 'E-HAILING', reference: null, notes: null,
  effective_from: '2026-08-01', effective_until: null, record_version: 1, ...overrides,
});
const month = (status: string, rows: OtherIncomeSeries[], lines: OtherIncome[]) =>
  ({ month: { finance_month: '2026-09-01', status }, other_income_series: rows, other_income: lines } as unknown as FinanceInput);

test('a Draft month needs its recurring lines while an active series covering it has none there yet', () => {
  assert.equal(recurringOtherIncomeMissing(month('DRAFT', [series()], [])), true);
  assert.equal(recurringOtherIncomeMissing(month('DRAFT', [series()], [line({ finance_month: '2026-09-01', series_id: 'series-1' })])), false);
  // A line deleted by hand counts: the database does not make it again, so the month is not opened again for it.
  assert.equal(recurringOtherIncomeMissing(month('DRAFT', [series()], [line({ finance_month: '2026-09-01', series_id: 'series-1', cancelled_at: '2026-09-10T00:00:00Z' })])), false);
  assert.equal(recurringOtherIncomeMissing(month('DRAFT', [series({ effective_from: '2026-10-01' })], [])), false);
  assert.equal(recurringOtherIncomeMissing(month('DRAFT', [series({ effective_until: '2026-08-01' })], [])), false);
  assert.equal(recurringOtherIncomeMissing(month('CLOSED', [series()], [])), false);
  assert.equal(recurringOtherIncomeMissing(month('READY FOR REVIEW', [series()], [])), false);
  // An older server sends no series: nothing to create.
  assert.equal(recurringOtherIncomeMissing({ month: { finance_month: '2026-09-01', status: 'DRAFT' } } as unknown as FinanceInput), false);
});
