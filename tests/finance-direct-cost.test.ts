import test from 'node:test';
import assert from 'node:assert/strict';
import { directCostBreakdown } from '../services/finance/directCost.ts';

const totals = {
  cash: 1000, revenue: 1200, service_claim: 200, commission: 30, recurring: 400,
  workshop: 150.25, workshop_unallocated: 50, insurance: 125.44, direct_costs: 55,
  contribution: 239.31, margin: null,
};

test('direct cost splits into monthly vehicle cost, service and maintenance, insurance and other', () => {
  assert.deepEqual(directCostBreakdown(totals), {
    monthly_vehicle: 400,
    service_maintenance: 350.25, // driver service claims + workshop billing
    insurance: 125.44,
    other: 85, // other vehicle costs + commission
    total: 960.69,
  });
});

test('the four parts always add up to the direct cost total, and revenue minus it is the contribution', () => {
  const parts = directCostBreakdown(totals);
  assert.equal(Math.round((parts.monthly_vehicle + parts.service_maintenance + parts.insurance + parts.other) * 100) / 100, parts.total);
  assert.equal(Math.round((totals.revenue - parts.total) * 100) / 100, totals.contribution);
});
