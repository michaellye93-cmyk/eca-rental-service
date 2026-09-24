import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatDate, kualaLumpurToday, previousMonth } from '../utils.ts';

// Behave like a computer that is not on Malaysia time: the helpers must still follow Kuala Lumpur's calendar.
process.env.TZ = 'America/New_York';

test('kualaLumpurToday follows the Kuala Lumpur calendar whatever the computer time zone', () => {
  // 17:00 in Kuala Lumpur, still 24 September there (converting the time zone twice would give the 25th).
  assert.equal(kualaLumpurToday(new Date('2026-09-24T09:00:00Z')), '2026-09-24');
  // 23:59 and 00:00 in Kuala Lumpur either side of midnight.
  assert.equal(kualaLumpurToday(new Date('2026-09-24T15:59:00Z')), '2026-09-24');
  assert.equal(kualaLumpurToday(new Date('2026-09-24T16:00:00Z')), '2026-09-25');
});

test('previousMonth gives the calendar month before a date, across year ends', () => {
  assert.equal(previousMonth('2026-09-24'), '2026-08');
  assert.equal(previousMonth('2026-12-31'), '2026-11');
  assert.equal(previousMonth('2026-01-05'), '2025-12');
});

test('formatDate shows one day-month-year format and a fallback for missing or invalid dates', () => {
  assert.match(formatDate('2026-09-04'), /^04 Sept? 2026$/);
  assert.match(formatDate(new Date(2026, 8, 4)), /^04 Sept? 2026$/);
  assert.equal(formatDate(''), '—');
  assert.equal(formatDate(undefined, 'N/A'), 'N/A');
  assert.equal(formatDate('not a date'), '—');
});

test('formatCurrency shows Malaysian ringgit with two decimals', () => {
  assert.match(formatCurrency(1234.5), /^RM\s1,234\.50$/);
  assert.match(formatCurrency(0), /^RM\s0\.00$/);
});
