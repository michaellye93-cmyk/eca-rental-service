import React from 'react';
import { Driver, DriverStatus } from '../types';
import { calculateDriverMetrics, formatCurrency, formatDate, generateDriverInvoices, getNextDueDate, kualaLumpurNow, parseDate } from '../utils';
import { AlertOctagon, AlertTriangle, Calendar, CheckCircle2, CircleDollarSign, Info, LogOut, Receipt } from 'lucide-react';
import { PaymentAmount, PaymentMethodBadge } from './RentDisplay';

interface DriverDashboardProps {
  driver: Driver;
  /** What the ECA office wants drivers to read about paying (set by an Admin); null when none has been written. */
  paymentInstructions?: string | null;
  onLogout: () => void;
}

type Tone = 'good' | 'warning' | 'critical' | 'neutral';
const TONE: Record<Tone, { card: string; icon: React.ReactNode }> = {
  good: { card: 'bg-emerald-700 text-white', icon: <CheckCircle2 className="w-10 h-10" aria-hidden="true" /> },
  warning: { card: 'bg-amber-100 text-amber-950 border border-amber-300', icon: <AlertTriangle className="w-10 h-10 text-amber-700" aria-hidden="true" /> },
  critical: { card: 'bg-red-800 text-white', icon: <AlertOctagon className="w-10 h-10" aria-hidden="true" /> },
  neutral: { card: 'bg-gray-800 text-white', icon: <Info className="w-10 h-10" aria-hidden="true" /> },
};

/**
 * The driver's own page: one status that matches what the office sees, what is owed and when the next payment is due,
 * how to pay, contract progress and recent payments.
 */
