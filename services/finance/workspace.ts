import { normalizePlate } from './calculations.ts';
import { parseInsuranceSheet, type InsuranceSummary } from './insuranceImport.ts';
import { parseCorporateSheet } from './corporateImport.ts';
import { readFinanceWorkbook, type WorkbookSheet } from './imports.ts';
import type { FinanceExpense, FinanceInput, QualityIssue } from '../../types/finance.ts';

const financeMonth = (value: string) => { const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(value); if (!match) throw new Error('Select a valid Finance month.'); return `${match[1]}-${match[2]}-01`; };

export type WorkspaceSection = 'workshop' | 'vehicle_expense' | 'corporate_expense';
export type SectionKind = 'vehicle' | 'recurring_cost' | 'insurance' | 'vehicle_expense' | 'corporate_expense';
export interface SectionPreview { rows: Record<string, unknown>[]; issues: QualityIssue[]; filename: string; total_rows: number; total_amount: number; insurance_summary?: InsuranceSummary; skipped_rows?: number }
export interface SectionReview { section: WorkspaceSection; decision: 'NONE' | 'REVIEWED'; reviewed_at: string; valid: boolean }
export interface SectionUpload { id: string; kind: SectionKind; filename: string; imported_at: string; row_count: number; total_amount: number; source_audit?: Array<{ sheet_name: string; source_row: number | string; record_kind: string; record_id?: string; plate_key?: string }> }
export interface WorkspaceMeta { reviews: SectionReview[]; uploads: SectionUpload[] }

const aliases: Record<string, string[]> = {
  responsibility: ['responsibility'],
  plate_key: ['carplate', 'plate', 'vehicleplate', 'registrationno'], display_plate: ['carplate', 'plate', 'vehicleplate', 'registrationno'],
  billing_date: ['billingdate', 'date', 'expensedate'], category: ['category', 'costtype'], amount: ['amount', 'cost', 'total'], supplier: ['supplier', 'vendor', 'workshop'], reference: ['reference', 'invoiceno', 'receiptno'], description: ['description', 'note', 'notes'],
  business_unit: ['businessunit'], ownership_type: ['ownershiptype'], status: ['status'], start_month: ['startmonth'], end_month: ['endmonth'], cost_type: ['costtype', 'category'], monthly_amount: ['monthlyamount', 'monthlyamountrm'], payee: ['payee', 'lender', 'payeelender'], notes: ['notes', 'note'], premium: ['premium'], payment_date: ['paymentdate'], coverage_start: ['coveragestart'], coverage_end: ['coverageend'],
};
const key = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const find = (sheet: WorkbookSheet, field: string) => sheet.headers.find(header => aliases[field]?.includes(key(header)));
const value = (sheet: WorkbookSheet, row: Record<string, unknown>, field: string) => { const header = find(sheet, field); return header ? row[header] : null; };
const issue = (code: string, detail: string, plate_key: string | null = null): QualityIssue => ({ code, severity: 'error', detail, plate_key });
function date(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'number' && raw > 1 && raw < 100000) return new Date(Date.UTC(1899, 11, 30 + raw)).toISOString().slice(0, 10);
  const text = String(raw ?? '').trim(); const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); const result = slash ? `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}` : text.slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(result) ? new Date(`${result}T00:00:00Z`) : null;
  return parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : null;
}
function month(raw: unknown) { const parsed = date(raw) ?? String(raw ?? '').trim(); return /^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(parsed) ? `${parsed.slice(0, 7)}-01` : null; }
function amount(raw: unknown): number | null { const text = String(raw ?? '').trim(); const parsed = typeof raw === 'number' ? raw : Number(text.replace(/[RM,\s]/g, '')); return text && Number.isFinite(parsed) && Math.abs(parsed * 100 - Math.round(parsed * 100)) < 1e-7 ? parsed : null; }
function choose(sheets: WorkbookSheet[], kind: SectionKind) {
  const wanted: Record<SectionKind, RegExp> = { vehicle: /vehicle|master/i, recurring_cost: /monthly|recurring|cost/i, insurance: /insurance/i, vehicle_expense: /vehicle|expense|cost/i, corporate_expense: /corporate|opex|shared|expense/i };
  return sheets.find(sheet => wanted[kind].test(sheet.name)) ?? sheets.slice().sort((a, b) => b.headers.length - a.headers.length)[0];
}
function source(row: { source_row: number; sheet_name: string }) { return { source_row: row.source_row, sheet_name: row.sheet_name }; }
function required(sheet: WorkbookSheet, fields: string[], issues: QualityIssue[]) { for (const field of fields) if (!find(sheet, field)) issues.push(issue('MISSING_REQUIRED_HEADER', `Workbook is missing required ${field.replace('_', ' ')} column`)); }

