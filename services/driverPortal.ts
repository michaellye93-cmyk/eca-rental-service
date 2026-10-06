import type { Driver } from '../types.ts';
import { DriverStatus } from '../types.ts';
import { calculateDriverMetrics, formatCurrency, formatDate, generateDriverInvoices, getNextDueDate, isSewaBiasa, parseDate } from '../utils.ts';

export type PortalTone = 'good' | 'warning' | 'neutral';

export interface DriverPortalView {
  tone: PortalTone;
  title: string;
  message: string;
  /** One manageable next step towards a lower balance, while rent is owed. */
  milestone: string | null;
  /** Thanks for the latest cash payment. */
  thanks: string | null;
  /** Contract progress, never counting past the contract length. Null for closed accounts or no recorded length. */
  progress: { label: string; percent: number; note: string | null } | null;
  /** The contract facts a driver looks up, in display order. */
  contract: { label: string; value: string }[];
  /** The next few rents due after today (none once the account is closed or the contract has ended). */
  upcoming: { date: string; amount: string }[];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (day: number) => {
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
};
const UPCOMING_COUNT = 3;

/**
 * What the driver's own page says, in the tone the office uses on WhatsApp: recognise each payment, show truthful
 * progress and one concrete next step, never threaten or push for full settlement. Figures come from the shared rent
 * rules (calculateDriverMetrics), so the balance always matches the office.
 */
export const driverPortalView = (driver: Driver, now: Date): DriverPortalView => {
  const metrics = calculateDriverMetrics(driver, now);
  const owed = Math.max(0, metrics.principalOutstanding);
  const rate = driver.rentalRate;
  const unit = driver.rentalCycle === 'MONTHLY' ? 'Month' : 'Week';

  let tone: PortalTone;
  let title: string;
  let message: string;
  if (driver.isDelisted) {
    tone = owed > 0 ? 'warning' : 'neutral';
    title = owed > 0 ? 'Final settlement' : 'Account closed';
    message = owed > 0
      ? `${formatCurrency(owed)} is left to settle to close your account. Message the office if you'd like to arrange it.`
      : 'Your rental has ended with nothing owed. Thank you.';
  } else if (owed <= 0.01) {
    const nextDue = getNextDueDate(driver, now);
    tone = 'good';
    title = "You're up to date";
    message = nextDue ? `Your next rent of ${formatCurrency(rate)} is due on ${formatDate(nextDue)}.` : 'Nothing is owed. Thank you.';
  } else if (metrics.status === DriverStatus.BAD) {
    tone = 'warning';
    title = "Let's catch up";
    message = `You have ${formatCurrency(owed)} to catch up. Every payment brings it down. Message the office if you'd like a payment plan.`;
  } else {
    tone = 'warning';
    title = 'Rent to catch up';
    message = `You have ${formatCurrency(owed)} to catch up. Thank you for every payment.`;
  }

  let milestone: string | null = null;
  if (owed > 0.01 && rate > 0) {
    const nextLevel = (Math.ceil(owed / rate - 1e-9) - 1) * rate;
    const step = owed - nextLevel;
    milestone = nextLevel <= 0.01
      ? `Pay ${formatCurrency(owed)} and you're fully up to date.`
      : `Next step: pay ${formatCurrency(step)} to bring it down to ${formatCurrency(nextLevel)}.`;
  }

  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  // Cash payments up to today only (a service claim alone is not a payment the driver made); same-day transfers count together.
  const cashByDay = new Map<string, number>();
  for (const payment of driver.paymentHistory || []) {
    const day = parseDate(payment.date);
    if (payment.amount > 0 && !isNaN(day.getTime()) && day <= endOfDay) {
      cashByDay.set(payment.date, (cashByDay.get(payment.date) ?? 0) + payment.amount);
    }
  }
  const latestDay = [...cashByDay.keys()].sort((a, b) => parseDate(b).getTime() - parseDate(a).getTime())[0];
  const thanks = latestDay ? `Last payment ${formatCurrency(cashByDay.get(latestDay)!)} on ${formatDate(latestDay)}. Thank you!` : null;

  let progress: DriverPortalView['progress'] = null;
  if (!driver.isDelisted && driver.contractDuration > 0) {
    const shown = Math.min(metrics.cyclesElapsed, driver.contractDuration);
    progress = {
      label: `${unit} ${shown} of ${driver.contractDuration}`,
      percent: Math.round(metrics.progressPercent),
      note: metrics.cyclesElapsed > driver.contractDuration ? 'Contract length reached. Rent continues until your contract is closed.' : null,
    };
  }

  const start = parseDate(driver.contractStartDate);
  const hasStart = !isNaN(start.getTime());
  const payDay = !hasStart ? ''
    : driver.rentalCycle === 'MONTHLY'
      ? ` on the ${ordinal(start.getDate())} of each month${start.getDate() > 28 ? ' (or the last day of a shorter month)' : ''}`
      : ` every ${WEEKDAYS[start.getDay()]}`;
  const contract: DriverPortalView['contract'] = [
    { label: 'Car', value: driver.carPlate },
    { label: 'Type', value: isSewaBiasa(driver) ? 'Rental (Sewa Biasa)' : 'Rent-to-own (Sewa Beli)' },
    { label: 'Rent', value: `${formatCurrency(rate)}${payDay}` },
  ];
  if (hasStart) contract.push({ label: 'Started', value: formatDate(start) });
  if (driver.contractEndDate && !isNaN(parseDate(driver.contractEndDate).getTime())) {
    contract.push({ label: 'Ends', value: formatDate(driver.contractEndDate) });
  } else if (driver.contractDuration > 0) {
    contract.push({ label: 'Length', value: `${driver.contractDuration} ${unit.toLowerCase()}${driver.contractDuration === 1 ? '' : 's'}` });
  }

  let upcoming: DriverPortalView['upcoming'] = [];
  if (!driver.isDelisted && hasStart) {
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const horizon = new Date(endOfToday);
    if (driver.rentalCycle === 'MONTHLY') horizon.setMonth(horizon.getMonth() + UPCOMING_COUNT + 1);
    else horizon.setDate(horizon.getDate() + 7 * (UPCOMING_COUNT + 1));
    upcoming = generateDriverInvoices(driver, now, horizon)
      // Rent already paid ahead is not due again; a part-paid cycle shows what is left
      .filter(invoice => parseDate(invoice.dueDate) > endOfToday && invoice.remainingBalance > 0.01)
      .slice(0, UPCOMING_COUNT)
      .map(invoice => ({ date: formatDate(invoice.dueDate), amount: formatCurrency(invoice.remainingBalance) }));
  }

  return { tone, title, message, milestone, thanks, progress, contract, upcoming };
};
