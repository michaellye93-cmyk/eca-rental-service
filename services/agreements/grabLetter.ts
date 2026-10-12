import type { jsPDF } from 'jspdf';
import { longDate } from './template.ts';

/** The Grab e-hailing letter's boxes, each printed on its line of the form. */
export interface GrabLetterValues {
  owner_name: string;
  owner_ic_no: string;
  vehicle_model: string;
  vehicle_plate: string;
  driver_name: string;
  driver_ic_no: string;
  owner_signatory_name: string;
  letter_date: string;
}

/**
 * The letter's boxes: the driver from their profile, the car and its registered owner from Fleet (named again under the
 * owner's signature), and the date typed on the day (YYYY-MM-DD). Nothing missing is guessed; it prints as a line to write on.
 */
export const grabLetterValues = ({ driver, car, details, letterDate }: {
  driver: { name?: string; nric?: string };
  car: { plateNumber: string; make: string; model: string } | null;
  details: { ownerName: string; ownerId: string } | null;
  letterDate: string;
}): GrabLetterValues => ({
  owner_name: (details?.ownerName ?? '').trim(),
  owner_ic_no: (details?.ownerId ?? '').trim(),
  vehicle_model: `${car?.make ?? ''} ${car?.model ?? ''}`.trim(),
  vehicle_plate: (car?.plateNumber ?? '').trim(),
  driver_name: (driver.name ?? '').trim(),
  driver_ic_no: (driver.nric ?? '').trim(),
  owner_signatory_name: (details?.ownerName ?? '').trim(),
  letter_date: longDate(letterDate),
});

/** The two forms: Grab's, and the one for other e-hailing operators (EHO). Same layout, three lines worded differently. */
export type LetterKind = 'grab' | 'other';

// The original forms (one A4 page, Word, Arial), measured in points from the top left. Every word sits where Word put
// it, so the justified lines keep their spacing; each box is a thin rule 1.32 pt under its line's baseline.
type Words = [string, number][];
type Line = { size: number; bold?: boolean; baseline: number; words: Words };
/** The lines that differ between the forms. */
const WORDING: Record<LetterKind, Line[]> = {
  grab: [
    { size: 12, baseline: 343.13, words: [['I', 72.02], ['hereby', 86.18], ['authorize', 133.82], ['and', 194.21], ['grant', 224.33], ['permission', 261.89], ['to', 330.19], ['(Grab', 350.23], ['Driver-Partner’s', 391.15], ['name)', 485.74]] },
    { size: 12, baseline: 401.57, words: [['to', 72.02], ['register', 89.54], ['with', 136.94], ['E-hailing', 165.74], ['Driver', 219.89], ['and', 259.25], ['to', 286.75], ['use', 304.15], ['my', 330.91], ['vehicle', 354.43], ['to', 399.1], ['carry', 416.62], ['out', 450.58], ['E-hailing', 473.74]] },
    { size: 12, baseline: 430.73, words: [['services.', 72.02]] },
  ],
  other: [
    { size: 12, baseline: 343.13, words: [['I', 72.02], ['hereby', 86.18], ['authorize', 133.82], ['and', 194.21], ['grant', 224.33], ['permission', 261.89], ['to', 330.19], ['(E-hailing', 350.23], ['Driver', 403.15], ['name)', 437.74]] },
    { size: 12, baseline: 401.57, words: [['to', 72.02], ['register', 87.86], ['with', 133.58], ['E-hailing', 160.58], ['as', 212.93], ['Driver', 231.41], ['and', 269.09], ['to', 294.79], ['use', 310.39], ['my', 335.47], ['vehicle', 357.31], ['to', 400.3], ['carry', 416.02], ['out', 448.3], ['E-hailing-', 469.78]] },
    { size: 12, baseline: 430.73, words: [['related', 72.02], ['services.', 112.22]] },
  ],
};
const COMMON: Line[] = [
  { size: 16, bold: true, baseline: 86.66, words: [['LETTER', 201.29], ['OF', 267.89], ['AUTHORIZATION', 294.31]] },
  { size: 13, bold: true, baseline: 146.06, words: [['SUBJECT', 72.02], [':', 135.98], ['LETTER', 143.66], ['TO', 197.81], ['AUTHORIZE', 219.29], ['THE', 298.39], ['USE', 328.03], ['OF', 358.15], ['VEHICLE', 379.63]] },
  { size: 12, baseline: 226.22, words: [['I,', 72.02], ['(name', 82.07], ['of', 119.38], ['vehicle', 132.79], ['owner)', 173.41], [',', 507.82]] },
  { size: 12, baseline: 255.38, words: [['(I/C', 72.02], ['No.)', 101.42], [',', 254.69], ['am', 268.25], ['the', 295.03], ['vehicle', 321.91], ['owner', 369.43], ['of', 412.3], ['(vehicle', 432.46], ['model)', 481.18]] },
  { size: 12, baseline: 284.33, words: [['(car', 181.85], ['plate', 205.85], ['number)', 235.21], ['.', 418.06]] },
  { size: 12, baseline: 372.29, words: [['(I/C', 251.81], ['No.)', 276.53], [',', 416.5], ['to', 424.29], ['use', 438.78], ['my', 462.51], ['vehicle', 483]] },
  { size: 12, baseline: 474.79, words: [['Thank', 72.02], ['you.', 108.5]] },
  { size: 12, baseline: 591.79, words: [['Yours', 72.02], ['truly,', 105.26]] },
  { size: 12, baseline: 655.42, words: [['(Vehicle', 72.02], ['Owner’s', 118.22], ['Signature)', 165.14]] },
  { size: 12, baseline: 685.3, words: [['Vehicle', 72.02], ['Owner’s', 114.79], ['Name:', 162.04]] },
  { size: 12, baseline: 716.98, words: [['Date', 72.02], [':', 100.78]] },
];
const BOXES: { key: keyof GrabLetterValues; from: number; to: number; baseline: number }[] = [
  { key: 'owner_name', from: 215.45, to: 507.82, baseline: 226.22 },
  { key: 'owner_ic_no', from: 134.3, to: 254.68, baseline: 255.38 },
  { key: 'vehicle_model', from: 72.02, to: 181.84, baseline: 284.33 },
  { key: 'vehicle_plate', from: 283.27, to: 418.05, baseline: 284.33 },
  { key: 'driver_name', from: 72.02, to: 248.8, baseline: 372.29 },
  { key: 'driver_ic_no', from: 304.03, to: 416.49, baseline: 372.29 },
  { key: 'owner_signatory_name', from: 200.81, to: 337.27, baseline: 685.3 },
  { key: 'letter_date', from: 107.42, to: 244.6, baseline: 716.98 },
];
/** The open line the owner signs on. */
const SIGNATURE = { from: 72, to: 219.26, y: 636.25, width: 0.7585 };
const PT_PER_MM = 72 / 25.4;

