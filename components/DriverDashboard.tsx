import React from 'react';
import { Driver } from '../types';
import { calculateDriverMetrics, formatCurrency, formatDate, generateDriverInvoices, getNextDueDate, isSewaBiasa, kualaLumpurNow, parseDate, portalPenalty } from '../utils';
import { driverPortalView, type PortalTone } from '../services/driverPortal';
import { Calendar, CheckCircle2, ChevronDown, FileText, Info, LogOut, Receipt, TrendingUp, WalletCards } from 'lucide-react';
import { PaymentAmount, PaymentMethodBadge } from './RentDisplay';

interface DriverDashboardProps {
  driver: Driver;
  onLogout: () => void;
}

/** Cards rise in one after another on open; the delay is per position (see .portal-enter in index.css). */
const enter = (position: number): { className: string; style: React.CSSProperties } => ({
  className: 'portal-enter',
  style: { animationDelay: `${position * 70}ms` },
});

const TONE: Record<PortalTone, { card: string; icon: React.ReactNode }> = {
  good: { card: 'bg-emerald-700 text-white', icon: <CheckCircle2 className="w-10 h-10" aria-hidden="true" /> },
  warning: { card: 'bg-amber-100 text-amber-950 border border-amber-300', icon: <WalletCards className="w-10 h-10 text-amber-700" aria-hidden="true" /> },
  neutral: { card: 'bg-gray-800 text-white', icon: <Info className="w-10 h-10" aria-hidden="true" /> },
};

/**
 * The driver's own page, built for phones: one status in the office's friendly WhatsApp tone (same figures as the
 * office), what is owed with one manageable next step, the late-payment penalty while rent is owed, where to pay,
 * contract progress and recent payments with thanks for the latest.
 */
