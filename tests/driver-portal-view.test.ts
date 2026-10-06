import test from 'node:test';
import assert from 'node:assert/strict';
import type { Driver } from '../types.ts';
import { driverPortalView } from '../services/driverPortal.ts';

const on = (iso: string) => new Date(`${iso}T12:00:00`);
// Weekly RM100 rent from Saturday 1 Aug 2026, 10-week contract, no end date.
const driver = (overrides: Partial<Driver> = {}): Driver => ({
  id: 'driver-1', nric: '', name: 'Fixture Driver', carPlate: 'XAA1001',
  contractStartDate: '2026-08-01', rentalCycle: 'WEEKLY', contractDuration: 10, rentalRate: 100,
  totalAmountPaid: 0, paymentHistory: [], category: 'SEWABELI', ...overrides,
});
const paid = (date: string, amount: number, serviceClaim = 0) => ({ id: `p-${date}-${amount}`, date, amount, serviceClaim });

test('a driver who owes nothing is up to date and sees the next rent and date', () => {
  const view = driverPortalView(driver({ paymentHistory: [paid('2026-08-01', 100), paid('2026-08-08', 100)] }), on('2026-08-10'));
  assert.equal(view.tone, 'good');
  assert.equal(view.title, "You're up to date");
  assert.match(view.message, /RM\s?100\.00 is due on 15 Aug 2026/);
  assert.equal(view.milestone, null);
});

