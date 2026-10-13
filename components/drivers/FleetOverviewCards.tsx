import React from 'react';
import { Activity, Calendar, CalendarCheck, CheckCircle2, Clock, MessageCircle } from 'lucide-react';
import { LATE_ALERT_DAYS, formatCurrency, formatDate, formatPhone, whatsappLink } from '../../utils';
import type { DriverListItem } from './useDriverListData';

type Risk = 'GOOD' | 'MID' | 'BAD';

interface FleetOverviewCardsProps {
  activeFleetCount: number;
  riskCounts: Record<Risk, number>;
  /** The risk filter on the driver list; its tile shows pressed. */
  statusFilter: 'ALL' | Risk;
  onChooseRisk: (status: Risk) => void;
  /** Total active fleet: shows the active list, ready to search. */
  onSearchActiveFleet: () => void;
  screenedCount: number;
  /** False when the shared screening table is not available yet. */
  screeningShared: boolean;
  weekTotals: { due: number; paid: number };
  monthTotals: { due: number; paid: number };
  startOfWeek: Date;
  endOfWeek: Date;
  startOfMonth: Date;
  lateAlerts: { driver: DriverListItem; days: number }[];
  lateAlertsOwed: number;
  /** A late alert shows that driver's row in the list. */
  onShowDriver: (driverId: string) => void;
}

/** The fleet overview's risk tiles; each one filters the driver list. */
const RISK_TILES: { status: 'GOOD' | 'MID' | 'BAD'; label: string; figure: string; pressedLook: string }[] = [
  { status: 'GOOD', label: 'Good', figure: 'text-emerald-600', pressedLook: 'ring-emerald-500 bg-emerald-50/40' },
  { status: 'MID', label: 'Mid', figure: 'text-amber-600', pressedLook: 'ring-amber-500 bg-amber-50/40' },
  { status: 'BAD', label: 'Bad', figure: 'text-rose-600', pressedLook: 'ring-rose-500 bg-rose-50/40' },
];

const TARGET_LOOK = {
  week: { glow: 'bg-blue-500/5', amount: 'text-blue-950', bar: 'from-blue-500 to-indigo-600' },
  month: { glow: 'bg-indigo-500/5', amount: 'text-indigo-950', bar: 'from-indigo-500 to-purple-600' },
};

