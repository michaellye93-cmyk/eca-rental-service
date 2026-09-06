import type { Driver } from './types';

const DAY = 86_400_000;
const day = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
  const n = Date.parse(value + 'T00:00:00Z') / DAY;
  return Number.isFinite(n) && new Date(n * DAY).toISOString().slice(0, 10) === value ? n : NaN;
};
const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const cents = (amount: number) => Math.round(Number(amount) * 100);
const sum = <T,>(rows: T[], select: (row: T) => number) => rows.reduce((total, row) => total + select(row), 0);
const money = (n: number) => n / 100;

export function getReportDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}

export type PaymentResult = 'FULL' | 'PARTIAL' | 'ZERO' | 'NO_RENT_DUE';
export interface PaymentPeriod {
  start: string;
  end: string;
  due: number;
  cash: number;
  claims: number;
  result: PaymentResult;
  completed: boolean;
}
export interface TerminationEvidence {
  driver: Pick<Driver, 'id' | 'name' | 'carPlate' | 'rentalCycle' | 'rentalRate' | 'contractStartDate'>;
  reportDate: string;
  windowStart: string;
  snapshotDate: string;
  weeks: PaymentPeriod[];
  billingCycles: PaymentPeriod[];
  fullWeeks: number | null;
  partialWeeks: number | null;
  zeroWeeks: number | null;
  failureWeeks: number | null;
  rentalWeeks: number | null;
  underpaidCycles: number;
  rentalDue: number;
  cashReceived: number;
  serviceCredits: number;
  shortfall: number;
  cashCoverage: number | null;
  currentOutstanding: number;
  previousOutstanding: number;
  outstandingMovement: number;
  movementDirection: 'increased' | 'decreased' | 'approximately stable';
  arrearsWeeks: number | null;
  lastCashPayment: { date: string; amount: number } | null;
  daysSinceLastCash: number | null;
  lastMeaningfulPayment: { date: string; amount: number } | null;
  daysSinceLastMeaningful: number | null;
  meaningfulThreshold: number;
  averageDaysLate: number | null;
  cashAppliedToOldInvoices: number;
  oldestUnpaidInvoice: string | null;
  oldestUnpaidDays: number;
  recommended: boolean;
  exclusion: 'INACTIVE' | 'DATA_EXCEPTION' | 'INSUFFICIENT_OBSERVATION' | 'RECOVERING_OR_CURRENTLY_COVERED' | 'INSUFFICIENT_COMBINED_EVIDENCE' | null;
  dataIssues: string[];
  reasons: string[];
}

/** Read-only reconstruction. Integer cents, KL calendar dates, current app accrual/FIFO rules.
 * Lifetime records are used only to establish balances and allocations; recommendation evidence
 * is bounded to the latest 56 days. Never uses stored behavioural labels or personal attributes.
 */
