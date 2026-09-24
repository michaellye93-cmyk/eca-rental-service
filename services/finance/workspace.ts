import { normalizePlate } from './calculations.ts';
import { parseInsuranceSheet, type InsuranceSummary } from './insuranceImport.ts';
import { readFinanceWorkbook } from './imports.ts';
import type { FinanceInput, QualityIssue } from '../../types/finance.ts';
import { parseExpenseRows, parseInsuranceRows, parseOtherIncomeRows, parseRecurringCostRows, parseVehicleRows, parseWorkshopRows, selectImportSheet, type SafeImportDestination } from './safeImports.ts';

const financeMonth = (value: string) => { const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(value); if (!match) throw new Error('Select a valid Finance month.'); return `${match[1]}-${match[2]}-01`; };

export type WorkspaceSection = 'workshop' | 'vehicle_expense' | 'corporate_expense' | 'other_income';
export type SectionKind = 'vehicle' | 'recurring_cost' | 'insurance' | 'vehicle_expense' | 'corporate_expense' | 'workshop' | 'fixed_cost' | 'other_income';
export interface SectionPreview { rows: Record<string, unknown>[]; issues: QualityIssue[]; filename: string; total_rows: number; total_amount: number; insurance_summary?: InsuranceSummary; skipped_rows?: number }
export interface SectionReview { section: WorkspaceSection; decision: 'MISSING' | 'NONE' | 'REVIEWED'; reviewed_at: string | null; valid: boolean }
export interface SectionUpload { id: string; kind: SectionKind; filename: string; imported_at: string; row_count: number; total_amount: number; status: 'POSTED' | 'REPLACED' | 'UNDONE'; source_audit?: Array<{ sheet_name: string; source_row: number | string; record_kind: string; record_id?: string; plate_key?: string }> }
export interface WorkspaceMeta { reviews: SectionReview[]; uploads: SectionUpload[] }
export interface SafeImportChange { source_row: number; sheet_name: string; action: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'NEEDS_REVIEW' | 'CANCELLED'; record_id: string | null; before?: Record<string, unknown> | null; candidates?: Array<{ record_id: string; cost_type?: string; category?: string; payee?: string | null; supplier?: string | null; monthly_amount?: number; amount?: number; start_month?: string; billing_date?: string | null; end_month?: string | null; reference?: string | null; cancelled_at?: string | null }>; row: Record<string, unknown> }
export interface SafeImportPreview { preview_token: string; selected_section: string; worksheet: string; finance_month: string; counts: { new: number; updated: number; unchanged: number; needs_review: number; cancelled: number }; current_total: number; proposed_total: number; changes: SafeImportChange[] }

