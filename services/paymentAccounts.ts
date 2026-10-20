import { isBankReceipt } from './paymentLog.ts';

/**
 * The accounts payments are received into (public.payment_accounts, from
 * supabase/migrations/20261020090000_payment_received_into.sql). Each belongs to one company, so the bank
 * reconciliation can be done for the SDN BHD account and the Enterprise accounts separately.
 */

export type PaymentEntity = 'SDN_BHD' | 'ENTERPRISE';

export interface PaymentAccount {
  id: string;
  label: string;
  entity: PaymentEntity;
}

/** The company names as the office writes them. */
export const ENTITY_NAMES: Record<PaymentEntity, string> = { SDN_BHD: 'SDN BHD', ENTERPRISE: 'Enterprise' };

/** Money that reaches a bank (bank transfer or cash deposit) must say which account it went into. */
export const needsReceivedInto = (amount: number, method?: string | null): boolean => isBankReceipt(amount, method);

/** "Account · Company", or "Untagged" for a payment with no (known) account. */
export function receivedIntoLabel(accounts: PaymentAccount[], id: string | null | undefined): string {
  const account = id ? accounts.find(item => item.id === id) : undefined;
  return account ? `${account.label} · ${ENTITY_NAMES[account.entity]}` : 'Untagged';
}

/** The bank check's company filter: everything, one company, or the payments still untagged. */
export type AccountFilter = 'all' | PaymentEntity | 'UNTAGGED';

export function matchesAccountFilter(filter: AccountFilter, id: string | null | undefined, accounts: PaymentAccount[]): boolean {
  if (filter === 'all') return true;
  const account = id ? accounts.find(item => item.id === id) : undefined;
  return filter === 'UNTAGGED' ? !account : account?.entity === filter;
}
