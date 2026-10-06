import type ExcelJS from 'exceljs';

/**
 * RHB "Transaction Statement" PDFs converted to Excel: one sheet per page, a summary block on page one, repeated
 * column headings, long cells wrapped onto following rows, "-" for an empty amount and a signed running balance, with
 * columns that shift from page to page. A transaction row starts with a date; every row after it without a date
 * continues that transaction. Amounts are read from the right: running balance, credit, debit, then RHB's own
 * transaction number, so shifted or blank columns do not matter.
 */
export interface RhbStatement {
  rows: Array<{ source_row: number; values: Record<string, unknown> }>;
  accountLabel: string | null;
  /** Deposits and withdrawals printed in the summary on page one, when present. */
  control: { credits: number; debits: number } | null;
}

export const RHB_HEADERS = ['Date', 'Description', 'Reference', 'Debit', 'Credit'];

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as { richText?: Array<{ text: string }>; result?: unknown; text?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((part) => part.text).join('');
    if (v.result !== undefined) return cellText(v.result);
    if (v.text !== undefined) return String(v.text);
  }
  return String(value);
}
const isDate = (value: unknown) => value instanceof Date && !Number.isNaN(value.getTime());
const MONEY = /^-?[\d,]+(\.\d{1,2})?[+-]?$/;
const moneyValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = cellText(value).trim();
  if (text === '-' || text === '') return 0;
  if (!MONEY.test(text)) return null;
  const parsed = Number(text.replace(/[,+]/g, '').replace(/-$/, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
/** The row's cells left to right; a merged cell counts once (its copies across the merge are left blank). */
const rowCells = (row: ExcelJS.Row): unknown[] => {
  const cells: unknown[] = [];
  for (let col = 1; col <= row.cellCount; col += 1) {
    const cell = row.getCell(col);
    cells.push(cell.isMerged && cell.master && cell.master.address !== cell.address ? null : cell.value);
  }
  return cells;
};
const signedBalance = (value: unknown): number | null => {
  const text = cellText(value).trim();
  if (!/^-?[\d,]+\.\d{2}[+-]$/.test(text)) return null;
  const amount = Number(text.replace(/[,+-]/g, ''));
  return text.endsWith('-') ? -amount : amount;
};
const nonBlank = (value: unknown) => cellText(value).trim() !== '';
const isHeading = (texts: string[]) => {
  const joined = texts.join(' ').toUpperCase();
  return /BRANCH DESCR|AMOUNT \(DR\)|AMOUNT \(CR\)/.test(joined) || (texts.includes('Name') && texts.includes('Reference'));
};
const tidy = (parts: string[]) => parts.join(' ').replace(/\s+/g, ' ').replace(/(^|\s)\/(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();

export function isRhbStatement(workbook: ExcelJS.Workbook): boolean {
  for (const sheet of workbook.worksheets.slice(0, 2)) {
    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r += 1) {
      const text = rowCells(sheet.getRow(r)).map(cellText).join(' ').toUpperCase();
      if (text.includes('TRANSACTION STATEMENT') || text.includes('DEPOSIT ACCOUNT SUMMARY') || text.includes('AMOUNT (DR)')) return true;
    }
  }
  return false;
}

export function parseRhbStatement(workbook: ExcelJS.Workbook): RhbStatement {
  const rows: RhbStatement['rows'] = [];
  let accountLabel: string | null = null;
  let control: RhbStatement['control'] = null;
  // Text is kept per column so a name or reference wrapped onto the next row is joined back in the right place.
  let lastBalance: number | null = null;
  let current: { date: string; columns: Map<number, string[]>; reference: string; debit: number; credit: number } | null = null;
  const finish = () => {
    if (!current) return;
    const description = tidy([...current.columns.entries()].sort((a, b) => a[0] - b[0]).map(([, parts]) => parts.join(' ')));
    rows.push({ source_row: rows.length + 1, values: { Date: current.date, Description: description, Reference: current.reference, Debit: current.debit, Credit: current.credit } });
    current = null;
  };
  for (const sheet of workbook.worksheets) {
    for (let r = 1; r <= sheet.rowCount; r += 1) {
      const cells = rowCells(sheet.getRow(r));
      if (!cells.some(nonBlank)) continue;
      const texts = cells.filter(nonBlank).map((value) => cellText(value).trim());
      if (!isDate(cells[0])) {
        if (!rows.length && !current) {
          // Summary block before the first transaction: account number and the printed deposit and withdrawal totals.
          for (const text of texts) {
            const account = text.match(/^\d{12,16}$/);
            if (account && !accountLabel) accountLabel = `RHB …${account[0].slice(-4)}`;
          }
          if (texts.some((text) => /Beginning Balance/i.test(text))) {
            const opening = cells.map(signedBalance).find((value) => value !== null);
            if (opening !== undefined && opening !== null) lastBalance = opening;
          }
          if (texts.some((text) => /Deposits \(Plus\)/i.test(text))) {
            const totals = texts.map((text) => text.match(/^([\d,]+\.\d{2})\s*\n\s*([\d,]+\.\d{2})$/)).find(Boolean);
            if (totals) control = { credits: Number(totals[1].replace(/,/g, '')), debits: Number(totals[2].replace(/,/g, '')) };
          }
          continue;
        }
        if (isHeading(texts)) continue;
        // A wrapped continuation of the transaction above (a stray date in a text column is page furniture).
        if (current) {
          const open = current;
          cells.forEach((value, index) => {
            if (!nonBlank(value) || isDate(value)) return;
            open.columns.set(index, [...(open.columns.get(index) ?? []), cellText(value).trim()]);
          });
        }
        continue;
      }
      finish();
      const indexed = cells.map((value, index) => ({ value, index })).slice(1).filter(({ value }) => nonBlank(value));
      const values = indexed.map(({ value }) => value);
      // From the right: running balance, credit, debit, RHB transaction number.
      let end = values.length;
      const balance = end > 0 ? signedBalance(values[end - 1]) : null;
      if (balance !== null) end -= 1;
      let credit = Math.abs(moneyValue(values[end - 1]) ?? 0);
      let debit = Math.abs(moneyValue(values[end - 2]) ?? 0);
      end -= 2;
      // The running balance is the most reliable figure in a converted PDF: when the amounts read disagree with the
      // change in balance, the change in balance decides.
      if (balance !== null && lastBalance !== null) {
        const change = Math.round((balance - lastBalance) * 100) / 100;
        if (Math.abs(change - (credit - debit)) > 0.005) {
          credit = change > 0 ? change : 0;
          debit = change < 0 ? -change : 0;
        }
      }
      if (balance !== null) lastBalance = balance;
      let reference = '';
      if (end > 0 && /^\d{1,10}$/.test(cellText(values[end - 1]).trim())) {
        reference = cellText(values[end - 1]).trim();
        end -= 1;
      }
      const start = /^\d{1,4}$/.test(cellText(values[0]).trim()) ? 1 : 0; // branch code
      current = {
        date: (cells[0] as Date).toISOString().slice(0, 10),
        columns: new Map(indexed.slice(start, Math.max(start, end)).map(({ value, index }) => [index, [cellText(value).trim()]])),
        reference,
        debit,
        credit,
      };
    }
  }
  finish();
  return { rows, accountLabel, control };
}
