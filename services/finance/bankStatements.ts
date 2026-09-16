import ExcelJS from 'exceljs';
import type { BankReviewRow, BankSourceRow, BankStatementPreview } from '../../types/finance-bank.ts';
import type { FinanceInput, QualityIssue } from '../../types/finance.ts';

export type BankFieldMapping = { sheet?: string; date?: string; description?: string; reference?: string; debit?: string; credit?: string; amount?: string; direction?: string; accountLabel?: string };
export type BankPreview = BankStatementPreview & { source_hash: string; issues: QualityIssue[] };
const aliases: Record<string, string[]> = { date: ['date', 'transactiondate', 'txndate', 'valuedate'], description: ['description', 'details', 'narration', 'transactiondescription'], reference: ['reference', 'ref', 'transactionreference'], debit: ['debit', 'withdrawal', 'dr'], credit: ['credit', 'deposit', 'cr'], amount: ['amount', 'transactionamount'], direction: ['direction', 'type', 'transactiontype'] };
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const issue = (code: string, detail: string, severity: 'error' | 'warning' = 'error'): QualityIssue => ({ code, detail, severity });
const month = (value: string) => /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : '';
const cents = (value: number) => Math.round(value * 100) / 100;
function parseDate(value: unknown): string | null { if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10); const text = String(value ?? '').trim(); const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : text.slice(0, 10); const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : null; return parsed && parsed.toISOString().slice(0, 10) === iso ? iso : null; }
function number(value: unknown): number | null { const text = String(value ?? '').trim(); if (!text) return null; const parsed = Number(text.replace(/[RM,\s]/g, '')); return Number.isFinite(parsed) ? parsed : null; }
function field(row: Record<string, unknown>, headers: string[], name: keyof BankFieldMapping, mapping?: BankFieldMapping) { const header = mapping?.[name] ?? headers.find((header) => aliases[name]?.includes(key(header))); return header ? row[header] : null; }
function parseCsv(text: string) { const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean); const split = (line: string) => { const values: string[] = []; let value = ''; let quote = false; for (let i = 0; i < line.length; i++) { if (line[i] === '"') { if (quote && line[i + 1] === '"') { value += '"'; i++; } else quote = !quote; } else if (line[i] === ',' && !quote) { values.push(value.trim()); value = ''; } else value += line[i]; } values.push(value.trim()); return values; }; const headers = split(lines[0] ?? ''); return { headers, rows: lines.slice(1).map((line, index) => ({ source_row: index + 2, values: Object.fromEntries(headers.map((header, i) => [header, split(line)[i] ?? ''])) })) }; }
async function source(buffer: ArrayBuffer, filename: string, mapping?: BankFieldMapping) { if (/\.csv$/i.test(filename)) return parseCsv(new TextDecoder().decode(buffer)); if (/\.json$/i.test(filename)) { const parsed = JSON.parse(new TextDecoder().decode(buffer)); const values = Array.isArray(parsed) ? parsed : parsed.rows; if (!Array.isArray(values)) throw new Error('JSON statement must contain a rows array'); const headers = [...new Set(values.flatMap((row: object) => Object.keys(row)))]; return { headers, rows: values.map((values: Record<string, unknown>, index: number) => ({ source_row: index + 1, values })) }; } const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); const sheet = mapping?.sheet ? workbook.getWorksheet(mapping.sheet) : workbook.worksheets[0]; if (!sheet) throw new Error('Workbook sheet not found'); const headerValues = sheet.getRow(1).values; const headers = (Array.isArray(headerValues) ? headerValues : []).slice(1).map(String); return { headers, rows: Array.from({ length: Math.max(0, sheet.rowCount - 1) }, (_, i) => { const row = sheet.getRow(i + 2); return { source_row: i + 2, values: Object.fromEntries(headers.map((header, col) => [header, row.getCell(col + 1).value])) }; }).filter((row) => Object.values(row.values).some((value) => value !== null && value !== '')) }; }
async function hash(buffer: ArrayBuffer) { const digest = await crypto.subtle.digest('SHA-256', buffer); return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join(''); }
export async function readBankStatement(buffer: ArrayBuffer, filename: string): Promise<{ headers: string[] }> { const data = await source(buffer, filename); return { headers: data.headers.filter((header) => !/(account|card|customer|identity|nric|passport|phone|email)/i.test(header)) }; }
export async function previewBankStatement(buffer: ArrayBuffer, filename: string, financeMonth: string, input: FinanceInput, mapping?: BankFieldMapping): Promise<BankPreview> { const data = await source(buffer, filename, mapping); const issues: QualityIssue[] = []; const sourceHash = await hash(buffer); if (!data.rows.length) issues.push(issue('EMPTY_BANK_STATEMENT', 'Statement contains no transaction rows')); if (input.bank_imports?.some((entry) => entry.source_hash === sourceHash)) issues.push(issue('DUPLICATE_BANK_SOURCE_HASH', 'This statement has already been imported for Finance review'));
  const rows: BankReviewRow[] = data.rows.map(({ source_row, values }) => { const transaction_date = parseDate(field(values, data.headers, 'date', mapping)); const description = String(field(values, data.headers, 'description', mapping) ?? '').trim(); const referenceValue = field(values, data.headers, 'reference', mapping); const debit = number(field(values, data.headers, 'debit', mapping)); const credit = number(field(values, data.headers, 'credit', mapping)); const amount = number(field(values, data.headers, 'amount', mapping)); const direction = String(field(values, data.headers, 'direction', mapping) ?? '').toLowerCase(); let dr = debit ?? 0; let cr = credit ?? 0; if (debit === null && credit === null && amount !== null) { if (/(debit|withdraw|dr|out)/.test(direction)) dr = amount; else if (/(credit|deposit|cr|in)/.test(direction)) cr = amount; else issues.push(issue('AMBIGUOUS_BANK_DIRECTION', `Row ${source_row} has an amount without a direction`)); } if (!transaction_date) issues.push(issue('INVALID_BANK_DATE', `Row ${source_row} has no valid calendar date`)); if (!description) issues.push(issue('MISSING_BANK_DESCRIPTION', `Row ${source_row} has no description`)); if (debit === null && credit === null && amount === null) issues.push(issue('MISSING_BANK_AMOUNT', `Row ${source_row} has no debit or credit amount`)); if (dr < 0 || cr < 0 || (dr > 0 && cr > 0)) issues.push(issue('INVALID_BANK_AMOUNT', `Row ${source_row} has invalid debit/credit values`)); const suggestion = cr > 0 ? input.ehailing.find((payment) => cents(payment.cash_amount) === cents(cr) && payment.payment_date === transaction_date) : undefined; return { source_row, transaction_date: transaction_date ?? '', description, reference: referenceValue ? String(referenceValue) : null, debit: dr, credit: cr, decision: 'PENDING', payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, review_note: suggestion ? `Suggested payment match: ${suggestion.source_payment_id}; Admin review required.` : '' }; });
  return { rows, issues, total_debits: cents(rows.reduce((sum, row) => sum + row.debit, 0)), total_credits: cents(rows.reduce((sum, row) => sum + row.credit, 0)), filename, account_label: mapping?.accountLabel ?? '', finance_month: financeMonth, source_hash: sourceHash }; }
