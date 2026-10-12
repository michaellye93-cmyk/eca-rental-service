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

/** The account a statement belongs to on Cash: an existing account ending in the same four digits, else its own name. */
const accountFor = (statementLabel: string, existing: string[]) => {
  const digits = statementLabel.match(/(\d{4})\D*$/)?.[1];
  return (digits && existing.find(label => label.replace(/\D/g, '').endsWith(digits))) || statementLabel;
};

export interface BalanceEntry { account: string; balance: number; asOf: string; note: string }

/** The Cash balance lines to save for a posted statement; a month not yet over (after `today`) has no month-end balance yet. */
export function balanceEntries(s: { accountLabel: string; filename: string; month: string; opening: number | null; closing: number | null }, existingAccounts: string[], today = '9999-12-31'): BalanceEntry[] {
  const account = accountFor(s.accountLabel.trim(), existingAccounts);
  const entries: BalanceEntry[] = [];
  if (s.opening !== null) entries.push({ account, balance: s.opening, asOf: lastDay(previousMonth(s.month)), note: `Opening balance from bank statement ${s.filename}` });
  if (s.closing !== null && lastDay(s.month) <= today) entries.push({ account, balance: s.closing, asOf: lastDay(s.month), note: `Closing balance from bank statement ${s.filename}` });
  return entries;
}
