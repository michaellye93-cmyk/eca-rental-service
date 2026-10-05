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
