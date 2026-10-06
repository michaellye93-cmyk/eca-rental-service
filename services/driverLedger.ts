import type { Driver } from '../types.ts';
import { generateDriverInvoices } from '../utils.ts';

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
