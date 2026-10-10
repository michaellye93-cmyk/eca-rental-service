import type { Driver } from '../types.ts';
import { generateDriverInvoices, rentAllocations } from '../utils.ts';

const cents = (value: number) => Math.round(value * 100) / 100;
const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(year, number, 0, 23, 59, 59);
};

export interface DriverMonth {
  month: string; // YYYY-MM
  /** Rent falling due in the month (up to today for the current month), from the shared rent schedule. */
  billed: number;
  /** Cash and service claims dated in the month. */
  collected: number;
  /** Rent billed to date less everything collected to date, at month end (negative = paid ahead). */
  balance: number;
  /** Collected ÷ billed for the month, or null with nothing billed. */
  rate: number | null;
}

/** Billed, collected and balance per calendar month for one driver. Months are YYYY-MM, oldest first. */
export function driverMonthlyLedger(driver: Driver, months: string[], today: Date): DriverMonth[] {
  if (!months.length) return [];
  const last = monthEnd([...months].sort().at(-1)!);
  const invoices = generateDriverInvoices(driver, today, last);
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return months.map((month) => {
    // A month still in progress counts only up to today: rent not yet due is neither billed nor owed.
    const cutoff = [`${month}-31`, todayKey].sort()[0];
    const inMonth = (date: string) => date.slice(0, 7) === month && date <= cutoff;
    const billed = cents(invoices.filter((invoice) => inMonth(invoice.dueDate)).reduce((sum, invoice) => sum + invoice.amount, 0));
    const collected = cents(driver.paymentHistory.filter((payment) => inMonth(payment.date))
      .reduce((sum, payment) => sum + payment.amount + (payment.serviceClaim ?? 0), 0));
    const billedToDate = invoices.filter((invoice) => invoice.dueDate <= cutoff).reduce((sum, invoice) => sum + invoice.amount, 0);
    const collectedToDate = driver.paymentHistory.filter((payment) => payment.date <= cutoff)
      .reduce((sum, payment) => sum + payment.amount + (payment.serviceClaim ?? 0), 0);
    return { month, billed, collected, balance: cents(billedToDate - collectedToDate), rate: billed ? collected / billed : null };
  });
}

/** Every driver's rent billed and money collected in one month, delisted drivers included. */
export function monthCollection(drivers: Driver[], month: string, today: Date): { billed: number; collected: number; rate: number | null } {
  let billed = 0;
  let collected = 0;
  for (const driver of drivers) {
    const [row] = driverMonthlyLedger(driver, [month], today);
    billed += row.billed;
    collected += row.collected;
  }
  return { billed: cents(billed), collected: cents(collected), rate: billed ? collected / billed : null };
}

const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** A stretch of calendar days, `from` to `to` inclusive (YYYY-MM-DD); `key` names it (its first day). */
export interface Period { key: string; from: string; to: string }

/** The calendar month YYYY-MM as a period. */
export function monthPeriod(month: string): Period {
  const [year, number] = month.split('-').map(Number);
  return { key: month, from: `${month}-01`, to: isoDay(new Date(year, number, 0)) };
}

/** The last `count` Monday-to-Sunday weeks, oldest first, ending with the week that contains today. */
export function weekPeriods(today: Date, count: number): Period[] {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: count }, (_, i) => {
    const from = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * (count - 1 - i));
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
    return { key: isoDay(from), from: isoDay(from), to: isoDay(to) };
  });
}

export interface CollectionSplit {
  /** The period's key (its first day, or YYYY-MM for a month). */
  period: string;
  /** Rent falling due in the period (up to today for the period in progress). */
  due: number;
  /** Everything paid in the period: cash, service claims and deposit contra. */
  collected: number;
  /** Paid in the period for rent due in the period. */
  current: number;
  /** Paid in the period for rent that fell due before it. */
  arrears: number;
  /** Paid in the period for rent not yet due, or beyond the recorded contract. */
  ahead: number;
  /** Of `collected`, service claims and deposit contra: settled rent that brought in no cash. */
  notCash: number;
}

/**
 * Money collected in each period split by the rent it settled (oldest rent first, as the rent schedule allocates it):
 * the period's own rent, old arrears or paid ahead. Delisted drivers count too: what they pay is arrears.
 */
export function collectionSplit(drivers: Driver[], periods: Period[], today: Date): CollectionSplit[] {
  const todayKey = isoDay(today);
  const rows = periods.map((period) => ({ period, due: 0, collected: 0, current: 0, arrears: 0, ahead: 0, notCash: 0 }));
  const rowFor = (date: string) => rows.find((row) => row.period.from <= date && date <= row.period.to);
  const last = periods.reduce((latest, period) => (period.to > latest ? period.to : latest), '');
  for (const driver of drivers) {
    // Rent due counts only up to today: rent not yet due is neither due nor owed.
    for (const invoice of last ? generateDriverInvoices(driver, today, new Date(`${last}T00:00:00`)) : []) {
      const row = invoice.dueDate <= todayKey ? rowFor(invoice.dueDate) : undefined;
      if (row) row.due += invoice.amount;
    }
    for (const allocation of rentAllocations(driver, today)) {
      const row = rowFor(allocation.paymentDate);
      if (!row) continue;
      row.collected += allocation.amount;
      const due = allocation.dueDate;
      // Rent not yet due (later in this period too) is paid ahead, so the period in progress never counts more than is due.
      if (due === null || due > row.period.to || due > todayKey) row.ahead += allocation.amount;
      else if (due < row.period.from) row.arrears += allocation.amount;
      else row.current += allocation.amount;
    }
    for (const payment of driver.paymentHistory) {
      const row = payment.date <= todayKey ? rowFor(payment.date) : undefined;
      if (row) row.notCash += (payment.serviceClaim ?? 0) + (['DEPOSIT CONTRA', 'CLAIM'].includes(payment.paymentMethod ?? '') ? payment.amount : 0);
    }
  }
  return rows.map((row) => ({ period: row.period.key, due: cents(row.due), collected: cents(row.collected), current: cents(row.current),
    arrears: cents(row.arrears), ahead: cents(row.ahead), notCash: cents(row.notCash) }));
}

export interface AgeingBucket { label: string; amount: number; drivers: number }

/**
 * Unpaid rent grouped by how many days it is past its due date (rent due today is not yet overdue), across the given
 * drivers. Payments settle the oldest rent first, as everywhere else, so what is left unpaid is the newest rent.
 */
export function arrearsAgeing(drivers: Driver[], today: Date): AgeingBucket[] {
  const buckets: Array<AgeingBucket & { max: number; ids: Set<string> }> = [
    { label: '0–30 days', max: 30, amount: 0, drivers: 0, ids: new Set() },
    { label: '31–60 days', max: 60, amount: 0, drivers: 0, ids: new Set() },
    { label: '61–90 days', max: 90, amount: 0, drivers: 0, ids: new Set() },
    { label: 'Over 90 days', max: Infinity, amount: 0, drivers: 0, ids: new Set() },
  ];
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (const driver of drivers) {
    for (const invoice of generateDriverInvoices(driver, today)) {
      const due = new Date(invoice.dueDate + 'T00:00:00');
      if (due >= dayStart || invoice.remainingBalance <= 0.005) continue;
      const days = Math.round((dayStart.getTime() - due.getTime()) / 86_400_000);
      const bucket = buckets.find((candidate) => days <= candidate.max)!;
      bucket.amount += invoice.remainingBalance;
      bucket.ids.add(driver.id);
    }
  }
  return buckets.map(({ label, amount, ids }) => ({ label, amount: cents(amount), drivers: ids.size }));
}
