import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import type { Driver } from '../types.ts';
import { drawAgreement, drawLetter } from '../services/agreements/pdf.ts';
import { defaultTemplate, fillText, placeholdersIn } from '../services/agreements/template.ts';
import {
  LETTER_KINDS, LETTER_LABELS, LETTER_PLACEHOLDERS, defaultLetter, deadlineDate, letterFileName, letterFromStored, letterValues, longDateBM,
} from '../services/agreements/letters.ts';
import { agreementApi } from '../services/agreements/api.ts';
import { ADMIN_ID, asUser, database, migrate } from './finance-db-fixture.ts';

const COMPANY = { company_name: 'Fixture Rentals Sdn Bhd', company_reg_no: '000000-X', company_address: '1 Fixture Road', company_phone: '000', company_email: 'a@example.test' };

const driver = (over: Partial<Driver> = {}): Driver => ({
  id: 'd1', nric: '900101011234', name: 'Fixture Driver One', address: '2 Fixture Lane', carPlate: 'XAA1001',
  contractStartDate: '2026-08-03', category: 'SEWABELI', rentalCycle: 'WEEKLY', contractDuration: 104, rentalRate: 300,
  totalAmountPaid: 600, paymentHistory: [
    { id: 'p1', amount: 300, date: '2026-08-03' } as Driver['paymentHistory'][number],
    { id: 'p2', amount: 300, date: '2026-08-10' } as Driver['paymentHistory'][number],
  ],
  ...over,
});

test('Malay long dates and the pay-by date', () => {
  assert.equal(longDateBM('2026-10-14'), '14 Oktober 2026');
  assert.equal(longDateBM('2026-08-01'), '1 Ogos 2026');
  assert.equal(longDateBM('nope'), '');
  assert.equal(deadlineDate('2026-10-14', 7), '2026-10-21');
  assert.equal(deadlineDate('2026-12-28', 14), '2027-01-11');
  assert.equal(deadlineDate('', 7), '');
});

test('a letter is filled from the driver, Fleet, the company and the rent schedule (rent owed as at the letter date)', () => {
  const values = letterValues({
    driver: driver(), car: { plateNumber: 'XAA1001', make: 'PERODUA', model: 'BEZZA' }, company: COMPANY,
    letterDate: '2026-10-14', payWithinDays: 7, reference: 'ECA/FIX/001',
  });
  // Weekly RM300 from Monday 3 Aug 2026: 11 rents due by 14 Oct (3 Aug ... 12 Oct), 2 paid, so 9 owed
  assert.equal(values.rent_arrears, 'RM 2,700.00');
  assert.equal(values.total_debt, 'RM 2,700.00');
  assert.equal(values.debt_breakdown, 'hutang sewa RM 2,700.00');
  assert.equal(values.arrears_as_of, '14 Oktober 2026');
  assert.equal(values.amount_7_days, 'RM 2,430.00');
  assert.equal(values.amount_14_days, 'RM 2,570.00'); // 2,565 to the nearest RM10
  assert.equal(values.cycles_owed, '9 minggu');
  assert.equal(values.letter_date, '14 Oktober 2026');
  assert.equal(values.pay_by_date, '21 Oktober 2026');
  assert.equal(values.pay_within_days, '7');
  assert.equal(values.letter_ref, 'ECA/FIX/001');
  assert.equal(values.customer_name, 'Fixture Driver One');
  assert.equal(values.customer_nric, '900101011234');
  assert.equal(values.customer_address, '2 Fixture Lane');
  assert.equal(values.vehicle_plate, 'XAA1001');
  assert.equal(values.customer_phone, '');
  assert.equal(values.vehicle_make_model, 'PERODUA BEZZA');
  assert.equal(values.agreement_type, 'Sewa Beli');
  assert.equal(values.start_date, '3 Ogos 2026');
  assert.equal(values.rent_amount, 'RM 300.00');
  assert.equal(values.rental_cycle, 'minggu');
  assert.equal(values.company_name, 'Fixture Rentals Sdn Bhd');
  assert.equal(values.company_reg_no, '000000-X');
});

