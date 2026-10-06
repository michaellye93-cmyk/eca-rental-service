import type { Driver } from '../types.ts';
import { DriverStatus } from '../types.ts';
import { calculateDriverMetrics, formatCurrency, generateDriverInvoices, getNextDueDate, isSewaBiasa, parseDate } from '../utils.ts';
import { portalDate, portalText, type PortalLang } from './portalText.ts';

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
  contract: { key: 'car' | 'type' | 'rent' | 'started' | 'ends' | 'length'; label: string; value: string }[];
  /** The next few rents due after today (none once the account is closed or the contract has ended). */
  upcoming: { date: string; amount: string }[];
}

const UPCOMING_COUNT = 3;

/**
 * What the driver's own page says, in the tone the office uses on WhatsApp: recognise each payment, show truthful
 * progress and one concrete next step, never threaten or push for full settlement. Figures come from the shared rent
 * rules (calculateDriverMetrics), so the balance always matches the office.
 */
export const driverPortalView = (driver: Driver, now: Date, lang: PortalLang = 'en'): DriverPortalView => {
  const t = portalText(lang);
  const date = (value: string | Date) => portalDate(value, lang);
  const metrics = calculateDriverMetrics(driver, now);
  const owed = Math.max(0, metrics.principalOutstanding);
  const rate = driver.rentalRate;
  const unit = driver.rentalCycle === 'MONTHLY' ? 'month' : 'week';

  let tone: PortalTone;
  let title: string;
  let message: string;
  if (driver.isDelisted) {
    tone = owed > 0 ? 'warning' : 'neutral';
    title = owed > 0 ? t.finalTitle : t.closedTitle;
    message = owed > 0 ? t.final(formatCurrency(owed)) : t.closed;
  } else if (owed <= 0.01) {
    const nextDue = getNextDueDate(driver, now);
    tone = 'good';
    title = t.upToDateTitle;
    message = nextDue ? t.upToDate(formatCurrency(rate), date(nextDue)) : t.nothingOwed;
  } else if (metrics.status === DriverStatus.BAD) {
    tone = 'warning';
    title = t.behindTitle;
    message = t.behind(formatCurrency(owed));
  } else {
    tone = 'warning';
    title = t.catchUpTitle;
    message = t.catchUp(formatCurrency(owed));
  }

  let milestone: string | null = null;
  if (owed > 0.01 && rate > 0) {
    const nextLevel = (Math.ceil(owed / rate - 1e-9) - 1) * rate;
    const step = owed - nextLevel;
    milestone = nextLevel <= 0.01
      ? t.clearAll(formatCurrency(owed))
      : t.nextStep(formatCurrency(step), formatCurrency(nextLevel));
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
  const thanks = latestDay ? t.thanks(formatCurrency(cashByDay.get(latestDay)!), date(latestDay)) : null;

  let progress: DriverPortalView['progress'] = null;
  if (!driver.isDelisted && driver.contractDuration > 0) {
    const shown = Math.min(metrics.cyclesElapsed, driver.contractDuration);
    progress = {
      label: t.progress(unit, shown, driver.contractDuration),
      percent: Math.round(metrics.progressPercent),
      note: metrics.cyclesElapsed > driver.contractDuration ? t.pastLength : null,
    };
  }

  const start = parseDate(driver.contractStartDate);
  const hasStart = !isNaN(start.getTime());
  const payDay = !hasStart ? ''
    : driver.rentalCycle === 'MONTHLY'
      ? t.monthly(start.getDate(), start.getDate() > 28)
      : t.everyWeekday(t.weekdays[start.getDay()]);
  const contract: DriverPortalView['contract'] = [
    { key: 'car', label: t.car, value: driver.carPlate },
    { key: 'type', label: t.type, value: isSewaBiasa(driver) ? t.rental : t.rentToOwn },
    { key: 'rent', label: t.rent, value: `${formatCurrency(rate)}${payDay}` },
  ];
  if (hasStart) contract.push({ key: 'started', label: t.started, value: date(start) });
  if (driver.contractEndDate && !isNaN(parseDate(driver.contractEndDate).getTime())) {
    contract.push({ key: 'ends', label: t.ends, value: date(driver.contractEndDate) });
  } else if (driver.contractDuration > 0) {
    contract.push({ key: 'length', label: t.length, value: t.lengthValue(driver.contractDuration, unit) });
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
      .map(invoice => ({ date: date(invoice.dueDate), amount: formatCurrency(invoice.remainingBalance) }));
  }

  return { tone, title, message, milestone, thanks, progress, contract, upcoming };
};
