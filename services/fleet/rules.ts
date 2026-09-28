import { normalizePlate, plateMatches } from '../../utils.ts';

/** How the car list is split, as Guardian recorded it. */
export type Ownership = 'Own Fleet' | 'Others';
/** The three dates the Fleet page watches. */
export type ExpiryKind = 'roadtax' | 'insurance' | 'inspection';
/** expired: passed · due: today or within ATTENTION_DAYS · ok: later · none: no inspection · missing: required date empty or not a date */
export type ExpiryTone = 'expired' | 'due' | 'ok' | 'none' | 'missing';

/** A car on the Fleet page. Dates are YYYY-MM-DD, or '' when not set. */
export interface Car {
  id: string;
  make: string;
  model: string;
  plateNumber: string;
  roadtaxExpiry: string;
  insuranceExpiry: string;
  inspectionExpiry: string;
  notes: string;
  ownership: Ownership;
}

/** A row of public.cars as Supabase returns it (all text, Guardian's camelCase column names). */
export interface CarRow {
  id: string;
  make?: string | null;
  model?: string | null;
  plateNumber?: string | null;
  roadtaxExpiry?: string | null;
  insuranceExpiry?: string | null;
  inspectionExpiry?: string | null;
  notes?: string | null;
  label?: string | null;
  ownership?: string | null;
}

/** How one of a car's dates shows on the Fleet page. */
export interface ExpiryStatus {
  kind: ExpiryKind;
  /** The stored date, '' when not set. */
  date: string;
  tone: ExpiryTone;
  /** Days from today to the date (negative once passed); null without a valid date. */
  days: number | null;
  text: string;
  needsAttention: boolean;
}

/** A date this many days away or fewer (today included) needs attention: Guardian's window. */
export const ATTENTION_DAYS = 30;

export const EXPIRY_LABELS: Record<ExpiryKind, string> = { roadtax: 'Road tax', insurance: 'Insurance', inspection: 'Inspection' };

const DAY_MS = 24 * 60 * 60 * 1000;
const text = (value: string | null | undefined) => (value ?? '').trim();

/** Days since 1970-01-01 for a real YYYY-MM-DD calendar date, else null. The computer's time zone plays no part. */
const dayNumber = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return time / DAY_MS;
};

/** Whole days from `today` to `date` (both YYYY-MM-DD): 0 on the day, negative once passed; null if either isn't a date. */
export const daysUntil = (date: string, today: string): number | null => {
  const target = dayNumber(date);
  const from = dayNumber(today);
  return target === null || from === null ? null : target - from;
};

