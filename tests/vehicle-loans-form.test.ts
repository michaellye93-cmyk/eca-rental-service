import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { money } from '../services/fmt.ts';
import type { VehicleLoan } from '../services/finance/loans.ts';

// Finance → Vehicle loans → Add / Edit loan: the form follows the bank letter line for line. Node cannot read JSX, so
// VehicleLoans.tsx is bundled with esbuild (as in vehicle-loans-view.test.ts) and its form rendered to HTML. The
// Supabase client is created with placeholders and never called.
const ROOT = new URL('../', import.meta.url);
let loaded: Promise<any> | null = null;
function loadForm() {
  loaded ??= (async () => {
    const out = new URL('node_modules/.cache/eca-tests/vehicle-loans-form.mjs', ROOT);
    await mkdir(new URL('.', out), { recursive: true });
    await build({
      entryPoints: [fileURLToPath(new URL('components/finance/VehicleLoans.tsx', ROOT))],
      bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
      define: { 'import.meta.env': '{}' }, packages: 'external', outfile: fileURLToPath(out),
    });
    const original = console.error;
    console.error = () => {}; // the placeholder Supabase client says its settings are missing
    try { return await import(`${pathToFileURL(fileURLToPath(out)).href}?t=${Date.now()}`); }
    finally { console.error = original; }
  })();
  return loaded;
}