export async function previewSectionWorkbook(buffer: ArrayBuffer, filename: string, kind: SectionKind, selectedMonth: string, input: FinanceInput): Promise<SectionPreview> {
  const selected = financeMonth(selectedMonth); const workbook = await readFinanceWorkbook(buffer);
  const destination: Record<SectionKind, SafeImportDestination> = { vehicle: 'vehicle_master', recurring_cost: 'vehicle_monthly_costs', insurance: 'insurance', vehicle_expense: 'vehicle_expenses', corporate_expense: 'company_expenses', workshop: 'workshop', fixed_cost: 'fixed_cost', other_income: 'other_income' };
  const exact = selectImportSheet(workbook.sheets, destination[kind]);
  if (exact.status !== 'selected' || !exact.sheet) return { rows: [], issues: [{ code: exact.issue?.code ?? 'MISSING_WORKSHEET', severity: 'error', detail: exact.issue?.detail ?? 'Select an accepted worksheet', plate_key: null }], filename, total_rows: 0, total_amount: 0 };
  const sheet = exact.sheet;
  if (kind === 'recurring_cost' || kind === 'fixed_cost') {
    if (kind === 'fixed_cost' && sheet.name.trim().toLowerCase() === 'shared opex') {
      const parsed = parseExpenseRows(sheet);
      const normalized = parsed.rows.filter(row => /monthly|recurr/i.test(row.frequency)).map(row => ({ ...row, record_id: row.id, monthly_amount: row.amount, effective_from: selected, effective_until: null, start_month: selected, end_month: null, payee: row.payee }));
      return { rows: normalized as unknown as Record<string, unknown>[], issues: parsed.issues as QualityIssue[], filename, total_rows: normalized.length, total_amount: normalized.reduce((sum, row) => sum + Number(row.monthly_amount ?? 0), 0), skipped_rows: parsed.rows.length - normalized.length };
    }
    const parsed = parseRecurringCostRows(sheet, kind === 'fixed_cost' ? 'fixed_cost' : 'vehicle_monthly_costs');
    const normalized = parsed.rows.map(row => kind === 'fixed_cost' ? { ...row, record_id: row.id, effective_from: selected, effective_until: null, start_month: selected, end_month: null } : { ...row, record_id: row.id });
    return { rows: normalized as unknown as Record<string, unknown>[], issues: parsed.issues as QualityIssue[], filename, total_rows: normalized.length, total_amount: normalized.reduce((sum, row) => sum + Number(row.monthly_amount ?? 0), 0) };
  }
  if (kind === 'corporate_expense') {
    const parsed = parseExpenseRows(sheet, { expectedMonth: selected });
    const normalized = parsed.rows.map(row => ({ ...row, record_id: row.id, finance_month: selected, billing_date: row.expense_date, payment_source: 'Corporate Opex', supplier: row.payee, description: row.notes }));
    return { rows: normalized, issues: parsed.issues as QualityIssue[], filename, total_rows: normalized.length, total_amount: normalized.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) };
  }
  if (kind === 'workshop') {
    const parsed = parseWorkshopRows(sheet, { expectedMonth: selected, impliedCategory: 'Service & Maintenance' });
    const normalized = parsed.rows.map(row => ({ ...row, record_id: row.id, finance_month: selected, billing_date: row.expense_date, payment_source: 'Workshop Billing' }));
    return { rows: normalized, issues: parsed.issues as QualityIssue[], filename, total_rows: normalized.length, total_amount: normalized.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) };
  }
  if (kind === 'other_income') {
    const parsed = parseOtherIncomeRows(sheet, { expectedMonth: selected });
    const normalized = parsed.rows.map(row => ({ ...row, record_id: row.id, status: 'CONFIRMED' }));
    return { rows: normalized, issues: parsed.issues as QualityIssue[], filename, total_rows: normalized.length, total_amount: normalized.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) };
  }
  if (kind === 'insurance') {
    const parsed = parseInsuranceSheet(sheet, new Set([...input.vehicles.map(vehicle => normalizePlate(vehicle.plate_key)), ...(input.vehicle_plate_history ?? []).map(alias => normalizePlate(alias.plate_key))]));
    const identities = new Map(parseInsuranceRows(sheet).rows.map(row => [row.source_row, row.id]));
    const normalized = parsed.rows.map(row => ({ ...row, record_id: identities.get(row.source_row) ?? null }));
    return {rows: normalized as unknown as Record<string, unknown>[], issues: parsed.issues, filename, total_rows: parsed.rows.length, total_amount: parsed.summary.total_eca_premium, insurance_summary: parsed.summary};
  }
  if (kind === 'vehicle') {
    const parsed = parseVehicleRows(sheet);
    const normalized = parsed.rows.map(row => ({ ...row, record_id: row.vehicle_id }));
    return { rows: normalized as unknown as Record<string, unknown>[], issues: parsed.issues as QualityIssue[], filename, total_rows: normalized.length, total_amount: 0 };
  }
  if (kind === 'vehicle_expense') {
    const parsed = parseWorkshopRows(sheet, { expectedMonth: selected });
    const normalized = parsed.rows.map(row => ({ ...row, record_id: row.id, finance_month: selected, billing_date: row.expense_date, payment_source: 'Vehicle Direct Cost' }));
    return { rows: normalized as unknown as Record<string, unknown>[], issues: parsed.issues as QualityIssue[], filename, total_rows: normalized.length, total_amount: normalized.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) };
  }
  throw new Error(`Unsupported Finance section: ${kind}`);
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> { const { supabase } = await import('../../supabaseClient'); const { data, error } = await supabase.rpc(name, args); if (error) throw new Error(error.message); return data as T; }
const dbKind: Record<SectionKind, string> = { vehicle: 'VEHICLE', recurring_cost: 'RECURRING_COST', insurance: 'INSURANCE', vehicle_expense: 'VEHICLE_EXPENSE', corporate_expense: 'CORPORATE_EXPENSE', workshop: 'WORKSHOP', fixed_cost: 'FIXED_COST', other_income: 'OTHER_INCOME' };
export const previewSafeSectionImport = (kind: SectionKind, selectedMonth: string, filename: string, rows: Record<string, unknown>[], revision: number, sourceHash: string, mode: 'UPDATE' | 'REPLACE' = 'UPDATE', replaceUploadId: string | null = null) => rpc<SafeImportPreview>('finance_preview_section_import', { p_kind: dbKind[kind], p_month: financeMonth(selectedMonth), p_filename: filename, p_rows: rows, p_revision: revision, p_source_hash: sourceHash, p_mode: mode, p_replace_upload_id: replaceUploadId });
export const applySafeSectionImport = (preview: SafeImportPreview, revision: number) => rpc<FinanceInput>('finance_apply_section_import', { p_preview_token: preview.preview_token, p_confirmation: preview.changes, p_revision: revision });
export const undoSafeSectionImport = (uploadId: string, revision: number) => rpc<FinanceInput>('finance_undo_section_import', { p_upload_id: uploadId, p_revision: revision });
export const loadWorkspaceMeta = (selectedMonth: string) => rpc<WorkspaceMeta>('finance_workspace_meta', { p_month: financeMonth(selectedMonth) });
export const reviewSection = (selectedMonth: string, section: WorkspaceSection, decision: 'NONE' | 'REVIEWED', revision: number) => rpc<WorkspaceMeta>('finance_review_section', { p_month: financeMonth(selectedMonth), p_section: section, p_decision: decision, p_revision: revision });
