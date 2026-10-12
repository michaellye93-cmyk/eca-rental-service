import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { drawGrabLetter, grabLetterFileName, grabLetterValues } from '../services/agreements/grabLetter.ts';

const driver = { name: 'Fixture Driver One', nric: '000000000001' };
const car = { plateNumber: 'XAA1001', make: 'Perodua', model: 'Bezza 1.3' };
const details = { ownerName: 'Fixture Owner Sdn Bhd', ownerId: '111111-Y' };
/** How jsPDF writes a piece of text in the file: brackets are escaped and ’ is WinAnsi byte 146. */
const inPdf = (text: string) => text.replace(/[()\\]/g, c => `\\${c}`).replace(/’/g, String.fromCharCode(146));
const letter = (values: Record<string, string>) => {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: false });
  drawGrabLetter(doc, values);
  return doc;
};

test('the letter is filled from the driver, the Fleet car and its registered owner (also printed as the owner\'s name under the signature), plus the typed date', () => {
  const values = grabLetterValues({ driver, car, details, letterDate: '2026-10-12' });
  assert.deepEqual(values, {
    owner_name: 'Fixture Owner Sdn Bhd',
    owner_ic_no: '111111-Y',
    vehicle_model: 'Perodua Bezza 1.3',
    vehicle_plate: 'XAA1001',
    driver_name: 'Fixture Driver One',
    driver_ic_no: '000000000001',
    owner_signatory_name: 'Fixture Owner Sdn Bhd',
    letter_date: '12 October 2026',
  });
});

test('a car with no registered owner on Fleet leaves the owner blank rather than guessing', () => {
  const values = grabLetterValues({ driver, car, details: null, letterDate: '' });
  assert.equal(values.owner_name, '');
  assert.equal(values.owner_ic_no, '');
  assert.equal(values.owner_signatory_name, '');
  assert.equal(values.letter_date, '');
});

test('the letter keeps every word of the form on one A4 page, with the values printed on their lines', () => {
  const doc = letter(grabLetterValues({ driver, car, details, letterDate: '2026-10-12' }));
  const text = doc.output();
  assert.ok(text.startsWith('%PDF'));
  assert.equal(doc.getNumberOfPages(), 1);
  const form = `LETTER OF AUTHORIZATION SUBJECT : LETTER TO AUTHORIZE THE USE OF VEHICLE I, (name of vehicle owner) , (I/C No.) , am the
    vehicle owner of (vehicle model) (car plate number) . I hereby authorize and grant permission to (Grab Driver-Partner’s name)
    (I/C No.) , to use my vehicle to register with E-hailing Driver and to use my vehicle to carry out E-hailing services.
    Thank you. Yours truly, (Vehicle Owner’s Signature) Vehicle Owner’s Name: Date :`;
  for (const word of form.split(/\s+/)) assert.ok(text.includes(`(${inPdf(word)})`), word);
  for (const value of ['Fixture Owner Sdn Bhd', '111111-Y', 'Perodua Bezza 1.3', 'XAA1001', 'Fixture Driver One', '000000000001', '12 October 2026']) {
    assert.ok(text.includes(`(${inPdf(value)})`), value);
  }
  // The original has no letterhead or logo
  assert.ok(!text.includes('/Subtype /Image'));
});

test('the layout matches the original: title placed where Word put it, 1-inch left margin, Arial-size text', () => {
  const doc = letter(grabLetterValues({ driver, car, details, letterDate: '' }));
  const text = doc.output();
  const at = (word: string) => {
    const match = new RegExp(`([\\d.]+) ([\\d.]+) Td\\s*\\(${inPdf(word).replace(/[\\()]/g, c => `\\${c}`)}\\) Tj`).exec(text);
    assert.ok(match, word);
    return [Number(match[1]), 842.04 - Number(match[2])];
  };
  const close = (actual: number, expected: number, word: string) => assert.ok(Math.abs(actual - expected) < 0.5, `${word}: ${actual} vs ${expected}`);
  for (const [word, x, baseline] of [['LETTER', 201.29, 86.66], ['SUBJECT', 72.02, 146.06], ['I,', 72.02, 226.22], ['services.', 72.02, 430.73], ['Yours', 72.02, 591.79], ['Date', 72.02, 716.98]] as const) {
    const [ax, ay] = at(word);
    close(ax, x, word);
    close(ay, baseline, word);
  }
  assert.match(text, /\/F2 16 Tf[\s\S]*?\(LETTER\) Tj/, 'title in bold 16');
  assert.match(text, /\/F2 13 Tf[\s\S]*?\(SUBJECT\) Tj/, 'subject in bold 13');
});

test('empty boxes print as lines to write on, and a long owner name shrinks to stay on its line', () => {
  const blank = letter(grabLetterValues({ driver: { name: '', nric: '' }, car: { plateNumber: '', make: '', model: '' }, details: null, letterDate: '' }));
  assert.equal(blank.getNumberOfPages(), 1);
  assert.ok(!blank.output().includes('____'), 'blank boxes are drawn rules, not underscores');

  const name = 'Fixture Very Long Registered Owner Name Holdings Sdn Bhd (Malaysia)';
  const long = letter(grabLetterValues({ driver, car, details: { ownerName: name, ownerId: '111111-Y' }, letterDate: '2026-10-12' }));
  const text = long.output();
  assert.equal(long.getNumberOfPages(), 1);
  const before = text.slice(0, text.indexOf(`(${inPdf(name)}) Tj`));
  const size = /\/F1 ([\d.]+) Tf(?![\s\S]*Tf)/.exec(before);
  assert.ok(size && Number(size[1]) < 12, 'printed smaller than 12 pt');
  long.setFontSize(Number(size![1]));
  assert.ok(long.getTextWidth(name) <= 292.37 - 2, 'fits on the owner name line');
});

test('a name too long for one line even when smaller goes onto two lines inside its box, never past it', () => {
  const name = 'FIXTURE DRIVER WITH A VERY LONG NAME BIN FIXTURE FATHER NAME EXAMPLE';
  const doc = letter(grabLetterValues({ driver: { name, nric: '000000000001' }, car, details, letterDate: '' }));
  const text = doc.output();
  const lines = [...text.matchAll(/\/F1 ([\d.]+) Tf\n(?:[^\n]*\n){2,3}([\d.]+) ([\d.]+) Td\s*\((FIXTURE DRIVER[^)]*|[^)]*EXAMPLE)\) Tj/g)];
  assert.equal(lines.length, 2, 'two lines');
  assert.equal(lines.map(m => m[4]).join(' '), name, 'nothing lost');
  for (const [, size, x, , words] of lines) {
    assert.ok(Number(size) >= 7);
    doc.setFontSize(Number(size));
    assert.ok(Number(x) + doc.getTextWidth(words) <= 248.8, `"${words}" stays inside the box`);
  }
});

test('the file name names the letter, plate and driver, without characters Windows refuses', () => {
  assert.equal(grabLetterFileName('XAA1001', 'Fixture/Driver: One'), 'Grab Authorization Letter XAA1001 Fixture Driver  One.pdf');
});
