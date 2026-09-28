import type { Driver, PaymentTransaction } from '../types.ts';
import { formatCurrency, formatDate } from '../utils.ts';

/**
 * Payment checks and the payment change log (public.payment_changes, from
 * supabase/migrations/20260929090000_collections_support.sql): who recorded, edited or deleted each payment and when.
 */

/** A row of public.payment_changes; `before` and `after` are the whole payments row. */
export interface PaymentChange {
  id: number;
  payment_id: string;
  driver_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_at: string;
  changed_by_name: string;
  changed_by_role: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** Who did something as the office reads it: Admin or Staff from the account's role, otherwise the stored name. */
export const whoLabel = (role: string | null | undefined, name: string | null | undefined): string =>
  role === 'admin' ? 'Admin' : role === 'staff' ? 'Staff' : (name || '').trim() || 'Unknown account';

/** Who made a payment change (see whoLabel). */
export const actorLabel = (change: Pick<PaymentChange, 'changed_by_role' | 'changed_by_name'>): string =>
  whoLabel(change.changed_by_role, change.changed_by_name);

const stampFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

/** When a change was made, in Kuala Lumpur time, e.g. "29 Sept 2026, 2:05 pm". */
export const changeTime = (iso: string): string => stampFormat.format(new Date(iso));

const money = (value: unknown) => formatCurrency(Number(value) || 0);

/** The payment fields an edit can change, as they read in a note. */
const FIELDS: { key: string; label: string; show: (value: unknown) => string }[] = [
  { key: 'amount', label: 'amount', show: money },
  { key: 'service_claim', label: 'claim', show: money },
  { key: 'date', label: 'date', show: value => formatDate(String(value ?? '')) },
  { key: 'payment_method', label: 'method', show: value => String(value || 'BANK TRANSFER') },
  { key: 'reference', label: 'reference', show: value => (value ? String(value) : 'none') },
];

/** One change as a line of the payment's history. */
function noteFor(change: PaymentChange): string {
  const who = `${actorLabel(change)} · ${changeTime(change.changed_at)}`;
  if (change.action === 'INSERT') return `Recorded by ${who}`;
  const before = change.before ?? {};
  if (change.action === 'DELETE') {
    const claim = Number(before.service_claim) || 0;
    return `Deleted by ${who}: ${money(before.amount)}${claim > 0 ? ` + ${money(claim)} claim` : ''} on ${formatDate(String(before.date ?? ''))}`;
  }
  const after = change.after ?? {};
  const edits = FIELDS
    .filter(field => field.show(before[field.key]) !== field.show(after[field.key]))
    .map(field => `${field.label} ${field.show(before[field.key])} → ${field.show(after[field.key])}`);
  return `Edited by ${who}${edits.length ? `: ${edits.join('; ')}` : ''}`;
}

/**
 * Each payment's history lines, oldest first: "Recorded by Staff · …", then every edit and a deletion. Payments recorded
 * before the log started have no lines at all (their recorder is not known).
 */
export function paymentNotes(changes: PaymentChange[]): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  for (const change of [...changes].sort((a, b) => a.id - b.id)) {
    const lines = notes.get(change.payment_id) ?? [];
    lines.push(noteFor(change));
    notes.set(change.payment_id, lines);
  }
  return notes;
}

/** What is being recorded, for the duplicate check. */
export interface PaymentEntry {
  amount: number;
  serviceClaim: number;
  date: string;
  reference?: string;
}

export interface PossibleDuplicate {
  driver: Driver;
  payment: PaymentTransaction;
  reason: 'SAME_AMOUNT_AND_DATE' | 'SAME_REFERENCE';
}

/** A reference as compared: capitals without spaces. */
export const referenceKey = (reference?: string | null): string => (reference || '').toUpperCase().replace(/\s+/g, '');

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Payments that look like the one about to be recorded: this driver's payment of the same amount on the same date (the
 * claim, for a claim-only entry), or any driver's payment with the same reference. Each payment is listed once.
 */
export function findPossibleDuplicates(drivers: Driver[], driverId: string, entry: PaymentEntry): PossibleDuplicate[] {
  const wantedReference = referenceKey(entry.reference);
  const found: PossibleDuplicate[] = [];
  for (const driver of drivers) {
    for (const payment of driver.paymentHistory || []) {
      const sameAmount = entry.amount > 0 ? near(payment.amount, entry.amount) : payment.amount === 0 && near(payment.serviceClaim || 0, entry.serviceClaim);
      if (driver.id === driverId && payment.date === entry.date && sameAmount) found.push({ driver, payment, reason: 'SAME_AMOUNT_AND_DATE' });
      else if (wantedReference && referenceKey(payment.reference) === wantedReference) found.push({ driver, payment, reason: 'SAME_REFERENCE' });
    }
  }
  return found;
}
