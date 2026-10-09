import type { DepositKind, DriverDeposit } from './depositsApi.ts';

/** What was received of each kind (refunds and forfeits not taken off): the amounts an agreement states. */
export const receivedByKind = (rows: Array<Pick<DriverDeposit, 'kind' | 'entry' | 'amount'>>): Record<DepositKind, number> => {
  const total = (kind: DepositKind) => Math.round(rows.filter(r => r.kind === kind && r.entry === 'RECEIVED').reduce((sum, r) => sum + Number(r.amount), 0) * 100) / 100;
  return { DEPOSIT: total('DEPOSIT'), DOWNPAYMENT: total('DOWNPAYMENT') };
};
