import { formatCurrency, formatDate } from '../utils.ts';
import { changeTime, whoLabel } from './paymentLog.ts';

/** A row of public.driver_changes (supabase/migrations/20261012180000_security_review.sql): only changed fields kept. */
export interface DriverChange {
  id: number;
  driver_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_at: string;
  changed_by_name: string;
  changed_by_role: string | null;
  fields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const text = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : String(value));
const date = (value: unknown) => (value ? formatDate(String(value)) : '—');
const money = (value: unknown) => (value === null || value === undefined ? '—' : formatCurrency(Number(value) || 0));
const yesNo = (value: unknown) => (value ? 'yes' : 'no');
const list = (value: unknown) => (Array.isArray(value) && value.length ? value.join(', ') : '—');

/** The driver fields as the office reads them; anything not listed here is shown by its column name. */
const FIELDS: Record<string, { label: string; show: (value: unknown) => string }> = {
  name: { label: 'name', show: text },
  nric: { label: 'NRIC', show: text },
  email: { label: 'email', show: text },
  phone: { label: 'phone', show: text },
  address: { label: 'address', show: text },
  whatsapp_group: { label: 'WhatsApp group', show: text },
  emergency_contact_name: { label: 'emergency contact', show: text },
  emergency_contact_phone: { label: 'emergency phone', show: text },
  car_plate: { label: 'plate', show: text },
  category: { label: 'category', show: text },
  rental_cycle: { label: 'cycle', show: text },
  rental_rate: { label: 'rent', show: money },
  contract_start_date: { label: 'start date', show: date },
  contract_end_date: { label: 'end date', show: date },
  contract_duration_weeks: { label: 'contract length', show: text },
  is_delisted: { label: 'delisted', show: yesNo },
  delist_date: { label: 'delist date', show: date },
  tags: { label: 'tags', show: list },
};
/** Columns the database fills in itself; an edit that only touched these is not worth a line. */
const BOOKKEEPING = new Set(['id', 'created_at', 'updated_at']);

/** The driver's profile history, newest first: "Staff · 12 Oct 2026, 12:05 pm: rent RM 400.00 → RM 450.00". */
export function driverChangeLines(changes: DriverChange[]): string[] {
  return [...changes].sort((a, b) => b.id - a.id).flatMap(change => {
    const who = `${whoLabel(change.changed_by_role, change.changed_by_name)} · ${changeTime(change.changed_at)}`;
    if (change.action === 'INSERT') return [`${who}: driver added`];
    if (change.action === 'DELETE') return [`${who}: driver deleted`];
    const edits = change.fields.filter(field => !BOOKKEEPING.has(field)).map(field => {
      const known = FIELDS[field];
      const show = known?.show ?? text;
      return `${known?.label ?? field} ${show(change.before?.[field])} → ${show(change.after?.[field])}`;
    });
    return edits.length ? [`${who}: ${edits.join('; ')}`] : [];
  });
}
