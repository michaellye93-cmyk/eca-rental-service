import test from 'node:test';
import assert from 'node:assert/strict';
import { businessStatement } from '../services/finance/directCost.ts';
import type { FinanceTotals } from '../types/finance.ts';

const zero = (): FinanceTotals => ({ cash: 0, revenue: 0, service_claim: 0, commission: 0, recurring: 0, workshop: 0, workshop_unallocated: 0, insurance: 0, direct_costs: 0, contribution: 0, margin: null });
const row = (values: Partial<FinanceTotals>): FinanceTotals => {
  const totals = { ...zero(), ...values };
  totals.contribution = Math.round((totals.revenue - totals.recurring - totals.service_claim - totals.workshop - totals.insurance - totals.direct_costs - totals.commission) * 100) / 100;
  totals.margin = totals.revenue ? totals.contribution / totals.revenue : null;
  return totals;
};

const businesses = {
  'E-HAILING': row({ revenue: 5000, service_claim: 300, recurring: 2000, workshop: 200, insurance: 400 }),
  'DAILY RENTAL': row({ revenue: 1500, recurring: 600, insurance: 100, direct_costs: 50 }),
  'SMART DRIVE': row({ revenue: 800, commission: 80, recurring: 300 }),
  'SAMBUNG BAYAR': zero(),
  UNMATCHED: zero(),
};
const sum = (key: keyof FinanceTotals) => Object.values(businesses).reduce((total, value) => total + (value[key] as number), 0);
const totals = row({ revenue: sum('revenue'), service_claim: sum('service_claim'), recurring: sum('recurring'), workshop: sum('workshop'), insurance: sum('insurance'), direct_costs: sum('direct_costs'), commission: sum('commission') });

test('each business gets revenue less owner payout / loan, service, insurance and other, ending at its gross profit', () => {
  const statement = businessStatement(businesses, totals);
  const ehailing = statement.columns.find((column) => column.business === 'E-HAILING')!;
  assert.deepEqual(ehailing, {
    business: 'E-HAILING', label: 'E-HAILING', revenue: 5000,
    owner_payout_loan: 2000, service: 500, insurance: 400, other: 0,
    gross_profit: 2100, margin: 0.42,
  });
  const smart = statement.columns.find((column) => column.business === 'SMART DRIVE')!;
  assert.equal(smart.other, 80); // Smart Drive commission
  assert.equal(smart.gross_profit, 420);
});

test('gross profit equals the contribution already on the P&L, for every business and the total', () => {
  const statement = businessStatement(businesses, totals);
  for (const column of statement.columns) assert.equal(column.gross_profit, businesses[column.business as keyof typeof businesses].contribution);
  assert.equal(statement.total.gross_profit, totals.contribution);
  assert.equal(statement.total.revenue, totals.revenue);
});

test('businesses with nothing this month are left out, and unmatched cars show only when they carry money', () => {
  const quiet = businessStatement(businesses, totals);
  assert.deepEqual(quiet.columns.map((column) => column.business), ['E-HAILING', 'DAILY RENTAL', 'SMART DRIVE']);
  assert.equal(quiet.unmatched, false);

  const withUnmatched = { ...businesses, UNMATCHED: row({ insurance: 90 }) };
  const flagged = businessStatement(withUnmatched, totals);
  const unmatched = flagged.columns.at(-1)!;
  assert.equal(unmatched.business, 'UNMATCHED');
  assert.equal(unmatched.label, 'Unmatched cars');
  assert.equal(unmatched.gross_profit, -90);
  assert.equal(flagged.unmatched, true);
});
