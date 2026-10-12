import type { Driver } from '../types.ts';
import { DriverStatus } from '../types.ts';
import { formatCurrency, isSewaBiasa, parseDate } from '../utils.ts';
import { driverAccount, type DriverAccount } from './driverAccount.ts';
import { portalDate, portalText, type PortalLang } from './portalText.ts';

export type PortalTone = 'good' | 'warning' | 'neutral';

export interface DriverPortalView {
  /** The facts every figure below is worded from: the same ones the admin driver row reads (driverAccount). */
  account: DriverAccount;
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

/**
 * What the driver's own page says, in the tone the office uses on WhatsApp: recognise each payment, show truthful
 * progress and one concrete next step, never threaten or push for full settlement. Every figure comes from the driver's
 * account facts (driverAccount, on the shared rent rules), so the balance and dates always match the office.
 */
export const driverPortalView = (driver: Driver, now: Date, lang: PortalLang = 'en'): DriverPortalView => {
  const t = portalText(lang);
  const date = (value: string | Date) => portalDate(value, lang);
  const account = driverAccount(driver, now);
  const owed = account.owed;
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
    tone = 'good';
    title = t.upToDateTitle;
    message = account.dueDate ? t.upToDate(formatCurrency(rate), date(account.dueDate)) : t.nothingOwed;
  } else if (account.status === DriverStatus.BAD) {
    tone = 'warning';
    title = t.behindTitle;
    message = t.behind(formatCurrency(owed));
  } else {
    tone = 'warning';
    title = t.catchUpTitle;
    message = t.catchUp(formatCurrency(owed));
  }

  const step = account.nextStep;
  const milestone = !step ? null
    : step.leaves <= 0.01 ? t.clearAll(formatCurrency(owed)) : t.nextStep(formatCurrency(step.amount), formatCurrency(step.leaves));

  const cash = account.lastCashPayment;
  const thanks = cash ? t.thanks(formatCurrency(cash.amount), date(cash.date)) : null;

  const progress: DriverPortalView['progress'] = account.progress ? {
    label: t.progress(unit, account.progress.shown, account.progress.length),
    percent: account.progress.percent,
    note: account.progress.pastLength ? t.pastLength : null,
  } : null;

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

  const upcoming = account.upcoming.map(row => ({ date: date(row.date), amount: formatCurrency(row.amount) }));

  return { account, tone, title, message, milestone, thanks, progress, contract, upcoming };
};
