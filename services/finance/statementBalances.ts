/**
 * The bank balance at the two month ends a statement shows, so posting a statement fills in Cash's bank balances (and the
 * Bank check) instead of them being typed again. Only balances the statement prints or proves are used.
 */

const lastDay = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, '0')}`;
};
const previousMonth = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
};

/**
 * Balance at the end of the month before `month` (opening) and at the end of `month` (closing), from each line's balance
 * after it (lines oldest first) and the statement's printed opening balance. A month with no line says nothing.
 */
export function monthEndBalances(lines: { date: string; balance: number | null }[], printedOpening: number | null, month: string): { opening: number | null; closing: number | null } {
  const inMonth = lines.filter(l => l.date.slice(0, 7) === month);
  if (!inMonth.length) return { opening: null, closing: null };
  const before = lines.filter(l => l.date.slice(0, 7) < month && l.balance !== null);
  const opening = before.length ? before[before.length - 1].balance : lines[0].date.slice(0, 7) === month ? printedOpening : null;
  const lastInMonth = [...inMonth].reverse().find(l => l.balance !== null);
  return { opening, closing: lastInMonth?.balance ?? null };
}

const lastFourDigits = (label: string) => {
  const digits = label.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
};

/**
 * Whether two labels name the same bank account: the same name (ignoring spaces at either end), or both carry at least
 * four digits and the last four are the same. The one rule for statement balances and for Month close.
 */
export function sameBankAccount(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const digitsA = lastFourDigits(a);
  return digitsA !== null && digitsA === lastFourDigits(b);
}

export interface BalanceEntry { account: string; balance: number; asOf: string; note: string }

/**
 * The Cash balance lines to save for a posted statement; a month not yet over (after `today`) has no month-end balance
 * yet. They go under the account on Cash that is the same bank account (sameBankAccount); with no account on Cash yet,
 * under the statement's own label. When Cash has accounts but none is this one, nothing is saved and `reason` says
 * why: a second label for one bank account would count its money twice.
 */
export function balanceEntries(s: { accountLabel: string; filename: string; month: string; opening: number | null; closing: number | null }, existingAccounts: string[], today = '9999-12-31'): { entries: BalanceEntry[]; reason: string | null } {
  if (s.opening === null && s.closing === null) return { entries: [], reason: null };
  const label = s.accountLabel.trim();
  const existing = [...new Set(existingAccounts)];
  const match = existing.find(account => sameBankAccount(account, label));
  if (!match && existing.length) {
    const digits = lastFourDigits(label);
    const what = digits ? `ends in ${digits}` : `is named "${label}"`;
    const fix = digits ? 'Rename the account on Cash to end in those digits' : 'Rename the account on Cash to match it';
    return { entries: [], reason: `Bank balances not added: no account on Cash ${what}. ${fix}, or enter the balances by hand.` };
  }
  const account = match ?? label;
  const entries: BalanceEntry[] = [];
  if (s.opening !== null) entries.push({ account, balance: s.opening, asOf: lastDay(previousMonth(s.month)), note: `Opening balance from bank statement ${s.filename}` });
  if (s.closing !== null && lastDay(s.month) <= today) entries.push({ account, balance: s.closing, asOf: lastDay(s.month), note: `Closing balance from bank statement ${s.filename}` });
  return { entries, reason: null };
}