test('a monthly driver owes months; a delisted driver owes only up to the delist date', () => {
  const monthly = letterValues({
    driver: driver({ rentalCycle: 'MONTHLY', rentalRate: 1200, contractStartDate: '2026-07-01', paymentHistory: [], totalAmountPaid: 0 }),
    car: null, company: COMPANY, letterDate: '2026-10-14', payWithinDays: 14, reference: '',
  });
  assert.equal(monthly.rent_arrears, 'RM 4,800.00'); // 1 Jul, 1 Aug, 1 Sep, 1 Oct
  assert.equal(monthly.cycles_owed, '4 bulan');
  assert.equal(monthly.rental_cycle, 'bulan');
  assert.equal(monthly.vehicle_plate, 'XAA1001', 'the driver plate stands in when Fleet has no car');
  const delisted = letterValues({
    driver: driver({ isDelisted: true, delistDate: '2026-08-20' }), car: null, company: COMPANY, letterDate: '2026-10-14', payWithinDays: 7, reference: '',
  });
  assert.equal(delisted.rent_arrears, 'RM 300.00'); // 3, 10, 17 Aug due; 2 paid
  assert.equal(delisted.arrears_as_of, '20 Ogos 2026');
  const withCosts = letterValues({
    driver: driver(), car: null, company: COMPANY, letterDate: '2026-10-14', payWithinDays: 7, reference: '', repairCost: '1,000', paintDentCost: 'RM 300.50',
  });
  assert.equal(withCosts.total_debt, 'RM 4,000.50');
  assert.equal(withCosts.debt_breakdown, 'hutang sewa RM 2,700.00 + kos baiki kereta RM 1,000.00 + kos cat dan kemek RM 300.50 = RM 4,000.50');
});

test('nothing owed prints RM 0.00, and a missing value stays empty (it prints as a line to write on)', () => {
  const values = letterValues({
    driver: driver({ paymentHistory: [{ id: 'p', amount: 99999, date: '2026-08-03' } as Driver['paymentHistory'][number]], address: '' }),
    car: null, company: { ...COMPANY, company_name: '' }, letterDate: '2026-10-14', payWithinDays: 7, reference: '',
  });
  assert.equal(values.rent_arrears, 'RM 0.00');
  assert.equal(values.cycles_owed, '0 minggu');
  assert.equal(values.customer_address, '');
  assert.equal(values.company_name, '');
  assert.equal(values.letter_ref, '');
});

test('the three built-in letters are in Malay, name their purpose, and use only placeholders the letter fills', () => {
  assert.deepEqual(LETTER_KINDS, ['BATAL_SEWABELI', 'TUNTUT_SEWA', 'CTOS_LOD']);
  const known = new Set(LETTER_PLACEHOLDERS.map(p => p.key));
  const words: Record<string, RegExp[]> = {
    BATAL_SEWABELI: [/PEMBATALAN/i, /Sewa Beli/, /\{\{total_debt\}\}/, /\{\{vehicle_plate\}\}/],
    TUNTUT_SEWA: [/TUNTUTAN/i, /\{\{total_debt\}\}/, /\{\{pay_by_date\}\}/],
    CTOS_LOD: [/CTOS/, /\{\{total_debt\}\}/, /\{\{pay_by_date\}\}/],
  };
  for (const kind of LETTER_KINDS) {
    const letter = defaultLetter(kind);
    assert.ok(LETTER_LABELS[kind]);
    for (const pattern of words[kind]) assert.match(`${letter.title}\n${letter.body}`, pattern, `${kind}: ${pattern}`);
    for (const key of placeholdersIn(`${letter.title}\n${letter.body}`)) assert.ok(known.has(key), `${kind}: {{${key}}} is not filled by the letter`);
    assert.doesNotMatch(letter.body, /d{6,}/, 'company numbers and accounts come from the database, never the draft');
  }
});

test('a saved letter is used when sound; anything else falls back to the built-in draft', () => {
  assert.deepEqual(letterFromStored('CTOS_LOD', { title: 'T', body: 'B' }), { title: 'T', body: 'B' });
  assert.deepEqual(letterFromStored('CTOS_LOD', { title: 'T' }), defaultLetter('CTOS_LOD'));
  assert.deepEqual(letterFromStored('TUNTUT_SEWA', null), defaultLetter('TUNTUT_SEWA'));
});

test('a letter prints on the agreement letterhead and footer, without the agreement initials line', () => {
  const values = { ...COMPANY, customer_name: 'Fixture Driver One', total_debt: 'RM 2,700.00', letter_ref: 'ECA/FIX/001', letter_date: '14 Oktober 2026' };
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawLetter(doc, defaultLetter('TUNTUT_SEWA'), values);
  const text = doc.output();
  for (const words of ['Fixture Rentals Sdn Bhd', 'Company No. 000000-X', 'Private & Confidential', 'Page 1 of', 'RM 2,700.00', 'Fixture Driver One', 'ECA/FIX/001', '14 Oktober 2026']) {
    assert.ok(text.includes(words), words);
  }
  assert.ok(!text.includes("Lessee's initials"));
  // The agreement keeps its initials line and the same letterhead
  const agreement = new jsPDF({ unit: 'mm', format: 'a4' });
  drawAgreement(agreement, defaultTemplate('SEWA_BIASA'), COMPANY);
  const agreementText = agreement.output();
  for (const words of ["Lessee's initials", 'Private & Confidential', 'Company No. 000000-X', 'Page 1 of 4']) assert.ok(agreementText.includes(words), words);
});

