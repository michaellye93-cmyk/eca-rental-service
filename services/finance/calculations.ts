import type { BusinessUnit, FinanceInput, FinanceTotals, Insurance, QualityIssue, VehicleContribution } from '../../types/finance.ts';
import { insuranceStatus, ownerPremiumReview } from './insurance.ts';

const businessUnits: BusinessUnit[] = ['E-HAILING', 'DAILY RENTAL', 'SMART DRIVE', 'SAMBUNG BAYAR'];
const zeroTotals = (): FinanceTotals => ({ cash: 0, revenue: 0, service_claim: 0, commission: 0, recurring: 0, workshop: 0, workshop_unallocated: 0, insurance: 0, direct_costs: 0, contribution: 0, margin: null });
const cents = (value: number) => Math.round(value * 100) / 100;
const monthKey = (value: string) => /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : '';

export function normalizePlate(value: string | null): string {
  return (value ?? '').toUpperCase().replace(/\s/g, '');
}

function monthOverlaps(cost: { start_month: string; end_month: string | null }, month: string): boolean {
  const selected = monthKey(month); const start = monthKey(cost.start_month); const end = cost.end_month ? monthKey(cost.end_month) : null;
  return Boolean(selected && start && start <= selected && (!end || end >= selected));
}

function monthDays(month: string): number {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0)).getUTCDate();
}

function coveredDaysInMonth(insurance: Insurance, month: string): number {
  const [year, numericMonth] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, numericMonth - 1, 1));
  const last = new Date(Date.UTC(year, numericMonth - 1, monthDays(month)));
  const start = new Date(`${insurance.coverage_start}T00:00:00Z`);
  const end = new Date(`${insurance.coverage_end}T00:00:00Z`);
  const left = Math.max(first.getTime(), start.getTime());
  const right = Math.min(last.getTime(), end.getTime());
  return right < left ? 0 : Math.floor((right - left) / 86_400_000) + 1;
}

