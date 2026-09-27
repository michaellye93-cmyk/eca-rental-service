import type { BankReviewRow } from '../../types/finance-bank.ts';
import type { EhailingPayment } from '../../types/finance.ts';

/**
 * Suggested payment matches for bank credits, ported from the retired Bank Recon screen's multi-pass matcher (same
 * day windows, thresholds and scores). Finance statement rows carry a description and a reference, so the description
 * is read as the sender's name once common banking words are removed, and plates are looked for in both fields.
 * Suggestions only prefill a review: an Admin still posts the statement, and Finance checks month and amount again.
 */
export type SuggestionPass =
  | 'NAME_OR_PLATE_1_DAY'
  | 'NAME_OR_PLATE_5_DAYS'
  | 'NAME_OR_PLATE_14_DAYS'
  | 'NAME_OR_PLATE_32_DAYS'
  | 'CASH_DEPOSIT_5_DAYS'
  | 'CASH_DEPOSIT_12_DAYS'
  | 'CASH_DEPOSIT_CLOSEST';

export interface PaymentSuggestion {
  sourceRow: number;
  paymentId: string;
  pass: SuggestionPass;
  reason: string;
}

const REASONS: Record<SuggestionPass, string> = {
  NAME_OR_PLATE_1_DAY: 'Name or plate matches, same amount, within 1 day',
  NAME_OR_PLATE_5_DAYS: 'Name or plate matches, same amount, within 5 days',
  NAME_OR_PLATE_14_DAYS: 'Name or plate matches, same amount, within 14 days',
  NAME_OR_PLATE_32_DAYS: 'Name or plate matches, same amount, within 32 days',
  CASH_DEPOSIT_5_DAYS: 'Cash deposit recorded, same amount, within 5 days',
  CASH_DEPOSIT_12_DAYS: 'Cash deposit recorded, same amount, within 12 days',
  CASH_DEPOSIT_CLOSEST: 'Cash deposit, same amount, closest payment within 12 days',
};

// Words banks add to transfer descriptions; they are not part of anyone's name.
const BANKING_WORDS = new Set([
  'DUITNOW', 'TRANSFER', 'TRANSFERS', 'TRF', 'TRSF', 'IBG', 'IBFT', 'GIRO', 'FUND', 'FUNDS', 'FPX', 'INSTANT', 'FROM',
  'CR', 'CREDIT', 'ADVICE', 'PAYMENT', 'PYMT', 'PMT', 'ONLINE', 'INTERBANK', 'QR', 'REF', 'M2U', 'MAE', 'JOMPAY',
  'CASH', 'DEPOSIT', 'CDM',
]);

const DAY = 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / DAY;
const squash = (text: string | null | undefined) => String(text ?? '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '');

/** The part of a bank description that can be a person's name. */
function senderName(description: string): string {
  return description
    .toUpperCase()
    .split(/[^A-Z0-9/.]+/)
    .filter(token => token && !BANKING_WORDS.has(token) && !/^\d+$/.test(token))
    .join(' ');
}

function normalizeToken(token: string) {
  const t = token.toUpperCase().trim();
  if (/^(MOHD|MHD|MOHAMAD|MOHAMID|MOHAMED|MOHAMMAD|MOHAMMED|MUHD|MUHAMAD|MUHAMID|MUHAMED|MUHAMMAD|MUHAMMED|MD|M)$/.test(t)) return 'MD';
  if (/^(ABDUL|ABD)$/.test(t)) return 'ABD';
  if (/^(AHMAD|AHMED)$/.test(t)) return 'AHMAD';
  if (/^(CHANDRAN|CHNDRAN)$/.test(t)) return 'CHANDRAN';
  return t;
}

function bigrams(text: string): Set<string> {
  const result = new Set<string>();
  const s = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let i = 0; i < s.length - 1; i++) result.add(s.substring(i, i + 2));
  return result;
}

function bigramSimilarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  x.forEach(pair => { if (y.has(pair)) shared++; });
  return (2 * shared) / (x.size + y.size);
}

/** Same rules as Bank Recon: token overlap of 55%+, bigram similarity of 60%+, or one name contained in the other. */
function nameMatch(driverName: string, sender: string) {
  const honorifics = /\b(BIN|BINTI|BTE|BT|B\.|B|A\/L|A\/P|MR|MRS|MS|KOP)\b/g;
  const driverClean = String(driverName || '').toUpperCase().replace(honorifics, '');
  const senderClean = String(sender || '').toUpperCase().replace(honorifics, '');
  const driverTokens = driverClean.split(/[\s-]+/).filter(t => t.length >= 2).map(normalizeToken);
  const senderTokens = senderClean.split(/[\s-]+/).filter(t => t.length >= 2).map(normalizeToken);
  const shared = driverTokens.filter(t => senderTokens.includes(t));
  const tokenSimilarity = driverTokens.length + senderTokens.length > 0 ? (shared.length * 2) / (driverTokens.length + senderTokens.length) : 0;
  const bigram = bigramSimilarity(driverClean, senderClean);
  const driverSquashed = driverClean.replace(/[^A-Z0-9]/g, '');
  const senderSquashed = senderClean.replace(/[^A-Z0-9]/g, '');
  let inclusion = 0;
  if (driverSquashed.length >= 3 && senderSquashed.length >= 3) {
    if (driverSquashed.includes(senderSquashed) && senderSquashed.length / driverSquashed.length >= 0.5) inclusion = senderSquashed.length / driverSquashed.length;
    else if (senderSquashed.includes(driverSquashed) && driverSquashed.length / senderSquashed.length >= 0.5) inclusion = driverSquashed.length / senderSquashed.length;
  }
  return { isMatch: tokenSimilarity >= 0.55 || bigram >= 0.6 || inclusion > 0, similarity: Math.max(tokenSimilarity, bigram, inclusion) };
}

