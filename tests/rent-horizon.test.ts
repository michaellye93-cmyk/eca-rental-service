import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDriverMetrics, generateDriverInvoices, rentDueAndPaid } from '../utils.ts';
import type { Driver, PaymentTransaction } from '../types.ts';

const on = (iso: string) => new Date(`${iso}T00:00:00`);
const pay = (id: string, date: string, amount: number, serviceClaim = 0): PaymentTransaction => ({ id, date, amount, serviceClaim });
// Weekly rent due on Thursdays from 6 Aug 2026. The recorded length (4 weeks) ended in August and there is no end date,
// so under the agreed rule rent keeps falling due every Thursday: 1, 8, 15, 22 and 29 Oct.
const pastLength = (overrides: Partial<Driver> = {}): Driver => ({
  id: 'w1', nric: '', name: 'Fixture Driver', carPlate: 'XAA1001',
  contractStartDate: '2026-08-06', rentalCycle: 'WEEKLY', contractDuration: 4, rentalRate: 100,
  totalAmountPaid: 0, paymentHistory: [], ...overrides,
});
const october = [on('2026-10-01'), on('2026-10-31')] as const;
const fifthOctober = on('2026-10-05');

test('a period target counts rent due later in the period from a driver past the recorded contract length', () => {
  assert.deepEqual(rentDueAndPaid([pastLength()], ...october, fifthOctober), { due: 500, paid: 0 });
});

test('a payment dated after today but inside the period does not count as paid yet', () => {
  const d = pastLength({ paymentHistory: [pay('p1', '2026-08-06', 800), pay('p2', '2026-10-20', 100)] });
  // 800 covers 6 Aug - 24 Sep; the 20 Oct entry is ignored until that day, so none of October is paid.
  assert.deepEqual(rentDueAndPaid([d], ...october, fifthOctober), { due: 500, paid: 0 });
});

test('money already paid in advance counts against the rent due later in the period', () => {
  const d = pastLength({ paymentHistory: [pay('p1', '2026-08-06', 900), pay('p2', '2026-10-02', 200)] });
  // 900 covers up to 1 Oct; the 200 paid on 2 Oct covers 8 and 15 Oct.
  assert.deepEqual(rentDueAndPaid([d], ...october, fifthOctober), { due: 500, paid: 300 });
});

test('the balance still counts only rent due up to today', () => {
  const d = pastLength({ paymentHistory: [pay('p1', '2026-08-06', 800)] });
  // Nine cycles are due by 5 Oct (6 Aug - 1 Oct); 800 paid leaves 100 outstanding, whatever falls due later.
  assert.equal(calculateDriverMetrics(d, fifthOctober).principalOutstanding, 100);
});

test('the invoice list reaches a horizon and marks unpaid cycles after today as FUTURE', () => {
  const d = pastLength();
  const withHorizon = generateDriverInvoices(d, fifthOctober, on('2026-10-20'));
  assert.deepEqual(withHorizon.slice(-2).map(inv => [inv.dueDate, inv.status]), [['2026-10-08', 'FUTURE'], ['2026-10-15', 'FUTURE']]);
  // Without a horizon the list stops at today for a contract past its recorded length, as before.
  assert.equal(generateDriverInvoices(d, fifthOctober).at(-1)?.dueDate, '2026-10-01');
});

