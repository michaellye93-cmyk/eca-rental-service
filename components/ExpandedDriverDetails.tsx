import React, { useEffect, useMemo, useState } from 'react';
import { Driver } from '../types';
import { categoryLabel, formatDate, formatPhone, latestInvoices, whatsappLink } from '../utils';
import { InvoiceRow, PaymentAmount, PaymentMethodBadge } from './RentDisplay';
import { BankBadge, DeletedPayments, PaymentNoteLines, useBankStatus, usePaymentNotes } from './PaymentNotes';
import DriverDeposits from './DriverDeposits';
import { loadDriverChanges } from '../services/collectionsApi';
import { driverChangeLines, type DriverChange } from '../services/driverChanges';
import { collectionSummary } from '../services/collections';
import { Phone, User, FileText, Clock, DollarSign, History } from 'lucide-react';

interface ExpandedDriverDetailsProps {
  driver: Driver;
  /** Admins may delete deposit lines; staff only add them. */
  isAdmin: boolean;
  onLogPaymentClick: () => void;
  /** Records a rent payment settled from the driver's deposit (contra) on delisting. */
  onContraPayment?: (amount: number, date: string) => unknown;
}

/** Who changed the driver's profile and what, newest first; nothing before the change log existed. */
function ProfileHistory({ driver }: { driver: Driver }) {
  const [changes, setChanges] = useState<DriverChange[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Reloaded when the profile itself changes (an edit here), not on every payment
  const profileKey = `${driver.id}|${driver.name}|${driver.carPlate}|${driver.rentalRate}|${driver.contractStartDate}|${driver.contractEndDate}|${driver.isDelisted}|${(driver.tags || []).join(',')}|${driver.phone}|${driver.whatsappGroup}|${driver.collectionArrangement}|${driver.collectionTone}|${driver.collectionLanguage}|${driver.contactWindow}|${driver.collectionNote}`;
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadDriverChanges(driver.id).then(rows => { if (live) setChanges(rows); }).catch(() => { if (live) { setChanges([]); setFailed(true); } });
    return () => { live = false; };
  }, [profileKey]);
  const lines = useMemo(() => driverChangeLines(changes ?? []), [changes]);
  return (
    <div className="space-y-3">
      <h5 className="text-sm font-bold text-gray-900 flex items-center gap-2">
        <History className="w-4 h-4 text-gray-500" aria-hidden="true" /> Profile changes
      </h5>
      {changes === null ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : failed ? (
        <p className="text-xs text-gray-600">The change log could not be read (it starts once the 12 Oct database update is run).</p>
      ) : lines.length === 0 ? (
        <p className="text-xs text-gray-600">No changes recorded since the change log started (12 Oct 2026).</p>
      ) : (
        <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1 text-xs text-gray-700">
          {lines.map((line, index) => <li key={index} className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">{line}</li>)}
        </ul>
      )}
    </div>
  );
}

export const ExpandedDriverDetails: React.FC<ExpandedDriverDetailsProps> = ({ driver, isAdmin, onLogPaymentClick, onContraPayment }) => {
  // The latest six obligations from the shared rent schedule, newest first
  const billingSchedule = useMemo(() => latestInvoices(driver), [driver]);
  // Who recorded and changed each payment (payments from before the change log carry nothing)
  const notes = usePaymentNotes(driver);
  const bankStatus = useBankStatus(driver);
  // Latest payment compared with the driver's average timing: 3+ days later reads as slipping, 2+ days earlier as recovering
  const velocity = driver.performanceVelocity || 0;
  const paymentTiming = velocity > 3
    ? { text: 'Paying later than usual', look: 'font-bold text-red-700' }
    : velocity < -2
      ? { text: 'Paying earlier than usual', look: 'font-semibold text-green-700' }
      : { text: 'Usual timing', look: 'font-semibold text-gray-600' };
  const sewaBeli = categoryLabel(driver) === 'Sewa Beli';

  return (
    <div className="bg-white/95 rounded-2xl border border-gray-200/80 shadow-inner p-6 space-y-8 font-sans text-gray-800">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Driver profile */}
        <div className="bg-gray-50/50 rounded-xl p-5 border border-gray-200/60 shadow-sm space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
              <User className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h4 className="text-base font-bold text-gray-900">{driver.name}</h4>
              <p className="text-xs text-gray-500 font-medium font-mono">ID: {driver.id.substring(0, 8)}</p>
            </div>
          </div>

          <dl className="space-y-3.5 border-t border-gray-200/60 pt-4 text-xs">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                <Phone className="w-3.5 h-3.5" aria-hidden="true" /> Contact
              </dt>
              <dd>
                {driver.phone ? (
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-bold text-gray-700">{formatPhone(driver.phone)}</span>
                    <a href={whatsappLink(driver.phone)} target="_blank" rel="noopener noreferrer" className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-800 hover:bg-emerald-100">WhatsApp</a>
                  </span>
                ) : <span className="text-gray-600 italic">No phone yet: add it with Edit</span>}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500 font-semibold uppercase tracking-wider shrink-0">WhatsApp group</dt>
              <dd className="text-right break-words">{driver.whatsappGroup ? <span className="font-bold text-gray-800">{driver.whatsappGroup}</span> : <span className="text-gray-600 italic">Not set: add it with Edit</span>}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-gray-500 font-semibold uppercase tracking-wider shrink-0">Collection</dt>
              <dd className="text-right break-words">
                {collectionSummary(driver)
                  ? <span className="font-bold text-gray-800">{collectionSummary(driver)}</span>
                  : <span className="text-gray-600 italic">No arrangement: add it with Edit</span>}
                {driver.collectionNote && <span className="block text-gray-600 font-medium mt-0.5">{driver.collectionNote}</span>}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500 font-semibold uppercase tracking-wider shrink-0">NRIC No</dt>
              <dd className="font-mono font-bold text-gray-700">{driver.nric}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500 font-semibold uppercase tracking-wider shrink-0">Tags</dt>
              <dd className="flex flex-wrap justify-end gap-1">
                {(driver.tags?.length ? driver.tags : ['None']).map(tag => (
                  <span key={tag} className="font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100 uppercase tracking-wide">{tag}</span>
                ))}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500 font-semibold uppercase tracking-wider shrink-0">Category</dt>
              <dd className={`font-black uppercase tracking-wider px-2 py-0.5 rounded border ${sewaBeli ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
                {categoryLabel(driver)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500 font-semibold uppercase tracking-wider shrink-0">Payment timing</dt>
              <dd className={paymentTiming.look}>{paymentTiming.text}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500 font-semibold uppercase tracking-wider shrink-0">Registered Car</dt>
              <dd className="font-mono font-extrabold text-gray-950 bg-yellow-50 px-2 border border-yellow-200 rounded">{driver.carPlate}</dd>
            </div>
          </dl>

          <div className="border-t border-gray-200/60 pt-4">
            <button
              type="button"
              onClick={onLogPaymentClick}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-all focus:ring-2 focus:ring-blue-500/55"
            >
              <DollarSign className="w-4 h-4 shrink-0" aria-hidden="true" /> Record payment
            </button>
          </div>
        </div>

        {/* Rent schedule */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-500" aria-hidden="true" />
              Rent schedule
            </h5>
            <span className="text-xs text-gray-500 font-black uppercase tracking-wider">Last 6 Billing Periods</span>
          </div>
          <div className="space-y-1.5">
            {billingSchedule.map(inv => <InvoiceRow key={inv.id} invoice={inv} />)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 border-t border-gray-200/60 pt-6">
        {/* Deposits and payments */}
        <div className="lg:col-span-2 space-y-4">
          <DriverDeposits driver={driver} isAdmin={isAdmin} onContraPayment={onContraPayment} />
          <h5 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-500" aria-hidden="true" />
            Payments
          </h5>

          <DeletedPayments notes={notes} payments={driver.paymentHistory} />
          {driver.paymentHistory.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-600 text-xs">
              No payments recorded yet.
            </div>
          ) : (
            <ul className="relative border-l border-gray-200 pl-4 ml-3 space-y-6">
              {driver.paymentHistory.map((pt, index) => (
                <li key={pt.id || index} className="relative text-xs">
                  <span aria-hidden="true" className="absolute -left-7 top-1 w-3 h-3 rounded-full bg-blue-600 border-2 border-white ring-2 ring-blue-100" />
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/60">
                    <div className="flex items-center gap-2 flex-wrap">
                      <PaymentAmount payment={pt} className="font-extrabold text-base text-gray-950" />
                      <PaymentMethodBadge method={pt.paymentMethod} />
                      {pt.reference && <span className="text-xs font-mono text-gray-700 bg-white border border-gray-200 px-1.5 py-0.5 rounded">Ref: {pt.reference}</span>}
                      <BankBadge payment={pt} status={bankStatus} />
                    </div>
                    <p className="text-gray-500 font-medium font-mono mt-1 text-xs">Paid on {formatDate(pt.date, 'N/A')}</p>
                    <PaymentNoteLines lines={notes.get(pt.id)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ProfileHistory driver={driver} />
      </div>
    </div>
  );
};
