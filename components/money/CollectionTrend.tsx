import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CollectionSplit } from '../../services/driverLedger';
import { formatCurrency } from '../../utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;
const money = (n: number) => formatCurrency(n || 0);
const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

// Blue total, emerald (good) for this month's rent, amber for old arrears, grey dashed for the rent due. Validated for
// colour-blind separation; each line also has its own marker and the legend and table carry the names.
const SERIES = [
  { key: 'collected', name: 'Collected (all money in)', color: '#2563eb', dot: { r: 4 } },
  { key: 'current', name: "Paid for this month's rent", color: '#059669', dot: { r: 5 }, width: 3 },
  { key: 'arrears', name: 'Paid for old arrears', color: '#d97706', dot: { r: 4 } },
  { key: 'due', name: 'Rent due this month', color: '#6b7280', dot: false, dash: '6 4' },
] as const;
// Legend and tooltip list the lines in the order above, not alphabetically.
const seriesOrder = (item: { value?: unknown; name?: unknown }) => SERIES.findIndex((series) => series.name === (item.value ?? item.name));

/**
 * Collected vs paid for this month's rent, last 6 months. Money collected is split by the rent it settled (oldest rent
 * first): a big month of collections can be mostly old arrears, so the green line is the month's real collection.
 */
export default function CollectionTrend({ rows }: { rows: CollectionSplit[] }) {
  const data = rows.map((row) => ({ ...row, label: label(row.month) }));
  const latest = rows[rows.length - 1];
  return (
    <section aria-labelledby="collection-trend-heading" className="finance-panel">
      <div className="finance-section-heading">
        <div>
          <h3 id="collection-trend-heading">Collected vs this month's rent</h3>
          <p>Money in each month, split by the rent it paid (oldest rent first). Green is what came in for the month's own rent; amber settled earlier months. This month: up to today.</p>
        </div>
      </div>
      <figure className="m-0">
        <div className="h-64" role="img" aria-label={latest ? `Last 6 months. This month ${money(latest.collected)} collected, ${money(latest.current)} for this month's rent, ${money(latest.arrears)} for old arrears, ${money(latest.due)} rent due.` : 'No collections yet.'}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} />
              <YAxis tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={false} width={56}
                tickFormatter={(value: number) => (value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value))} />
              <Tooltip formatter={(value) => money(Number(value))} itemSorter={(item) => seriesOrder(item)} itemStyle={{ color: '#1f2937' }} />
              <Legend verticalAlign="top" height={28} itemSorter={(item) => seriesOrder(item)} formatter={(value) => <span className="text-xs text-gray-700">{value}</span>} />
              {SERIES.map((series) => (
                <Line key={series.key} type="linear" dataKey={series.key} name={series.name} stroke={series.color}
                  strokeWidth={'width' in series ? series.width : 2} strokeDasharray={'dash' in series ? series.dash : undefined}
                  dot={series.dot} activeDot={series.dot === false ? false : { r: 6 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-blue-700 font-semibold">Show the numbers</summary>
          <div className="overflow-x-auto mt-2">
            <table className="text-xs text-left">
              <thead className="text-gray-500 uppercase">
                <tr>
                  <th className="px-2 py-1">Month</th>
                  <th className="px-2 py-1 text-right">Rent due</th>
                  <th className="px-2 py-1 text-right">Collected</th>
                  <th className="px-2 py-1 text-right">For this month</th>
                  <th className="px-2 py-1 text-right">For old arrears</th>
                  <th className="px-2 py-1 text-right">Paid ahead</th>
                  <th className="px-2 py-1 text-right">This month's rent paid</th>
                  <th className="px-2 py-1 text-right">Not cash</th>
                </tr>
              </thead>
              <tbody className="font-mono text-gray-800">
                {rows.map((row) => (
                  <tr key={row.month} className="border-t border-gray-100">
                    <td className="px-2 py-1">{label(row.month)}</td>
                    <td className="px-2 py-1 text-right">{money(row.due)}</td>
                    <td className="px-2 py-1 text-right">{money(row.collected)}</td>
                    <td className="px-2 py-1 text-right">{money(row.current)}</td>
                    <td className="px-2 py-1 text-right">{money(row.arrears)}</td>
                    <td className="px-2 py-1 text-right">{money(row.ahead)}</td>
                    <td className="px-2 py-1 text-right">{percent(row.current, row.due)}</td>
                    <td className="px-2 py-1 text-right">{money(row.notCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-gray-500">Not cash: service claims and deposits set against rent. They settle rent but bring in no money, so they are inside Collected.</p>
          </div>
        </details>
      </figure>
    </section>
  );
}
