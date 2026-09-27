import React from 'react';
import type { CashLineSummary, CashStatus } from '../../services/cashOutlook';
import { formatCurrency } from '../../utils';

/** Status colours are fixed (good / warning / serious / critical); every status also has its own icon and word. */
const STATUS_LOOK: Record<CashStatus, { label: string; color: string; icon: 'alert' | 'watch' | 'check' }> = {
  SHORT: { label: 'Short', color: '#d03b3b', icon: 'alert' },
  TIGHT: { label: 'Tight', color: '#ec835a', icon: 'alert' },
  WATCH: { label: 'Watch', color: '#fab219', icon: 'watch' },
  COVERED: { label: 'Covered', color: '#0ca30c', icon: 'check' },
};

export function CashStatusPill({ status, size = 'sm' }: { status: CashStatus; size?: 'sm' | 'md' }) {
  const look = STATUS_LOOK[status];
  const box = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white font-bold text-gray-900 ${size === 'md' ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-xs'}`}>
      <svg viewBox="0 0 16 16" className={box} aria-hidden="true">
        {look.icon === 'alert' && <><path d="M8 1.5 15 14H1z" fill={look.color} /><path d="M8 6v3.6" stroke="#111827" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="11.6" r="0.95" fill="#111827" /></>}
        {look.icon === 'watch' && <><circle cx="8" cy="8" r="6.5" fill={look.color} /><path d="M8 4.5V8l2.3 1.6" stroke="#111827" strokeWidth="1.5" strokeLinecap="round" fill="none" /></>}
        {look.icon === 'check' && <><circle cx="8" cy="8" r="6.5" fill={look.color} /><path d="m5 8.2 2 2 4-4.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>}
      </svg>
      {look.label}
    </span>
  );
}

/** The status sentence without its leading "Tight:" style word, for use next to the pill that already says it. */
export const sentenceBody = (sentence: string) => {
  const body = sentence.replace(/^(Short|Tight|Watch|Covered): /, '');
  return body.charAt(0).toUpperCase() + body.slice(1);
};

const ageText = (days: number) => (days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`);

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-1.5 border-r border-gray-200 flex flex-col justify-center min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-gray-600">{label}</dt>
      <dd className="text-[15px] font-semibold text-gray-900 whitespace-nowrap">{children}</dd>
    </div>
  );
}

/**
 * The always-on cash line under the admin top bar: cash in bank, what is left after the next 30 days of bills, overdue
 * rent, and one plain sentence with a status. Clicking it opens Money → Cash.
 */
export default function CashLine({ summary, state, onOpen }: { summary: CashLineSummary | null; state: 'loading' | 'ready' | 'unavailable'; onOpen: () => void }) {
  const frame = 'bg-white border-b border-gray-200 print:hidden';
  const inner = 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8';
  if (state === 'unavailable') {
    return (
      <div className={frame}>
        <p className={`${inner} py-2 text-xs text-gray-600`}>
          Cash line unavailable: the cash database update has not been installed, or Finance could not be reached. Reload the page to try again.
        </p>
      </div>
    );
  }
  if (state === 'loading' || !summary) {
    return (
      <div className={frame} aria-busy="true">
        <p className={`${inner} py-3 text-xs text-gray-500`}>Working out your cash position…</p>
      </div>
    );
  }
  const change = summary.overdueChange;
  return (
    <section aria-label="Cash position" className={frame}>
      <div className={`${inner} flex items-stretch`}>
        <dl className="hidden md:flex items-stretch -ml-4">
          <Tile label="Cash in bank">
            {summary.cash ? <>{formatCurrency(summary.cash.total)} <span className="text-xs font-medium text-gray-600">· {ageText(summary.cash.ageDays)}</span></> : <span className="text-gray-600">Not entered</span>}
          </Tile>
          <Tile label="Next 30 days">
            {summary.left !== null
              ? <><span className={summary.left < 0 ? 'text-rose-700' : ''}>{formatCurrency(summary.left)}</span> <span className="text-xs font-medium text-gray-600">left after bills</span></>
              : <><span className={summary.net < 0 ? 'text-rose-700' : ''}>{formatCurrency(summary.net)}</span> <span className="text-xs font-medium text-gray-600">in less bills</span></>}
          </Tile>
          <Tile label="Overdue rent">
            {formatCurrency(summary.overdue)}{' '}
            {change > 0.005 ? <span className="text-xs font-semibold text-rose-700">▲ {formatCurrency(change)} this week</span>
              : change < -0.005 ? <span className="text-xs font-semibold text-emerald-700">▼ {formatCurrency(-change)} this week</span>
                : <span className="text-xs font-medium text-gray-600">no change this week</span>}
          </Tile>
        </dl>
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 flex items-center gap-3 py-2 md:pl-4 text-left hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <CashStatusPill status={summary.status} />
          <span className="min-w-0 text-sm leading-snug text-gray-900">{sentenceBody(summary.sentence)}</span>
          <span className="ml-auto shrink-0 text-xs font-semibold text-blue-700 whitespace-nowrap">Cash page ›</span>
        </button>
      </div>
    </section>
  );
}