/** Rent falling due in a period (the target) and how much of it has been settled (cash and repair credits). */
function TargetCard({ title, period, icon, look, totals }: { title: string; period: string; icon: React.ReactNode; look: keyof typeof TARGET_LOOK; totals: { due: number; paid: number } }) {
  const { glow, amount, bar } = TARGET_LOOK[look];
  const share = totals.due > 0 ? Math.min(100, (totals.paid / totals.due) * 100) : 0;
  return (
    <div title="Rent settled (cash and repair credits) of the rent due in this period" className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/75 backdrop-blur-md shadow-lg px-4 py-2.5">
      <div aria-hidden="true" className={`absolute top-0 right-0 w-36 h-36 rounded-full blur-2xl pointer-events-none ${glow}`} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-gray-950">{icon}{title}</h2>
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{period}</p>
      </div>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className={`text-xl xl:text-2xl font-black tracking-tight font-mono ${amount}`}>{formatCurrency(totals.paid)}</span>
        <span className="sr-only">settled</span>
        <span className="text-sm font-bold text-gray-500">of <span className="font-mono font-extrabold">{formatCurrency(totals.due)}</span></span>
        <span className="sr-only">target,</span>
        <span className="ml-auto text-xs font-bold text-gray-600">{Math.round(share)}%</span>
      </p>
      <div aria-hidden="true" className="w-full h-2.5 mt-2 p-0.5 bg-gray-200/60 rounded-full border border-white/40 shadow-inner overflow-hidden">
        <div className={`h-1.5 rounded-full bg-gradient-to-r transition-all duration-1000 ${bar}`} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

/** Fleet health (risk tiles, fleet size, today's screening), this week's and month's rent targets and the late alerts. */
export default function FleetOverviewCards({
  activeFleetCount, riskCounts, statusFilter, onChooseRisk, onSearchActiveFleet, screenedCount, screeningShared,
  weekTotals, monthTotals, startOfWeek, endOfWeek, startOfMonth, lateAlerts, lateAlertsOwed, onShowDriver,
}: FleetOverviewCardsProps) {
  const chooseRisk = onChooseRisk;
  const searchActiveFleet = onSearchActiveFleet;
  const showDriverRow = onShowDriver;
  return (
    <section aria-label="Fleet overview" className="grid grid-cols-1 md:grid-cols-12 md:grid-flow-row-dense gap-3 print:hidden">
      {/* Fleet health: risk tiles (filters), fleet size (jumps to search) and today's screening */}
      <div className="md:col-span-7 xl:col-span-5 bg-white rounded-2xl border border-gray-200 shadow-md p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 tracking-tight">
            <Activity className="w-5 h-5 text-blue-600 shrink-0" aria-hidden="true" />
            Fleet Overview & Health Status
          </h2>
          <button
            type="button"
            onClick={searchActiveFleet}
            aria-label={`${activeFleetCount} active vehicles. Search the active fleet`}
            title="Search the active fleet"
            className="flex items-baseline gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-0.5 hover:bg-gray-100 transition-colors"
          >
            <span className="text-base font-black text-gray-900">{activeFleetCount}</span>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-600">active vehicles</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {RISK_TILES.map(({ status, label, figure, pressedLook }) => {
            const pressed = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={pressed}
                onClick={() => chooseRisk(status)}
                title={pressed ? 'Click to show all drivers' : `Click to show only ${label} drivers`}
                className={`rounded-xl px-2 py-2.5 border text-center flex flex-col items-center transition-colors ${pressed ? `ring-2 border-transparent ${pressedLook}` : 'bg-gray-50/40 border-gray-200/60 hover:bg-gray-100/60'}`}
              >
                <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500">{label}</span>
                <span className={`my-0.5 text-3xl font-black leading-none ${figure}`}>{activeFleetCount ? Math.round((riskCounts[status] / activeFleetCount) * 100) : 0}%</span>
                <span className="text-sm font-bold text-gray-500">{riskCounts[status]} drivers</span>
              </button>
            );
          })}
        </div>

        {/* Daily screening progress (resets at midnight, Malaysia time) */}
        <div className="rounded-xl border border-black px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2" title={screeningShared ? 'Shared by all staff. Resets at midnight, Malaysia time (GMT+8)' : 'Not shared yet: the screening database update has not been installed, so marks last only while this page is open'}>
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-[#E11D48] shrink-0" />
            <span className="text-xs font-extrabold uppercase tracking-wider text-[#991B1B]">Screened today</span>
          </span>
          <span className="ml-auto sm:ml-0 sm:order-2 text-xs font-bold uppercase whitespace-nowrap">
            <span className="text-sm font-mono font-black text-gray-950">{screenedCount} / {activeFleetCount}</span>
            <span className="text-[#E11D48]"> · {Math.max(0, activeFleetCount - screenedCount)} pending</span>
            <span className="sr-only"> (resets at midnight, Malaysia time)</span>
          </span>
          <div aria-hidden="true" className="basis-full sm:basis-auto sm:flex-1 sm:min-w-24 sm:order-1 h-2.5 p-0.5 bg-gray-100 rounded-full border border-gray-200/40 shadow-inner overflow-hidden">
            <div className="h-full bg-[#E11D48] rounded-full transition-all duration-700" style={{ width: `${activeFleetCount > 0 ? Math.min(100, (screenedCount / activeFleetCount) * 100) : 0}%` }} />
          </div>
        </div>
      </div>

      {/* This week's and this month's rent, and how much of it has been paid */}
      <div className="md:col-span-12 xl:col-span-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
        <TargetCard
          title="Weekly Target"
          period={`${startOfWeek.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${formatDate(endOfWeek)}`}
          icon={<CalendarCheck className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />}
          look="week"
          totals={weekTotals}
        />
        <TargetCard
          title="Monthly Target"
          period={startOfMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          icon={<Calendar className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden="true" />}
          look="month"
          totals={monthTotals}
        />
      </div>

      {/* Late alerts: weekly drivers 8+ days without a payment, monthly drivers 8+ days overdue.
          Beside the targets it takes their height and scrolls, rather than stretching the row. */}
      <div className="md:col-span-5 xl:col-span-3 md:relative">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-md p-4 flex flex-col max-h-[220px] md:max-h-none md:absolute md:inset-0">
          <div className="flex items-center justify-between gap-3 mb-2 pb-2 border-b border-gray-200">
            <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900">
              <Clock className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
              Late Alerts ({LATE_ALERT_DAYS}d+)
            </h2>
            <span className="whitespace-nowrap bg-red-50 text-red-700 text-xs font-black px-2 py-0.5 rounded-full uppercase border border-red-200 tracking-wider">{lateAlerts.length} drivers</span>
          </div>
          {lateAlerts.length > 0 && (
            <p className="-mt-1 mb-2 text-xs text-gray-600">Owed by these drivers: <span className="font-mono font-bold text-rose-700">{formatCurrency(lateAlertsOwed)}</span></p>
          )}
          {lateAlerts.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-4 bg-gray-50/25 rounded-xl border border-dashed border-gray-200">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" aria-hidden="true" />
              <p className="text-xs font-bold text-gray-500">All accounts are safe and active.</p>
            </div>
          ) : (
            <ul className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
              {lateAlerts.map(({ driver, days }) => {
                const lateness = `${days} days ${driver.rentalCycle === 'MONTHLY' ? 'overdue' : 'without payment'}`;
                const owed = driver.activeBalance.baseValue;
                return (
                  <li key={driver.id} className="flex items-stretch gap-1">
                    <button
                      type="button"
                      onClick={() => showDriverRow(driver.id)}
                      aria-label={`${driver.name}, ${driver.carPlate}: ${lateness}, ${formatCurrency(owed)} owed. Show in the list`}
                      className="group flex-1 min-w-0 text-left flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-gray-100 bg-gray-50/55 hover:bg-orange-50/60 hover:border-orange-200 transition-colors text-xs"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                        <span className="min-w-0 leading-tight">
                          <span title={driver.name} className="block truncate font-bold text-gray-800 group-hover:text-orange-950">{driver.name}</span>
                          <span className="block font-mono text-gray-500">{driver.carPlate}</span>
                        </span>
                      </span>
                      <span className="shrink-0 flex flex-col items-end gap-0.5">
                        <span title={lateness} className="px-2 py-1 rounded-lg leading-none bg-orange-100/90 text-orange-950 font-mono font-extrabold">{days}d</span>
                        <span className="font-mono font-semibold text-gray-700 whitespace-nowrap">{formatCurrency(owed)}</span>
                      </span>
                    </button>
                    {driver.phone && (
                      <a
                        href={whatsappLink(driver.phone, `Hi ${driver.name}, this is ECA. Your rent for ${driver.carPlate} is ${lateness} and ${formatCurrency(owed)} is owed. Please pay as soon as possible.`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`WhatsApp ${driver.name}`}
                        title={`WhatsApp ${driver.name} (${formatPhone(driver.phone)})`}
                        className="shrink-0 w-9 flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      >
                        <MessageCircle className="w-4 h-4" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
