import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isoDay, money, monthEnd, monthLong, monthStart, monthShort, MONTH_SHORT, percent, percent1, previousMonth, round2 } from '../services/fmt.ts';
import { formatCurrency } from '../utils.ts';

// Intl puts a no-break space between RM and the figure.

test('money is the RM figure every screen shows, two decimals, and a blank or minus-zero amount shows RM 0.00', () => {
  assert.equal(money(1234.5), 'RM\u00a01,234.50');
  assert.equal(money(-250), '-RM\u00a0250.00');
  assert.equal(money(0), 'RM\u00a00.00');
  assert.equal(money(-0), 'RM\u00a00.00');
  assert.equal(money(Number.NaN), 'RM\u00a00.00');
  assert.equal(money(undefined), 'RM\u00a00.00');
  assert.equal(money(null), 'RM\u00a00.00');
  for (const n of [0.5, 12, 999.995, 1500000, -37.1]) assert.equal(money(n), formatCurrency(n));
});

test('percent rounds to a whole number (Cash page, cash line, collection trend); percent1 keeps one decimal (Finance margins)', () => {
  assert.equal(percent(0.195), '20%');
  assert.equal(percent(0.854), '85%');
  assert.equal(percent(1), '100%');
  assert.equal(percent(0), '0%');
  assert.equal(percent1(0.195), '19.5%');
  assert.equal(percent1(0.2), '20.0%');
  assert.equal(percent1(-0.0512), '-5.1%');
  assert.equal(percent1(0), '0.0%');
});

test('month labels: long "September 2026" (Finance title, month close, Cash bank check) and short "Sep 2026" (cash outlook, trend)', () => {
  const long = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  long.forEach((name, i) => {
    const month = `2026-${String(i + 1).padStart(2, '0')}`;
    assert.equal(monthLong(month), `${name} 2026`);
    assert.equal(monthLong(`${month}-01`), `${name} 2026`);
    // The screens used en-MY and en-GB toLocaleDateString; both print the same long label.
    for (const locale of ['en-MY', 'en-GB']) {
      assert.equal(monthLong(month), new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' }));
    }
  });
  assert.equal(monthShort('2026-09'), 'Sep 2026');
  assert.equal(monthShort('2026-09-01'), 'Sep 2026');
  assert.equal(monthShort('2027-01-15'), 'Jan 2027');
  assert.deepEqual(MONTH_SHORT, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
});

test('isoDay reads the local calendar day, not the UTC one', () => {
  assert.equal(isoDay(new Date(2026, 8, 1, 0, 30)), '2026-09-01');
  assert.equal(isoDay(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
  assert.equal(isoDay(new Date(2026, 1, 5)), '2026-02-05');
});

test('addDays moves a YYYY-MM-DD date across month and year ends', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-10-12', 0), '2026-10-12');
  assert.equal(addDays('2026-10-12T10:00:00', 30), '2026-11-11');
});

test('monthEnd gives the last day of the month as YYYY-MM-DD from YYYY-MM or YYYY-MM-DD', () => {
  assert.equal(monthEnd('2026-09'), '2026-09-30');
  assert.equal(monthEnd('2026-12-01'), '2026-12-31');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
  assert.equal(monthEnd('2026-02-15'), '2026-02-28');
});

test('monthStart gives the first day of the month as YYYY-MM-01 from YYYY-MM or YYYY-MM-DD', () => {
  assert.equal(monthStart('2026-09'), '2026-09-01');
  assert.equal(monthStart('2026-09-17'), '2026-09-01');
  assert.equal(monthStart('2026-12-01'), '2026-12-01');
});

test('previousMonth steps back one month, across the year end', () => {
  assert.equal(previousMonth('2026-09'), '2026-08');
  assert.equal(previousMonth('2026-01'), '2025-12');
  assert.equal(previousMonth('2026-10'), '2026-09');
  assert.equal(previousMonth('2026-09-15'), '2026-08');
});

test('round2 rounds to two decimals exactly as the old local helpers did', () => {
  assert.equal(round2(1.005), Math.round(1.005 * 100) / 100);
  assert.equal(round2(10.126), 10.13);
  assert.equal(round2(-3.335), Math.round(-3.335 * 100) / 100);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1500), 1500);
});