const DriverDashboard: React.FC<DriverDashboardProps> = ({ driver, paymentInstructions, onLogout }) => {
  const now = kualaLumpurNow();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const metrics = calculateDriverMetrics(driver, now);
  const owed = Math.max(0, metrics.principalOutstanding);
  const cycle = driver.rentalCycle === 'MONTHLY' ? 'month' : 'week';
  const cyclesOwed = `${metrics.cyclesOwed.toFixed(1)} ${cycle}s of rent`;
  const oldestUnpaid = generateDriverInvoices(driver, now).find(inv => inv.remainingBalance > 0.01 && parseDate(inv.dueDate) <= endOfToday);
  const nextDue = driver.isDelisted ? null : getNextDueDate(driver, now);
  const ownsAtEnd = (driver.category || 'SEWABELI').toUpperCase().replace(/\s+/g, '_') !== 'SEWA_BIASA';
  const recent = driver.paymentHistory.slice(0, 5);

  let status: { tone: Tone; title: string; message: string };
  if (driver.isDelisted) {
    status = owed > 0
      ? { tone: 'critical', title: 'Final settlement needed', message: `You owe ${formatCurrency(owed)}. Please settle it to close your account.` }
      : { tone: 'neutral', title: 'Account closed', message: 'Your rental has ended with nothing owed. Thank you.' };
  } else if (metrics.status === DriverStatus.BAD) {
    status = { tone: 'critical', title: 'Urgent: payment needed', message: `You owe ${formatCurrency(owed)} (${cyclesOwed}). Pay now to keep using the car.` };
  } else if (metrics.status === DriverStatus.MID) {
    status = { tone: 'warning', title: 'Payment due', message: `You owe ${formatCurrency(owed)} (${cyclesOwed}). Please pay as soon as you can.` };
  } else {
    status = {
      tone: 'good',
      title: "You're up to date",
      message: nextDue ? `Your next rent of ${formatCurrency(driver.rentalRate)} is due on ${formatDate(nextDue)}.` : 'Nothing is owed.',
    };
  }
  const tone = TONE[status.tone];

  return (
    <div className="min-h-screen bg-gray-50 pb-10 font-sans">
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-4 flex justify-between items-center gap-4">
          <div className="min-w-0 flex-1">
            <h1 className={`${driver.name.length > 25 ? 'text-lg' : 'text-xl'} font-bold text-gray-800 uppercase leading-snug break-words`}>Hello, {driver.name}</h1>
            <p className="text-sm text-gray-600 font-mono truncate">{driver.carPlate}</p>
          </div>
          <button type="button" onClick={onLogout} aria-label="Log out" title="Log out" className="text-gray-600 hover:text-gray-800 shrink-0 p-2">
            <LogOut className="w-6 h-6" aria-hidden="true" />
          </button>
        </div>
      </div>

      <main className="max-w-md mx-auto px-4 pt-6 space-y-4">
        {/* One status, matching what the office sees */}
        <section aria-labelledby="status-title" className={`rounded-2xl shadow-md p-6 text-center ${tone.card}`}>
          <div className="flex flex-col items-center gap-2">
            {tone.icon}
            <h2 id="status-title" className="text-2xl font-bold">{status.title}</h2>
            <p className="text-sm font-medium leading-relaxed">{status.message}</p>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <div className={`bg-white p-4 rounded-xl shadow-sm border ${owed > 0 ? 'border-red-300' : 'border-gray-200'}`}>
            <p className="text-gray-600 text-xs uppercase font-semibold mb-1">You owe</p>
            <p className={`text-xl font-bold ${owed > 0 ? 'text-red-700' : 'text-gray-900'}`}>{formatCurrency(owed)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <p className="text-gray-600 text-xs uppercase font-semibold mb-1">Rent per {cycle}</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(driver.rentalRate)}</p>
          </div>
        </div>

        {/* When to pay next */}
        {(owed > 0 || nextDue) && (
          <section aria-labelledby="next-payment-title" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-start gap-3">
            <Calendar className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="next-payment-title" className="text-sm font-bold text-gray-900">Next payment</h2>
              {owed > 0 ? (
                <p className="text-sm text-gray-800 mt-0.5">
                  Pay <strong>{formatCurrency(owed)}</strong> now{oldestUnpaid ? `, unpaid since ${formatDate(oldestUnpaid.dueDate)}` : ''}.
                </p>
              ) : nextDue ? (
                <p className="text-sm text-gray-800 mt-0.5"><strong>{formatCurrency(driver.rentalRate)}</strong> on {formatDate(nextDue)}.</p>
              ) : null}
            </div>
          </section>
        )}

        {/* How to pay, as written by the ECA office */}
        <section aria-labelledby="how-to-pay-title" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-start gap-3">
          <CircleDollarSign className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="how-to-pay-title" className="text-sm font-bold text-gray-900">How to pay</h2>
            <p className="text-sm text-gray-800 mt-0.5 whitespace-pre-line break-words">{paymentInstructions?.trim() || 'Ask the ECA office how to pay.'}</p>
          </div>
        </section>

        {/* Contract progress */}
        {!driver.isDelisted && driver.contractDuration > 0 && (
          <section aria-labelledby="progress-title" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <div className="flex justify-between text-sm text-gray-700 mb-2">
              <h2 id="progress-title" className="font-semibold">{ownsAtEnd ? 'On the way to owning this car' : 'Rental progress'}</h2>
              <span className="font-semibold">{cycle === 'month' ? 'Month' : 'Week'} {metrics.cyclesElapsed} of {driver.contractDuration}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5" aria-hidden="true">
              <div className="h-2.5 rounded-full bg-blue-700" style={{ width: `${metrics.progressPercent}%` }} />
            </div>
            <p className="text-xs text-gray-600 mt-2">{Math.round(metrics.progressPercent)}% of the contract</p>
          </section>
        )}

        {/* Recent payments */}
        <section aria-labelledby="recent-title" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <h2 id="recent-title" className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4 text-gray-600" aria-hidden="true" /> Recent payments
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-gray-600">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recent.map(payment => (
                <li key={payment.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-700">{formatDate(payment.date)}</span>
                  <span className="flex items-center gap-2">
                    <PaymentAmount payment={payment} className="font-semibold text-gray-900" />
                    <PaymentMethodBadge method={payment.paymentMethod} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
};

export default DriverDashboard;
