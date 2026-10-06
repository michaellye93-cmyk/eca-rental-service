import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DriverWithMetrics } from '../../types';
import { kualaLumpurNow } from '../../utils';
import { segmentHistory } from '../../services/collections';

// The dashboard's GOOD / MID / BAD colours (emerald, amber, rose); checked for colour-blind separation.
const SEGMENTS = [
  { key: 'GOOD', label: 'Good', color: '#059669' },
  { key: 'MID', label: 'Mid', color: '#f59e0b' },
  { key: 'BAD', label: 'Bad', color: '#e11d48' },
] as const;

// Legend and tooltip list the segments in stack order (Good, Mid, Bad), not alphabetically
const segmentOrder = (item: { value?: unknown; name?: unknown }) => SEGMENTS.findIndex(segment => segment.label === (item.value ?? item.name));

/** GOOD / MID / BAD active drivers at the end of each of the last 12 weeks. */
export default function SegmentTrend({ drivers }: { drivers: DriverWithMetrics[] }) {
  const weeks = useMemo(() => segmentHistory(drivers, kualaLumpurNow(), 12), [drivers]);
  const latest = weeks[weeks.length - 1];

  return (
    <section aria-labelledby="segment-trend-heading" className="finance-panel">
      <div className="finance-section-heading">
        <div>
          <h3 id="segment-trend-heading">Segment trend</h3>
          <p>Active drivers by risk at the end of each week (this week: today), last 12 weeks.</p>
        </div>
      </div>
      <figure className="m-0">
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
    </section>
  );
}
