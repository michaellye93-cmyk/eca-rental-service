import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, Printer, AlertTriangle } from 'lucide-react';
import { supabase } from '../supabaseClient';
import type { Driver } from '../types';
import { buildTerminationReport, getReportDate } from '../terminationReport';
import type { PaymentPeriod, TerminationEvidence } from '../terminationReport';
import { loadTerminationDrivers } from '../terminationReportData';
import './TerminationReport.css';

const currency = (amount: number) => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: 2 }).format(amount);
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
const movementLabel = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${currency(Math.abs(value))}`;
const DRIVER_FIELDS = 'id,name,car_plate,contract_start_date,contract_end_date,contract_duration_weeks,rental_rate,rental_cycle,is_delisted';
const PAYMENT_FIELDS = 'id,driver_id,date,amount,service_claim,payment_method';

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-gray-500 mb-1">{label}</dt><dd className="text-sm font-semibold text-gray-900 leading-6">{children}</dd></div>;
}

function PaymentTimeline({ periods, monthly }: { periods: PaymentPeriod[]; monthly: boolean }) {
  return <div className="overflow-x-auto rounded-lg border border-gray-200 mt-3">
    <table className="w-full text-left text-xs sm:text-sm">
      <caption className="text-left px-3 py-2 bg-gray-50 font-semibold text-gray-700">{monthly ? 'Observed billing cycles' : '8-week payment timeline'}</caption>
      <thead className="border-y border-gray-200 bg-gray-50 text-gray-600"><tr>
        <th scope="col" className="p-3">{monthly ? 'Billing period' : 'Week'}</th><th scope="col" className="p-3 text-right whitespace-nowrap">Rental Due</th><th scope="col" className="p-3 text-right whitespace-nowrap">Cash Paid</th><th scope="col" className="p-3">Result</th>
      </tr></thead>
      <tbody>{periods.map((period, index) => <tr key={period.start} className="border-b last:border-b-0 border-gray-100">
        <th scope="row" className="p-3 font-normal"><span className="font-semibold">{monthly ? `Cycle ${index + 1}` : `Week ${index + 1}`}</span><span className="block text-[11px] text-gray-500 mt-0.5">{dateLabel(period.start)} – {dateLabel(period.end)}</span>{!period.completed && <span className="text-[10px] text-gray-500 block">Through report date · still open</span>}</th>
        <td className="p-3 text-right whitespace-nowrap tabular-nums">{currency(period.due)}</td>
        <td className="p-3 text-right whitespace-nowrap tabular-nums">{currency(period.cash)}{period.claims > 0 && <span className="block text-[10px] text-gray-500">+ {currency(period.claims)} credit</span>}</td>
        <td className="p-3 font-semibold text-gray-700 text-[11px] sm:text-xs">{period.result === 'NO_RENT_DUE' ? 'NO RENT DUE' : period.result === 'FULL' && period.cash > period.due ? 'FULL / CATCH-UP PAYMENT' : `${period.result} PAYMENT`}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function Evidence({ evidence: r }: { evidence: TerminationEvidence }) {
  const monthly = r.driver.rentalCycle === 'MONTHLY';
  const conclusion = [
    `The latest 8 weeks show repeated ${monthly ? 'underpayment of observed billing cycles' : 'failure to meet weekly rental requirements'}.`,
    `Cash received was ${currency(r.cashReceived)} against ${currency(r.rentalDue)} becoming due.`,
    r.movementDirection === 'increased' ? `Outstanding increased by ${currency(r.outstandingMovement)}.` : `Outstanding remained ${r.movementDirection} at ${currency(r.currentOutstanding)}.`,
    r.oldestUnpaidDays >= (monthly ? 30 : 21) ? `Unpaid rental remains from ${dateLabel(r.oldestUnpaidInvoice!)}.` : '',
    'These combined payment facts support management consideration of termination and vehicle recovery.',
  ].filter(Boolean).join(' ');
  return <div className="space-y-6 text-sm leading-relaxed text-gray-700">
    <h4 className="text-base font-bold text-gray-900">Why termination is recommended</h4>
    <section>
      <h5 className="font-semibold text-gray-900">1. Repeated Failure to Meet Rental Payment</h5>
      <p className="mt-1">{monthly
        ? `During the latest 8 weeks, cash within ${r.underpaidCycles} of ${r.billingCycles.length} observed billing cycles fell below the rental becoming due. Monthly billing is assessed by cycle, not weekly failure counts.`
        : `During the latest 8 weeks, the driver failed to meet the rental requirement in ${r.failureWeeks} of ${r.rentalWeeks} rental weeks: ${r.zeroWeeks} zero-payment and ${r.partialWeeks} partial-payment weeks. ${r.fullWeeks} ${r.fullWeeks === 1 ? 'week was' : 'weeks were'} fully covered by cash.`}</p>
      <PaymentTimeline periods={monthly ? r.billingCycles : r.weeks} monthly={monthly} />
      <p className="mt-2 text-xs text-gray-500">Cash-flow comparison by period; a catch-up payment may settle earlier invoices. No-rent-due periods are excluded from failures. The latest open period is shown as of the report date; it cannot establish repeated failure on its own.</p>
    </section>
    <section>
      <h5 className="font-semibold text-gray-900">2. Insufficient Payment During Observation Period</h5>
      <p className="mt-1">Rental of {currency(r.rentalDue)} became due, while {currency(r.cashReceived)} cash was recorded as received ({((r.cashCoverage || 0) * 100).toFixed(1)}% coverage).</p>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Metric label="Rental Due">{currency(r.rentalDue)}</Metric><Metric label="Cash Received">{currency(r.cashReceived)}</Metric><Metric label="Cash Shortfall">{currency(r.shortfall)}</Metric><Metric label="Service Claim Credits">{currency(r.serviceCredits)}</Metric>
      </dl>
      <p className="text-xs text-gray-500 mt-2">Service claims reduce outstanding separately; they are not cash payments.</p>
    </section>
    <section>
      <h5 className="font-semibold text-gray-900">3. Outstanding {r.movementDirection === 'increased' ? 'Continued to Increase' : r.movementDirection === 'decreased' ? 'Decreased' : 'Remained Approximately Stable'}</h5>
      <p className="mt-1">Outstanding {r.movementDirection} from {currency(r.previousOutstanding)} at {dateLabel(r.snapshotDate)} to {currency(r.currentOutstanding)} as of {dateLabel(r.reportDate)}.</p>
      <dl className="grid grid-cols-3 gap-3 mt-3"><Metric label="8 Weeks Ago">{currency(r.previousOutstanding)}</Metric><Metric label="Current">{currency(r.currentOutstanding)}</Metric><Metric label="Movement">{movementLabel(r.outstandingMovement)}</Metric></dl>
    </section>
    <section>
      <h5 className="font-semibold text-gray-900">4. Latest Cash Payment</h5>
      <p className="mt-1">{r.lastCashPayment
        ? `The latest positive cash payment day was ${dateLabel(r.lastCashPayment.date)}, totalling ${currency(r.lastCashPayment.amount)}. No further cash payment has been recorded for ${r.daysSinceLastCash} calendar days.`
        : `No positive cash payment is recorded in the available ledger. The contract commenced on ${dateLabel(r.driver.contractStartDate)}.`}</p>
      <p className="mt-2">{r.lastMeaningfulPayment
        ? `Latest meaningful payment: ${currency(r.lastMeaningfulPayment.amount)} on ${dateLabel(r.lastMeaningfulPayment.date)} (${r.daysSinceLastMeaningful} days ago).`
        : 'No meaningful payment is recorded in the available ledger.'}</p>
      <p className="text-xs text-gray-500 mt-1">Meaningful = at least {currency(r.meaningfulThreshold)} cash on one day; same-day receipts are combined.{monthly ? ' Monthly equivalent: monthly rent × 12 / 52, rounded up to the nearest cent.' : ' Threshold: one contractual week’s rent.'}</p>
    </section>
    <section>
      <h5 className="font-semibold text-gray-900">5. Current Arrears</h5>
      <p className="mt-1">Current outstanding is {currency(r.currentOutstanding)}{monthly ? ` against a monthly rental of ${currency(r.driver.rentalRate)}.` : `, equivalent to ${r.arrearsWeeks!.toFixed(1)} weeks of contractual rental.`} Historical debt is context; it is not a standalone reason for recommendation.</p>
    </section>
    <section>
      <h5 className="font-semibold text-gray-900">6. Payment Lateness</h5>
      {r.averageDaysLate !== null ? <p className="mt-1">Cash received during the observation period was applied to rental invoices using the existing oldest-invoice-first reconstruction. The cash-weighted average lateness was {r.averageDaysLate.toFixed(1)} days.{r.cashAppliedToOldInvoices > 0 ? ` ${currency(r.cashAppliedToOldInvoices)} was applied to invoices at least ${monthly ? '30' : '21'} days overdue.` : ''}</p>
        : <p className="mt-1">Average payment lateness cannot be calculated: no cash from this period was allocated to an accrued invoice.</p>}
      <dl className="grid grid-cols-2 gap-3 mt-3"><Metric label="Oldest Unpaid Invoice">{r.oldestUnpaidInvoice ? dateLabel(r.oldestUnpaidInvoice) : 'None'}</Metric><Metric label="Average Days Late">{r.averageDaysLate === null ? 'Not available' : `${r.averageDaysLate.toFixed(1)} days`}</Metric></dl>
      <p className="text-xs text-gray-500 mt-2">Invoice dates and allocations are reconstructed from the current contract and complete payment ledger. Lateness uses only cash received in these 56 days; service credits and unapplied advances are excluded. Historical contract edits are not versioned.</p>
    </section>
    <section className="border-t border-gray-200 pt-5">
      <h4 className="font-bold text-gray-900">Management Conclusion</h4>
      <p className="mt-2">{conclusion}</p>
      <p className="mt-3 font-bold text-rose-800">RECOMMENDATION: TERMINATION &amp; VEHICLE RECOVERY REVIEW</p>
      <p className="text-xs text-gray-500 mt-1">Final action remains a management decision. This report does not change the account or issue a notice.</p>
    </section>
  </div>;
}

const DriverCard: React.FC<{ evidence: TerminationEvidence }> = ({ evidence }) => {
  const [expanded, setExpanded] = useState(false);
  const r = evidence, monthly = r.driver.rentalCycle === 'MONTHLY';
  const evidenceId = `termination-evidence-${r.driver.id}`;
  return <article className="termination-driver rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
    <div className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4"><div><h3 className="text-xl font-extrabold tracking-tight text-gray-900">{r.driver.carPlate}</h3><p className="mt-1 font-medium text-gray-600">{r.driver.name}</p></div><span className="text-[10px] tracking-wide font-bold text-rose-800 bg-rose-50 rounded-md border border-rose-100 px-2.5 py-1.5">RECOMMENDED FOR TERMINATION</span></div>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4">
        <Metric label="Current Outstanding"><span className="text-lg font-bold text-rose-700 tabular-nums">{currency(r.currentOutstanding)}</span></Metric>
        <Metric label="Latest 8 Weeks"><span className="block">{currency(r.cashReceived)} Paid</span><span className="text-gray-500 font-normal">/ {currency(r.rentalDue)} Due</span></Metric>
        <Metric label={monthly ? 'Underpaid Billing Cycles' : 'Payment Failure'}>{monthly ? `${r.underpaidCycles} of ${r.billingCycles.length} cycles` : `${r.failureWeeks} of ${r.rentalWeeks} weeks`}<span className="block text-xs text-gray-500 font-normal">{monthly ? 'Monthly contract' : `${r.zeroWeeks} zero · ${r.partialWeeks} partial`}</span></Metric>
        <Metric label="Outstanding Movement"><span className="tabular-nums">{movementLabel(r.outstandingMovement)}</span><span className="block text-xs text-gray-500 font-normal">vs 8 weeks ago</span></Metric>
      </dl>
      <button type="button" className="termination-no-print mt-4 flex items-center gap-2 text-sm font-semibold text-gray-800 rounded-lg border border-gray-300 px-3 py-2 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" aria-expanded={expanded} aria-controls={evidenceId} onClick={() => setExpanded(value => !value)}>
        {expanded ? 'Hide Evidence' : 'View Evidence'}<ChevronDown aria-hidden="true" className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
    </div>
    <div id={evidenceId} hidden={!expanded} className="termination-evidence border-t border-gray-200 p-4 sm:p-5 bg-gray-50/40"><Evidence evidence={r} /></div>
    <aside className="border-t border-gray-200 bg-amber-50/50 px-4 sm:px-5 py-3 text-xs leading-5 text-gray-600">
      <p className="font-semibold text-gray-800 flex items-center gap-1.5"><AlertTriangle aria-hidden="true" className="w-3.5 h-3.5" />Management Verification Required</p>
      <p>Before termination, confirm:</p>
      <ol className="list-decimal pl-4 sm:grid sm:grid-cols-2 sm:gap-x-6"><li>No recent payment is missing from the system.</li><li>No approved payment arrangement exists outside the system.</li><li>No workshop, accident or company-approved downtime explains the outstanding.</li><li>Required contractual notice/default procedures have been followed.</li></ol>
    </aside>
  </article>;
};

export function TerminationReportContent({ drivers, reportDate }: { drivers: Driver[]; reportDate: string }) {
  const report = useMemo(() => buildTerminationReport(drivers, reportDate), [drivers, reportDate]);
  const exceptions = report.analyses.filter(r => r.exclusion === 'DATA_EXCEPTION').length;
  return <>
    <dl className="flex flex-wrap gap-x-8 gap-y-3 py-4"><Metric label="Report Date">{dateLabel(reportDate)}</Metric><Metric label="Observation Period">{dateLabel(report.windowStart)} – {dateLabel(reportDate)}</Metric><Metric label="Drivers Recommended"><span className="text-lg font-bold">{report.recommendations.length}</span></Metric></dl>
    {exceptions > 0 && <p className="mb-4 text-xs text-gray-500" role="note">{exceptions} active {exceptions === 1 ? 'account has' : 'accounts have'} a contract or ledger exception and cannot be recommended automatically. No recommendation has been inferred from incomplete evidence.</p>}
    <div className="space-y-4">{report.recommendations.length ? report.recommendations.map(r => <DriverCard key={r.driver.id} evidence={r} />)
      : <p className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600">No driver currently demonstrates sufficiently strong payment non-performance for termination recommendation based on the latest 8-week observation period.</p>}</div>
  </>;
}

export default function TerminationReport() {
  const [snapshot, setSnapshot] = useState<{ drivers: Driver[]; reportDate: string; loadedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const drivers = await loadTerminationDrivers(async (table, from, to, ids) => {
        let query = supabase.from(table).select(table === 'drivers' ? DRIVER_FIELDS : PAYMENT_FIELDS).order('id').range(from, to);
        if (table === 'drivers') query = query.or('is_delisted.eq.false,is_delisted.is.null');
        if (table === 'payments') query = query.in('driver_id', ids!);
        const { data, error } = await query.abortSignal(controller.signal);
        if (error) throw error;
        if (!data) throw new Error('Missing report data');
        return data as unknown as Record<string, unknown>[];
      });
      if (request.current !== controller) return;
      if (controller.signal.aborted) throw new Error('Report read timed out');
      setSnapshot({ drivers, reportDate: getReportDate(), loadedAt: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()) });
    } catch {
      if (request.current === controller) setError(true);
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); return () => { request.current?.abort(); request.current = null; }; }, [refresh]);
  const print = () => {
    document.body.classList.add('printing-termination-report');
    const cleanup = () => document.body.classList.remove('printing-termination-report');
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    cleanup();
  };
  return <section className="termination-report mb-8" aria-labelledby="termination-report-title" aria-busy={loading}>
    <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
      <div><h2 id="termination-report-title" className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">A. Recommended for Termination</h2><p className="text-sm text-gray-500 mt-1">Drivers showing persistent payment non-performance during the latest 8-week observation period.</p></div>
      <div className="termination-no-print flex shrink-0 gap-2"><button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"><RefreshCw aria-hidden="true" className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Refreshing…' : 'Refresh Report'}</button><button type="button" onClick={print} disabled={loading || error || !snapshot} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Printer aria-hidden="true" className="w-3.5 h-3.5" />Print Report</button></div>
    </div>
    {loading ? <p className="py-6 text-sm text-gray-500" role="status">Reading the complete active-driver payment ledger…</p>
      : error || !snapshot ? <p className="my-4 p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800" role="alert">The report could not be refreshed. Recommendations are hidden until the complete ledger loads. Please try Refresh Report again.</p>
      : <><TerminationReportContent drivers={snapshot.drivers} reportDate={snapshot.reportDate} /><p className="mt-3 text-[11px] text-gray-500">Live records read at {snapshot.loadedAt} MYT. Figures include entries recorded for the report date; today is still in progress. Refresh to include new receipts.</p></>}
    <details className="termination-no-print mt-4 text-xs text-gray-500"><summary className="cursor-pointer font-medium w-fit">How recommendations are selected</summary><p className="mt-2 max-w-4xl leading-5">The report requires repeated failures in completed weekly periods (or at least two underpaid monthly cycles with sufficient elapsed time), low cash coverage and materially increasing or persistent arrears, corroborated by payment gaps, invoice age or late cash. High outstanding alone never qualifies. Coverage near 100% and sustained recent recovery are excluded, as are insufficient history and unresolved contract/ledger exceptions. New weekly accounts need at least four completed rental periods. The open period cannot establish repetition on its own. Order follows failure frequency, cash shortfall, balance increase, payment gap and arrears age/size; no numerical score is used.</p></details>
  </section>;
}
