import { AlertTriangle, Calendar, CheckCircle2, ChevronRight, MessageSquareText, Pencil, Trash2, TrendingDown, TrendingUp, UserMinus } from 'lucide-react';
import { dayTagCheck, formatCurrency, formatDate, kualaLumpurNow } from '../../utils';
import { collectionSummary, type CatchUpStatus } from '../../services/collections';
import { ExpandedDriverDetails } from '../ExpandedDriverDetails';
import CollectionsPanels from '../CollectionsPanels';
import type { CollectionsExtras } from '../useCollectionsExtras';
import type { DriverListItem } from './useDriverListData';

/** A driver's open or recently missed promise and running catch-up plan, shown as chips on the row. */
export type CollectionChips = { promise?: { text: string; missed: boolean }; plan?: { text: string; state: CatchUpStatus['state'] } };

const PLAN_CHIP: Record<CatchUpStatus['state'], string> = {
  ON_TRACK: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BEHIND: 'bg-rose-50 text-rose-800 border-rose-200',
  NOT_STARTED: 'bg-slate-50 text-slate-700 border-slate-200',
  ENDED: 'bg-slate-50 text-slate-700 border-slate-200',
  STOPPED: 'bg-slate-50 text-slate-700 border-slate-200',
};

interface DriverRowProps {
  driver: DriverListItem;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Briefly ringed after choosing the driver from the late alerts. */
  highlighted: boolean;
  /** Marked screened today. */
  screened: boolean;
  onScreen: () => void;
  chips?: CollectionChips;
  /** The recovery bar's start, e.g. "1 Sep". */
  recoverySinceLabel: string;
  driverScope: 'ACTIVE' | 'DELISTED' | 'TERMINATION';
  userRole: 'admin' | 'staff';
  extras: CollectionsExtras;
  /** Kuala Lumpur's date, YYYY-MM-DD. */
  today: string;
  onPayment: () => void;
  onStatement: () => void;
  onEdit: () => void;
  onDelist: () => void;
  onDelete: () => void;
  /** Records a deposit used for rent (from the expanded details). */
  onContraPayment: (amount: number, date: string) => void;
}