export function validateBankReview(rows: BankReviewRow[], financeMonth: string, input: FinanceInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const ids = new Set<string>();
  const sourceRows = new Set<number>();
  const normalizedText = (text: string | null) => (text ?? '').toUpperCase().replace(/\s+/g, ' ');
  if (!rows.length) issues.push(issue('EMPTY_BANK_STATEMENT', 'Statement contains no transaction rows'));
  for (const row of rows) {
    const id = [row.transaction_date, row.debit.toFixed(2), row.credit.toFixed(2), normalizedText(row.reference), normalizedText(row.description)].join('|');
    if (ids.has(id)) issues.push(issue('DUPLICATE_BANK_ROW', `Duplicate bank row ${row.source_row}`));
    ids.add(id);
    if (!Number.isInteger(row.source_row) || row.source_row < 1 || sourceRows.has(row.source_row)) issues.push(issue('INVALID_BANK_SOURCE_ROW', 'Bank source row numbers must be positive and unique'));
    sourceRows.add(row.source_row);
    if (!parseDate(row.transaction_date) || month(row.transaction_date) !== month(financeMonth)) issues.push(issue('BANK_MONTH_MISMATCH', `Bank row ${row.source_row} has an invalid date or is outside the selected Finance month`));
    if (!Number.isFinite(row.debit) || !Number.isFinite(row.credit) || !((row.debit > 0 && row.credit === 0) || (row.credit > 0 && row.debit === 0)) || cents(row.debit) !== row.debit || cents(row.credit) !== row.credit) issues.push(issue('INVALID_BANK_AMOUNT', `Bank row ${row.source_row} requires one positive debit or credit, with at most two decimal places`));
    if (!row.description?.trim()) issues.push(issue('MISSING_BANK_DESCRIPTION', `Bank row ${row.source_row} needs a description`));
    if (!['EXPENSE','MATCHED','EXCLUDED'].includes(row.decision)) issues.push(issue('PENDING_BANK_REVIEW', `Bank row ${row.source_row} still needs Admin review`));
    if (row.credit > 0 && row.decision === 'EXPENSE') issues.push(issue('INVALID_CREDIT_DECISION', `Credit row ${row.source_row} must be matched or excluded`));
    if (row.decision === 'EXCLUDED' && !row.review_note.trim()) issues.push(issue('MISSING_BANK_EXCLUSION_REASON', `Excluded row ${row.source_row} needs a review reason`));
    if (row.decision === 'EXPENSE' && (!row.payment_source || !row.category || (row.payment_source !== 'Corporate Opex' && !row.plate_key))) issues.push(issue('INCOMPLETE_BANK_EXPENSE', `Expense row ${row.source_row} needs source, category and vehicle where applicable`));
    if (row.decision !== 'MATCHED') continue;
    let exists = false;
    let compatible = false;
    const selectedMonth = month(financeMonth);
    if (row.matched_kind === 'payment') {
      const record = input.ehailing.find(x => x.source_payment_id === row.matched_id);
      exists = !!record;
      compatible = !!record && row.debit === 0 && record.cash_amount === row.credit && month(record.finance_month) === selectedMonth;
    } else if (row.matched_kind === 'smart_import') {
      const record = input.smart_import;
      exists = !!record && record.id === row.matched_id;
      compatible = exists && row.credit > 0 && row.debit === 0 && record!.status === 'POSTED' && month(record!.finance_month) === selectedMonth;
    } else if (row.matched_kind === 'recurring_cost') {
      const record = input.recurring_costs.find(x => x.id === row.matched_id);
      exists = !!record;
      compatible = !!record && row.credit === 0 && record.monthly_amount === row.debit && month(record.start_month) <= selectedMonth && (!record.end_month || month(record.end_month) >= selectedMonth);
    } else if (row.matched_kind === 'insurance') {
      const record = input.insurance.find(x => x.id === row.matched_id);
      exists = !!record;
      compatible = !!record && record.responsibility !== 'OWNER_PAID' && row.credit === 0 && record.premium === row.debit && month(record.payment_date ?? '') === selectedMonth;
    } else if (row.matched_kind === 'expense') {
      const record = input.expenses.find(x => x.id === row.matched_id);
      exists = !!record;
      compatible = !!record && row.credit === 0 && record.amount === row.debit && month(record.finance_month) === selectedMonth;
    }
    if (!exists) issues.push(issue('UNKNOWN_BANK_MATCH', `Bank row ${row.source_row} references an unknown Finance record`));
    else if (!compatible) issues.push(issue('BANK_MATCH_AMOUNT_MISMATCH', `Bank row ${row.source_row} does not match the amount, direction or month of the selected record`));
  }
  return issues;
}
export async function extractBankStatement(file: File) { const { supabase } = await import('../../supabaseClient.ts'); const { data: { session } } = await supabase.auth.getSession(); if (!session?.access_token) throw new Error('Finance sign-in is required'); const form = new FormData(); form.append('file', file); const { data, error } = await supabase.functions.invoke('finance-extract-bank-statement', { body: form, headers: { Authorization: `Bearer ${session.access_token}` } }); if (error) throw new Error('Bank statement extraction failed'); return data as { rows: BankSourceRow[]; total_debits: number; total_credits: number }; }