// Fixture cars and made-up amounts only. text() turns markup into words; money's no-break space reads as a space.
const CARS = [
  { id: 'car-1', make: 'Fixture', model: 'Bezza 1.3', plateNumber: 'XAA 1001', roadtaxExpiry: '', insuranceExpiry: '', inspectionExpiry: '', notes: '', ownership: 'Own Fleet' },
  { id: 'car-2', make: 'Fixture', model: 'Axia 1.0', plateNumber: 'XAA 1002', roadtaxExpiry: '', insuranceExpiry: '', inspectionExpiry: '', notes: '', ownership: 'Own Fleet' },
];
const OWNERS = new Map([['XAA1001', 'Fixture Owner Sdn Bhd'], ['XAA1002', 'Fixture Owner']]);
const LOAN: VehicleLoan = {
  id: 'loan-1', plate_key: 'XAA1001', display_plate: 'XAA 1001', bank: 'Fixture Bank', finance_amount: 30000,
  flat_rate_percent: 3, tenure_months: 60, first_payment_date: '2024-01-15', downpayment: 3000, monthly_instalment: 575,
  status: 'ACTIVE', closed_on: null, notes: null, record_version: 1, cash_price: 33000, rate_type: 'FLAT',
  commencement_date: '2023-12-15', hirer: 'Fixture Owner Sdn Bhd',
};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const render = async (props: object) => {
  const { LoanForm } = await loadForm();
  return renderToStaticMarkup(createElement(LoanForm, {
    loan: null, cars: CARS, owners: OWNERS, hirers: ['Fixture Owner', 'Fixture Owner Sdn Bhd'], carsError: null,
    notInFinance: new Set(), busy: false, onSave: async () => {}, onCancel: () => {}, ...props,
  })) as string;
};
const labels = (html: string) => [...html.matchAll(/<span class="loans-letter-label">([^<]*)<\/span>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

test("the Add / Edit loan form follows the bank letter's lines in order, status and notes at the end", async () => {
  const html = await render({ loan: LOAN });
  assert.deepEqual(labels(html), [
    'Registration No.', 'Model', 'Ownership (hirer)', 'Loan provider (E-hak)', 'Cost (RM)', 'Less: Downpayment paid (RM)',
    'HP Financing (RM)', 'Interest rate, % a year', 'Rate type', 'Interest', 'Total', 'Commencement date',
    'First instalment date', 'No. of instalments', 'Monthly instalment', 'Final instalment',
  ]);
  assert.ok(html.indexOf('Final instalment') < html.indexOf('>Status<') && html.indexOf('>Status<') < html.indexOf('>Notes<'));
  const page = text(html);
  assert.match(page, /Model Fixture Bezza 1\.3/, "the model is read from Fleet's car");
  assert.match(html, /<input[^>]*list="loan-hirers"[^>]*value="Fixture Owner Sdn Bhd"/, 'the stored hirer, typed');
  assert.match(html, /<datalist id="loan-hirers"><option value="Fixture Owner"><\/option><option value="Fixture Owner Sdn Bhd"><\/option><\/datalist>/);
  assert.match(html, /value="33000"/, 'the cost');
  // Read-only lines for a flat rate: 30,000 × 3% × 5 = 4,500; total 34,500; final 34,500 − 59 × 575 = 575.
  assert.ok(page.includes(text(`Interest ${money(4500)}`)));
  assert.ok(page.includes(text(`Total ${money(34500)}`)));
  assert.ok(page.includes(text(`Final instalment ${money(575)}`)));
  assert.match(html, /<option value="FLAT" selected="">Flat<\/option>/);
});

test('a variable rate has no interest, total or final instalment, and the instalment is always typed', async () => {
  const html = await render({ loan: { ...LOAN, rate_type: 'VARIABLE', monthly_instalment: 610 } });
  const page = text(html);
  assert.match(page, /Interest — Total — /);
  assert.match(page, /Final instalment — /);
  assert.match(html, /<input required="" type="number"[^>]*value="610"/, 'the typed instalment');
  assert.match(html, /<input type="checkbox"(?=[^>]*checked="")(?=[^>]*disabled="")/, 'override forced on');
});

test('a new loan shows an empty Ownership and a hint where the model is unknown', async () => {
  const html = await render({});
  const page = text(html);
  assert.match(page, /Model — Ownership \(hirer\)/);
  assert.match(html, /list="loan-hirers"[^>]*value=""/);
});

test('typing the letter fills the lines that follow from it until they are typed by hand', async () => {
  const { changeLoanForm, valuesOf } = await loadForm();
  let values = valuesOf(null);
  const owners = OWNERS;
  // Picking the car fills a blank Ownership from Fleet's vehicle details.
  values = changeLoanForm(values, 'plate_key', 'XAA1001', owners);
  assert.equal(values.hirer, 'Fixture Owner Sdn Bhd');
  // Another car: still not typed by hand, so it follows the car.
  values = changeLoanForm(values, 'plate_key', 'XAA1002', owners);
  assert.equal(values.hirer, 'Fixture Owner');
  values = changeLoanForm(values, 'hirer', 'Fixture Owner Sdn Bhd', owners);
  values = changeLoanForm(values, 'plate_key', 'XAA1001', owners);
  values = changeLoanForm(values, 'plate_key', 'XAA1002', owners);
  assert.equal(values.hirer, 'Fixture Owner Sdn Bhd', 'a typed Ownership stays');
  // HP Financing = Cost − Downpayment, whichever is typed last.
  values = changeLoanForm(values, 'cash_price', '33000', owners);
  assert.equal(values.finance_amount, '33000');
  values = changeLoanForm(values, 'downpayment', '3000.50', owners);
  assert.equal(values.finance_amount, '29999.5');
  values = changeLoanForm(values, 'finance_amount', '29000', owners);
  values = changeLoanForm(values, 'cash_price', '34000', owners);
  assert.equal(values.finance_amount, '29000', 'typed by hand: left alone');
  // First instalment date = commencement + 1 month, until typed by hand.
  values = changeLoanForm(values, 'commencement_date', '2024-01-31', owners);
  assert.equal(values.first_payment_date, '2024-02-29');
  values = changeLoanForm(values, 'first_payment_date', '2024-03-05', owners);
  assert.equal(values.first_payment_date, '2024-03-05', 'typed directly: kept');
  values = changeLoanForm(values, 'commencement_date', '2024-02-10', owners);
  assert.equal(values.first_payment_date, '2024-03-10', 'a changed commencement always moves the first instalment with it');
  // Variable: the instalment is typed (override on); back to Flat leaves the override as it was.
  values = changeLoanForm(values, 'rate_type', 'VARIABLE', owners);
  assert.equal(values.override, true);
  // An existing loan's financing and ownership are never overwritten by typing the cost or picking the car, but a
  // changed commencement moves its first instalment (the owner corrects commencement dates and expects the bar to follow).
  let edit = valuesOf(LOAN);
  edit = changeLoanForm(edit, 'cash_price', '40000', owners);
  edit = changeLoanForm(edit, 'plate_key', 'XAA1002', owners);
  assert.deepEqual([edit.finance_amount, edit.first_payment_date, edit.hirer], ['30000', '2024-01-15', 'Fixture Owner Sdn Bhd']);
  edit = changeLoanForm(edit, 'commencement_date', '2023-11-01', owners);
  assert.equal(edit.first_payment_date, '2023-12-01');
  // A stored loan without an Ownership is filled from Fleet when its car is picked.
  assert.equal(changeLoanForm(valuesOf({ ...LOAN, hirer: null }), 'plate_key', 'XAA1002', owners).hirer, 'Fixture Owner');
  assert.equal(valuesOf({ ...LOAN, rate_type: 'VARIABLE' }).override, true, 'a stored variable loan opens with its typed instalment');
});