/** One driver in the collections list: name, chips, risk and timing, outstanding and recovery, actions, and the expanded details. */
export default function DriverRow({
  driver, expanded, onToggleExpand, highlighted, screened, onScreen, chips, recoverySinceLabel, driverScope, userRole, extras, today,
  onPayment, onStatement, onEdit, onDelist, onDelete, onContraPayment,
}: DriverRowProps) {
  // The row's figures are the driver's account facts, the same ones the driver's phone page reads
  const m = driver.account;
  const cycleLabel = driver.rentalCycle === 'MONTHLY' ? 'Months' : 'Weeks';
  // The latest payment and the row's warning: weekly rent 8+ days without a payment; monthly rent the late-alert
  // rule (oldest unpaid rent 8+ days past its due date), so in the active list a monthly row is red exactly when it
  // is a late alert (a delisted row still shows rent left unpaid)
  const lastPaid = m.lastPayment;
  const payWarning = m.payWarning;
  const payWarningText = payWarning ? (payWarning.kind === 'overdue' ? `Rent ${payWarning.days} days overdue` : `${payWarning.days} days without payment`) : undefined;
  const nextDueStr = formatDate(m.dueDate, 'N/A');
  // Active drivers whose day tag disagrees with their rent day (or who have none)
  const tagCheck = driver.isDelisted ? null : dayTagCheck(driver);
  const currentOutstanding = driver.activeBalance.baseValue;
  const baselineOutstanding = driver.recoveryBaseline;
  let labelText = 'Restored';
  let valueText = '';
  let progressPercent = 0;
  let barColorClass = 'bg-gray-300';
  if (baselineOutstanding > 0) {
    if (currentOutstanding < baselineOutstanding) {
      const restoredAmount = baselineOutstanding - currentOutstanding;
      progressPercent = (restoredAmount / baselineOutstanding) * 100;
      labelText = 'Restored';
      valueText = `${formatCurrency(restoredAmount)} / ${formatCurrency(baselineOutstanding)}`;
      barColorClass = progressPercent > 75 ? 'bg-emerald-500' : progressPercent > 35 ? 'bg-teal-500' : 'bg-indigo-500';
    } else if (currentOutstanding > baselineOutstanding) {
      const addedDebt = currentOutstanding - baselineOutstanding;
      progressPercent = (addedDebt / baselineOutstanding) * 105; // allow some visibility scale
      labelText = 'Slipped';
      valueText = `+${formatCurrency(addedDebt)} / ${formatCurrency(baselineOutstanding)}`;
      barColorClass = 'bg-rose-500';
    } else {
      labelText = 'Restored';
      valueText = `${formatCurrency(0)} / ${formatCurrency(baselineOutstanding)}`;
      progressPercent = 0;
      barColorClass = 'bg-gray-200';
    }
  } else if (currentOutstanding > 0) {
    progressPercent = 100;
    labelText = 'Slipped';
    valueText = `+${formatCurrency(currentOutstanding)} / ${formatCurrency(driver.rentalRate)}`;
    barColorClass = 'bg-rose-500';
  }

  return (
    <li id={`driver-row-${driver.id}`}>
      <div className={`relative bg-white rounded-lg border border-slate-200 shadow-sm hover:border-slate-300 transition-colors ${highlighted ? 'ring-2 ring-orange-500' : ''}`}>
        <span aria-hidden="true" className={`absolute left-0 inset-y-0 w-1.5 rounded-l-lg ${m.status === 'GOOD' ? 'bg-emerald-500' : m.status === 'MID' ? 'bg-amber-500' : 'bg-rose-500'}`}></span>
        <div className="grid gap-3 px-3 py-2.5 pl-4 lg:grid-cols-[minmax(0,1fr)_13rem_17rem_14.5rem] xl:grid-cols-[minmax(0,1fr)_14rem_18.5rem_14.5rem] lg:items-center lg:gap-0">
          {/* Driver */}
          <div className="flex items-start gap-2 min-w-0 lg:pr-4">
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} details for ${driver.name}`}
              onClick={() => onToggleExpand()}
              className="w-11 h-11 lg:w-8 lg:h-8 -ml-1 shrink-0 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ChevronRight className={`w-4 h-4 transform transition-transform duration-300 ${expanded ? 'rotate-90 text-blue-600' : ''}`} aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1 pt-1 lg:pt-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-900 text-base truncate">{driver.name}</h3>
                {!screened && !driver.isDelisted && (
                  <button type="button" onClick={() => onScreen()} className="relative flex h-6 w-6 -m-1.5 items-center justify-center cursor-pointer shrink-0" title="Not screened today (click to mark screened)" aria-label={`Mark ${driver.name} as screened today`}>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600 border border-white hover:bg-rose-700 shadow-sm"></span>
                  </button>
                )}
                {screened && !driver.isDelisted && (
                  <span title="Screened today" role="img" aria-label="Screened today" className="inline-flex"><CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" /></span>
                )}
                {driver.debtTrend.isStreak && (
                  <span title="Outstanding has gone up three weeks in a row" className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">Debt up 3 weeks</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-xs flex-wrap">
                <span className="font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{driver.carPlate}</span>
                <span className="flex items-center gap-1 font-bold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100"><Calendar className="w-3 h-3" aria-hidden="true" /> Due {nextDueStr}</span>
                {driver.category && <span className={`font-bold px-1.5 py-0.5 uppercase tracking-wider rounded border ${driver.category === 'SEWABELI' ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-orange-50 text-orange-800 border-orange-200'}`}>{driver.category === 'SEWABELI' ? 'Sewabeli' : 'Sewa Biasa'}</span>}
                {driver.tags?.map((tag, i) => <span key={i} className="bg-slate-50 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-medium">{tag}</span>)}
                {driver.collectionArrangement && (
                  <span title={collectionSummary(driver) ?? undefined} className="max-w-[16rem] truncate font-semibold px-1.5 py-0.5 rounded border bg-teal-50 text-teal-900 border-teal-200">{driver.collectionArrangement}</span>
                )}
                {chips?.promise && (
                  <span className={`font-bold px-1.5 py-0.5 rounded border ${chips!.promise!.missed ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-blue-50 text-blue-800 border-blue-200'}`}>{chips!.promise!.text}</span>
                )}
                {chips?.plan && (
                  <span className={`font-bold px-1.5 py-0.5 rounded border ${PLAN_CHIP[chips!.plan!.state]}`}>{chips!.plan!.text}</span>
                )}
                {tagCheck && !tagCheck.ok && (
                  <span title={`Rent falls due ${tagCheck.expected === 'MONTHLY' ? 'monthly' : `every ${tagCheck.expected}`}, so the day tag should be ${tagCheck.expected}. Fix it with Edit.`} className="flex items-center gap-1 font-bold text-amber-900 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                    {tagCheck.tagged.length ? `Tag ${tagCheck.tagged.join('/')}` : 'No day tag'} · rent {tagCheck.expected === 'MONTHLY' ? 'monthly' : tagCheck.expected}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Risk status and payment timing */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs lg:flex-col lg:justify-center lg:gap-1 lg:border-l lg:border-slate-100 lg:px-3 lg:text-center">
            <span className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${m.status === 'GOOD' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : m.status === 'MID' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>{m.status}</span>
              <span className="font-bold text-slate-600">{m.cyclesOwed > 0 ? `${m.cyclesOwed.toFixed(1)} ${cycleLabel} Owed` : 'Up to date'}</span>
            </span>
            <span title={payWarningText} className={`flex items-center gap-1 ${payWarning ? 'font-semibold text-rose-700' : lastPaid ? 'font-semibold text-slate-500' : 'text-slate-500'}`}>
              {payWarning && <AlertTriangle className="w-3 h-3" aria-hidden="true" />}
              {lastPaid ? `Last pay: ${formatDate(lastPaid.date)}` : 'No payment yet'}
              {/* A recent payment can still be red on monthly rent, so the reason is shown, not only on hover */}
              {payWarning?.kind === 'overdue' && <span aria-hidden="true" className="whitespace-nowrap">· {payWarning.days}d overdue</span>}
              {payWarningText && <span className="sr-only"> ({payWarningText})</span>}
            </span>
          </div>

          {/* Outstanding */}
          <div className="flex flex-col gap-1 lg:items-end lg:border-l lg:border-slate-100 lg:px-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 lg:justify-end lg:gap-x-2">
              <span className="font-bold text-lg">
                {currentOutstanding > 0 ? <span className="text-rose-700">{formatCurrency(currentOutstanding)}</span> : <span className="text-emerald-700">PAID</span>}
              </span>
              {driver.debtTrend.direction !== 'FLAT' && (
                <span title="Change in outstanding over the last 7 days" className={`text-xs font-bold flex items-center gap-1 ${driver.debtTrend.direction === 'UP' ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {driver.debtTrend.direction === 'UP' ? <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" /> : <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />}
                  {driver.debtTrend.direction === 'UP' ? '+' : '−'}{formatCurrency(driver.debtTrend.value)} in 7 days
                </span>
              )}
            </div>
            {(currentOutstanding > 0 || baselineOutstanding > 0) && (
              <div className="w-full text-left">
                <div className="flex flex-wrap justify-between items-center gap-x-2 text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  <span>{labelText} since {recoverySinceLabel}</span>
                  <span className="font-mono normal-case tracking-normal">{valueText}</span>
                </div>
                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full ${barColorClass} transition-all duration-500`} style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}></div>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 lg:justify-center lg:border-l lg:border-slate-100 lg:pl-3">
            <button type="button" onClick={onPayment} aria-label={`Record payment for ${driver.name}`} className="flex-1 lg:flex-none min-h-11 lg:min-h-0 px-3 lg:px-2.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1 transition-colors">
              <span className="font-bold text-xs">RM</span> Payment
            </button>
            <button type="button" onClick={onStatement} aria-label={`WhatsApp statement for ${driver.name}`} title="WhatsApp statement" className="shrink-0 w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center text-emerald-800 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"><MessageSquareText className="w-5 h-5 shrink-0" aria-hidden="true" /></button>
            <button type="button" onClick={onEdit} aria-label={`Edit ${driver.name}`} title="Edit driver" className="shrink-0 w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"><Pencil className="w-5 h-5 shrink-0" aria-hidden="true" /></button>
            {driverScope === 'ACTIVE'
              ? <button type="button" onClick={onDelist} aria-label={`Delist ${driver.name}`} title="Delist driver" className="shrink-0 w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"><UserMinus className="w-5 h-5 shrink-0" aria-hidden="true" /></button>
              : userRole === 'admin' && <button type="button" onClick={onDelete} aria-label={`Delete ${driver.name}`} title="Delete driver" className="shrink-0 w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"><Trash2 className="w-5 h-5 shrink-0" aria-hidden="true" /></button>}
          </div>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-2 sm:p-4">
          <ExpandedDriverDetails driver={driver} isAdmin={userRole === 'admin'} onLogPaymentClick={onPayment} onContraPayment={onContraPayment} onEditDriver={onEdit} />
          {!driver.isDelisted && <CollectionsPanels driver={driver} extras={extras} isAdmin={userRole === 'admin'} today={today} now={kualaLumpurNow()} />}
        </div>
      )}
    </li>
  );
}
