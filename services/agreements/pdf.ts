import type { jsPDF } from 'jspdf';
import { LETTER_FOOTER_NOTE, letterBlocks, type LetterTemplate } from './letters.ts';
import { BLANK, fillText, isClauseHeading, parseParagraphs, parseRows, sectionHeading, startsNewPage, type AgreementTemplate } from './template.ts';

// A4 in millimetres
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 20;
const WIDTH = PAGE_W - MARGIN * 2;
/** Content starts under the letterhead and stops above the footer. */
const TOP = 36;
const BOTTOM = PAGE_H - 24;
const LINE = 4.4;

type Rgb = [number, number, number];
const NAVY: Rgb = [30, 58, 95];
const GOLD: Rgb = [197, 160, 89];
const INK: Rgb = [33, 37, 41];
const GREY: Rgb = [110, 117, 125];
const RULE: Rgb = [205, 211, 220];
const SHADE: Rgb = [243, 245, 248];
const BAND: Rgb = [226, 232, 240];

/** "1.", "2.3", "(a)" or "a)" at the start of a paragraph: printed with the text hanging after it. */
const CLAUSE_NUMBER = /^((?:\d+(?:\.\d+)*\.?)|(?:\([a-z0-9]+\))|(?:[a-z]\)))\s+/i;
/** A short clause title ending in a full stop ("Late charge."), printed in bold. */
const CLAUSE_TITLE = /^([^.\n]{2,45}\.)\s+/;

/** The company logo (the app's gold cube), drawn as lines so it prints sharp at any size. */
function drawLogo(doc: jsPDF, x: number, y: number, size: number) {
  const s = size / 200;
  const at = (px: number, py: number): [number, number] => [x + px * s, y + py * s];
  const paths: [number, number][][] = [
    [[100, 20], [170, 55], [100, 90], [30, 55], [100, 20]],
    [[30, 55], [100, 90], [100, 180], [30, 145], [30, 55]],
    [[55, 90], [85, 105]],
    [[100, 90], [170, 55], [170, 145], [100, 180], [100, 90]],
    [[120, 125], [150, 110]],
  ];
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(14 * s);
  doc.setLineCap('round');
  doc.setLineJoin('round');
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const [x1, y1] = at(...path[i - 1]);
      const [x2, y2] = at(...path[i]);
      doc.line(x1, y1, x2, y2);
    }
  }
  doc.setLineWidth(0.2);
  doc.setLineCap('butt');
  doc.setLineJoin('miter');
}

/**
 * The letterhead (logo, company name, number, address and contacts over a gold rule) and footer (Private & Confidential,
 * page numbers) on every page: one look for the agreements and every letter. `label` names the paper top right; the
 * agreement adds the initials line, a letter its `note` above the footer.
 */
