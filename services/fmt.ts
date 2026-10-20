/**
 * The one home for how figures, percentages, month labels and calendar days are written. Screens import from here
 * instead of keeping their own copies, so the same number reads the same everywhere. No React, so tests load it.
 */
import { formatCurrency, previousMonth } from '../utils.ts';

/** formatCurrency is the raw RM format (minus zero prints "-RM 0.00"); previousMonth is YYYY-MM(-DD) → the month before as YYYY-MM. */
export { formatCurrency, previousMonth };

/** Ringgit with two decimals ("RM 1,234.50"). A blank, not-a-number or minus-zero amount shows "RM 0.00". */
export const money = (amount: number | null | undefined) => formatCurrency(Number(amount || 0));

/** A fraction as a whole percentage: 0.195 → "20%". */
export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** A fraction as a percentage with one decimal: 0.195 → "19.5%" (Finance margins). */
export const percent1 = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

/** Rounded to two decimals (sen), for money worked out in the browser. */
export const round2 = (value: number) => Math.round(value * 100) / 100;

export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const monthLabel = (names: readonly string[], month: string) => {
  const name = names[Number(month.slice(5, 7)) - 1];
  return name ? `${name} ${month.slice(0, 4)}` : 'Invalid Date';
};

/** "September 2026" from YYYY-MM or YYYY-MM-DD (the same text en-MY and en-GB dates print). */
export const monthLong = (month: string) => monthLabel(MONTH_LONG, month);

/** "Sep 2026" from YYYY-MM or YYYY-MM-DD (three letters; browsers' en-GB short form prints "Sept" instead). */
export const monthShort = (month: string) => monthLabel(MONTH_SHORT, month);

/** A Date's local calendar day as YYYY-MM-DD (never the UTC day). */
export const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const DAY = 86_400_000;
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};

/** A YYYY-MM-DD date moved by a number of days. */
export const addDays = (iso: string, days: number) => new Date((dayNumber(iso) + days) * DAY).toISOString().slice(0, 10);

/** The first day of the month as YYYY-MM-01, from YYYY-MM or YYYY-MM-DD. */
export const monthStart = (month: string) => `${month.slice(0, 7)}-01`;

/** The last day of the month as YYYY-MM-DD, from YYYY-MM or YYYY-MM-DD. */
export const monthEnd = (month: string) => {
  const [year, number] = month.slice(0, 7).split('-').map(Number);
  return `${month.slice(0, 7)}-${String(new Date(year, number, 0).getDate()).padStart(2, '0')}`;
};

const klParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });

/** An instant as a short Kuala Lumpur date and time, "21 Oct 2026, 3:05 pm"; null for a blank or unreadable value. */
export const klDateTime = (value: string | null | undefined): string | null => {
  const at = value ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const part = Object.fromEntries(klParts.formatToParts(at).map((p) => [p.type, p.value]));
  const hour = Number(part.hour) % 24;
  return `${Number(part.day)} ${MONTH_SHORT[Number(part.month) - 1]} ${part.year}, ${hour % 12 || 12}:${part.minute} ${hour < 12 ? 'am' : 'pm'}`;
};