test('a driver a little behind gets a friendly catch-up card and the amount that clears them', () => {
  const view = driverPortalView(driver({ paymentHistory: [paid('2026-08-01', 100), paid('2026-08-08', 40)] }), on('2026-08-10'));
  assert.equal(view.tone, 'warning');
  assert.equal(view.title, 'Rent to catch up');
  assert.doesNotMatch(`${view.title} ${view.message}`, /urgent|keep using the car|weeks of rent/i);
  assert.match(view.milestone ?? '', /Pay RM\s?60\.00 and you're fully up to date/);
});

test('a driver 3+ weeks behind sees no threat, a plan offer and one manageable next step, not full settlement', () => {
  // Five rents due by 29 Aug, RM100 paid: RM400 owed, 4 weeks.
  const view = driverPortalView(driver({ paymentHistory: [paid('2026-08-01', 100)] }), on('2026-08-30'));
  assert.equal(view.tone, 'warning');
  assert.equal(view.title, "Let's catch up");
  assert.match(view.message, /RM\s?400\.00/);
  assert.match(view.message, /payment plan/i);
  assert.doesNotMatch(`${view.title} ${view.message}`, /urgent|keep using the car|weeks of rent/i);
  assert.match(view.milestone ?? '', /Next step: pay RM\s?100\.00 to bring it down to RM\s?300\.00/);
});

test('the next step takes the balance down to the next whole rent', () => {
  // RM350 owed at RM100 a week: RM50 brings it to RM300.
  const view = driverPortalView(driver({ paymentHistory: [paid('2026-08-01', 100), paid('2026-08-08', 50)] }), on('2026-08-30'));
  assert.match(view.milestone ?? '', /pay RM\s?50\.00 to bring it down to RM\s?300\.00/);
});

test('the latest payment is thanked, with same-day transfers added together', () => {
  const view = driverPortalView(driver({ paymentHistory: [paid('2026-08-08', 30), paid('2026-08-01', 100), paid('2026-08-08', 70)] }), on('2026-08-10'));
  assert.match(view.thanks ?? '', /^Last payment RM\s?100\.00 on 08 Aug 2026\. Thank you!$/);
});

test('a service claim alone is not thanked as a payment; no payments means no thank-you line', () => {
  assert.equal(driverPortalView(driver(), on('2026-08-10')).thanks, null);
  const view = driverPortalView(driver({ paymentHistory: [paid('2026-08-01', 100), paid('2026-08-09', 0, 80)] }), on('2026-08-10'));
  assert.match(view.thanks ?? '', /01 Aug 2026/);
});

test('the contract count never reads past the contract length; rent past it is explained', () => {
  const short = driver({ contractDuration: 3 });
  const during = driverPortalView(short, on('2026-08-10'));
  assert.equal(during.progress?.label, 'Week 2 of 3');
  assert.equal(during.progress?.note, null);
  const after = driverPortalView(short, on('2026-09-30'));
  assert.equal(after.progress?.label, 'Week 3 of 3');
  assert.equal(after.progress?.percent, 100);
  assert.match(after.progress?.note ?? '', /rent continues/i);
});

test('monthly drivers read months; delisted drivers get no progress bar and a calm settlement card', () => {
  const monthly = driverPortalView(driver({ rentalCycle: 'MONTHLY', contractDuration: 12, rentalRate: 1000, paymentHistory: [paid('2026-08-01', 1000)] }), on('2026-08-10'));
  assert.equal(monthly.progress?.label, 'Month 1 of 12');
  const closedOwing = driverPortalView(driver({ isDelisted: true, delistDate: '2026-08-20' }), on('2026-08-30'));
  assert.equal(closedOwing.progress, null);
  assert.equal(closedOwing.title, 'Final settlement');
  assert.doesNotMatch(closedOwing.message, /urgent/i);
  const closed = driverPortalView(driver({ isDelisted: true, delistDate: '2026-08-02', paymentHistory: [paid('2026-08-01', 100)] }), on('2026-08-30'));
  assert.equal(closed.title, 'Account closed');
});

test('the contract card lists what a driver looks up: car, type, rent and pay day, start, and end or length', () => {
  const rows = driverPortalView(driver(), on('2026-08-10')).contract;
  const value = (label: string) => rows.find(row => row.label === label)?.value;
  assert.equal(value('Car'), 'XAA1001');
  assert.equal(value('Type'), 'Rent-to-own (Sewa Beli)');
  assert.match(value('Rent') ?? '', /^RM\s?100\.00 every Saturday$/);
  assert.equal(value('Started'), '01 Aug 2026');
  assert.equal(value('Length'), '10 weeks');
  assert.equal(value('Ends'), undefined);

  const monthly = driverPortalView(driver({ category: 'SEWA_BIASA', rentalCycle: 'MONTHLY', rentalRate: 1000, contractDuration: 12,
    contractStartDate: '2026-08-15', contractEndDate: '2027-08-14' }), on('2026-08-20')).contract;
  assert.equal(monthly.find(row => row.label === 'Type')?.value, 'Rental (Sewa Biasa)');
  assert.match(monthly.find(row => row.label === 'Rent')?.value ?? '', /on the 15th of each month$/);
  assert.equal(monthly.find(row => row.label === 'Ends')?.value, '14 Aug 2027');
});

test('upcoming due dates show the next three rents after today, and stop at the end of the contract', () => {
  const upcoming = driverPortalView(driver(), on('2026-08-10')).upcoming;
  assert.deepEqual(upcoming.map(row => row.date), ['15 Aug 2026', '22 Aug 2026', '29 Aug 2026']);
  assert.match(upcoming[0].amount, /RM\s?100\.00/);
  const ending = driverPortalView(driver({ contractEndDate: '2026-08-20' }), on('2026-08-10')).upcoming;
  assert.deepEqual(ending.map(row => row.date), ['15 Aug 2026']);
  assert.deepEqual(driverPortalView(driver({ isDelisted: true, delistDate: '2026-08-09' }), on('2026-08-10')).upcoming, []);
});

test('rent already paid in advance is not listed as coming up, and a part-paid week shows what is left', () => {
  const ahead = driverPortalView(driver({ paymentHistory: [paid('2026-08-01', 100), paid('2026-08-08', 200)] }), on('2026-08-10'));
  assert.deepEqual(ahead.upcoming.map(row => row.date), ['22 Aug 2026', '29 Aug 2026', '05 Sept 2026']);
  const part = driverPortalView(driver({ paymentHistory: [paid('2026-08-01', 100), paid('2026-08-08', 140)] }), on('2026-08-10'));
  assert.equal(part.upcoming[0].date, '15 Aug 2026');
  assert.match(part.upcoming[0].amount, /RM\s?60\.00/);
});

test('a payment dated after today (a typing slip) is not thanked yet', () => {
  const view = driverPortalView(driver({ paymentHistory: [paid('2026-08-01', 100), paid('2027-01-01', 100)] }), on('2026-08-10'));
  assert.match(view.thanks ?? '', /01 Aug 2026/);
});
