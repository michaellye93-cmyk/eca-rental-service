import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { agreementFileName, drawAgreement } from '../services/agreements/pdf.ts';
import { defaultTemplate } from '../services/agreements/template.ts';

test('each built-in template draws into an A4 PDF with every section heading and filled values', () => {
  for (const kind of ['SEWA_BIASA', 'SEWABELI'] as const) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    drawAgreement(doc, defaultTemplate(kind), { customer_name: 'Fixture Driver One', vehicle_plate: 'XAA1001', company_name: 'Fixture Rentals Sdn Bhd' });
    const text = doc.output();
    assert.ok(text.startsWith('%PDF'));
    for (const heading of ['SECTION A', 'SECTION B', 'SECTION C', 'SECTION D', 'Fixture Driver One', 'XAA1001']) {
      assert.ok(text.includes(heading), `${kind}: ${heading}`);
    }
  }
});

test('a long section flows onto more pages, each numbered', () => {
  const template = defaultTemplate('SEWA_BIASA');
  template.sections[1] = { ...template.sections[1], body: Array.from({ length: 80 }, (_, i) => `${i + 1}. A fixture clause long enough to wrap onto a second line of the page for testing the layout.`).join('\n\n') };
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawAgreement(doc, template, {});
  assert.ok(doc.getNumberOfPages() >= 3);
  assert.ok(doc.output().includes(`Page 1 of ${doc.getNumberOfPages()}`));
});

test('file names drop characters Windows refuses', () => {
  assert.equal(agreementFileName('Sewa Beli', 'XAA1001', 'Fixture/Driver: One'), 'Agreement Sewa Beli XAA1001 Fixture Driver  One.pdf');
});

test('every section after the first starts on a new page unless it is set to follow on', async () => {
  const { startsNewPage } = await import('../services/agreements/template.ts');
  const template = defaultTemplate('SEWA_BIASA');
  template.sections = template.sections.map(s => ({ ...s, body: s.layout === 'clauses' ? '1. Short.' : s.body }));
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawAgreement(doc, template, {});
  assert.equal(doc.getNumberOfPages(), 4, 'sections A, B, C and D each on their own page');
  assert.equal(startsNewPage(template.sections[0], 0), false);
  assert.equal(startsNewPage({ ...template.sections[2], keepWithPrevious: true }, 2), false);
  const together = { ...template, sections: template.sections.map(s => ({ ...s, keepWithPrevious: true })) };
  const one = new jsPDF({ unit: 'mm', format: 'a4' });
  drawAgreement(one, together, {});
  assert.ok(one.getNumberOfPages() < 4);
});

test('the agreement reads like a formal agreement: parties paragraph, letterhead on every page, witness wording and initials', () => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawAgreement(doc, defaultTemplate('SEWABELI'), { company_name: 'Fixture Rentals Sdn Bhd', company_reg_no: '000000-X', customer_name: 'Fixture Driver One', agreement_ref: 'FIX-001' });
  const text = doc.output();
  for (const words of ['THIS AGREEMENT is made on', 'IN WITNESS WHEREOF', "Lessee's initials", "Lessor's initials", 'Ref. FIX-001']) {
    assert.ok(text.includes(words), words);
  }
  // The company name heads every page
  assert.equal(text.split('Fixture Rentals Sdn Bhd').length - 1 >= doc.getNumberOfPages(), true);
});

test('the short Sewa Biasa fits its terms on one page: four pages in all', () => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawAgreement(doc, defaultTemplate('SEWA_BIASA'), {});
  assert.equal(doc.getNumberOfPages(), 4);
});

test('the Lessor signs as the company (name and company no.), and every box carries the agreement date', () => {
  const sig = defaultTemplate('SEWABELI').sections.find(s => s.layout === 'signature')!;
  assert.match(sig.body, /For and on behalf of the Lessor \| \{\{company_name\}\} \| \{\{company_reg_no\}\} \| \{\{agreement_date\}\}/);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawAgreement(doc, { title: 'T', sections: [sig] }, { company_name: 'Fixture Rentals Sdn Bhd', company_reg_no: '000000-X', customer_name: 'Fixture Driver One', agreement_date: '9 October 2026' });
  const text = doc.output();
  assert.ok(text.includes('Name: Fixture Rentals Sdn Bhd'));
  assert.ok(text.includes('NRIC / Co. No.: 000000-X'));
  assert.equal(text.split('Date: 9 October 2026').length - 1, 3, 'Lessee, Lessor and Witness');
});
