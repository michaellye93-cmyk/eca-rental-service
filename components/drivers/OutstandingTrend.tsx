import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Driver } from '../../types';
import { kualaLumpurNow } from '../../utils';
import { money, MONTH_SHORT } from '../../services/fmt';
import { monthlyOutstanding, outstandingDirection, TREND_MONTHS, type OutstandingDirection } from '../../services/outstandingTrend';

// Month-ends are named "Sep 26"; this month reads "Oct 26 (today)".
const label = (month: string) => `${MONTH_SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;

const LOOK: Record<OutstandingDirection, { text: string; badge: string }> = {
  RISING: { text: 'Rising', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  FLAT: { text: 'Flat', badge: 'bg-gray-50 text-gray-700 border-gray-200' },
  FALLING: { text: 'Falling', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NEW: { text: 'Too new to tell', badge: 'bg-gray-50 text-gray-600 border-gray-200' },
};

/** Rent outstanding at each month-end over the last 12 months, with whether it is rising, flat or falling. */
export default function OutstandingTrend({ driver }: { driver: Driver }) {
  const points = useMemo(() => monthlyOutstanding(driver, kualaLumpurNow()), [driver]);
  const trend = useMemo(() => outstandingDirection(driver, points), [driver, points]);
  const data = points.map(point => ({ ...point, label: point.soFar ? `${label(point.month)} (today)` : label(point.month) }));
  const latest = data[data.length - 1];
  if (!latest) return null;
  const look = LOOK[trend.direction];
  const since = `the end of ${label(points[points.length - 1 - trend.months]?.month ?? latest.month)}`;
  const detail = trend.direction === 'NEW' ? 'Needs a second month to compare.'
    : trend.change === 0 ? `Same as ${since}.`
    : `${trend.change > 0 ? 'Up' : 'Down'} ${money(Math.abs(trend.change))} since ${since}.`;

  return (
    <section aria-labelledby={`outstanding-trend-${driver.id}`} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 id={`outstanding-trend-${driver.id}`} className="text-sm font-bold text-gray-900">Outstanding trend</h5>
        <span className="flex items-center gap-2 text-xs">
          <span className={`rounded border px-2 py-0.5 font-black uppercase tracking-wider ${look.badge}`}>{look.text}</span>
          <span className="text-gray-600">{detail}</span>
        </span>
      </div>
      <p className="text-xs text-gray-500">Rent owed at the end of each month (last {TREND_MONTHS} months; this month as of today), without the late-payment penalty.</p>
      <figure className="m-0">
        <div className="h-48" role="img" aria-label={`Rent outstanding at each month-end. Today ${money(latest.outstanding)}. ${look.text}: ${detail}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} />
              <YAxis allowDecimals={false} domain={[0, (dataMax: number) => Math.max(dataMax, driver.rentalRate)]} tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={false}
                tickFormatter={(value: number) => (value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value))} />
              <Tooltip formatter={(value: number) => [money(value), 'Outstanding']} itemStyle={{ color: '#1f2937' }} />
              <Line type="linear" dataKey="outstanding" name="Outstanding" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer text-blue-700 font-semibold">Show the numbers</summary>
          <div className="overflow-x-auto mt-2">
            <table className="text-xs text-left">
              <thead className="text-gray-500 uppercase">
                <tr><th className="px-2 py-1">Month-end</th><th className="px-2 py-1 text-right">Outstanding</th></tr>
              </thead>
              <tbody className="font-mono text-gray-800">
                {data.map(point => (
                  <tr key={point.month} className="border-t border-gray-100">
                    <td className="px-2 py-1">{point.label}</td>
                    <td className="px-2 py-1 text-right">{money(point.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </figure>
    </section>
  );
}
