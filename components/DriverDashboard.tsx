import React, { useState } from 'react';
import { Driver } from '../types';
import { calculateDriverMetrics, formatCurrency, generateDriverInvoices, getNextDueDate, isSewaBiasa, kualaLumpurNow, parseDate, portalPenalty } from '../utils';
import { driverPortalView, type PortalTone } from '../services/driverPortal';
import type { PortalSignIn } from '../services/driverPortalSession';
import { agreementFileName, downloadAgreementPdf } from '../services/agreements/pdf';
import { KIND_LABELS } from '../services/agreements/template';
import Dialog from './Dialog';
const AgreementPreview = React.lazy(() => import('./agreements/AgreementPreview'));
import { portalDate, portalText, portalTime, type PortalLang } from '../services/portalText';
import { Calendar, CheckCircle2, ChevronDown, Download, Eye, FileSignature, FileText, Info, LogOut, Receipt, RefreshCw, TrendingUp, WalletCards } from 'lucide-react';
import { PaymentAmount, PaymentMethodBadge } from './RentDisplay';
import LanguageSwitch from './LanguageSwitch';
import InstallTip from './InstallTip';

interface DriverDashboardProps {
  driver: Driver;
  /** The agreement staff prepared for this driver, or null (the card is then hidden). */
  agreement?: PortalSignIn['agreement'];
  lang: PortalLang;
  onLangChange: (lang: PortalLang) => void;
  /** When the figures on screen were loaded. */
  loadedAt: Date;
  /** Reloads the driver's record; rejects with Error('rate_limited') or Error('unavailable') when it cannot. */
  onRefresh: () => Promise<void>;
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
 * The driver's own page, built for phones and shown in English, Bahasa Malaysia or Chinese: one status in the office's
 * friendly WhatsApp tone (same figures as the office), what is owed with one manageable next step, the late-payment
 * penalty while rent is owed, when and where to pay, contract progress and details, and recent payments with thanks
 * for the latest.
 */
const DriverDashboard: React.FC<DriverDashboardProps> = ({ driver, agreement = null, lang, onLangChange, loadedAt, onRefresh, onLogout }) => {
  const t = portalText(lang);
  const [showAgreement, setShowAgreement] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const downloadAgreement = async () => {
    if (!agreement || preparing) return;
    setPreparing(true);
    try {
      // The PDF is made on the phone, from the same text staff downloaded
      await downloadAgreementPdf(agreement.template, agreement.values,
        agreementFileName(KIND_LABELS[agreement.kind], agreement.values.vehicle_plate ?? '', agreement.values.customer_name ?? ''));
    } finally {
      setPreparing(false);
    }
  };
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const now = kualaLumpurNow();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const metrics = calculateDriverMetrics(driver, now);
  const owed = Math.max(0, metrics.principalOutstanding);
  const cycle = driver.rentalCycle === 'MONTHLY' ? 'month' : 'week';
  const view = driverPortalView(driver, now, lang);
  const oldestUnpaid = generateDriverInvoices(driver, now).find(inv => inv.remainingBalance > 0.01 && parseDate(inv.dueDate) <= endOfToday);
  const nextDue = driver.isDelisted ? null : getNextDueDate(driver, now);
  const ownsAtEnd = !isSewaBiasa(driver);
  const penalty = portalPenalty(metrics);
  const recent = driver.paymentHistory.slice(0, 5);
  const tone = TONE[view.tone];

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
    } catch (cause) {
      setRefreshError(cause instanceof Error && cause.message === 'rate_limited' ? t.rateLimited : t.refreshFailed);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-10 font-sans">
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 pt-4 pb-3">
          <div className="flex justify-between items-center gap-4">
            <div className="min-w-0 flex-1">
              <h1 className={`${driver.name.length > 25 ? 'text-lg' : 'text-xl'} font-bold text-gray-800 uppercase leading-snug break-words`}>{t.hello}, {driver.name}</h1>
              <p className="text-sm text-gray-600 font-mono truncate">{driver.carPlate}</p>
            </div>
            <button type="button" onClick={onLogout} aria-label={t.logOut} title={t.logOut} className="text-gray-600 hover:text-gray-800 shrink-0 p-2 rounded-full transition-transform active:scale-90">
              <LogOut className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <LanguageSwitch lang={lang} onChange={onLangChange} label={t.language} />
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1.5 rounded-lg transition-transform active:scale-95 disabled:opacity-70"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {refreshing ? t.refreshing : t.updated(portalTime(loadedAt))}
              <span className="sr-only">. {t.refresh}</span>
            </button>
          </div>
          {refreshError && <p role="alert" className="mt-1 text-xs text-red-700 text-right">{refreshError}</p>}
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
            <p className="text-gray-600 text-xs uppercase font-semibold mb-1">{t.youOwe}</p>
            <p className={`text-xl font-bold ${owed > 0 ? 'text-amber-800' : 'text-gray-900'}`}>{formatCurrency(owed)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <p className="text-gray-600 text-xs uppercase font-semibold mb-1">{t.rentPer(cycle)}</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(driver.rentalRate)}</p>
          </div>
        </div>

        {/* Late-payment penalty, for every driver while rent is owed: the total so far, what today adds, and the rate */}
        {penalty && (
          <section aria-labelledby="penalty-title" className={`bg-rose-50 p-4 rounded-xl shadow-sm border border-rose-200 ${enter(2).className}`} style={enter(2).style}>
            <div className="flex items-center justify-between gap-3">
              <h2 id="penalty-title" className="text-sm font-bold text-rose-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-rose-700" aria-hidden="true" /> {t.penaltyTitle}
              </h2>
              <span className="text-xs font-semibold text-rose-800 bg-white border border-rose-200 rounded-full px-2 py-0.5 whitespace-nowrap">
                {t.penaltyToday(formatCurrency(penalty.addedToday))}
              </span>
            </div>
            <p className="text-2xl font-bold text-rose-800 mt-1">{formatCurrency(penalty.total)}</p>
            <p className="text-xs text-rose-900/80 mt-1">{t.penaltyNote}</p>
          </section>
        )}

        {/* What to pay next: one manageable step while rent is owed, the next due dates, and where to pay */}
        {(owed > 0 || nextDue) && (
          <section aria-labelledby="next-payment-title" className={`bg-white p-4 rounded-xl shadow-sm border ${owed > 0 ? 'border-amber-300' : 'border-gray-200'} flex items-start gap-3 ${enter(3).className}`} style={enter(3).style}>
            <Calendar className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 id="next-payment-title" className="text-sm font-bold text-gray-900">{t.nextPayment}</h2>
              {owed > 0 ? (
                <>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{view.milestone}</p>
                  {oldestUnpaid && <p className="text-xs text-gray-600 mt-0.5">{t.unpaidSince(portalDate(oldestUnpaid.dueDate, lang))}</p>}
                </>
              ) : nextDue && view.upcoming.length === 0 ? (
                <p className="text-sm text-gray-800 mt-0.5">{t.amountOn(formatCurrency(driver.rentalRate), portalDate(nextDue, lang))}</p>
              ) : null}
              {view.upcoming.length > 0 && (
                <div className={owed > 0 ? 'mt-3' : 'mt-1'}>
                  {owed > 0 && <h3 className="text-xs uppercase font-semibold text-gray-600">{t.comingUp}</h3>}
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
              <p className="text-xs text-gray-600 mt-2">{t.whereToPay}</p>
            </div>
          </section>
        )}

        {/* Contract progress, never counting past the contract length */}
        {view.progress && (
          <section aria-labelledby="progress-title" className={`bg-white p-4 rounded-xl shadow-sm border border-gray-200 ${enter(4).className}`} style={enter(4).style}>
            <div className="flex justify-between gap-3 text-sm text-gray-700 mb-2">
              <h2 id="progress-title" className="font-semibold">{ownsAtEnd ? t.ownTitle : t.rentalTitle}</h2>
              <span className="font-semibold text-right">{view.progress.label}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5" aria-hidden="true">
              <div className="h-2.5 rounded-full bg-blue-700 portal-fill" style={{ width: `${view.progress.percent}%` }} />
            </div>
            <p className="text-xs text-gray-600 mt-2">{view.progress.note ?? t.percent(view.progress.percent)}</p>
          </section>
        )}

        {/* My contract: the facts a driver looks up, folded away until opened */}
        <details className={`group bg-white rounded-xl shadow-sm border border-gray-200 ${enter(5).className}`} style={enter(5).style}>
          <summary className="p-4 flex items-center justify-between gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-600" aria-hidden="true" /> {t.myContract}
            </span>
            <ChevronDown className="w-5 h-5 text-gray-500 transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
          </summary>
          <dl className="px-4 pb-4 divide-y divide-gray-100 portal-reveal">
            {view.contract.map(row => (
              <div key={row.key} className="py-2 flex justify-between gap-4 text-sm">
                <dt className="text-gray-600 shrink-0">{row.label}</dt>
                <dd className="font-semibold text-gray-900 text-right">{row.value}</dd>
              </div>
            ))}
          </dl>
        </details>

        {/* My agreement: the one staff prepared, to read again or download */}
        {agreement && (
          <section aria-labelledby="agreement-title" className={`bg-white p-4 rounded-xl shadow-sm border border-gray-200 ${enter(5).className}`} style={enter(5).style}>
            <h2 id="agreement-title" className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-gray-600" aria-hidden="true" /> {t.myAgreement}
            </h2>
            <p className="text-xs text-gray-600 mt-1">{t.agreementMade(portalDate(agreement.createdAt || new Date(), lang))}</p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button type="button" onClick={() => setShowAgreement(true)} className="min-h-11 rounded-lg border border-gray-300 text-sm font-semibold text-gray-800 flex items-center justify-center gap-2">
                <Eye className="w-4 h-4" aria-hidden="true" /> {t.viewAgreement}
              </button>
              <button type="button" onClick={() => void downloadAgreement()} disabled={preparing} className="min-h-11 rounded-lg bg-blue-600 disabled:opacity-60 text-sm font-semibold text-white flex items-center justify-center gap-2">
                <Download className="w-4 h-4" aria-hidden="true" /> {preparing ? t.downloading : t.downloadAgreement}
              </button>
            </div>
          </section>
        )}
        {agreement && showAgreement && (
          <Dialog title={t.myAgreement} onClose={() => setShowAgreement(false)} size="lg">
            <div className="p-2 sm:p-4 bg-gray-100">
              <React.Suspense fallback={<p className="p-4 text-sm text-gray-500">…</p>}>
                <AgreementPreview template={agreement.template} values={agreement.values} />
              </React.Suspense>
            </div>
          </Dialog>
        )}

        {/* Recent payments */}
        <section aria-labelledby="recent-title" className={`bg-white p-4 rounded-xl shadow-sm border border-gray-200 ${enter(6).className}`} style={enter(6).style}>
          <h2 id="recent-title" className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4 text-gray-600" aria-hidden="true" /> {t.recent}
          </h2>
          {view.thanks && <p className="text-sm font-semibold text-emerald-800 mb-2">{view.thanks}</p>}
          {recent.length === 0 ? (
            <p className="text-sm text-gray-600">{t.noPayments}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recent.map(payment => (
                <li key={payment.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-700">{portalDate(payment.date, lang)}</span>
                  <span className="flex items-center gap-2">
                    <PaymentAmount payment={payment} className="font-semibold text-gray-900" />
                    <PaymentMethodBadge method={payment.paymentMethod} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <InstallTip lang={lang} />
      </main>
    </div>
  );
};

export default DriverDashboard;
