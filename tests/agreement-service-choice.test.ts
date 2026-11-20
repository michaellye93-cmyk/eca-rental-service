import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { drawAgreement } from '../services/agreements/pdf.ts';
import {
  SERVICE_MARK, defaultTemplate, forServiceBy, hasServiceChoice, templateFromStored, type AgreementTemplate, type ServiceBy,
} from '../services/agreements/template.ts';
import { copyFromStored } from '../services/agreements/api.ts';

const KINDS = ['SEWABELI', 'SEWA_BIASA'] as const;
const CHOICES: ServiceBy[] = ['LESSOR', 'LESSEE'];
const allText = (template: AgreementTemplate) => [template.preamble ?? '', ...template.sections.map(s => `${s.title}\n${s.body}`)].join('\n');
const terms = (template: AgreementTemplate) => template.sections.find(s => s.id === 'terms')!.body;
const schedule = (template: AgreementTemplate) => template.sections.find(s => s.id === 'schedule')!.body;

test('each built-in draft offers the service and maintenance choice', () => {
  for (const kind of KINDS) assert.equal(hasServiceChoice(defaultTemplate(kind)), true, kind);
});

test('Company chosen: the Lessor arranges servicing, as the agreements say today, and no markers print', () => {
  const beli = forServiceBy(defaultTemplate('SEWABELI'), 'LESSOR');
  assert.match(terms(beli), /Routine servicing and approved repairs are arranged by the Lessor/);
  assert.doesNotMatch(terms(beli), /The Lessee arranges and pays for all servicing/);
  assert.match(schedule(beli), /Service and maintenance \| By the Lessor \(Section B, clause 5\)/);
  const biasa = forServiceBy(defaultTemplate('SEWA_BIASA'), 'LESSOR');
  assert.match(terms(biasa), /the Lessor renews road tax and insurance and arranges servicing/);
  assert.match(schedule(biasa), /Service and maintenance \| By the Lessor \(Section B, clause 4\.2\)/);
  for (const template of [beli, biasa]) {
    assert.ok(!allText(template).includes(SERVICE_MARK.LESSOR) && !allText(template).includes(SERVICE_MARK.LESSEE));
  }
});

