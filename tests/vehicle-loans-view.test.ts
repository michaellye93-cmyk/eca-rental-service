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

test('the Vehicle loans page shows the headline, the chart and the loans most paid off first', async () => {
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
  // The asset row: the cars still owned (the settled one too), what they cost and were paid down, and their disposal value.
  assert.match(page, /Cost of vehicles/);
  assert.ok(page.includes(text(money(99000))), 'cost: financing + downpayment of the three cars, none sold');
  assert.match(page, /Downpayment paid/);
  assert.ok(page.includes(text(money(9000))), 'downpayment of the three cars');
  assert.match(page, /Projected disposal value at payoff/);
  assert.match(page, /5% of cost a year/);
  assert.match(page, /Depreciation, % a year/);
  assert.match(page, /Assumes every instalment is paid on time; the bank statement is the record\./);
  // The chart is drawn from the series, each running loan's end labelled by plate.
  assert.match(html, /<svg[^>]*role="img"/);
  assert.match(page, /XAA 1001 ends/);
  assert.match(page, /XAA 1002 ends/);
  // The list: most paid off first, the settled loan last.
  const order = ['XAA 1001', 'XAA 1002', 'XAA 1003'].map((plate) => page.indexOf(`${plate} `, page.indexOf('Loans, most paid off first')));
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

test('a loan row has a Schedule button; expanded, it shows the HP schedule with year-end rows and a Download Excel button', async () => {
  const View = await loadView();
  const scheduled = loan({ plate_key: 'XAA1004', display_plate: 'XAA 1004', first_payment_date: '2024-01-15', monthly_instalment: 575 });
  const settled = loan({ plate_key: 'XAA1005', display_plate: 'XAA 1005', first_payment_date: '2024-01-15', monthly_instalment: 575, status: 'SOLD', closed_on: '2026-06-10' });
  const props = {
    loans: [scheduled, settled], today: '2026-10-21', cars: new Map(),
    whatIf: { finance_amount: '', flat_rate_percent: '', tenure_months: '', first_payment_month: '' },
    onToggleSchedule: () => {}, onDownloadSchedule: () => {},
  };
  const closed: string = renderToStaticMarkup(createElement(View, { ...props, expanded: new Set<string>() }));
  assert.equal((closed.match(/aria-expanded="false"/g) ?? []).length, 2, 'each loan has a collapsed Schedule button');
  assert.match(closed, /aria-controls="loan-schedule-XAA1004"[^>]*>Schedule</);
  assert.doesNotMatch(closed, /<table/, 'collapsed: no table');
  assert.doesNotMatch(closed, /Download Excel/);

  const html: string = renderToStaticMarkup(createElement(View, { ...props, expanded: new Set(['XAA1004', 'XAA1005']) }));
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 2);
  assert.match(html, /id="loan-schedule-XAA1004"/);
  assert.match(html, /id="loan-schedule-XAA1005"/, 'a sold loan still shows its full schedule');
  const page = text(html);
  const headers = ['Year', 'Ins. No', 'Sum of Digit', 'Instalment', 'Interest', 'Principal', 'Total Instalment', 'Total Interest', 'Total Principal', 'Bal Due'];
  const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
  assert.deepEqual([...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]), headers);
  assert.ok(page.includes(text(`Total payable ${money(34500)} · interest ${money(4500)} at 3.00% flat · Rule of 78 split · first payment 15 Jan 2024 · last instalment 15 Dec 2028`)));
  const table = html.slice(html.indexOf('id="loan-schedule-XAA1004"'), html.indexOf('id="loan-schedule-XAA1005"'));
  const bodyRows = table.split('<tr').slice(2);
  assert.equal(bodyRows.length, 60);
  assert.equal(bodyRows.filter((row) => /class="[^"]*loan-schedule-year/.test(row)).length, 6, 'six year-end rows');
  assert.match(bodyRows[2], /31\.03\.2024/);
  assert.match(bodyRows[59], /15\.12\.2028/);
  assert.match(text(bodyRows[59].slice(0, bodyRows[59].indexOf('</tr>'))), /0\.00 $/, 'the last balance is nil');
  assert.doesNotMatch(bodyRows[33], /is-future/, '15 Oct 2026 is on or before today');
  assert.match(bodyRows[34], /is-future/, '15 Nov 2026 is still to come');
  assert.match(bodyRows[0], /<td class="num">575\.00<\/td>/, 'numbers right-aligned, plain figures');
  assert.equal((html.match(/>Download Excel</g) ?? []).length, 2);
});

