import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { money } from '../services/fmt.ts';
import type { VehicleLoan } from '../services/finance/loans.ts';

// Node cannot read JSX, so the page's view (props only: no Supabase, no CSS) is bundled with esbuild, which Vite
// already ships, into a file inside the project (so "react" resolves) and rendered to HTML with fixture loans.
const ROOT = new URL('../', import.meta.url);
/** Bundles one component file (import.meta.env empty, as without .env.local) and returns its default export. */
async function loadComponent(file: string, name: string) {
  const out = new URL(`node_modules/.cache/eca-tests/${name}.mjs`, ROOT);
  await mkdir(new URL('.', out), { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL(file, ROOT))],
    bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
    define: { 'import.meta.env': '{}' },
    // Packages are loaded by Node from node_modules, so React is the one the test renders with.
    packages: 'external',
    outfile: fileURLToPath(out),
  });
  return (await import(`${pathToFileURL(fileURLToPath(out)).href}?t=${Date.now()}`)).default;
}
const loadView = () => loadComponent('components/finance/VehicleLoansView.tsx', 'vehicle-loans-view');

// Fixture cars and made-up amounts only. text() turns markup into words; money's no-break space reads as a space.
const loan = (overrides: Partial<VehicleLoan>): VehicleLoan => ({
  id: overrides.plate_key, plate_key: 'XAA1001', display_plate: 'XAA 1001', bank: 'Fixture Bank', finance_amount: 30000,
  flat_rate_percent: 3, tenure_months: 60, first_payment_date: '2022-05-05', downpayment: 3000, monthly_instalment: 500,
  status: 'ACTIVE', closed_on: null, notes: null, record_version: 1, ...overrides,
});
const LOANS = [
  loan({ plate_key: 'XAA1002', display_plate: 'XAA 1002', first_payment_date: '2025-01-05', tenure_months: 48, monthly_instalment: 800 }),
  loan({ plate_key: 'XAA1003', display_plate: 'XAA 1003', status: 'SETTLED', closed_on: '2026-06-10', monthly_instalment: 300 }),
  loan({ plate_key: 'XAA1001', display_plate: 'XAA 1001' }), // 6 instalments left
];
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('the Vehicle loans page shows the headline, the chart and the loans soonest to finish first', async () => {
  const View = await loadView();
  const html: string = renderToStaticMarkup(createElement(View, {
    loans: LOANS, today: '2026-10-21', cars: new Map([['XAA1001', 'Fixture Bezza 1.3']]),
    whatIf: { finance_amount: '', flat_rate_percent: '', tenure_months: '', first_payment_month: '' },
    onAdd: () => {}, onEdit: () => {}, onDelete: () => {}, onWhatIfChange: () => {},
  }));
  const page = text(html);
  assert.match(page, /Hire-purchase instalments, this month/);
  assert.ok(page.includes(text(money(1300))), 'this month: the two active loans');
  assert.match(page, /2 active loans · next finishes Apr 2027 \(XAA 1001\)/);
  assert.match(page, /Balance left, all loans/);
  assert.ok(page.includes(text(money(500 * 6 + 800 * 26))), 'balance left: instalments still to pay');
  assert.match(page, /Within 6 months of payoff 1/);
  assert.match(page, /Assumes every instalment is paid on time; the bank statement is the record\./);
  // The chart is drawn from the series, each running loan's end labelled by plate.
  assert.match(html, /<svg[^>]*role="img"/);
  assert.match(page, /XAA 1001 ends/);
  assert.match(page, /XAA 1002 ends/);
  // The list: soonest to finish first, the settled loan last.
  const order = ['XAA 1001', 'XAA 1002', 'XAA 1003'].map((plate) => page.indexOf(`${plate} `, page.indexOf('Loans, soonest to finish first')));
  assert.ok(order[0] < order[1] && order[1] < order[2], `list order ${order}`);
  assert.match(page, /paid 54 of 60 · 6 left · finishes Apr 2027/);
  assert.match(page, /paid 22 of 48 · 26 left · finishes Dec 2028/);
  assert.match(page, /Fixture Bezza 1\.3/, "Fleet's make and model beside the plate");
  assert.match(page, /Settled Jun 2026 · no longer counted/);
  assert.match(html, /class="loan-bar-fill is-near"[^>]*style="width:90%"/, 'the near-payoff bar is amber');
  assert.match(html, /class="loan-bar-fill is-closed"[^>]*style="width:100%"/, 'a settled loan is full and muted');
  assert.match(html, /class="loan-bar-fill"[^>]*style="width:46%"/);
  assert.match(page, /Add loan/);
  assert.equal((html.match(/>Edit</g) ?? []).length, 3, 'each loan can be edited');
});

