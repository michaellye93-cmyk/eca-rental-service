import { kualaLumpurToday } from '../utils.ts';
import { driverAccount } from './driverAccount.ts';
import { buildCollectionsData, type ContactSummary, type CollectionsData, type CollectionsDriver, type CollectionsInput, type ContactKind, type PromiseState } from './collections.ts';

/**
 * The day's collection worklist (/admin/worklist): one row per active driver with what to do next, built from the
 * collections data view (buildCollectionsData) and the driver's account facts (driverAccount), so every rent figure comes
 * from the shared rent schedule in utils.ts.
 * Nothing is sent from it.
 */

/**
 * What to do next with a driver. The owner's seven steps, plus three that close gaps in them (owing but never asked,
 * and an open promise date).
 */
export type NextStep =
  | 'Nothing due'
  | 'Due-day message'
  | `Follow up (asked ${number} ${"day" | "days" | "hours"} ago, still unpaid)`
  | 'Promise missed: follow up'
  | 'Wait: asked within 6 hours'
  | `Arrangement: ${string} — check before asking`
  | 'Thank for payment'
  | 'Ask: owing, no ask logged'
  | `Wait: promised ${string}`;

export interface StepInput {
  /** The real moment (not a Kuala Lumpur wall-clock Date): the 6-hour rule is measured from it. */
  now: Date;
  /** Kuala Lumpur calendar day, YYYY-MM-DD. */
  today: string;
  /** Rent owed now (rent due today included), from the rent schedule. */
  owed: number;
  /** What is still unpaid of rent falling due today; 0 when none falls due today or it is paid. */
  dueTodayUnpaid: number;
  /** The driver's standing collection arrangement (Edit Driver), e.g. "Monthly RM1,000 by the 5th". */
  arrangement: string | null;
  /** The latest payment's date, YYYY-MM-DD. */
  lastPaymentDate: string | null;
  /** When the driver was last asked (ask, follow-up or statement) and last thanked: ISO times from the contact log. */
  lastAskAt: string | null;
  lastThanksAt: string | null;
  /** The latest promise to pay: its state, promised date and the Kuala Lumpur day it was logged (YYYY-MM-DD). */
  promise: { state: PromiseState; date: string; loggedOn: string } | null;
}

const HOUR_MS = 3_600_000;
const addDay = (isoDay: string, days: number) => {
  const [year, month, day] = isoDay.split('-').map(Number);
  return kualaLumpurToday(new Date(Date.UTC(year, month - 1, day + days, 4)));
};
/** Whole Kuala Lumpur calendar days from one day to another. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const dayMonth = (isoDay: string) => `${Number(isoDay.slice(8, 10))}/${Number(isoDay.slice(5, 7))}`;

/**
 * The next step with a driver, by the collection rules:
 * - Nothing owed: thank a payment dated today or yesterday that has not been thanked since; otherwise nothing is due.
 * - A payment today or yesterday not yet thanked: thank first (the conversation continues from there).
 * - A missed promise: follow up, even within 6 hours of an ask, until a follow-up is logged after the promised date.
 * - An open promise logged today or yesterday: wait for it, even on the due day (no due-day message over a fresh promise).
 * - Rent due today and unpaid: the due-day message, even within 6 hours of an ask, unless already asked today.
 * - An open promise date: wait for it.
 * - Asked within 6 hours: wait (owner's rule, 13 Oct 2026). Never asked: ask. Asked 6 hours ago or more and still
 *   unpaid: follow up.
 * A standing arrangement overrides the weekly ask rhythm, not thanks or missed promises: its text replaces only the
 * ask, the follow-up and the due-day message (the waits still show).
 */
/** No new ask to the same driver within this many hours of the last one (owner's rule, 13 Oct 2026). */
export const WAIT_AFTER_ASK_HOURS = 6;

export function nextCollectionStep(input: StepInput): NextStep {
  const { today } = input;
  const dayOf = (iso: string) => kualaLumpurToday(new Date(iso));
  const yesterday = addDay(today, -1);
  const thanksDue = input.lastPaymentDate !== null && input.lastPaymentDate >= yesterday && input.lastPaymentDate <= today
    && !(input.lastThanksAt && dayOf(input.lastThanksAt) >= input.lastPaymentDate);
  if (input.owed <= 0.005) return thanksDue ? 'Thank for payment' : 'Nothing due';

  if (thanksDue) return 'Thank for payment';

  const askDay = input.lastAskAt ? dayOf(input.lastAskAt) : null;
  if (input.promise?.state === 'MISSED' && !(askDay && askDay > input.promise.date)) return 'Promise missed: follow up';
  const arrangement = input.arrangement?.trim();
  const ask = (step: NextStep): NextStep => (arrangement ? `Arrangement: ${arrangement} — check before asking` : step);
  const promised = input.promise?.state === 'OPEN' ? `Wait: promised ${dayMonth(input.promise.date)}` as const : null;
  if (promised && input.promise!.loggedOn >= yesterday) return promised;
  if (input.dueTodayUnpaid > 0.005 && askDay !== today) return ask('Due-day message');
  if (promised) return promised;
  if (!input.lastAskAt || !askDay) return ask('Ask: owing, no ask logged');
  const sinceAsk = input.now.getTime() - Date.parse(input.lastAskAt);
  if (sinceAsk < WAIT_AFTER_ASK_HOURS * HOUR_MS) return 'Wait: asked within 6 hours';
  const days = daysBetween(askDay, today);
  return ask(days >= 1
    ? `Follow up (asked ${days} ${days === 1 ? 'day' : 'days'} ago, still unpaid)`
    : `Follow up (asked ${Math.floor(sinceAsk / HOUR_MS)} hours ago, still unpaid)`);
}