test('the loans are grouped under one heading per hirer, biggest monthly total first, with the unset group', async () => {
  const View = await loadView();
  const html: string = renderToStaticMarkup(createElement(View, {
    loans: [
      loan({ plate_key: 'XAA1001', display_plate: 'XAA 1001', hirer: 'Fixture Owner', monthly_instalment: 500, commencement_date: '2022-04-05' }),
      loan({ plate_key: 'XAA1002', display_plate: 'XAA 1002', hirer: 'Fixture Owner Sdn Bhd', first_payment_date: '2025-01-05', tenure_months: 48, monthly_instalment: 800 }),
      loan({ plate_key: 'XAA1003', display_plate: 'XAA 1003', hirer: 'Fixture Owner Sdn Bhd', status: 'SETTLED', closed_on: '2026-06-10', monthly_instalment: 300 }),
      loan({ plate_key: 'XAA1004', display_plate: 'XAA 1004', hirer: 'Fixture Owner', first_payment_date: '2026-01-05', monthly_instalment: 450 }),
      loan({ plate_key: 'XAA1005', display_plate: 'XAA 1005', first_payment_date: '2026-02-05', monthly_instalment: 200, rate_type: 'VARIABLE', flat_rate_percent: 4.5 }),
    ],
    today: '2026-10-21', cars: new Map(),
    whatIf: { finance_amount: '', flat_rate_percent: '', tenure_months: '', first_payment_month: '' },
  }));
  const page = text(html);
  const headings = [...html.matchAll(/<h4 class="loans-group-heading">(.*?)<\/h4>/g)].map((m) => text(m[1]).trim());
  assert.deepEqual(headings, [
    text(`Fixture Owner · 2 active · ${money(950)} /mo`).trim(),
    text(`Fixture Owner Sdn Bhd · 1 active · ${money(800)} /mo`).trim(),
    text(`Ownership not set · 1 active · ${money(200)} /mo`).trim(),
  ]);
  // Inside each group the most paid off first; each loan sits under its own hirer.
  const list = page.slice(page.indexOf('Loans, most paid off first'));
  const at = (needle: string) => list.indexOf(needle);
  assert.ok(at('Fixture Owner · 2') < at('XAA 1001 ') && at('XAA 1001 ') < at('XAA 1004 ') && at('XAA 1004 ') < at('Fixture Owner Sdn Bhd · 1'));
  assert.ok(at('Fixture Owner Sdn Bhd · 1') < at('XAA 1002 ') && at('XAA 1002 ') < at('XAA 1003 ') && at('XAA 1003 ') < at('Ownership not set'));
  assert.ok(at('Ownership not set') < at('XAA 1005 '));
  // The small print: the commencement date when set, and the rate type.
  assert.match(page, /3\.00% flat · 60 months from May 2022 · commenced 5 Apr 2022/);
  assert.match(page, /4\.50% variable · 60 months from Feb 2026/);
});

test("a variable-rate loan's schedule shows a dash for the interest split, with the line saying the bank gives it", async () => {
  const View = await loadView();
  const variable = loan({ plate_key: 'XAA1006', display_plate: 'XAA 1006', rate_type: 'VARIABLE', finance_amount: 10000, tenure_months: 24, monthly_instalment: 450, first_payment_date: '2025-01-10' });
  const html: string = renderToStaticMarkup(createElement(View, {
    loans: [variable], today: '2026-10-21', cars: new Map(), expanded: new Set(['XAA1006']),
    whatIf: { finance_amount: '', flat_rate_percent: '', tenure_months: '', first_payment_month: '' },
    onToggleSchedule: () => {}, onDownloadSchedule: () => {},
  }));
  const page = text(html);
  assert.match(page, /Variable rate: the bank's statement gives the interest split · 3\.00% variable · first payment 10 Jan 2025 · last instalment 10 Dec 2026/);
  assert.doesNotMatch(page, /Rule of 78/);
  const bodyRows = html.slice(html.indexOf('<tbody')).split('<tr').slice(1);
  assert.equal(bodyRows.length, 24);
  assert.match(bodyRows[0], /<td class="num">450\.00<\/td><td class="num">—<\/td><td class="num">—<\/td>/, 'no interest or principal on a row');
  assert.match(bodyRows[2], /<td class="num">1,350\.00<\/td><td class="num">—<\/td><td class="num">—<\/td><td class="num">8,650\.00<\/td>/, 'the year-end row: instalments and the balance only');
});