const dayCount = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`;

/** How one of a car's dates shows, measured from `today` (Kuala Lumpur's date). An empty inspection is not needed. */
export const expiryStatus = (kind: ExpiryKind, date: string, today: string): ExpiryStatus => {
  const stored = text(date);
  if (kind === 'inspection' && stored === '') return { kind, date: '', tone: 'none', days: null, text: 'No inspection', needsAttention: false };
  const days = daysUntil(stored, today);
  if (days === null) return { kind, date: stored, tone: 'missing', days: null, text: 'Not set', needsAttention: true };
  if (days < 0) return { kind, date: stored, tone: 'expired', days, text: `Expired ${dayCount(-days)} ago`, needsAttention: true };
  if (days === 0) return { kind, date: stored, tone: 'due', days, text: 'Due today', needsAttention: true };
  if (days <= ATTENTION_DAYS) return { kind, date: stored, tone: 'due', days, text: `Due in ${dayCount(days)}`, needsAttention: true };
  return { kind, date: stored, tone: 'ok', days, text: `${dayCount(days)} left`, needsAttention: false };
};

/** Road tax, insurance and inspection, in that order. */
export const carStatuses = (car: Car, today: string): ExpiryStatus[] => [
  expiryStatus('roadtax', car.roadtaxExpiry, today),
  expiryStatus('insurance', car.insuranceExpiry, today),
  expiryStatus('inspection', car.inspectionExpiry, today),
];

/** A car needs attention when any of its dates does. */
export const needsAttention = (car: Car, today: string): boolean => carStatuses(car, today).some(status => status.needsAttention);

/** How many cars need attention: the Fleet tab's red count and the "Needs attention" tile. */
export const attentionCount = (cars: Car[], today: string): number => cars.filter(car => needsAttention(car, today)).length;

/** The car's soonest set date; '' (first of all) when road tax or insurance is missing or not a date. */
const urgencyKey = (car: Car): string => {
  if (dayNumber(text(car.roadtaxExpiry)) === null || dayNumber(text(car.insuranceExpiry)) === null) return '';
  return [car.roadtaxExpiry, car.insuranceExpiry, car.inspectionExpiry].map(text).filter(date => dayNumber(date) !== null).sort()[0];
};

/** Most urgent first; ties by plate. Returns a new array. */
export const byUrgency = (cars: Car[]): Car[] =>
  [...cars].sort((a, b) => urgencyKey(a).localeCompare(urgencyKey(b)) || normalizePlate(a.plateNumber).localeCompare(normalizePlate(b.plateNumber)));

/** Search by plate (ignoring spaces and letter case), make, model or notes. An empty search matches every car. */
export const matchesSearch = (car: Car, query: string): boolean => {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  return plateMatches(car.plateNumber, query) || [car.make, car.model, car.notes].some(value => value.toLowerCase().includes(wanted));
};

/** Another car already using this plate (compared without spaces or letter case); `exceptId` is the car being edited. */
export const findDuplicatePlate = (cars: Car[], plate: string, exceptId?: string): Car | undefined => {
  const key = normalizePlate(plate);
  return key ? cars.find(other => other.id !== exceptId && normalizePlate(other.plateNumber) === key) : undefined;
};

/** Why the form can't save this car yet, or null when it can. `cars` is the whole list, for the duplicate-plate check. */
export const carFormError = (car: Car, cars: Car[]): string | null => {
  if (!text(car.make) || !text(car.model) || !text(car.plateNumber)) return 'Enter the make, model and plate.';
  if (dayNumber(text(car.roadtaxExpiry)) === null) return 'Choose the road tax expiry date.';
  if (dayNumber(text(car.insuranceExpiry)) === null) return 'Choose the insurance expiry date.';
  if (text(car.inspectionExpiry) && dayNumber(text(car.inspectionExpiry)) === null) return 'Choose a valid inspection date, or leave it empty.';
  const duplicate = findDuplicatePlate(cars, car.plateNumber, car.id);
  return duplicate ? `This plate is already in the list (${duplicate.make} ${duplicate.model}).` : null;
};

/** A public.cars row as a car: notes fall back to the older label column; anything but "Others" is Own Fleet. */
export const carFromRow = (row: CarRow): Car => ({
  id: String(row.id),
  make: text(row.make),
  model: text(row.model),
  plateNumber: text(row.plateNumber),
  roadtaxExpiry: text(row.roadtaxExpiry),
  insuranceExpiry: text(row.insuranceExpiry),
  inspectionExpiry: text(row.inspectionExpiry),
  notes: text(row.notes) || text(row.label),
  ownership: text(row.ownership).toLowerCase() === 'others' ? 'Others' : 'Own Fleet',
});

/** The columns a save writes. Never `label`: Guardian's older column is only read. */
export const carToRow = (car: Car) => ({
  id: car.id,
  make: text(car.make),
  model: text(car.model),
  plateNumber: text(car.plateNumber),
  roadtaxExpiry: text(car.roadtaxExpiry),
  insuranceExpiry: text(car.insuranceExpiry),
  inspectionExpiry: text(car.inspectionExpiry),
  notes: text(car.notes),
  ownership: car.ownership,
});

/** An empty car for the Add form: Own Fleet, with a fresh id (the id column is text, as Guardian wrote it). */
export const newCar = (): Car => ({
  id: crypto.randomUUID(), make: '', model: '', plateNumber: '', roadtaxExpiry: '', insuranceExpiry: '',
  inspectionExpiry: '', notes: '', ownership: 'Own Fleet',
});
