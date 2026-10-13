import type { Insurance, InsuranceResponsibility } from '../../types/finance.ts';

export function normalizeInsuranceResponsibility(value: unknown): InsuranceResponsibility | null {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  return normalized === 'ECA_PAID' || normalized === 'OWNER_PAID' ? normalized : null;
}

export const ownerPremiumReview = 'Vehicle is marked Owner Paid but an insurance premium has been entered. Please review.';
export type InsuranceStatus = 'ECA Paid' | 'Future ECA Renewal Responsibility' | 'Owner Paid / No ECA Cost' | 'Needs Review';
export function validInsuranceDate(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function insuranceProblems(policy: Insurance): string[] {
  const errors: string[] = [];
  if (!policy.plate_key) errors.push('Select a vehicle.');
  if (!Number.isFinite(policy.premium) || policy.premium < 0 || Math.abs(policy.premium * 100 - Math.round(policy.premium * 100)) > 1e-7) errors.push('Premium (RM) must be a non-negative amount with at most two decimal places.');
  if (policy.responsibility === 'OWNER_PAID') {
    errors.push(...validateOwnerPaid(policy));
  } else if (policy.responsibility === 'ECA_PAID') {
    errors.push(...validateEcaPaid(policy));
  } else {
    errors.push('Select ECA PAID or OWNER PAID responsibility.');
  }
  return errors;
}
function optionalCoverageProblems(policy: Insurance): string[] {
  const errors: string[] = [];
  if ((policy.coverage_start && !validInsuranceDate(policy.coverage_start)) || (policy.coverage_end && !validInsuranceDate(policy.coverage_end))) errors.push('Enter valid coverage dates.');
  if (policy.coverage_start && policy.coverage_end && policy.coverage_end < policy.coverage_start) errors.push('Coverage End must be on or after Coverage Start.');
  return errors;
}
function validateOwnerPaid(policy: Insurance): string[] {
  return optionalCoverageProblems(policy);
}
function validateEcaPaid(policy: Insurance): string[] {
  const errors = optionalCoverageProblems(policy);
  if (policy.premium > 0 && (!validInsuranceDate(policy.coverage_start) || !validInsuranceDate(policy.coverage_end))) errors.push('Positive ECA-paid premiums require Coverage Start and Coverage End.');
  return errors;
}
export function insuranceStatus(policy: Insurance): InsuranceStatus {
  if (insuranceProblems(policy).length || (policy.responsibility === 'OWNER_PAID' && policy.premium > 0)) return 'Needs Review';
  if (policy.responsibility === 'OWNER_PAID') return 'Owner Paid / No ECA Cost';
  return policy.premium === 0 ? 'Future ECA Renewal Responsibility' : 'ECA Paid';
}
export function insuranceCashOutflow(policy: Insurance, calculationVersion = 2): {date: string | null; amount: number} {
  if (calculationVersion === 1) return policy.responsibility !== 'OWNER_PAID' && policy.premium > 0 && validInsuranceDate(policy.payment_date) ? {date:policy.payment_date,amount:policy.premium} : {date:null,amount:0};
  return insuranceStatus(policy) === 'ECA Paid' ? {date: policy.coverage_start, amount: policy.premium} : {date: null, amount: 0};
}
const charged = (policy: Insurance) => !policy.cancelled_at && insuranceStatus(policy) === 'ECA Paid';
const cents = (value: number) => Math.round(value * 100) / 100;
/** The Insurance header: ECA-paid premiums whose cover includes today, and every one on record (all years, expired too). */
export function insuranceHeaderTotals(policies: Insurance[], today: string): {active: number; allYears: number} {
  const live = policies.filter(charged);
  return {
    active: cents(live.filter((policy) => policy.coverage_start! <= today && today <= policy.coverage_end!).reduce((sum, policy) => sum + policy.premium, 0)),
    allYears: cents(live.reduce((sum, policy) => sum + policy.premium, 0)),
  };
}
/** Charged policies for the same car whose cover dates share at least one day: each would be charged for those days. */
export function overlappingInsurance(policies: Insurance[]): Map<Insurance, Insurance[]> {
  const plate = (policy: Insurance) => (policy.plate_key ?? '').toUpperCase().replace(/\s/g, '');
  const live = policies.filter(charged);
  const result = new Map<Insurance, Insurance[]>();
  for (const policy of live) {
    const others = live.filter((other) => other !== policy && plate(other) === plate(policy) && other.coverage_start! <= policy.coverage_end! && policy.coverage_start! <= other.coverage_end!);
    if (others.length) result.set(policy, others);
  }
  return result;
}
