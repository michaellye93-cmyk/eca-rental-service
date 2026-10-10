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

export interface CollectionSplit {
  month: string; // YYYY-MM
  /** Rent falling due in the month (up to today for the current month). */
  due: number;
  /** Everything paid in the month: cash, service claims and deposit contra. */
  collected: number;
  /** Paid in the month for rent due in the month. */
  current: number;
  /** Paid in the month for rent that fell due in an earlier month. */
  arrears: number;
  /** Paid in the month for rent not yet due, or beyond the recorded contract. */
  ahead: number;
  /** Of `collected`, service claims and deposit contra: settled rent that brought in no cash. */
  notCash: number;
}

/**
 * Money collected each month split by the rent it settled (oldest rent first, as the rent schedule allocates it): this
 * month's rent, old arrears or paid ahead. Delisted drivers count too: what they pay is arrears.
 */
export function collectionSplit(drivers: Driver[], months: string[], today: Date): CollectionSplit[] {
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const rows = months.map((month) => ({ month, due: 0, collected: 0, current: 0, arrears: 0, ahead: 0, notCash: 0 }));
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const ledgers = drivers.map((driver) => driverMonthlyLedger(driver, months, today));
  ledgers.forEach((ledger) => ledger.forEach((entry) => { byMonth.get(entry.month)!.due += entry.billed; }));
  for (const driver of drivers) {
    for (const allocation of rentAllocations(driver, today)) {
      const row = byMonth.get(allocation.paymentDate.slice(0, 7));
      if (!row) continue;
      row.collected += allocation.amount;
      const dueMonth = allocation.dueDate?.slice(0, 7);
      // Rent not yet due (later this month too) is paid ahead, so the month in progress never counts more than is due.
      if (dueMonth === undefined || dueMonth > row.month || allocation.dueDate! > todayKey) row.ahead += allocation.amount;
      else if (dueMonth < row.month) row.arrears += allocation.amount;
      else row.current += allocation.amount;
    }
    for (const payment of driver.paymentHistory) {
      const row = byMonth.get(payment.date.slice(0, 7));
      if (!row || payment.date > todayKey) continue;
      row.notCash += (payment.serviceClaim ?? 0) + (['DEPOSIT CONTRA', 'CLAIM'].includes(payment.paymentMethod ?? '') ? payment.amount : 0);
    }
  }
  return rows.map((row) => ({ month: row.month, due: cents(row.due), collected: cents(row.collected), current: cents(row.current),
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