/** One active driver on the worklist. Built field by field: NRIC, phone, email and address are never included. */
export interface WorklistRow {
  id: string;
  plate: string;
  name: string;
  whatsapp_group: string | null;
  status: string;
  owed: number;
  /** Rent falling due today and what is still unpaid of it; null when none falls due today. */
  due_today: { amount: number; unpaid: number } | null;
  late_days: number | null;
  last_payment_date: string | null;
  promise: { amount: number; date: string; status: PromiseState; paid_so_far: number } | null;
  last_contact: { at: string; kind: ContactKind; run_slot: string | null } | null;
  last_ask_at: string | null;
  collection: CollectionsDriver['collection'];
  next_step: NextStep;
}

export interface WorklistData {
  generated_at: string;
  today: string;
  about: string;
  warnings: string[];
  drivers: WorklistRow[];
}

const lastThanks = (contacts: ContactSummary[] | null, driverId: string): string | null =>
  (contacts ?? []).filter(contact => contact.driver_id === driverId && contact.kind === 'THANKS')
    .reduce<string | null>((latest, contact) => (!latest || contact.contacted_at > latest ? contact.contacted_at : latest), null);

/**
 * The worklist: every active driver, rent falling due today first, then the data view's order (late alerts with the
 * longest late first, then by amount owed). `instant` is the real moment, for the 6-hour rule.
 */
export function buildWorklist(input: CollectionsInput & { instant: Date }): WorklistData {
  const data: CollectionsData = buildCollectionsData(input);
  const byId = new Map(input.drivers.map(driver => [driver.id, driver]));
  const rows = data.drivers.map((row): WorklistRow => {
    const driver = byId.get(row.id)!;
    // Rent falling due today, from the driver's account facts (driverAccount), as the driver row and phone page read them
    const dueToday = driverAccount(driver, input.now).dueToday;
    const thanks = lastThanks(input.contacts ?? null, row.id);
    const next_step = nextCollectionStep({
      now: input.instant, today: input.today, owed: row.status.outstanding, dueTodayUnpaid: dueToday ? dueToday.unpaid : 0,
      arrangement: row.collection.arrangement, lastPaymentDate: row.status.last_payment_date, lastAskAt: row.last_ask_at, lastThanksAt: thanks,
      promise: row.promise ? { state: row.promise.status, date: row.promise.date, loggedOn: row.promise.logged_on } : null,
    });
    return {
      id: row.id,
      plate: row.plate,
      name: row.short_name,
      whatsapp_group: row.whatsapp_group,
      status: row.status.risk,
      owed: row.status.outstanding,
      due_today: dueToday,
      late_days: row.status.late_days,
      last_payment_date: row.status.last_payment_date,
      promise: row.promise ? { amount: row.promise.amount, date: row.promise.date, status: row.promise.status, paid_so_far: row.promise.paid_so_far } : null,
      last_contact: row.last_contact ? { at: row.last_contact.at, kind: row.last_contact.kind, run_slot: row.last_contact.run_slot } : null,
      last_ask_at: row.last_ask_at,
      collection: row.collection,
      next_step,
    };
  });
  // Rent due today first; the sort is stable, so each group keeps the data view's order
  rows.sort((a, b) => Number(b.due_today !== null) - Number(a.due_today !== null));
  return {
    generated_at: data.generated_at,
    today: data.today,
    about: 'Read-only worklist of active drivers from the ECA admin site: the next step for each. Money in RM; rent only. Nothing is sent from here.',
    warnings: data.warnings,
    drivers: rows,
  };
}

/** The worklist as JSON text: the heading on a few lines, then one line per driver (valid JSON, read in one go). */
export function worklistJson(data: WorklistData): string {
  const { drivers, ...head } = data;
  const top = Object.entries(head).map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`);
  return `{\n${top.join(',\n')},\n"drivers":[\n${drivers.map(driver => JSON.stringify(driver)).join(',\n')}\n]}`;
}