test('every built-in letter fits on its page(s) with the company logo, and a long letter flows on with numbered pages', () => {
  const png = `data:image/png;base64,${readFileSync(new URL('../public/agreement-logo.png', import.meta.url)).toString('base64')}`;
  for (const kind of LETTER_KINDS) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    drawLetter(doc, defaultLetter(kind), COMPANY, png);
    assert.ok(doc.getNumberOfPages() <= 2, `${kind} is at most two pages`);
    assert.ok(doc.output().includes('/Subtype /Image'));
  }
  const long = { title: 'Fixture', body: Array.from({ length: 60 }, (_, i) => `${i + 1}. A fixture paragraph long enough to wrap onto a second line of the page for testing the layout.`).join('\n\n') };
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawLetter(doc, long, {});
  assert.ok(doc.getNumberOfPages() >= 2);
  assert.ok(doc.output().includes(`Page 2 of ${doc.getNumberOfPages()}`));
});

test('unfilled boxes print as a line to write on, and file names are safe', () => {
  assert.ok(fillText('{{letter_ref}}', {}).includes('___'));
  assert.equal(letterFileName('CTOS_LOD', 'XAA1001', 'Fixture/Driver: One'), 'CTOS LOD XAA1001 Fixture Driver  One.pdf');
  assert.equal(letterFileName('BATAL_SEWABELI', 'XAA1001', 'Fixture Driver'), 'Surat Batal Sewa Beli XAA1001 Fixture Driver.pdf');
});

test('letters are saved under their own key and reset by removing it; a letter never saved uses the built-in draft', async () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const result = { data: [{ key: 'letter:CTOS_LOD', value: { title: 'Fixture CTOS', body: 'Body' } }], error: null };
  const builder: any = new Proxy({}, {
    get(_t, method: string) {
      if (method === 'then') return (resolve: (v: unknown) => void) => resolve(result);
      return (...args: unknown[]) => { calls.push({ method, args }); return builder; };
    },
  });
  const api = agreementApi({ from: (table: string) => { calls.push({ method: 'from', args: [table] }); return builder; } });
  const settings = await api.load();
  assert.equal(settings.letters.CTOS_LOD.title, 'Fixture CTOS');
  assert.deepEqual(settings.letters.TUNTUT_SEWA, defaultLetter('TUNTUT_SEWA'));
  assert.equal(settings.letterBuiltIn.CTOS_LOD, false);
  assert.equal(settings.letterBuiltIn.BATAL_SEWABELI, true);
  calls.length = 0;
  await api.saveLetter('TUNTUT_SEWA', { title: 'T', body: 'B' });
  assert.equal((calls.find(c => c.method === 'upsert')!.args[0] as { key: string }).key, 'letter:TUNTUT_SEWA');
  calls.length = 0;
  await api.resetLetter('BATAL_SEWABELI');
  assert.deepEqual(calls.map(c => c.method), ['from', 'delete', 'eq']);
  assert.deepEqual(calls[2].args, ['key', 'letter:BATAL_SEWABELI']);
});

test('the letters SQL lets admins save the three letter keys and still refuses any other key', async () => {
  const db = await database();
  try {
    await db.exec(`create table public.cars(id text primary key, make text, model text, "plateNumber" text);`);
    await migrate(db, '20261009090000_vehicle_details_and_agreements.sql');
    await migrate(db, '20261014120000_agreement_letters.sql');
    await migrate(db, '20261014120000_agreement_letters.sql'); // safe to run twice
    await asUser(db, ADMIN_ID);
    await db.query(`insert into public.agreement_settings(key, value) values
      ('letter:BATAL_SEWABELI', '{}'), ('letter:TUNTUT_SEWA', '{}'), ('letter:CTOS_LOD', '{}'), ('template:SEWABELI', '{}'), ('company', '{}')`);
    await assert.rejects(db.query(`insert into public.agreement_settings(key, value) values ('letter:OTHER', '{}')`), /check constraint/);
  } finally { await db.close(); }
});
