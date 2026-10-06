import { useEffect, useMemo, useState } from 'react';
import type { Driver } from '../types';
import { loadPaymentBankStatus, loadPaymentChanges } from '../services/collectionsApi';
import { paymentNotes, paymentRecorders, type PaymentChange } from '../services/paymentLog';

/**
 * The driver's payment change log: each payment's history lines (see paymentNotes) and who recorded it (see
 * paymentRecorders), by payment id. Reloaded whenever the driver's payments change here; empty when the change log is
 * not available yet.
 */
export function usePaymentLog(driver: Pick<Driver, 'id' | 'paymentHistory'> | null): { notes: Map<string, string[]>; recorders: Map<string, string> } {
  const [changes, setChanges] = useState<PaymentChange[]>([]);
  const driverId = driver?.id;
  const payments = driver?.paymentHistory;
  useEffect(() => {
    if (!driverId) return;
    let live = true;
    loadPaymentChanges(driverId)
      .then(loaded => { if (live) setChanges(loaded); })
      .catch(() => { if (live) setChanges([]); });
    return () => { live = false; };
  }, [driverId, payments]);
  return useMemo(() => ({ notes: paymentNotes(changes), recorders: paymentRecorders(changes) }), [changes]);
}

/** Who recorded and changed each of the driver's payments, by payment id (see usePaymentLog). */
export const usePaymentNotes = (driver: Pick<Driver, 'id' | 'paymentHistory'> | null): Map<string, string[]> => usePaymentLog(driver).notes;

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

export interface BankStatus { matched: Set<string>; months: Set<string> }

/**
 * Bank confirmation for the driver's payments: which ones a posted bank statement was matched to, and which months have
 * a posted statement. Null for staff (admin only) or before the database update; then no badge is shown.
 */
export function useBankStatus(driver: Pick<Driver, 'id' | 'paymentHistory'> | null): BankStatus | null {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const driverId = driver?.id;
  const payments = driver?.paymentHistory;
  useEffect(() => {
    if (!driverId) return;
    let live = true;
    loadPaymentBankStatus(driverId)
      .then(loaded => { if (live) setStatus({ matched: new Set(loaded.matched), months: new Set(loaded.months) }); })
      .catch(() => { if (live) setStatus(null); });
    return () => { live = false; };
  }, [driverId, payments]);
  return status;
}

/**
 * "Bank ✓" when a posted bank statement was matched to the payment; "Not in bank" when its month's statement is posted
 * but no bank line was matched to it, so the receipt needs checking. Claim-only payments bring no money, so no badge.
 */
export function BankBadge({ payment, status }: { payment: Pick<Driver['paymentHistory'][number], 'id' | 'date' | 'amount' | 'paymentMethod'>; status: BankStatus | null }) {
  if (!status || !(payment.amount > 0)) return null;
  if (status.matched.has(payment.id)) {
    return <span className="ml-1 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800" title="Matched to a line on the posted bank statement">Bank ✓</span>;
  }
  if (payment.paymentMethod === 'DEPOSIT CONTRA') {
    return <span className="ml-1 inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700" title="Deposit forfeited against rent on termination, so no bank line is expected">Deposit forfeit</span>;
  }
  if (payment.paymentMethod === 'CASH') {
    return <span className="ml-1 inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700" title="Paid in cash in hand, so no bank line is expected">Cash</span>;
  }
  if (status.months.has(payment.date.slice(0, 7))) {
    return <span className="ml-1 inline-block rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-800" title="This month's bank statement is posted, but no bank line was matched to this payment. Check the receipt.">Not in bank</span>;
  }
  return null;
}