function coveredMonths(insurance: Insurance): string[] {
  const start = new Date(`${insurance.coverage_start}T00:00:00Z`);
  const end = new Date(`${insurance.coverage_end}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const final = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const result: string[] = [];
  while (cursor <= final) {
    result.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

export function allocateInsurance(insurance: Insurance, month: string, calculationVersion = 1): number {
  if (calculationVersion >= 2 && insuranceStatus(insurance) !== 'ECA Paid') return 0;
  if (insurance.responsibility === 'OWNER_PAID') return 0;
  month = monthKey(month);
  const months = coveredMonths(insurance);
  if (!months.includes(month)) return 0;
  const weights = months.map((candidate) => coveredDaysInMonth(insurance, candidate) / monthDays(candidate));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (!totalWeight) return 0;
  const index = months.indexOf(month);
  if (index === months.length - 1) {
    return cents(insurance.premium - months.slice(0, -1).reduce((sum, candidate) => sum + allocateInsurance(insurance, candidate, calculationVersion), 0));
  }
  return cents(insurance.premium * weights[index] / totalWeight);
}

function finalise(total: FinanceTotals): FinanceTotals {
  total.contribution = cents(total.revenue - total.commission - total.recurring - total.service_claim - total.workshop - total.insurance - total.direct_costs);
  total.margin = total.revenue === 0 ? null : total.contribution / total.revenue;
  for (const key of Object.keys(total) as Array<keyof FinanceTotals>) if (key !== 'margin' && typeof total[key] === 'number') total[key] = cents(total[key] as number) as never;
  return total;
}

export function calculateFinance(input: FinanceInput) {
  const issues: QualityIssue[] = [];
  const calculationVersion = input.calculation_version ?? 1;
  if (![1,2,3].includes(calculationVersion)) throw new Error('Unsupported Finance calculation version; preserve the original version when reading closed months.');
  for (const row of input.bank_rows ?? []) if (row.match_valid === false) issues.push({code:'BANK_MATCH_CHANGED',severity:'error',detail:'The Finance source of this bank match changed. Review the match again before closing.',source_id:`${row.import_id}:${row.source_row}`});
  for (const cost of input.recurring_costs) if (!cost.cancelled_at && /to\s*classify|unclassified/i.test(cost.cost_type)) issues.push({code:'UNCLASSIFIED_RECURRING_COST',severity:'warning',detail:'The source recurring cost label needs classification; its original amount and start month are preserved.',plate_key:cost.plate_key,source_id:cost.id});
  const vehicleByPlate = new Map<string, typeof input.vehicles[number]>();
  for (const vehicle of input.vehicles) {
    const key = normalizePlate(vehicle.plate_key);
    if (vehicleByPlate.has(key)) issues.push({ code: 'DUPLICATE_VEHICLE_MASTER', severity: 'error', detail: `Duplicate Finance vehicle master plate ${key}`, plate_key: key });
    else vehicleByPlate.set(key, vehicle);
  }
  const contributions = new Map<string, VehicleContribution>();
  const contributionFor = (plate: string | null, sourceId?: string | null): VehicleContribution => {
    const key = normalizePlate(plate);
    const master = vehicleByPlate.get(key);
    const reportKey = master ? key : 'UNMATCHED';
    if (!master && key) issues.push({ code: 'UNMATCHED_PLATE', severity: 'error', detail: `Plate ${key} has no Finance vehicle master`, plate_key: key, source_id: sourceId ?? null });
    if (!contributions.has(reportKey)) contributions.set(reportKey, { ...zeroTotals(), plate_key: reportKey, display_plate: master?.display_plate ?? 'Unmatched', business_unit: master?.business_unit ?? 'UNMATCHED' });
    return contributions.get(reportKey)!;
  };
  for (const vehicle of input.vehicles) if (!vehicle.deleted_at) contributionFor(vehicle.plate_key);
  const ids = new Set<string>();
  for (const payment of input.ehailing) {
    if (ids.has(payment.source_payment_id)) issues.push({ code: 'DUPLICATE_SOURCE_ID', severity: 'error', detail: 'Duplicate E-hailing source payment id', source_id: payment.source_payment_id });
    ids.add(payment.source_payment_id);
    if (!payment.driver_id || !payment.driver_name_snapshot?.trim()) issues.push({ code: 'MISSING_DRIVER', severity: 'error', detail: 'E-hailing payment has no complete driver snapshot', source_id: payment.source_payment_id });
    if (!normalizePlate(payment.plate_key)) issues.push({ code: 'MISSING_PLATE', severity: 'error', detail: 'E-hailing payment has no plate', source_id: payment.source_payment_id });
    issues.push({ code: 'HISTORICAL_ATTRIBUTION_POSSIBLE', severity: 'warning', detail: 'Historical plate assignment is based on an editable operational profile snapshot', source_id: payment.source_payment_id, plate_key: payment.plate_key });
    if (payment.attribution_changed) issues.push({ code: 'HISTORICAL_ATTRIBUTION_CHANGED', severity: 'warning', detail: 'Historical payment vehicle attribution has changed', source_id: payment.source_payment_id, plate_key: payment.plate_key });
    const vehicle = contributionFor(payment.plate_key, payment.source_payment_id);
    vehicle.cash += payment.cash_amount; vehicle.service_claim += payment.service_claim;
    vehicle.revenue += payment.cash_amount + payment.service_claim;
  }
  for (const row of input.smart_rows) {
    const vehicle = contributionFor(row.plate_key, row.reference);
    vehicle.revenue += row.gross_revenue; vehicle.commission += row.commission;
  }
  const nonVehicleIncome = new Map<BusinessUnit, number>();
  for (const income of input.other_income ?? []) {
    if (income.status !== 'CONFIRMED' || income.cancelled_at || monthKey(income.finance_month) !== monthKey(input.month.finance_month)) continue;
    if (income.plate_key) contributionFor(income.plate_key, income.id).revenue += income.amount;
    else nonVehicleIncome.set(income.business_unit, (nonVehicleIncome.get(income.business_unit) ?? 0) + income.amount);
  }
  const month = monthKey(input.month.finance_month);
  for (const cost of input.recurring_costs) if (!cost.cancelled_at && monthOverlaps(cost, month)) contributionFor(cost.plate_key).recurring += cost.monthly_amount;
  for (const policy of input.insurance.filter((entry) => !entry.cancelled_at)) {
    const allocation = allocateInsurance(policy, input.month.finance_month, calculationVersion);
    if (calculationVersion >= 2 && insuranceStatus(policy) === 'Needs Review') issues.push({code:'INSURANCE_NEEDS_REVIEW',severity:'warning',detail:policy.responsibility === 'OWNER_PAID' && policy.premium > 0 ? ownerPremiumReview : 'Review the insurance responsibility, premium and coverage details.',plate_key:policy.plate_key,source_id:policy.id});
    if (allocation !== 0 || !vehicleByPlate.get(normalizePlate(policy.plate_key))?.deleted_at) contributionFor(policy.plate_key).insurance += allocation;
  }
  let corporateOpex = 0;
  for (const expense of input.expenses.filter((entry) => !entry.cancelled_at && monthKey(entry.finance_month) === month)) {
    if (expense.payment_source === 'Corporate Opex') { corporateOpex += expense.amount; continue; }
    const vehicle = contributionFor(expense.plate_key, expense.reference);
    if (expense.payment_source === 'Workshop Billing') vehicle.workshop += expense.amount;
    else vehicle.direct_costs += expense.amount;
  }
  for (const vehicle of contributions.values()) {
    if (vehicle.business_unit !== 'UNMATCHED' && vehicle.revenue > 0 && !input.recurring_costs.some((cost) => !cost.cancelled_at && normalizePlate(cost.plate_key) === vehicle.plate_key && monthOverlaps(cost, month))) issues.push({ code: 'MISSING_COST_MASTER', severity: 'warning', detail: 'Vehicle has revenue but no applicable recurring cost master', plate_key: vehicle.plate_key });
    if (vehicle.business_unit !== 'UNMATCHED' && vehicle.revenue === 0 && (vehicle.recurring > 0 || vehicle.insurance > 0 || vehicle.workshop > 0 || vehicle.direct_costs > 0)) issues.push({ code: 'COST_WITHOUT_REVENUE', severity: 'warning', detail: 'Vehicle has costs but no revenue', plate_key: vehicle.plate_key });
    finalise(vehicle);
  }
  const businesses = Object.fromEntries([...businessUnits, 'UNMATCHED'].map((business) => [business, zeroTotals()])) as Record<BusinessUnit | 'UNMATCHED', FinanceTotals>;
  for (const vehicle of contributions.values()) { const target = businesses[vehicle.business_unit]; for (const key of Object.keys(zeroTotals()) as Array<keyof FinanceTotals>) if (key !== 'margin') (target[key] as number) += (vehicle[key] as number) || 0; }
  for (const [business, amount] of nonVehicleIncome) businesses[business].revenue += amount;
  let fleetWorkshopUnallocated = 0;
  for (const summary of input.workshop_summaries ?? []) {
    if (summary.cancelled_at || monthKey(summary.finance_month) !== month) continue;
    const remainder = Math.max(0, summary.unallocated_amount ?? summary.amount - (summary.allocated_amount ?? 0));
    if (summary.business_unit) {
      businesses[summary.business_unit].workshop += remainder;
      businesses[summary.business_unit].workshop_unallocated += remainder;
    } else fleetWorkshopUnallocated += remainder;
  }
  for (const business of Object.values(businesses)) finalise(business);
  const totals = zeroTotals();
  for (const business of Object.values(businesses)) for (const key of Object.keys(zeroTotals()) as Array<keyof FinanceTotals>) if (key !== 'margin') (totals[key] as number) += (business[key] as number) || 0;
  totals.workshop += fleetWorkshopUnallocated;
  totals.workshop_unallocated += fleetWorkshopUnallocated;
  finalise(totals);
  const sourceCash = cents(input.ehailing.reduce((sum, payment) => sum + payment.cash_amount, 0));
  const sourceClaims = cents(input.ehailing.reduce((sum, payment) => sum + payment.service_claim, 0));
  if (!input.month.refreshed_at || input.ehailing.some((payment) => !payment.refreshed_at)) issues.push({ code: 'MISSING_REFRESHED_AT', severity: 'warning', detail: 'Finance source refresh timestamp is missing' });
  if (input.month.source_count !== input.ehailing.length) issues.push({ code: 'SOURCE_COUNT_MISMATCH', severity: 'error', detail: 'Finance month source count does not match loaded E-hailing rows' });
  if (cents(input.month.total_cash) !== sourceCash) issues.push({ code: 'SOURCE_CASH_MISMATCH', severity: 'error', detail: 'Finance month cash control does not match loaded E-hailing rows' });
  if (cents(input.month.total_claim) !== sourceClaims) issues.push({ code: 'SOURCE_CLAIM_MISMATCH', severity: 'error', detail: 'Finance month service-claim control does not match loaded E-hailing rows' });
  if (!input.smart_import) issues.push({ code: 'MISSING_SMART_IMPORT', severity: 'warning', detail: 'No approved Smart Drive import is linked to this Finance month' });
  return { vehicles: [...contributions.values()], businesses, totals, corporate_opex: cents(corporateOpex), fleet_unallocated_workshop: cents(fleetWorkshopUnallocated), management_profit: cents(totals.contribution - corporateOpex), issues };
}

export const buildFinanceReport = calculateFinance;
