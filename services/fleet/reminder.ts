import { normalizePlate } from '../../utils.ts';
import { carStatuses, EXPIRY_LABELS, type Car, type ExpiryKind, type ExpiryStatus, type InsuranceCover } from './rules.ts';

/** The shared list stays this short, so it fits one WhatsApp message comfortably. */
export const FLEET_REMINDER_MAX_CHARS = 1500;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A YYYY-MM-DD date as e.g. "20 Oct 2026" (no time zone involved). */
const dayLabel = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
};

const KINDS: ExpiryKind[] = ['roadtax', 'insurance', 'inspection'];

/**
 * This week's Fleet reminder as plain text, ready to share on WhatsApp: every car whose road tax, insurance or
 * inspection is due in the next 30 days, expired or missing (the Fleet page's own rules, Finance's later insurance date
 * included when `cover` is given), grouped by kind with plate and date, most urgent first. No WhatsApp markup or emoji.
 * Past FLEET_REMINDER_MAX_CHARS characters the last lines give way to "and N more".
 */
export function fleetReminderText(cars: Car[], today: string, cover?: InsuranceCover): string {
  const header = `ECA Fleet reminders, ${dayLabel(today)}`;
  const due = new Map<ExpiryKind, { car: Car; status: ExpiryStatus }[]>(KINDS.map(kind => [kind, []]));
  for (const car of cars) {
    for (const status of carStatuses(car, today, cover)) if (status.needsAttention) due.get(status.kind)!.push({ car, status });
  }
  const groups = KINDS.map(kind => ({
    kind,
    lines: due.get(kind)!
      .sort((a, b) => (a.status.days ?? -Infinity) - (b.status.days ?? -Infinity)
        || normalizePlate(a.car.plateNumber).localeCompare(normalizePlate(b.car.plateNumber)))
      .map(({ car, status }) => `${car.plateNumber.trim()} - ${status.days === null ? status.text : `${dayLabel(status.date)} (${status.text})`}`),
  })).filter(group => group.lines.length > 0);
  const total = groups.reduce((sum, group) => sum + group.lines.length, 0);
  if (total === 0) return `${header}\nNo road tax, insurance or inspection is due in the next 30 days, expired or missing.`;

  /** The message with only the first `shown` car lines (in group order). */
  const build = (shown: number) => {
    const parts = [header, 'Due in the next 30 days, expired or missing:'];
    let left = shown;
    for (const group of groups) {
      if (left <= 0) break;
      const lines = group.lines.slice(0, left);
      left -= lines.length;
      parts.push('', EXPIRY_LABELS[group.kind], ...lines);
    }
    if (shown < total) parts.push('', `and ${total - shown} more`);
    return parts.join('\n');
  };
  for (let shown = total; shown > 0; shown--) {
    const text = build(shown);
    if (text.length <= FLEET_REMINDER_MAX_CHARS) return text;
  }
  return build(0);
}
