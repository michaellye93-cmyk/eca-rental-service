import type { DepositKind, DriverDeposit } from './depositsApi.ts';

/** What was received of each kind (refunds and forfeits not taken off): the amounts an agreement states. */
export const receivedByKind = (rows: Array<Pick<DriverDeposit, 'kind' | 'entry' | 'amount'>>): Record<DepositKind, number> => {
  const total = (kind: DepositKind) => Math.round(rows.filter(r => r.kind === kind && r.entry === 'RECEIVED').reduce((sum, r) => sum + Number(r.amount), 0) * 100) / 100;
  return { DEPOSIT: total('DEPOSIT'), DOWNPAYMENT: total('DOWNPAYMENT') };
};

/**
 * What a driver form should record from its deposit and downpayment boxes: the rise over what is already received
 * (zero for a new driver). A box left empty means "no change". Returns a message instead when an amount is not a
 * number of zero or more, or is lower than what is recorded (lowering is a refund or a correction, made in the
 * driver's Deposits panel where it is logged).
 */
export const upfrontToRecord = (
  typed: { deposit: string; downpayment: string },
  recorded: Record<DepositKind, number>,
): { deposit: number; downpayment: number } | string => {
  const read = (text: string, current: number): number | null => {
    if (!text.trim()) return current;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  };
  const deposit = read(typed.deposit, recorded.DEPOSIT);
  const downpayment = read(typed.downpayment, recorded.DOWNPAYMENT);
  if (deposit === null || downpayment === null) return 'Enter the deposit and downpayment as amounts of zero or more.';
  if (deposit < recorded.DEPOSIT || downpayment < recorded.DOWNPAYMENT) {
    return "To lower a deposit or downpayment already recorded, refund or delete the entry in the driver's Deposits panel.";
  }
  return { deposit: Math.round((deposit - recorded.DEPOSIT) * 100) / 100, downpayment: Math.round((downpayment - recorded.DOWNPAYMENT) * 100) / 100 };
};