/**
 * Draws the letter on the first page of an empty A4 jsPDF document, in whatever unit it was made with. A value too long
 * for its line is printed smaller (down to 7 pt) so it stays on the line.
 */
export function drawGrabLetter(doc: jsPDF, values: GrabLetterValues | Record<string, string>, kind: LetterKind = 'grab') {
  const k = doc.internal.scaleFactor; // points per document unit
  const at = (pt: number) => pt / k;
  doc.setTextColor(0, 0, 0);
  doc.setFillColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  for (const line of [...COMMON, ...WORDING[kind]]) {
    doc.setFont('helvetica', line.bold ? 'bold' : 'normal');
    doc.setFontSize(line.size);
    for (const [word, x] of line.words) doc.text(word, at(x), at(line.baseline));
  }
  doc.setFont('helvetica', 'normal');
  for (const box of BOXES) {
    doc.rect(at(box.from), at(box.baseline + 1.32), at(box.to - box.from), at(0.6), 'F');
    const value = ((values as Record<string, string>)[box.key] ?? '').trim();
    if (!value) continue;
    const room = box.to - box.from - 2;
    const fits = (lines: string[], size: number) => {
      doc.setFontSize(size);
      return lines.every(line => doc.getTextWidth(line) * k <= room);
    };
    // One line, down to 9 pt; past that, two lines (split at the most even word break) above the rule, down to 7 pt
    let lines = [value];
    let size = 12;
    while (size > 9 && !fits(lines, size)) size -= 0.5;
    if (!fits(lines, size)) {
      const words = value.split(/\s+/);
      const splits = words.slice(1).map((_, i) => [words.slice(0, i + 1).join(' '), words.slice(i + 1).join(' ')]);
      doc.setFontSize(10);
      lines = splits.length ? splits.reduce((best, pair) =>
        Math.max(...pair.map(line => doc.getTextWidth(line))) < Math.max(...best.map(line => doc.getTextWidth(line))) ? pair : best) : lines;
      size = 10;
      while (size > 7 && !fits(lines, size)) size -= 0.5;
    }
    doc.setFontSize(size);
    lines.forEach((line, i) => doc.text(line, at(box.from + 2), at(box.baseline - (lines.length - 1 - i) * size * 1.1)));
  }
  doc.setFontSize(12);
  doc.setLineWidth(at(SIGNATURE.width));
  doc.line(at(SIGNATURE.from), at(SIGNATURE.y), at(SIGNATURE.to), at(SIGNATURE.y));
  doc.setLineWidth(0.2 * PT_PER_MM / k);
}

const fileName = (title: string, plate: string, driver: string): string =>
  `${[title, plate, driver].map(part => (part || '').replace(/[\\/:*?"<>|]+/g, ' ').trim()).filter(Boolean).join(' ')}.pdf`;
/** A safe file name, e.g. "Grab Authorization Letter XAA1001 Fixture Driver.pdf". */
export const grabLetterFileName = (plate: string, driver: string): string => fileName('Grab Authorization Letter', plate, driver);
/** A safe file name, e.g. "Other EHO Authorization Letter XAA1001 Fixture Driver.pdf". */
export const otherLetterFileName = (plate: string, driver: string): string => fileName('Other EHO Authorization Letter', plate, driver);

/** Builds the letter in the browser and downloads it. Nothing is uploaded or stored. jsPDF loads only when used. */
export async function downloadGrabLetterPdf(values: GrabLetterValues, name: string, kind: LetterKind = 'grab') {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  drawGrabLetter(doc, values, kind);
  doc.save(name);
}