export async function previewSectionWorkbook(buffer: ArrayBuffer, filename: string, kind: SectionKind, selectedMonth: string, input: FinanceInput): Promise<SectionPreview> {
  const selected = financeMonth(selectedMonth); const workbook = await readFinanceWorkbook(buffer); const sheet = choose(workbook.sheets, kind); const issues: QualityIssue[] = []; const rows: Record<string, unknown>[] = []; let total = 0;
  if (!sheet) return { rows, issues: [issue('EMPTY_WORKBOOK', 'Workbook has no readable sheets')], filename, total_rows: 0, total_amount: 0 };
  if (kind === 'corporate_expense') {
    const parsed = parseCorporateSheet(sheet, selected);
    return {...parsed, rows: parsed.rows as unknown as Record<string, unknown>[], filename, total_rows: parsed.rows.length};
  }
  if (kind === 'insurance') {
    const parsed = parseInsuranceSheet(sheet, new Set(input.vehicles.map(vehicle => normalizePlate(vehicle.plate_key))));
    return {rows: parsed.rows as unknown as Record<string, unknown>[], issues: parsed.issues, filename, total_rows: parsed.rows.length, total_amount: parsed.summary.total_eca_premium, insurance_summary: parsed.summary};
  }
  const requiredFields: Record<SectionKind, string[]> = { vehicle: ['plate_key', 'business_unit', 'ownership_type', 'status'], recurring_cost: ['plate_key', 'start_month', 'cost_type', 'monthly_amount'], insurance: ['plate_key', 'premium', 'coverage_start', 'coverage_end'], vehicle_expense: ['billing_date', 'plate_key', 'category', 'amount'], corporate_expense: ['billing_date', 'category', 'amount'] };
  required(sheet, requiredFields[kind], issues); if (!sheet.rows.length) issues.push(issue('EMPTY_REPORT', 'Workbook contains no Finance rows'));
  const vehicles = new Set(input.vehicles.map(vehicle => normalizePlate(vehicle.plate_key)));
  const vehicleCategories = new Set(['Road Tax', 'APAD / Permit', 'Puspakom', 'Tyres', 'Battery', 'Repair', 'Accident', 'Towing', 'Restoration', 'Other Vehicle Cost']);
  for (const raw of sheet.rows) {
    const plate = normalizePlate(String(value(sheet, raw.values, 'plate_key') ?? '')); const rowIssues: string[] = [];
    if (kind === 'vehicle_expense') {
      const billing = date(value(sheet, raw.values, 'billing_date')); const money = amount(value(sheet, raw.values, 'amount')); const category = String(value(sheet, raw.values, 'category') ?? '').trim();
      if (!billing || billing.slice(0, 7) !== selected.slice(0, 7)) rowIssues.push('valid billing date in selected month'); if (money === null || money < 0) rowIssues.push('non-negative amount with at most two decimals'); if (!vehicleCategories.has(category)) rowIssues.push('approved category'); if (!plate || !vehicles.has(plate)) rowIssues.push('known vehicle');
      if (rowIssues.length) issues.push(issue('INVALID_SECTION_ROW', `Row ${raw.source_row} requires ${rowIssues.join(', ')}`, plate || null));
      rows.push({ ...source(raw), finance_month: selected, billing_date: billing ?? '', plate_key: plate || null, category, payment_source: 'Vehicle Direct Cost', supplier: String(value(sheet, raw.values, 'supplier') ?? '').trim() || null, amount: money ?? 0, reference: String(value(sheet, raw.values, 'reference') ?? '').trim() || null, description: String(value(sheet, raw.values, 'description') ?? '').trim() || null }); total += money ?? 0;
    } else if (kind === 'vehicle') {
      const business = String(value(sheet, raw.values, 'business_unit') ?? '').trim(); const ownership = String(value(sheet, raw.values, 'ownership_type') ?? '').trim(); const status = String(value(sheet, raw.values, 'status') ?? '').trim(); if (!plate || !['E-HAILING', 'DAILY RENTAL', 'SMART DRIVE', 'SAMBUNG BAYAR'].includes(business) || !ownership || !status) issues.push(issue('INVALID_VEHICLE_MASTER', `Row ${raw.source_row} requires plate, business unit, ownership type, and status`, plate || null)); rows.push({ ...source(raw), plate_key: plate, display_plate: String(value(sheet, raw.values, 'display_plate') ?? '').trim(), business_unit: business, ownership_type: ownership, status });
    } else if (kind === 'recurring_cost') {
      const start = month(value(sheet, raw.values, 'start_month')); const endRaw = value(sheet, raw.values, 'end_month'); const end = endRaw ? month(endRaw) : null; const money = amount(value(sheet, raw.values, 'monthly_amount')); const cost = String(value(sheet, raw.values, 'cost_type') ?? '').trim(); if (!plate || !vehicles.has(plate) || !start || (endRaw && !end) || (end && end < start) || !cost || money === null || money < 0) issues.push(issue('INVALID_RECURRING_COST', `Row ${raw.source_row} requires known vehicle, valid months, cost type, and amount`, plate || null)); rows.push({ ...source(raw), plate_key: plate, start_month: start ?? '', end_month: end, cost_type: cost, monthly_amount: money ?? 0, payee: String(value(sheet, raw.values, 'payee') ?? '').trim() || null, notes: String(value(sheet, raw.values, 'notes') ?? '').trim() || null }); total += money ?? 0;

    }
  }
  return { rows, issues, filename, total_rows: rows.length, total_amount: total };
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> { const { supabase } = await import('../../supabaseClient'); const { data, error } = await supabase.rpc(name, args); if (error) throw new Error(error.message); return data as T; }
const dbKind: Record<SectionKind, string> = { vehicle: 'VEHICLE', recurring_cost: 'RECURRING_COST', insurance: 'INSURANCE', vehicle_expense: 'VEHICLE_EXPENSE', corporate_expense: 'CORPORATE_EXPENSE' };
export const postSectionWorkbook = (kind: SectionKind, selectedMonth: string, filename: string, rows: Record<string, unknown>[], revision: number, sourceHash: string) => rpc<FinanceInput>('finance_post_section_workbook', { p_kind: dbKind[kind], p_month: financeMonth(selectedMonth), p_filename: filename, p_rows: rows, p_revision: revision, p_source_hash: sourceHash });
export const loadWorkspaceMeta = (selectedMonth: string) => rpc<WorkspaceMeta>('finance_workspace_meta', { p_month: financeMonth(selectedMonth) });
export const reviewSection = (selectedMonth: string, section: WorkspaceSection, decision: 'NONE' | 'REVIEWED', revision: number) => rpc<WorkspaceMeta>('finance_review_section', { p_month: financeMonth(selectedMonth), p_section: section, p_decision: decision, p_revision: revision });
export const previewPreviousSharedCosts = (selectedMonth: string) => rpc<FinanceExpense[]>('finance_preview_previous_shared_costs', { p_month: financeMonth(selectedMonth) });
export const copyPreviousSharedCosts = (selectedMonth: string, rows: FinanceExpense[], revision: number) => rpc<FinanceInput>('finance_copy_previous_shared_costs', { p_month: financeMonth(selectedMonth), p_rows: rows, p_revision: revision });
