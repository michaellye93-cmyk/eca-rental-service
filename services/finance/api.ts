import { supabase } from '../../supabaseClient';
import type { BootstrapData, FinanceInput, SmartDriveRow, FinanceExpense } from '../../types/finance';

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export function financeMonth(value: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(value);
  if (!match) throw new Error('Select a valid Finance month.');
  return `${match[1]}-${match[2]}-01`;
}
function recordPayload(kind: RecordKind, record: object): object {
  const result = { ...record } as Record<string, unknown>;
  for (const key of ['finance_month', 'start_month', 'end_month']) {
    if (typeof result[key] === 'string') result[key] = result[key] ? financeMonth(result[key] as string) : null;
  }
  if (result.payment_date === '') result.payment_date = null;
  return result;
}
export const getFinanceAccess = () => rpc<boolean>('finance_access');
export const loadMonth = (month: string) => rpc<FinanceInput>('finance_read_month', { p_month: financeMonth(month) });
export const refreshPayments = (month: string) => rpc<FinanceInput>('finance_refresh_payments', { p_month: financeMonth(month) });
export const transitionMonth = (month: string, action: 'READY' | 'CLOSE' | 'REOPEN', revision: number, acknowledgement = '') =>
  rpc<FinanceInput>('finance_transition_month', { p_month: financeMonth(month), p_action: action, p_revision: revision, p_acknowledgement: acknowledgement });
export type RecordKind = 'vehicle' | 'recurring_cost' | 'insurance' | 'expense';
export const saveRecord = (kind: RecordKind, record: object) => rpc<void>('finance_save_record', { p_kind: kind, p_record: recordPayload(kind, record) });
export const deleteVehicle = (month: string, plate: string, revision: number) =>
  rpc<FinanceInput>('finance_delete_vehicle', { p_month: financeMonth(month), p_plate: plate, p_revision: revision });
export const postSmartDrive = (month: string, filename: string, rows: SmartDriveRow[], replace: boolean, revision: number, sourceHash: string | null = null) =>
  rpc<FinanceInput>('finance_post_smart_drive', { p_month: financeMonth(month), p_filename: filename, p_rows: rows, p_replace: replace, p_revision: revision, p_source_hash: sourceHash });
export const postBootstrap = (data: BootstrapData, filename: string) => rpc<void>('finance_bootstrap', { p_data: { ...data, recurring_costs: data.recurring_costs.map(row => recordPayload('recurring_cost', row)), insurance: data.insurance.map(row => recordPayload('insurance', row)) }, p_filename: filename });
export const postWorkshop = (month: string, filename: string, rows: FinanceExpense[], revision: number, sourceHash: string | null = null) =>
  rpc<FinanceInput>('finance_post_workshop', { p_month: financeMonth(month), p_filename: filename, p_rows: rows.map(row => recordPayload('expense', row)), p_revision: revision, p_source_hash: sourceHash });
export const postBankStatement = (month: string, filename: string, accountLabel: string, rows: import('../../types/finance-bank').BankReviewRow[], revision: number, sourceHash: string) =>
  rpc<FinanceInput>('finance_post_bank_statement', { p_month: financeMonth(month), p_filename: filename, p_account_label: accountLabel, p_rows: rows, p_revision: revision, p_source_hash: sourceHash });
export const reviewBankMatch = (month: string, importId: string, row: import('../../types/finance-bank').BankReviewRow, revision: number) =>
  rpc<FinanceInput>('finance_review_bank_match', { p_month: financeMonth(month), p_import_id: importId, p_source_row: row.source_row, p_decision: row.decision, p_matched_kind: row.matched_kind, p_matched_id: row.matched_id, p_note: row.review_note, p_revision: revision });
