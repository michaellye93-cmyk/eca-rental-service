import { useEffect, useState } from 'react';
import type { Driver } from '../types';
import { loadPaymentChanges } from '../services/collectionsApi';
import { paymentNotes } from '../services/paymentLog';

/**
 * Who recorded and changed each of the driver's payments, by payment id (see paymentNotes). Reloaded whenever the
 * driver's payments change here; empty when the change log is not available yet.
 */
export function usePaymentNotes(driver: Pick<Driver, 'id' | 'paymentHistory'> | null): Map<string, string[]> {
  const [notes, setNotes] = useState<Map<string, string[]>>(() => new Map());
  const driverId = driver?.id;
  const payments = driver?.paymentHistory;
  useEffect(() => {
    if (!driverId) return;
    let live = true;
    loadPaymentChanges(driverId)
      .then(changes => { if (live) setNotes(paymentNotes(changes)); })
      .catch(() => { if (live) setNotes(new Map()); });
    return () => { live = false; };
  }, [driverId, payments]);
  return notes;
}

/** A payment's history lines under it, e.g. "Recorded by Staff · 29 Sept 2026, 2:05 pm". Nothing for older payments. */
export function PaymentNoteLines({ lines }: { lines?: string[] }) {
  if (!lines?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
      {lines.map((line, index) => <li key={index}>{line}</li>)}
    </ul>
  );
}

/** Payments deleted from this driver, with who deleted them (from the change log). */
export function DeletedPayments({ notes, payments }: { notes: Map<string, string[]>; payments: Driver['paymentHistory'] }) {
  const deleted = [...notes].filter(([id, lines]) => !payments.some(payment => payment.id === id) && lines.at(-1)?.startsWith('Deleted'));
  if (!deleted.length) return null;
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-xs text-rose-900">
      <p className="font-bold mb-1">Deleted payments</p>
      <ul className="space-y-0.5">{deleted.map(([id, lines]) => <li key={id}>{lines.at(-1)}</li>)}</ul>
    </div>
  );
}