test('a what-if loan adds a dotted line to the chart; no loans shows an empty state', async () => {
  const View = await loadView();
  const withWhatIf: string = renderToStaticMarkup(createElement(View, {
    loans: LOANS, today: '2026-10-21', cars: new Map(),
    whatIf: { finance_amount: '60000', flat_rate_percent: '2.7', tenure_months: '84', first_payment_month: '2027-01' },
  }));
  assert.match(withWhatIf, /stroke-dasharray/, 'the what-if line is dotted');
  // 60,000 + 60,000 × 2.7% × 7 = 71,340 / 84 = 849.28… → 850 a month.
  assert.ok(text(withWhatIf).includes(text(`What if adds ${money(850)} a month`)));
  const empty: string = renderToStaticMarkup(createElement(View, {
    loans: [], today: '2026-10-21', cars: new Map(),
    whatIf: { finance_amount: '', flat_rate_percent: '', tenure_months: '', first_payment_month: '' },
  }));
  assert.match(text(empty), /No loans yet/);
  assert.doesNotMatch(empty, /stroke-dasharray/);
});

test('Records shows a cost that Vehicle loans owns read-only, and the other costs editable as before', async () => {
  const Settings = await loadComponent('components/finance/FinanceSettingsSection.tsx', 'finance-settings-section');
  const cost = (id: string, plate: string, type: string, loanId: string | null) => ({ id, obligation_id: id, plate_key: plate, start_month: '2026-01-01', end_month: null, cost_type: type, monthly_amount: 500, payee: 'Fixture Bank', notes: null, cancelled_at: null, loan_id: loanId });
  const input = {
    month: { finance_month: '2026-10-01', status: 'DRAFT', revision: 1 },
    vehicles: [{ plate_key: 'XAA1001', display_plate: 'XAA 1001', business_unit: 'E-HAILING', ownership_type: 'Own Fleet', status: 'Active' }, { plate_key: 'XAA1002', display_plate: 'XAA 1002', business_unit: 'E-HAILING', ownership_type: 'Own Fleet', status: 'Active' }],
    recurring_costs: [cost('c1', 'XAA1001', 'Hire Purchase / Loan', 'loan-1'), cost('c2', 'XAA1002', 'Owner Payout', null)],
    insurance: [], expenses: [], ehailing: [], smart_import: null, smart_rows: [], imports: [], bootstrap_completed: true,
  };
  const noop = () => {};
  const html: string = renderToStaticMarkup(createElement(Settings, { tab: 'monthly_vehicle_costs', input, month: '2026-10', disabled: false, onSave: noop, onDelete: noop, onCancel: noop, onFile: noop, onExport: noop, drivers: [] }));
  const rows = html.split('<tr').slice(2);
  assert.equal(rows.length, 2);
  const loanRow = rows.find((row) => row.includes('XAA 1001'))!;
  const ownRow = rows.find((row) => row.includes('XAA 1002'))!;
  assert.match(loanRow, /From Vehicle loans/);
  assert.doesNotMatch(loanRow, />Edit</, 'no Edit on a loan-owned cost');
  assert.match(ownRow, />Edit</);
  assert.doesNotMatch(ownRow, /From Vehicle loans/);
});