test('Lessee chosen: the Lessee arranges and pays for servicing; the Lessor still renews road tax and insurance', () => {
  const beli = forServiceBy(defaultTemplate('SEWABELI'), 'LESSEE');
  assert.match(terms(beli), /The Lessee arranges and pays for all servicing, maintenance and repairs/);
  assert.doesNotMatch(terms(beli), /arranged by the Lessor/);
  assert.match(terms(beli), /Road tax and insurance\. The Lessor renews/);
  assert.match(schedule(beli), /Service and maintenance \| By the Lessee, at the Lessee's own cost \(Section B, clause 5\)/);
  const biasa = forServiceBy(defaultTemplate('SEWA_BIASA'), 'LESSEE');
  assert.match(terms(biasa), /arranges and pays for all servicing, maintenance, repairs and wear parts/);
  assert.doesNotMatch(terms(biasa), /arranges servicing/);
  assert.match(terms(biasa), /the Lessor renews road tax and insurance\.$/m);
  assert.match(schedule(biasa), /By the Lessee, at the Lessee's own cost \(Section B, clause 4\.2\)/);
  for (const template of [beli, biasa]) {
    assert.ok(!allText(template).includes(SERVICE_MARK.LESSOR) && !allText(template).includes(SERVICE_MARK.LESSEE));
  }
});

test('clause numbers stay in order with either choice (one 5.2, 5.3 and 5.4 each)', () => {
  for (const by of CHOICES) {
    const body = terms(forServiceBy(defaultTemplate('SEWABELI'), by));
    for (const n of ['5.1', '5.2', '5.3', '5.4']) assert.equal(body.split(`\n\n${n} `).length - 1, 1, `${by} ${n}`);
  }
});

test('a template saved before this choice existed gets both wordings when loaded, so the choice works on it too', () => {
  for (const kind of KINDS) {
    const old = forServiceBy(defaultTemplate(kind), 'LESSOR');
    old.sections = old.sections.map(s => (s.id === 'schedule' ? { ...s, body: s.body.split('\n').filter(l => !l.startsWith('Service and maintenance')).join('\n') } : s));
    const loaded = templateFromStored(kind, old);
    assert.equal(hasServiceChoice(loaded), true, kind);
    assert.deepEqual(forServiceBy(loaded, 'LESSEE'), forServiceBy(defaultTemplate(kind), 'LESSEE'), kind);
    assert.deepEqual(forServiceBy(loaded, 'LESSOR'), forServiceBy(defaultTemplate(kind), 'LESSOR'), kind);
  }
});

test('a saved template whose service clause was reworded is left as it is and offers no choice', () => {
  const old = forServiceBy(defaultTemplate('SEWA_BIASA'), 'LESSOR');
  old.sections = old.sections.map(s => (s.id === 'terms' ? { ...s, body: s.body.replace('arranges servicing', 'looks after servicing') } : s));
  const loaded = templateFromStored('SEWA_BIASA', old);
  assert.equal(hasServiceChoice(loaded), false);
  assert.match(terms(loaded), /looks after servicing/);
  assert.deepEqual(forServiceBy(loaded, 'LESSEE'), forServiceBy(loaded, 'LESSOR'), 'nothing to switch');
});

test('a saved template that already carries the markers is not changed when loaded', () => {
  const saved = defaultTemplate('SEWABELI');
  saved.sections = saved.sections.map(s => (s.id === 'terms' ? { ...s, body: s.body.replace('Routine servicing', 'Regular servicing') } : s));
  assert.deepEqual(templateFromStored('SEWABELI', saved), saved);
});

test('with either choice the Schedule fits page 1 and Sewa Biasa is still four pages', () => {
  const long = {
    customer_address: 'No. 12, Jalan Fixture Panjang 3/45, Taman Fixture Indah, 43200 Fixture Town, Selangor Darul Ehsan',
    company_bank_account: 'Fixture Bank 0000000000 (Fixture Rentals Sdn Bhd)',
  };
  for (const kind of KINDS) {
    for (const by of CHOICES) {
      const template = forServiceBy(defaultTemplate(kind), by);
      const first = new jsPDF({ unit: 'mm', format: 'a4' });
      drawAgreement(first, { ...template, sections: [template.sections[0]] }, long);
      assert.equal(first.getNumberOfPages(), 1, `${kind} ${by}: Schedule spills onto a second page`);
      if (kind === 'SEWA_BIASA') {
        const whole = new jsPDF({ unit: 'mm', format: 'a4' });
        drawAgreement(whole, template, long);
        assert.equal(whole.getNumberOfPages(), 4, `${by}: Sewa Biasa terms no longer fit one page`);
      }
    }
  }
});

test("the driver's saved copy keeps the choice so the page shows it again", () => {
  const copy = copyFromStored({ kind: 'SEWA_BIASA', template: defaultTemplate('SEWA_BIASA'), values: {},
    signing: { agreementDate: '2026-11-19', extra: {}, serviceBy: 'LESSEE' }, created_at: '2026-11-19T00:00:00Z' });
  assert.equal(copy?.signing?.serviceBy, 'LESSEE');
  const older = copyFromStored({ kind: 'SEWA_BIASA', template: defaultTemplate('SEWA_BIASA'), values: {},
    signing: { agreementDate: '2026-11-19', extra: {} }, created_at: '2026-11-19T00:00:00Z' });
  assert.equal(older?.signing?.serviceBy, undefined, 'copies from before the choice have none');
  const odd = copyFromStored({ kind: 'SEWA_BIASA', template: defaultTemplate('SEWA_BIASA'), values: {},
    signing: { agreementDate: '2026-11-19', extra: {}, serviceBy: 'SOMEONE' }, created_at: '2026-11-19T00:00:00Z' });
  assert.equal(odd?.signing?.serviceBy, undefined);
});

test('review 1: a saved template with a Company service clause deleted is left as it is, not given the clause back', () => {
  for (const [kind, gone] of [['SEWABELI', '5.4 Repairs need approval'], ['SEWA_BIASA', '4.2 Costs']] as const) {
    const old = forServiceBy(defaultTemplate(kind), 'LESSOR');
    old.sections = old.sections.map(s => (s.id === 'terms' ? { ...s, body: s.body.split('\n\n').filter(p => !p.startsWith(gone)).join('\n\n') } : s));
    const loaded = templateFromStored(kind, old);
    assert.equal(hasServiceChoice(loaded), false, kind);
    assert.ok(!terms(forServiceBy(loaded, 'LESSOR')).includes(gone), `${kind}: deleted clause came back`);
  }
});

test('review 2: a mark at the start of a line inside a paragraph governs that line, and marks match in any letter case', () => {
  const template: AgreementTemplate = { title: 'T', sections: [{ id: 'terms', title: 'Terms', layout: 'clauses',
    body: '1. Intro.\n\n[Company service] 2. Company does it.\n[lessee SERVICE] 2. Lessee does it.\n\n3. End.' }] };
  assert.equal(hasServiceChoice(template), true);
  assert.equal(forServiceBy(template, 'LESSOR').sections[0].body, '1. Intro.\n\n2. Company does it.\n\n3. End.');
  assert.equal(forServiceBy(template, 'LESSEE').sections[0].body, '1. Intro.\n\n2. Lessee does it.\n\n3. End.');
  // A marked paragraph keeps its following unmarked lines (an English line then its Malay line)
  const two: AgreementTemplate = { title: 'T', sections: [{ id: 'terms', title: 'Terms', layout: 'clauses',
    body: '[Lessee service] 2. Lessee does it.\nPenyewa melakukannya.\n\n[Company service] 2. Company does it.\nSyarikat melakukannya.' }] };
  assert.equal(forServiceBy(two, 'LESSEE').sections[0].body, '2. Lessee does it.\nPenyewa melakukannya.');
});

test('review 3: a template saved from the editor is never given the service wordings again', () => {
  const edited = forServiceBy(defaultTemplate('SEWA_BIASA'), 'LESSOR');
  const loaded = templateFromStored('SEWA_BIASA', { ...edited, serviceMarks: true });
  assert.equal(hasServiceChoice(loaded), false);
  assert.equal(loaded.serviceMarks, true, 'the flag survives a reload');
});
