import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CollectionSplit } from '../../services/driverLedger';
import { formatCurrency } from '../../utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Weeks are named by their Monday, e.g. "6 Oct".
const label = (monday: string) => `${Number(monday.slice(8, 10))} ${MONTHS[Number(monday.slice(5, 7)) - 1]}`;
const money = (n: number) => formatCurrency(n || 0);
const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

// Stacked areas whose top edge is everything collected: emerald (good) for the week's own rent, amber for old arrears,
// light grey for money paid ahead. The dashed grey line is the rent due, so the gap under it is the week's shortfall.
// Emerald and amber are validated for colour-blind separation; the legend, tooltip and table carry the names.
const AREAS = [
  { key: 'current', name: "This week's rent", color: '#059669' },
  { key: 'arrears', name: 'Old arrears', color: '#d97706' },
  { key: 'ahead', name: 'Paid ahead', color: '#cbd5e1' },
] as const;
const DUE = { key: 'due', name: 'Rent due', color: '#4b5563' } as const;
const ORDER: string[] = [...AREAS.map((area) => area.name), DUE.name];
// Legend lists the series in the order above, not alphabetically.
const seriesOrder = (item: { value?: unknown; name?: unknown }) => ORDER.indexOf(String(item.value ?? item.name));

type Point = CollectionSplit & { label: string; week: string };

function WeekTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  const line = (name: string, value: number, color?: string) => (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5">{color && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />}{name}</span>
      <span className="font-mono">{money(value)}</span>
    </div>
  );
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 shadow-sm">
      <div className="mb-1 font-semibold">Week of {point.week}</div>
      {line('All collected', point.collected)}
      {AREAS.map((area) => <div key={area.key}>{line(area.name, point[area.key], area.color)}</div>)}
      {line(DUE.name, point.due)}
    </div>
  );
}

/**
 * Collected vs the week's rent, last 13 weeks. Money collected is split by the rent it settled (oldest rent first): a
 * big week of collections can be mostly old arrears, so the green area is the week's real collection.
 */
export default function CollectionTrend({ rows }: { rows: CollectionSplit[] }) {
  // The week in progress is labelled and shaded as unfinished, so its dip doesn't read as a collapse.
  const data: Point[] = rows.map((row, index) => ({ ...row, week: label(row.period),
    label: index === rows.length - 1 ? `${label(row.period)} (so far)` : label(row.period) }));
  const latest = data[data.length - 1];
  const previous = data[data.length - 2];
  return (
    <section aria-labelledby="collection-trend-heading" className="finance-panel">
      <div className="finance-section-heading">
        <div>
          <h3 id="collection-trend-heading">Collected vs the week's rent</h3>
          <p>Money in each week (Monday to Sunday, last 13 weeks), split by the rent it paid (oldest rent first). Green paid that week's own rent; amber settled rent from earlier weeks. The gap under the dashed line is rent still unpaid.</p>
        </div>
      </div>
      <figure className="m-0">
        <div className="h-64" role="img" aria-label={latest ? `Last 13 weeks. This week so far ${money(latest.collected)} collected: ${money(latest.current)} for this week's rent, ${money(latest.arrears)} for old arrears; ${money(latest.due)} rent due.` : 'No collections yet.'}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" />
              {previous && <ReferenceArea x1={previous.label} x2={latest.label} fill="#f1f5f9" fillOpacity={0.8} ifOverflow="extendDomain" />}
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} />
              <YAxis tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={false}
                tickFormatter={(value: number) => (value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value))} />
              <Tooltip content={<WeekTooltip />} />
              <Legend verticalAlign="top" itemSorter={(item) => seriesOrder(item)} formatter={(value) => <span className="text-xs text-gray-700">{value}</span>} />
              {AREAS.map((area) => (
                <Area key={area.key} type="linear" dataKey={area.key} name={area.name} stackId="collected" stroke={area.color} strokeWidth={area.key === 'current' ? 2 : 1}
                  fill={area.color} fillOpacity={area.key === 'ahead' ? 0.6 : 0.35} isAnimationActive={false} />
              ))}
              <Line type="linear" dataKey={DUE.key} name={DUE.name} stroke={DUE.color} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-blue-700 font-semibold">Show the numbers</summary>
          <div className="overflow-x-auto mt-2">
            <table className="text-xs text-left">
              <thead className="text-gray-500 uppercase">
                <tr>
                  <th className="px-2 py-1">Week of</th>
                  <th className="px-2 py-1 text-right">Rent due</th>
                  <th className="px-2 py-1 text-right">% of week's rent paid</th>
                  <th className="px-2 py-1 text-right">All collected</th>
                  <th className="px-2 py-1 text-right">This week's rent</th>
                  <th className="px-2 py-1 text-right">Old arrears</th>
                  <th className="px-2 py-1 text-right">Paid ahead</th>
                  <th className="px-2 py-1 text-right">Not cash</th>
                </tr>
              </thead>
              <tbody className="font-mono text-gray-800">
                {data.map((row) => (
                  <tr key={row.period} className="border-t border-gray-100">
                    <td className="px-2 py-1">{row.label}</td>
                    <td className="px-2 py-1 text-right">{money(row.due)}</td>
                    <td className="px-2 py-1 text-right">{percent(row.current, row.due)}</td>
                    <td className="px-2 py-1 text-right">{money(row.collected)}</td>
                    <td className="px-2 py-1 text-right">{money(row.current)}</td>
                    <td className="px-2 py-1 text-right">{money(row.arrears)}</td>
                    <td className="px-2 py-1 text-right">{money(row.ahead)}</td>
                    <td className="px-2 py-1 text-right">{money(row.notCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-gray-500">% of week's rent paid: rent due that week and paid within the same week. Not cash: service claims and deposits set against rent; they settle rent but bring in no money, so they are inside All collected.</p>
          </div>
        </details>
      </figure>
    </section>
  );
}