export function analyseTerminationEvidence(driver: Driver, reportDate: string): TerminationEvidence {
  const end = day(reportDate);
  if (!Number.isFinite(end)) throw new Error('Invalid report date');
  const start = end - 55, previousDate = start - 1, commenced = day(driver.contractStartDate);
  const monthly = driver.rentalCycle === 'MONTHLY', rate = cents(driver.rentalRate);
  const dataIssues: string[] = [];
  if (!Number.isFinite(commenced) || !Number.isFinite(rate) || rate <= 0 || !['WEEKLY', 'MONTHLY'].includes(driver.rentalCycle)) dataIssues.push('Invalid commencement date, rental amount or cycle.');
  if (!Number.isInteger(driver.contractDuration) || driver.contractDuration <= 0) dataIssues.push('Invalid recorded contract duration.');
  const contractEnd = driver.contractEndDate ? day(driver.contractEndDate) : Infinity;
  if (Number.isNaN(contractEnd) || contractEnd <= commenced) dataIssues.push('Invalid contract end date.');
  else if (contractEnd <= end && !driver.isDelisted) dataIssues.push('Account is marked active but its contract has already ended; verify the current agreement.');
  const ids = new Set<string>();
  const payments = (driver.paymentHistory || []).map(p => {
    const date = day(p.date), cash = cents(p.amount), claim = cents(p.serviceClaim ?? 0);
    if (ids.has(p.id)) dataIssues.push('Duplicate payment IDs require verification.');
    ids.add(p.id);
    if (!Number.isFinite(date) || !Number.isFinite(cash) || !Number.isFinite(claim) || cash < 0 || claim < 0) dataIssues.push('Invalid or negative payment/credit requires ledger verification.');
    return { id: p.id, date, cash, claim };
  }).filter(p => Number.isFinite(p.date) && Number.isFinite(p.cash) && Number.isFinite(p.claim) && p.cash >= 0 && p.claim >= 0 && p.date <= end)
    .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
  const dueAt = (index: number) => {
    if (!monthly) return commenced + index * 7;
    const d = new Date(commenced * DAY);
    d.setUTCMonth(d.getUTCMonth() + index); // Same anchored month rollover as generateDriverInvoices.
    return d.getTime() / DAY;
  };
  const invoices: { date: number; index: number; remaining: number }[] = [];
  if (Number.isFinite(commenced) && Number.isFinite(rate) && rate > 0) {
    for (let i = 0; i < 2000; i++) {
      const date = dueAt(i);
      if (date > end || date >= contractEnd) break;
      invoices.push({ date, index: i, remaining: rate });
      if (i === 1999) dataIssues.push('Contract history exceeds the supported reconstruction range.');
    }
  }
  if (invoices.some(i => i.index >= driver.contractDuration)) dataIssues.push('App accrual extends beyond recorded contract duration; extension must be verified before recommendation.');
  const rentAt = (date: number) => invoices.filter(i => i.date <= date).length * (Number.isFinite(rate) ? rate : 0);
  const balanceAt = (date: number) => Math.max(0, rentAt(date) - sum(payments.filter(p => p.date <= date), p => p.cash + p.claim));
  const period = (a: number, b: number, due: number): PaymentPeriod => {
    const p = payments.filter(p => p.date >= a && p.date <= b);
    const cash = sum(p, p => p.cash), claims = sum(p, p => p.claim);
    return { start: iso(a), end: iso(b), due: money(due), cash: money(cash), claims: money(claims),
      result: due === 0 ? 'NO_RENT_DUE' : cash === 0 ? 'ZERO' : cash < due ? 'PARTIAL' : 'FULL', completed: b < end };
  };
  const weeks: PaymentPeriod[] = monthly ? [] : Array.from({ length: 8 }, (_, k) => {
    const a = start + k * 7, b = a + 6;
    return period(a, b, invoices.filter(i => i.date >= a && i.date <= b).length * (Number.isFinite(rate) ? rate : 0));
  });
  const billingCycles: PaymentPeriod[] = monthly ? invoices.filter(i => i.date >= start).map(i => {
    const nextDue = dueAt(i.index + 1);
    return period(i.date, Math.min(end, nextDue - 1, contractEnd - 1), rate);
  }) : [];
  const windowPayments = payments.filter(p => p.date >= start);
  const cash = sum(windowPayments, p => p.cash), claims = sum(windowPayments, p => p.claim);
  const due = invoices.filter(i => i.date >= start).length * (Number.isFinite(rate) ? rate : 0);
  const current = balanceAt(end), previous = balanceAt(previousDate), movement = current - previous;
  const stableTolerance = Number.isFinite(rate) ? Math.max(100, rate * 0.02) : 100;
  const cashDays = new Map<number, number>();
  for (const p of payments) if (p.cash > 0) cashDays.set(p.date, (cashDays.get(p.date) || 0) + p.cash);
  const daily = [...cashDays].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date - b.date);
  const meaningfulThreshold = Number.isFinite(rate) ? Math.ceil(monthly ? rate * 12 / 52 : rate) : 0;
  const last = daily.at(-1), meaningful = daily.filter(d => d.amount >= meaningfulThreshold).at(-1);
  let cashAllocated = 0, weightedDays = 0, cashToOld = 0, invoiceIndex = 0;
  for (const p of payments) for (const component of ['cash', 'claim'] as const) {
    let remaining = p[component];
    while (remaining > 0 && invoiceIndex < invoices.length) {
      const invoice = invoices[invoiceIndex];
      const allocated = Math.min(invoice.remaining, remaining);
      remaining -= allocated;
      invoice.remaining -= allocated;
      if (component === 'cash' && p.date >= start) {
        const late = Math.max(0, p.date - invoice.date);
        cashAllocated += allocated;
        weightedDays += allocated * late;
        if (late >= (monthly ? 30 : 21)) cashToOld += allocated;
      }
      if (invoice.remaining === 0) invoiceIndex++;
    }
  }
  const oldest = invoices.find(i => i.remaining > 0);
  const completedWeeks = weeks.filter(w => w.completed && w.due > 0);
  const failed = (w: PaymentPeriod) => w.result === 'ZERO' || w.result === 'PARTIAL';
  const failedCompleted = completedWeeks.filter(failed).length;
  // Open monthly cycles need at least 14 days of exposure; at least one full cycle is required below.
  const matureCycles = billingCycles.filter(c => end - day(c.start) >= 14);
  const matureFailed = matureCycles.filter(failed).length;
  const coverage = due > 0 ? cash / due : null;
  const recentStart = end - 27;
  const recentDue = invoices.filter(i => i.date >= recentStart).length * rate;
  const recentCash = sum(payments.filter(p => p.date >= recentStart), p => p.cash);
  const recentWeeks = weeks.slice(4).filter(w => w.due > 0);
  const recentConsistent = monthly
    ? billingCycles.some(c => c.result === 'FULL' && day(c.start) >= recentStart)
    : recentWeeks.length >= 3 && recentWeeks.filter(w => w.result === 'FULL').length / recentWeeks.length >= 0.75;
  const recovering = (coverage !== null && coverage >= 0.98) ||
    (recentDue > 0 && recentCash >= recentDue && current < balanceAt(recentStart - 1) - stableTolerance && recentConsistent);
  const noCashDays = last ? end - last.date : Math.max(0, end - commenced);
  const oldestDays = oldest ? end - oldest.date : 0;
  const averageLate = cashAllocated ? weightedDays / cashAllocated : null;
  const longGap = noCashDays >= (monthly ? 30 : 21);
  const oldDebt = oldestDays >= (monthly ? 30 : 21);
  const latePayments = averageLate !== null && averageLate >= (monthly ? 30 : 14);
  const largeArrears = current >= rate * (monthly ? 1 : 2);
  const materiallyIncreasing = movement >= Math.max(100, rate * 0.5);
  const stableOrIncreasing = movement >= -stableTolerance;
  const repeated = monthly ? matureFailed >= 2 : failedCompleted >= Math.max(3, Math.ceil(completedWeeks.length / 2));
  const veryFrequent = monthly ? matureFailed >= 2 : failedCompleted >= Math.max(4, Math.ceil(completedWeeks.length * 0.75));
  const observedEnough = end - commenced >= 28 && (monthly
    ? matureCycles.length >= 2 && billingCycles.some(c => c.completed)
    : completedWeeks.length >= 4);
  // Conjunctive evidence paths, never a weighted score or a single high-balance trigger.
  const lowCashDeterioration = repeated && coverage !== null && coverage < 0.7 &&
    (materiallyIncreasing || (stableOrIncreasing && largeArrears && longGap)) &&
    (longGap || oldDebt || latePayments || largeArrears);
  const sustainedUnderpayment = veryFrequent && coverage !== null && coverage < 0.9 &&
    materiallyIncreasing && largeArrears && (oldDebt || latePayments || longGap);
  let exclusion: TerminationEvidence['exclusion'] = null;
  if (driver.isDelisted) exclusion = 'INACTIVE';
  else if (dataIssues.length) exclusion = 'DATA_EXCEPTION';
  else if (!observedEnough || due <= 0) exclusion = 'INSUFFICIENT_OBSERVATION';
  else if (recovering) exclusion = 'RECOVERING_OR_CURRENTLY_COVERED';
  else if (current <= 0 || !(lowCashDeterioration || sustainedUnderpayment)) exclusion = 'INSUFFICIENT_COMBINED_EVIDENCE';
  const reasons: string[] = [];
  if (exclusion === null) {
    reasons.push(monthly ? 'Repeated underpayment of observed billing cycles' : 'Repeated failure in completed rental weeks');
    reasons.push(coverage! < 0.7 ? 'Less than 70% of rental due collected in cash' : 'Sustained cash underpayment across the observation period');
    if (materiallyIncreasing) reasons.push('Outstanding materially increased');
    if (longGap) reasons.push('Extended period without cash payment');
    if (oldDebt) reasons.push('Old unpaid rental invoices remain');
    if (latePayments) reasons.push('Recent cash was materially late against reconstructed invoices');
    if (largeArrears) reasons.push('Outstanding spans multiple weekly rentals or a monthly rental');
  }
  return {
    driver: { id: driver.id, name: driver.name, carPlate: driver.carPlate, rentalCycle: driver.rentalCycle, rentalRate: driver.rentalRate, contractStartDate: driver.contractStartDate },
    reportDate, windowStart: iso(start), snapshotDate: iso(previousDate), weeks, billingCycles,
    fullWeeks: monthly ? null : weeks.filter(w => w.result === 'FULL').length,
    partialWeeks: monthly ? null : weeks.filter(w => w.result === 'PARTIAL').length,
    zeroWeeks: monthly ? null : weeks.filter(w => w.result === 'ZERO').length,
    failureWeeks: monthly ? null : weeks.filter(failed).length,
    rentalWeeks: monthly ? null : weeks.filter(w => w.due > 0).length,
    underpaidCycles: billingCycles.filter(failed).length,
    rentalDue: money(due), cashReceived: money(cash), serviceCredits: money(claims), shortfall: money(Math.max(0, due - cash)), cashCoverage: coverage,
    currentOutstanding: money(current), previousOutstanding: money(previous), outstandingMovement: money(movement),
    movementDirection: Math.abs(movement) <= stableTolerance ? 'approximately stable' : movement > 0 ? 'increased' : 'decreased',
    arrearsWeeks: monthly || rate <= 0 ? null : current / rate,
    lastCashPayment: last ? { date: iso(last.date), amount: money(last.amount) } : null,
    daysSinceLastCash: last ? end - last.date : null,
    lastMeaningfulPayment: meaningful ? { date: iso(meaningful.date), amount: money(meaningful.amount) } : null,
    daysSinceLastMeaningful: meaningful ? end - meaningful.date : null, meaningfulThreshold: money(meaningfulThreshold),
    averageDaysLate: averageLate, cashAppliedToOldInvoices: money(cashToOld),
    oldestUnpaidInvoice: oldest ? iso(oldest.date) : null, oldestUnpaidDays: oldestDays,
    recommended: exclusion === null, exclusion, dataIssues: [...new Set(dataIssues)], reasons,
  };
}

/** Lexicographic ordering of visible facts, without producing a composite score. */
export function buildTerminationReport(drivers: Driver[], reportDate = getReportDate()) {
  const analyses = drivers.filter(d => !d.isDelisted).map(d => analyseTerminationEvidence(d, reportDate));
  const failureRate = (r: TerminationEvidence) => r.driver.rentalCycle === 'MONTHLY'
    ? r.underpaidCycles / Math.max(1, r.billingCycles.length) : (r.failureWeeks || 0) / Math.max(1, r.rentalWeeks || 0);
  const recommendations = analyses.filter(r => r.recommended).sort((a, b) =>
    failureRate(b) - failureRate(a) || b.shortfall - a.shortfall || b.outstandingMovement - a.outstandingMovement ||
    (b.daysSinceLastCash ?? day(reportDate) - day(b.driver.contractStartDate)) - (a.daysSinceLastCash ?? day(reportDate) - day(a.driver.contractStartDate)) ||
    b.oldestUnpaidDays - a.oldestUnpaidDays || b.currentOutstanding - a.currentOutstanding || a.driver.id.localeCompare(b.driver.id));
  return { reportDate, windowStart: iso(day(reportDate) - 55), recommendations, analyses };
}