const DriverDashboard: React.FC<DriverDashboardProps> = ({ driver, onLogout }) => {
  const now = kualaLumpurNow();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const metrics = calculateDriverMetrics(driver, now);
  const owed = Math.max(0, metrics.principalOutstanding);
  const cycle = driver.rentalCycle === 'MONTHLY' ? 'month' : 'week';
  const view = driverPortalView(driver, now);
  const oldestUnpaid = generateDriverInvoices(driver, now).find(inv => inv.remainingBalance > 0.01 && parseDate(inv.dueDate) <= endOfToday);
  const nextDue = driver.isDelisted ? null : getNextDueDate(driver, now);
  const ownsAtEnd = !isSewaBiasa(driver);
  const penalty = portalPenalty(metrics);
  const recent = driver.paymentHistory.slice(0, 5);

  const tone = TONE[view.tone];

  return (
    <div className="min-h-screen bg-gray-50 pb-10 font-sans">
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-4 flex justify-between items-center gap-4">
          <div className="min-w-0 flex-1">
            <h1 className={`${driver.name.length > 25 ? 'text-lg' : 'text-xl'} font-bold text-gray-800 uppercase leading-snug break-words`}>Hello, {driver.name}</h1>
            <p className="text-sm text-gray-600 font-mono truncate">{driver.carPlate}</p>
          </div>
          <button type="button" onClick={onLogout} aria-label="Log out" title="Log out" className="text-gray-600 hover:text-gray-800 shrink-0 p-2 rounded-full transition-transform active:scale-90">
            <LogOut className="w-6 h-6" aria-hidden="true" />
          </button>
        </div>
      </div>

      <main className="max-w-md mx-auto px-4 pt-6 space-y-4">
        {/* One status, matching what the office sees */}
        <section aria-labelledby="status-title" className={`rounded-2xl shadow-md p-6 text-center ${tone.card} ${enter(0).className}`} style={enter(0).style}>
          <div className="flex flex-col items-center gap-2">
            <span className="portal-pop">{tone.icon}</span>
            <h2 id="status-title" className="text-2xl font-bold">{view.title}</h2>
            <p className="text-sm font-medium leading-relaxed">{view.message}</p>
          </div>
        </section>

        <div className={`grid grid-cols-2 gap-3 ${enter(1).className}`} style={enter(1).style}>
          <div className={`bg-white p-4 rounded-xl shadow-sm border ${owed > 0 ? 'border-amber-300' : 'border-gray-200'}`}>
            <p className="text-gray-600 text-xs uppercase font-semibold mb-1">You owe</p>
            <p className={`text-xl font-bold ${owed > 0 ? 'text-amber-800' : 'text-gray-900'}`}>{formatCurrency(owed)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <p className="text-gray-600 text-xs uppercase font-semibold mb-1">Rent per {cycle}</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(driver.rentalRate)}</p>
          </div>
        </div>

        {/* Late-payment penalty, for every driver while rent is owed */}
        {penalty && (
          <section aria-labelledby="penalty-title" className={`bg-white p-4 rounded-xl shadow-sm border border-red-300 flex items-start gap-3 ${enter(2).className}`} style={enter(2).style}>
            <TrendingUp className="w-5 h-5 text-red-700 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="penalty-title" className="text-gray-600 text-xs uppercase font-semibold">Total accrued penalty</h2>
              <p className="text-xl font-bold text-red-700">{formatCurrency(penalty.total)}</p>
              <p className="text-sm text-gray-800 mt-0.5"><strong className="text-red-700">+{formatCurrency(penalty.addedToday)}</strong> added today</p>
              <p className="text-xs text-gray-600 mt-0.5">Interest compounding daily at 18% p.a.</p>
            </div>
          </section>
        )}

        {/* What to pay next: one manageable step while rent is owed, and where to pay */}
        {(owed > 0 || nextDue) && (
          <section aria-labelledby="next-payment-title" className={`bg-white p-4 rounded-xl shadow-sm border ${owed > 0 ? 'border-amber-300' : 'border-gray-200'} flex items-start gap-3 ${enter(3).className}`} style={enter(3).style}>
            <Calendar className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="next-payment-title" className="text-sm font-bold text-gray-900">Next payment</h2>
              {owed > 0 ? (
                <>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{view.milestone}</p>
                  {oldestUnpaid && <p className="text-xs text-gray-600 mt-0.5">Unpaid since {formatDate(oldestUnpaid.dueDate)}.</p>}
                </>
              ) : nextDue && view.upcoming.length === 0 ? (
                <p className="text-sm text-gray-800 mt-0.5"><strong>{formatCurrency(driver.rentalRate)}</strong> on {formatDate(nextDue)}.</p>
              ) : null}
              {view.upcoming.length > 0 && (
                <div className={owed > 0 ? 'mt-3' : 'mt-1'}>
                  {owed > 0 && <h3 className="text-xs uppercase font-semibold text-gray-600">Coming up</h3>}
                  <ul className="mt-1 divide-y divide-gray-100">
                    {view.upcoming.map(row => (
                      <li key={row.date} className="py-1.5 flex justify-between gap-3 text-sm">
                        <span className="text-gray-700">{row.date}</span>
                        <span className="font-semibold text-gray-900">{row.amount}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-gray-600 mt-2">Pay to the account on your WhatsApp group statement, then send the receipt in the same group.</p>
            </div>
          </section>
        )}

        {/* Contract progress, never counting past the contract length */}
        {view.progress && (
          <section aria-labelledby="progress-title" className={`bg-white p-4 rounded-xl shadow-sm border border-gray-200 ${enter(4).className}`} style={enter(4).style}>
            <div className="flex justify-between text-sm text-gray-700 mb-2">
              <h2 id="progress-title" className="font-semibold">{ownsAtEnd ? 'On the way to owning this car' : 'Rental progress'}</h2>
              <span className="font-semibold">{view.progress.label}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5" aria-hidden="true">
              <div className="h-2.5 rounded-full bg-blue-700 portal-fill" style={{ width: `${view.progress.percent}%` }} />
            </div>
            <p className="text-xs text-gray-600 mt-2">{view.progress.note ?? `${view.progress.percent}% of the contract`}</p>
          </section>
        )}

        {/* My contract: the facts a driver looks up, folded away until opened */}
        <details className={`group bg-white rounded-xl shadow-sm border border-gray-200 ${enter(5).className}`} style={enter(5).style}>
          <summary className="p-4 flex items-center justify-between gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-600" aria-hidden="true" /> My contract
            </span>
            <ChevronDown className="w-5 h-5 text-gray-500 transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
          </summary>
          <dl className="px-4 pb-4 divide-y divide-gray-100 portal-reveal">
            {view.contract.map(row => (
              <div key={row.label} className="py-2 flex justify-between gap-4 text-sm">
                <dt className="text-gray-600">{row.label}</dt>
                <dd className="font-semibold text-gray-900 text-right">{row.value}</dd>
              </div>
            ))}
          </dl>
        </details>

        {/* Recent payments */}
        <section aria-labelledby="recent-title" className={`bg-white p-4 rounded-xl shadow-sm border border-gray-200 ${enter(6).className}`} style={enter(6).style}>
          <h2 id="recent-title" className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4 text-gray-600" aria-hidden="true" /> Recent payments
          </h2>
          {view.thanks && <p className="text-sm font-semibold text-emerald-800 mb-2">{view.thanks}</p>}
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
