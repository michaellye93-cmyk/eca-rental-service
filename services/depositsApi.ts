import { supabase } from '../supabaseClient';

/**
 * Deposits (Sewa Biasa) and downpayments (Sewa Beli), kept apart from rent payments in public.driver_deposits
 * (supabase/migrations/20261006200000_driver_deposits.sql). Rent rules never read them. Each call rejects when the
 * table is not available yet (the file has not been run), so screens can carry on without it.
 */
export type DepositKind = 'DEPOSIT' | 'DOWNPAYMENT';
export type DepositEntry = 'RECEIVED' | 'REFUNDED' | 'FORFEITED' | 'CONTRA';
export interface DriverDeposit {
  id: string;
  driver_id: string;
  kind: DepositKind;
  entry: DepositEntry;
  entry_date: string;
  amount: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  created_at: string;
}
const COLUMNS = 'id,driver_id,kind,entry,entry_date,amount,method,reference,note,created_at';

/** Sewa Beli drivers pay a downpayment; everyone else a refundable deposit. */
export const depositKindFor = (category: string | null | undefined): DepositKind => (String(category ?? '').toUpperCase() === 'SEWABELI' ? 'DOWNPAYMENT' : 'DEPOSIT');
export const depositKindLabel = (kind: DepositKind) => (kind === 'DOWNPAYMENT' ? 'Downpayment' : 'Deposit');

/** Money still held for the driver: received less refunded and forfeited. */
export const depositHeld = (rows: Array<Pick<DriverDeposit, 'entry' | 'amount'>>) =>
  Math.round(rows.reduce((sum, row) => sum + (row.entry === 'RECEIVED' ? 1 : -1) * Number(row.amount), 0) * 100) / 100;

export async function loadDeposits(driverId: string): Promise<DriverDeposit[]> {
  const { data, error } = await supabase.from('driver_deposits').select(COLUMNS).eq('driver_id', driverId).order('entry_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, amount: Number(row.amount) }));
}

export async function addDeposit(row: { driver_id: string; kind: DepositKind; entry: DepositEntry; entry_date: string; amount: number; method?: string | null; reference?: string | null; note?: string | null }): Promise<DriverDeposit> {
  const { data, error } = await supabase.from('driver_deposits').insert(row).select(COLUMNS).single();
  if (error) throw error;
  return { ...(data as any), amount: Number((data as any).amount) };
}

export async function deleteDeposit(id: string): Promise<void> {
  const { error } = await supabase.from('driver_deposits').delete().eq('id', id);
  if (error) throw error;
}
