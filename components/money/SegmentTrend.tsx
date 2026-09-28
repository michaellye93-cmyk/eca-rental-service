import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { DriverWithMetrics } from '../../types';
import { formatCurrency, kualaLumpurNow } from '../../utils';
import { balanceTrend, segmentHistory } from '../../services/collections';

// The dashboard's GOOD / MID / BAD colours (emerald, amber, rose); checked for colour-blind separation.
const SEGMENTS = [
  { key: 'GOOD', label: 'Good', color: '#059669' },
  { key: 'MID', label: 'Mid', color: '#f59e0b' },
  { key: 'BAD', label: 'Bad', color: '#e11d48' },
] as const;

// Legend and tooltip list the segments in stack order (Good, Mid, Bad), not alphabetically
const segmentOrder = (item: { value?: unknown; name?: unknown }) => SEGMENTS.findIndex(segment => segment.label === (item.value ?? item.name));

const signed = (amount: number) => (amount > 0.005 ? `+${formatCurrency(amount)}` : amount < -0.005 ? `−${formatCurrency(-amount)}` : formatCurrency(0));

/**
 * The owner's daily outlook: GOOD / MID / BAD drivers at the end of each of the last 12 weeks, and every active driver
 * who owes, not improving first (improving = the balance fell over 28 days and did not rise over the last 7).
 */
export default function SegmentTrend({ drivers }: { drivers: DriverWithMetrics[] }) {
  const { weeks, rows, upToDate } = useMemo(() => {
    const now = kualaLumpurNow();
    const owing = drivers
      .filter(driver => !driver.isDelisted)
      .map(driver => ({ driver, trend: balanceTrend(driver, now) }));
    return {
      weeks: segmentHistory(drivers, now, 12),
      rows: owing
        .filter(row => row.trend.trend !== 'UP_TO_DATE')
        .sort((a, b) => Number(a.trend.trend === 'IMPROVING') - Number(b.trend.trend === 'IMPROVING') || b.trend.outstanding - a.trend.outstanding),
      upToDate: owing.filter(row => row.trend.trend === 'UP_TO_DATE').length,
    };
  }, [drivers]);
  const latest = weeks[weeks.length - 1];
  const notImproving = rows.filter(row => row.trend.trend === 'NOT_IMPROVING').length;

  return (
    <section aria-labelledby="segment-trend-heading" className="space-y-4 p-4 sm:p-6 border-b border-gray-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="segment-trend-heading" className="text-lg font-bold text-gray-900">Segment trend</h2>
        {latest && (
          <p className="text-sm text-gray-700">
            Now: <strong>{latest.GOOD}</strong> good · <strong>{latest.MID}</strong> mid · <strong>{latest.BAD}</strong> bad ·{' '}
            <strong>{notImproving}</strong> not improving
          </p>
        )}
      </div>

      <figure className="m-0">
        <figcaption className="text-xs text-gray-600 mb-2">Active drivers by risk at the end of each week (this week: today), last 12 weeks.</figcaption>
        <div className="h-64" role="img" aria-label={`Good, mid and bad drivers each week for the last 12 weeks. This week: ${latest?.GOOD ?? 0} good, ${latest?.MID ?? 0} mid, ${latest?.BAD ?? 0} bad.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="week" tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} labelFormatter={week => `Week of ${week}`} itemSorter={item => segmentOrder(item)} itemStyle={{ color: '#1f2937' }} />
              <Legend verticalAlign="top" height={28} iconType="square" itemSorter={item => segmentOrder(item)} formatter={value => <span className="text-xs text-gray-700">{value}</span>} />
              {SEGMENTS.map((segment, index) => (
                <Bar key={segment.key} dataKey={segment.key} name={segment.label} stackId="risk" fill={segment.color} stroke="#ffffff" strokeWidth={2}
                  radius={index === SEGMENTS.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={36} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-blue-700 font-semibold">Show the numbers</summary>
          <div className="overflow-x-auto mt-2">
            <table className="text-xs text-left">
              <thead className="text-gray-500 uppercase">
                <tr><th className="px-2 py-1">Week of</th>{SEGMENTS.map(segment => <th key={segment.key} className="px-2 py-1 text-right">{segment.label}</th>)}</tr>
              </thead>
              <tbody className="font-mono text-gray-800">
                {weeks.map(week => (
                  <tr key={week.week} className="border-t border-gray-100">
                    <td className="px-2 py-1">{week.week}</td>
                    {SEGMENTS.map(segment => <td key={segment.key} className="px-2 py-1 text-right">{week[segment.key]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </figure>

      <div>
        <h3 className="text-sm font-bold text-gray-900 mb-2">Drivers who owe, not improving first</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-600">No active driver owes rent.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-500">
                <tr>
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2">Risk</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-right">7 days</th>
                  <th className="px-3 py-2 text-right">28 days</th>
                  <th className="px-3 py-2">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(({ driver, trend }) => (
                  <tr key={driver.id}>
                    <td className="px-3 py-2"><span className="font-semibold text-gray-900">{driver.name}</span> <span className="font-mono text-xs text-gray-600">{driver.carPlate}</span></td>
                    <td className="px-3 py-2 text-xs font-bold">{driver.metrics.status}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(trend.outstanding)}</td>
                    <td className="px-3 py-2 text-right font-mono">{signed(trend.change7)}</td>
                    <td className="px-3 py-2 text-right font-mono">{signed(trend.change28)}</td>
                    <td className="px-3 py-2">
                      {trend.trend === 'IMPROVING'
                        ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800"><TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />Improving</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-800"><TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />Not improving</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-600">{upToDate} active {upToDate === 1 ? 'driver owes' : 'drivers owe'} nothing. Improving: the balance fell over 28 days and did not rise over the last 7.</p>
      </div>
    </section>
  );
}
