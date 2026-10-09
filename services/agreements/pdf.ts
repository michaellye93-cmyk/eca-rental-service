import type { jsPDF } from 'jspdf';
import { BLANK, fillText, isClauseHeading, parseParagraphs, parseRows, sectionHeading, type AgreementTemplate } from './template.ts';

// A4 in millimetres
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const WIDTH = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 22;
const LINE = 4.6;

/** "1.", "2.3", "(a)" or "a)" at the start of a paragraph: printed with the text hanging after it. */
const CLAUSE_NUMBER = /^((?:\d+(?:\.\d+)*\.?)|(?:\([a-z0-9]+\))|(?:[a-z]\)))\s+/i;

/** Draws the filled agreement into an empty jsPDF document (A4, millimetres). */
export function drawAgreement(doc: jsPDF, template: AgreementTemplate, values: Record<string, string>) {
  let y = MARGIN;
  const fill = (text: string) => fillText(text, values);
  const room = (height: number) => {
    if (y + height > BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
  };
  const font = (style: 'normal' | 'bold', size: number) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
  };
  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(text, width) as string[];

  // Title and, under it, the company
  font('bold', 14);
  for (const line of wrap(fill(template.title).toUpperCase(), WIDTH)) {
    doc.text(line, PAGE_W / 2, y + 5, { align: 'center' });
    y += 6.5;
  }
  if (values.company_name) {
    font('normal', 9.5);
    const company = [values.company_name, values.company_reg_no && `(${values.company_reg_no})`].filter(Boolean).join(' ');
    doc.text(company, PAGE_W / 2, y + 3, { align: 'center' });
    y += 5;
    if (values.company_address) {
      for (const line of wrap(values.company_address, WIDTH)) {
        doc.text(line, PAGE_W / 2, y + 3, { align: 'center' });
        y += 4.3;
      }
    }
  }
  y += 4;

  template.sections.forEach((section, index) => {
    // Section heading on a light band
    font('bold', 10.5);
    const heading = wrap(sectionHeading(index, fill(section.title)), WIDTH - 5);
    const band = 3 + heading.length * 4.5;
    room(band + 12);
    doc.setFillColor(235, 238, 243);
    doc.rect(MARGIN, y, WIDTH, band, 'F');
    doc.text(heading, MARGIN + 2.5, y + 5.1, { lineHeightFactor: 1.2 });
    y += band + 3.5;

    if (section.layout === 'clauses') {
      for (const paragraph of parseParagraphs(fill(section.body))) {
        const heading = isClauseHeading(paragraph);
        font(heading ? 'bold' : 'normal', 9.8);
        if (heading) room(LINE * 3); // keep a heading with the clause under it
        const numbered = CLAUSE_NUMBER.exec(paragraph);
        const indent = numbered ? Math.min(14, Math.max(8, doc.getTextWidth(numbered[1]) + 3)) : 0;
        const body = numbered ? paragraph.slice(numbered[0].length) : paragraph;
        const lines = body.split(/\r?\n/).flatMap(part => wrap(part, WIDTH - indent));
        lines.forEach((line, i) => {
          room(LINE);
          if (i === 0 && numbered) doc.text(numbered[1], MARGIN, y + 3.4);
          doc.text(line, MARGIN + indent, y + 3.4);
          y += LINE;
        });
        y += 2;
      }
    } else if (section.layout === 'table') {
      const labelW = 58;
      doc.setDrawColor(200, 205, 212);
      for (const cells of parseRows(section.body)) {
        if (cells.length === 1) {
          // A one-cell line is a sub-heading across the table
          font('bold', 9.8);
          const lines = wrap(fill(cells[0]), WIDTH - 4);
          const height = lines.length * LINE + 2.5;
          room(height);
          doc.rect(MARGIN, y, WIDTH, height);
          doc.text(lines, MARGIN + 2, y + 4.4, { lineHeightFactor: 1.35 });
          y += height;
          continue;
        }
        font('bold', 9.5);
        const label = wrap(fill(cells[0]), labelW - 4);
        font('normal', 9.5);
        const value = wrap(fill(cells.slice(1).join(' | ')), WIDTH - labelW - 4);
        const height = Math.max(label.length, value.length) * LINE + 2.5;
        room(height);
        doc.rect(MARGIN, y, labelW, height);
        doc.rect(MARGIN + labelW, y, WIDTH - labelW, height);
        font('bold', 9.5);
        doc.text(label, MARGIN + 2, y + 4.4, { lineHeightFactor: 1.35 });
        font('normal', 9.5);
        doc.text(value, MARGIN + labelW + 2, y + 4.4, { lineHeightFactor: 1.35 });
        y += height;
      }
      y += 4;
    } else {
      // Signatures: two boxes a row, each with room to sign, then party, name, ID and date
      const rows = parseRows(section.body);
      const boxW = (WIDTH - 10) / 2;
      const boxH = 49;
      room(Math.ceil(rows.length / 2) * (boxH + 4)); // keep the signatures together on one page
      for (let i = 0; i < rows.length; i += 2) {
        room(boxH + 4);
        rows.slice(i, i + 2).forEach((cells, column) => {
          const x = MARGIN + column * (boxW + 10);
          doc.setDrawColor(60, 60, 60);
          doc.line(x, y + 20, x + boxW - 6, y + 20);
          font('bold', 9.5);
          doc.text(wrap(fill(cells[0] ?? ''), boxW - 6)[0] ?? '', x, y + 25);
          font('normal', 9.3);
          const name = wrap(`Name: ${fill(cells[1] ?? '') || BLANK}`, boxW - 6).slice(0, 2);
          doc.text(name, x, y + 30.5, { lineHeightFactor: 1.2 });
          const below = y + 30.5 + name.length * 4.6;
          doc.text(wrap(`ID: ${fill(cells[2] ?? '') || BLANK}`, boxW - 6)[0], x, below);
          doc.text(`Date: ${BLANK}`, x, below + 5);
        });
        y += boxH + 4;
      }
    }
    y += 3;
  });

  // Page numbers and initials on every page
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    font('normal', 8);
    doc.setTextColor(110, 110, 110);
    doc.text(`Page ${page} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' });
    doc.text('Initials:  Owner ________    Hirer ________', MARGIN, PAGE_H - 10);
    doc.setTextColor(0, 0, 0);
  }
}

/** A safe file name, e.g. "Agreement Sewa Beli XAA1001 Fixture Driver.pdf". */
export const agreementFileName = (kindLabel: string, plate: string, customer: string): string =>
  `${['Agreement', kindLabel, plate, customer].map(part => (part || '').replace(/[\\/:*?"<>|]+/g, ' ').trim()).filter(Boolean).join(' ')}.pdf`;

/** Builds the PDF in the browser and downloads it. Nothing is uploaded or stored. jsPDF loads only when used. */
export async function downloadAgreementPdf(template: AgreementTemplate, values: Record<string, string>, fileName: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawAgreement(doc, template, values);
  doc.save(fileName);
}