function plateMatch(plate: string, row: BankReviewRow) {
  const wanted = squash(plate);
  return wanted.length > 3 && (squash(row.reference) + squash(row.description)).includes(wanted);
}

const isCashDepositText = (row: BankReviewRow) => /CASHDEPOSIT|CDM/.test(squash(row.description) + squash(row.reference));
const isCashDepositMethod = (payment: EhailingPayment) => ['CASH DEPOSIT', 'CASH'].includes(String(payment.payment_method ?? '').toUpperCase());
const sameAmount = (payment: EhailingPayment, row: BankReviewRow) => Math.abs(Number(payment.cash_amount) - Number(row.credit)) < 0.01;

/**
 * Suggests one recorded payment for each pending bank credit. Passes run in order, strictest first, and each payment is
 * suggested at most once. Claim-only payments (no cash) and payments in `taken` (already matched) are never suggested.
 */
export function suggestPaymentMatches(rows: BankReviewRow[], payments: EhailingPayment[], taken: Set<string> = new Set()): Map<number, PaymentSuggestion> {
  const credits = rows.filter(row => row.credit > 0 && row.debit === 0 && row.decision === 'PENDING');
  const pool = payments.filter(payment => payment.cash_amount > 0 && !taken.has(payment.source_payment_id));
  const used = new Set<string>();
  const suggestions = new Map<number, PaymentSuggestion>();
  const suggest = (row: BankReviewRow, payment: EhailingPayment, pass: SuggestionPass) => {
    used.add(payment.source_payment_id);
    suggestions.set(row.source_row, { sourceRow: row.source_row, paymentId: payment.source_payment_id, pass, reason: REASONS[pass] });
  };

  // Passes 1-4: name or plate, same amount, widening day windows; closer dates score higher.
  const namePasses: Array<[SuggestionPass, number, number]> = [
    ['NAME_OR_PLATE_1_DAY', 1.05, 50], ['NAME_OR_PLATE_5_DAYS', 5.05, 20], ['NAME_OR_PLATE_14_DAYS', 14.05, 5], ['NAME_OR_PLATE_32_DAYS', 32.05, 2],
  ];
  for (const [pass, window, dateWeight] of namePasses) {
    for (const row of credits) {
      if (suggestions.has(row.source_row)) continue;
      const sender = senderName(row.description);
      let best: EhailingPayment | null = null;
      let bestScore = -1;
      for (const payment of pool) {
        if (used.has(payment.source_payment_id) || !sameAmount(payment, row)) continue;
        const days = daysApart(payment.payment_date, row.transaction_date);
        if (days > window) continue;
        const name = nameMatch(payment.driver_name_snapshot ?? '', sender);
        const plate = plateMatch(payment.car_plate_snapshot ?? payment.plate_key ?? '', row);
        if (!name.isMatch && !plate) continue;
        const score = (name.isMatch ? 100 * name.similarity : 0) + (plate ? 150 : 0) + Math.max(0, (window - days) * dateWeight);
        if (score > bestScore) { bestScore = score; best = payment; }
      }
      if (best) suggest(row, best, pass);
    }
  }

  // Passes 5-6: cash-deposit wording and a payment recorded as a cash deposit.
  const cashPasses: Array<[SuggestionPass, number, number]> = [['CASH_DEPOSIT_5_DAYS', 5.05, 20], ['CASH_DEPOSIT_12_DAYS', 12.05, 5]];
  for (const [pass, window, dateWeight] of cashPasses) {
    for (const row of credits) {
      if (suggestions.has(row.source_row) || !isCashDepositText(row)) continue;
      let best: EhailingPayment | null = null;
      let bestScore = -1;
      for (const payment of pool) {
        if (used.has(payment.source_payment_id) || !sameAmount(payment, row) || !isCashDepositMethod(payment)) continue;
        const days = daysApart(payment.payment_date, row.transaction_date);
        if (days > window) continue;
        const score = 50 + Math.max(0, (window - days) * dateWeight);
        if (score > bestScore) { bestScore = score; best = payment; }
      }
      if (best) suggest(row, best, pass);
    }
  }

  // Pass 7: cash-deposit wording, the closest payment of the same amount within 12 days, whatever its recorded method.
  for (const row of credits) {
    if (suggestions.has(row.source_row) || !isCashDepositText(row)) continue;
    const closest = pool
      .filter(payment => !used.has(payment.source_payment_id) && sameAmount(payment, row) && daysApart(payment.payment_date, row.transaction_date) <= 12.05)
      .sort((a, b) => daysApart(a.payment_date, row.transaction_date) - daysApart(b.payment_date, row.transaction_date))[0];
    if (closest) suggest(row, closest, 'CASH_DEPOSIT_CLOSEST');
  }
  return suggestions;
}

/**
 * "System unsolved": cash payments recorded in the app that no bank credit has been matched to (claim-only payments
 * bring no money, so they are left out). Oldest first, then by driver name.
 */
export function unsolvedPayments(payments: EhailingPayment[], matchedPaymentIds: Set<string>): EhailingPayment[] {
  return payments
    .filter(payment => payment.cash_amount > 0 && !matchedPaymentIds.has(payment.source_payment_id))
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date) || String(a.driver_name_snapshot ?? '').localeCompare(String(b.driver_name_snapshot ?? '')));
}