export function drawPageFrame(doc: jsPDF, values: Record<string, string>, { label, initials = false, note = '', logo }: { label: string; initials?: boolean; note?: string; logo?: string }) {
  const font = (style: 'normal' | 'bold' | 'italic', size: number, colour: Rgb = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...colour);
  };
  const pages = doc.getNumberOfPages();
  const company = values.company_name || '';
  const companyLine = [values.company_reg_no && `Company No. ${values.company_reg_no}`, values.company_address].filter(Boolean).join('  ·  ');
  const contactLine = [values.company_phone && `Tel: ${values.company_phone}`, values.company_email].filter(Boolean).join('  ·  ');
  const ref = values.agreement_ref || values.letter_ref ? `Ref. ${values.agreement_ref || values.letter_ref}` : '';
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    if (logo) doc.addImage(logo, 'PNG', MARGIN, 10, 16, 16, 'agreement-logo', 'FAST');
    else drawLogo(doc, MARGIN, 11, 15);
    const textX = MARGIN + 19;
    font('bold', 11, NAVY);
    if (company) doc.text(company, textX, 16);
    font('normal', 7.5, GREY);
    if (companyLine) doc.text((doc.splitTextToSize(companyLine, PAGE_W - MARGIN - textX - 34) as string[])[0], textX, 20.5);
    if (contactLine) doc.text(contactLine, textX, 24.5);
    font('bold', 7.5, NAVY);
    doc.text(label, PAGE_W - MARGIN, 16, { align: 'right' });
    font('normal', 7.5, GREY);
    if (ref) doc.text(ref, PAGE_W - MARGIN, 20.5, { align: 'right' });
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, 29, PAGE_W - MARGIN, 29);
    doc.setLineWidth(0.2);

    if (note) {
      font('italic', 8, GREY);
      doc.text(note, PAGE_W / 2, PAGE_H - 19.5, { align: 'center' });
    }
    doc.setDrawColor(...RULE);
    doc.line(MARGIN, PAGE_H - 17, PAGE_W - MARGIN, PAGE_H - 17);
    font('normal', 8, GREY);
    if (initials) doc.text("Lessor's initials ________      Lessee's initials ________", MARGIN, PAGE_H - 11.5);
    doc.text('Private & Confidential', initials ? PAGE_W / 2 + 18 : PAGE_W / 2, PAGE_H - 11.5, { align: 'center' });
    doc.text(`Page ${page} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 11.5, { align: 'right' });
  }
}

/** The company logo printed in the letterhead (public/agreement-logo.png); the drawn mark is used if it can't load. */
export const LOGO_URL = '/agreement-logo.png';

/**
 * Draws the filled agreement into an empty jsPDF document (A4, millimetres). `logo` is the company logo as a PNG data
 * URL; without it a drawn mark stands in.
 */
export function drawAgreement(doc: jsPDF, template: AgreementTemplate, values: Record<string, string>, logo?: string) {
  let y = TOP;
  const fill = (text: string) => fillText(text, values);
  const newPage = () => {
    doc.addPage();
    y = TOP;
  };
  const room = (height: number) => {
    if (y + height > BOTTOM) newPage();
  };
  const font = (style: 'normal' | 'bold' | 'italic', size: number, colour: Rgb = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...colour);
  };
  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(text, width) as string[];

  /** A paragraph at `x`, `width` wide, with an optional bold lead-in on its first line. Breaks across pages. */
  const paragraph = (text: string, x: number, width: number, size: number, lead = '') => {
    font('bold', size);
    const leadW = lead ? doc.getTextWidth(`${lead} `) : 0;
    font('normal', size);
    const parts = text.split(/\r?\n/);
    // The first line is shorter by the bold lead-in; the rest use the full width
    const firstLine = wrap(parts[0], width - leadW)[0] ?? '';
    const rest = parts[0].slice(firstLine.length).trim();
    const lines: { text: string; lead: boolean }[] = [{ text: firstLine, lead: true }];
    if (rest) lines.push(...wrap(rest, width).map(line => ({ text: line, lead: false })));
    for (const part of parts.slice(1)) lines.push(...wrap(part, width).map(line => ({ text: line, lead: false })));
    for (const line of lines) {
      room(LINE);
      if (line.lead && lead) {
        font('bold', size);
        doc.text(lead, x, y + 3.3);
        font('normal', size);
        doc.text(line.text, x + leadW, y + 3.3);
      } else {
        doc.text(line.text, x, y + 3.3);
      }
      y += LINE;
    }
  };

  // Title under a gold rule, then the parties
  font('bold', 15, NAVY);
  for (const line of wrap(fill(template.title).toUpperCase(), WIDTH)) {
    doc.text(line, PAGE_W / 2, y + 5, { align: 'center' });
    y += 7;
  }
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(PAGE_W / 2 - 20, y + 1, PAGE_W / 2 + 20, y + 1);
  doc.setLineWidth(0.2);
  y += 6;
  if (template.preamble?.trim()) {
    for (const block of parseParagraphs(fill(template.preamble))) {
      paragraph(block, MARGIN, WIDTH, 10);
      y += 2.5;
    }
    y += 2;
  }

  template.sections.forEach((section, index) => {
    if (startsNewPage(section, index) && y > TOP) newPage();
    // Section heading on a navy band
    font('bold', 10.5, [255, 255, 255]);
    const heading = wrap(sectionHeading(index, fill(section.title)), WIDTH - 6);
    const band = 3.6 + heading.length * 4.6;
    room(band + 14);
    doc.setFillColor(...NAVY);
    doc.rect(MARGIN, y, WIDTH, band, 'F');
    doc.text(heading, MARGIN + 3, y + 5.3, { lineHeightFactor: 1.2 });
    y += band + 5;

    if (section.layout === 'clauses') {
      for (const block of parseParagraphs(fill(section.body))) {
        if (isClauseHeading(block)) {
          // A group heading: navy, kept with the clause under it
          room(LINE * 4);
          y += 1.5;
          font('bold', 10, NAVY);
          for (const line of wrap(block, WIDTH)) {
            doc.text(line, MARGIN, y + 3.3);
            y += LINE + 0.4;
          }
          y += 1;
          continue;
        }
        const numbered = CLAUSE_NUMBER.exec(block);
        font('normal', 9.6);
        const indent = numbered ? Math.min(14, Math.max(9, doc.getTextWidth(numbered[1]) + 3.5)) : 0;
        const body = numbered ? block.slice(numbered[0].length) : block;
        const title = CLAUSE_TITLE.exec(body);
        room(LINE * 2);
        if (numbered) {
          font('bold', 9.6);
          doc.text(numbered[1], MARGIN, y + 3.3);
        }
        paragraph(title ? body.slice(title[0].length) : body, MARGIN + indent, WIDTH - indent, 9.6, title ? title[1] : '');
        y += 2.2;
      }
    } else if (section.layout === 'table') {
      const labelW = 60;
      doc.setDrawColor(...RULE);
      for (const cells of parseRows(section.body)) {
        if (cells.length === 1) {
          // A one-cell line is a sub-heading across the table
          font('bold', 9, NAVY);
          const lines = wrap(fill(cells[0]).toUpperCase(), WIDTH - 6);
          const height = lines.length * LINE + 3;
          room(height + 7);
          doc.setFillColor(...BAND);
          doc.rect(MARGIN, y, WIDTH, height, 'FD');
          doc.text(lines, MARGIN + 3, y + 4.6, { lineHeightFactor: 1.3 });
          y += height;
          continue;
        }
        font('bold', 9.3);
        const label = wrap(fill(cells[0]), labelW - 6);
        font('normal', 9.3);
        const value = wrap(fill(cells.slice(1).join(' | ')), WIDTH - labelW - 6);
        const height = Math.max(label.length, value.length) * LINE + 3;
        room(height);
        doc.setFillColor(...SHADE);
        doc.rect(MARGIN, y, labelW, height, 'FD');
        doc.rect(MARGIN + labelW, y, WIDTH - labelW, height);
        font('bold', 9.3, [55, 65, 81]);
        doc.text(label, MARGIN + 3, y + 4.6, { lineHeightFactor: 1.3 });
        font('normal', 9.3);
        doc.text(value, MARGIN + labelW + 3, y + 4.6, { lineHeightFactor: 1.3 });
        y += height;
      }
      y += 4;
    } else {
      // Signatures: a line with no bar is wording (e.g. "IN WITNESS WHEREOF ..."); each other line is a box
      const rows = parseRows(section.body);
      const boxes = rows.filter(cells => cells.length > 1);
      const boxW = (WIDTH - 8) / 2;
      const boxH = 52;
      for (const cells of rows.filter(row => row.length === 1)) {
        paragraph(fill(cells[0]), MARGIN, WIDTH, 10);
        y += 4;
      }
      room(Math.ceil(boxes.length / 2) * (boxH + 6)); // keep the signatures together on one page
      for (let i = 0; i < boxes.length; i += 2) {
        room(boxH + 6);
        boxes.slice(i, i + 2).forEach((cells, column) => {
          const x = MARGIN + column * (boxW + 8);
          doc.setDrawColor(...RULE);
          doc.rect(x, y, boxW, boxH);
          doc.setFillColor(...BAND);
          doc.rect(x, y, boxW, 7.5, 'FD');
          font('bold', 9.3, NAVY);
          doc.text(wrap(fill(cells[0]), boxW - 6)[0] ?? '', x + 3, y + 5.1);
          // Room to sign, then the signature line
          doc.setDrawColor(...INK);
          doc.line(x + 3, y + 27, x + boxW - 3, y + 27);
          font('italic', 7.5, GREY);
          doc.text('Signature', x + 3, y + 30.5);
          font('normal', 9);
          const name = wrap(`Name: ${fill(cells[1] ?? '') || BLANK}`, boxW - 6).slice(0, 2);
          doc.text(name, x + 3, y + 36, { lineHeightFactor: 1.2 });
          const below = y + 36 + name.length * 4.3;
          doc.text(wrap(`NRIC / Co. No.: ${fill(cells[2] ?? '') || BLANK}`, boxW - 6)[0], x + 3, below);
          doc.text(`Date: ${fill(cells[3] ?? '') || BLANK}`, x + 3, below + 4.8);
        });
        y += boxH + 6;
      }
    }
    y += 3;
  });

  // Letterhead and footer on every page
  drawPageFrame(doc, values, { label: fill(template.title).toUpperCase().split('(')[0].trim(), initials: true, logo });
  doc.setTextColor(0, 0, 0);
}

/** A safe file name, e.g. "Agreement Sewa Beli XAA1001 Fixture Driver.pdf". */
export const agreementFileName = (kindLabel: string, plate: string, customer: string): string =>
  `${['Agreement', kindLabel, plate, customer].map(part => (part || '').replace(/[\\/:*?"<>|]+/g, ' ').trim()).filter(Boolean).join(' ')}.pdf`;

/** The company logo as a data URL, or undefined when it can't be fetched (the PDF then uses the drawn mark). */
async function loadLogo(): Promise<string | undefined> {
  try {
    const response = await fetch(LOGO_URL);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** Builds the PDF in the browser and downloads it. Nothing is uploaded or stored. jsPDF loads only when used. */
export async function downloadAgreementPdf(template: AgreementTemplate, values: Record<string, string>, fileName: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawAgreement(doc, template, values, await loadLogo());
  doc.save(fileName);
}

/**
 * Draws a filled letter into an empty jsPDF document (A4, millimetres) under the same letterhead and footer as the
 * agreements. See LetterTemplate for how the body is laid out.
 */
export function drawLetter(doc: jsPDF, letter: LetterTemplate, values: Record<string, string>, logo?: string) {
  const SIZE = 10.5;
  const STEP = 5;
  let y = TOP + 2;
  const fill = (text: string) => fillText(text, values);
  const font = (style: 'normal' | 'bold' | 'italic', size: number, colour: Rgb = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...colour);
  };
  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(text, width) as string[];
  const room = (height: number) => {
    if (y + height > BOTTOM - 6) {
      doc.addPage();
      y = TOP + 2;
    }
  };
  const lines = (text: string[], x: number) => {
    for (const line of text) {
      room(STEP);
      doc.text(line, x, y + 3.6);
      y += STEP;
    }
  };
  /** A title centred in a ruled box. */
  const title = (text: string) => {
    font('bold', 13, NAVY);
    const rows = wrap(fill(text).toUpperCase(), WIDTH - 30);
    const height = rows.length * 6 + 5;
    room(height + 6);
    const boxW = Math.min(WIDTH, Math.max(...rows.map(row => doc.getTextWidth(row))) + 16);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.4);
    doc.rect((PAGE_W - boxW) / 2, y, boxW, height);
    doc.setLineWidth(0.2);
    rows.forEach((row, i) => doc.text(row, PAGE_W / 2, y + 6.8 + i * 6, { align: 'center' }));
    y += height + 6;
  };

  title(letter.title);
  for (const block of letterBlocks(letter.body)) {
    if (block.type === 'page') {
      doc.addPage();
      y = TOP + 2;
    } else if (block.type === 'title') {
      title(block.text);
    } else if (block.type === 'quote') {
      font('italic', SIZE - 1);
      lines(wrap(fill(block.text), WIDTH - 20), MARGIN + 10);
      y += 2.5;
    } else if (block.type === 'fields') {
      // Bold labels with their colons lined up, then a rule under the block
      font('bold', SIZE);
      const labelW = Math.min(70, Math.max(...block.rows.map(([label]) => doc.getTextWidth(label))) + 3);
      room(block.rows.length * STEP + 4);
      for (const [label, value] of block.rows) {
        font('bold', SIZE);
        const text = wrap(fill(value), WIDTH - labelW - 5);
        room(text.length * STEP);
        doc.text(fill(label), MARGIN, y + 3.6);
        doc.text(':', MARGIN + labelW, y + 3.6);
        font('normal', SIZE);
        text.forEach((line, i) => doc.text(line, MARGIN + labelW + 4, y + 3.6 + i * STEP));
        y += text.length * STEP;
      }
      doc.setDrawColor(...RULE);
      doc.line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2);
      y += 6;
    } else if (block.type === 'table') {
      const columns = Math.max(...block.rows.map(row => row.length));
      const tableW = WIDTH * 0.8;
      const colW = tableW / columns;
      const x0 = MARGIN + (WIDTH - tableW) / 2;
      room((block.rows.length + 1) * 8 + 4);
      doc.setDrawColor(...INK);
      if (block.heading) {
        doc.setFillColor(...BAND);
        doc.rect(x0, y, tableW, 8, 'FD');
        font('bold', SIZE);
        doc.text(fill(block.heading), x0 + tableW / 2, y + 5.4, { align: 'center' });
        y += 8;
      }
      for (const row of block.rows) {
        font('normal', SIZE);
        const cells = Array.from({ length: columns }, (_, i) => wrap(fill(row[i] ?? ''), colW - 4));
        const height = Math.max(...cells.map(cell => cell.length)) * STEP + 3;
        room(height);
        cells.forEach((cell, i) => {
          doc.rect(x0 + i * colW, y, colW, height);
          doc.text(cell, x0 + i * colW + colW / 2, y + 5.2, { align: 'center', lineHeightFactor: 1.35 });
        });
        y += height;
      }
      y += 5;
    } else {
      font('normal', SIZE);
      const numbered = CLAUSE_NUMBER.exec(block.text);
      const indent = numbered ? 8 : 0;
      const text = numbered ? block.text.slice(numbered[0].length) : block.text;
      const rows = text.split(/\r?\n/).flatMap(part => wrap(fill(part), WIDTH - indent));
      room(Math.min(rows.length, 2) * STEP);
      if (numbered) doc.text(numbered[1], MARGIN, y + 3.6);
      lines(rows, MARGIN + indent);
      y += 2.5;
    }
  }
  drawPageFrame(doc, values, { label: fill(letter.title).toUpperCase(), note: LETTER_FOOTER_NOTE, logo });
  doc.setTextColor(0, 0, 0);
}

/** Builds the letter in the browser and downloads it. Nothing is uploaded or stored. jsPDF loads only when used. */
export async function downloadLetterPdf(letter: LetterTemplate, values: Record<string, string>, fileName: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawLetter(doc, letter, values, await loadLogo());
  doc.save(fileName);
}
