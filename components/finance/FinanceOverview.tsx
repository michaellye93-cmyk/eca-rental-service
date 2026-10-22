import { useMemo } from "react";
import { Bar, Cell, ComposedChart, LabelList, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRightIcon } from "@radix-ui/react-icons";
import { kualaLumpurNow, overdueRent } from "../../utils";
import { klDateTime, money, monthLong, percent, percent1 } from "../../services/fmt";
import StatTile from "../StatTile";
import type { FinanceInput, FinanceReport } from "../../types/finance";
import type { DriverWithMetrics } from "../../types";
import type { Page } from "../../services/finance/pages";
import { marginTarget, monthCashFlow, trendChartAxes, trendChartData, type TrendChartPoint, type TrendRow } from "../../services/finance/dashboard";
import { directCostBreakdown } from "../../services/finance/directCost";
import { collectionSplit, monthCollection, monthPeriod } from "../../services/driverLedger";
import { DataTable, SectionHeading, Skeleton } from "./FinancePrimitives";

/** The line under the P&L: when the month's E-Hailing payments were last read (a Draft month refreshes on opening). */
const eHailingAsOf = (refreshedAt: string | null) => {
  const at = klDateTime(refreshedAt);
  return at ? `E-Hailing figures as of ${at}.` : "E-Hailing figures have not been read for this month yet.";
};

const statusLabel = (status: string) => (status === "READY FOR REVIEW" ? "Ready" : status === "CLOSED" ? "Closed" : "Draft");

// Revenue in light grey, operating profit in the Finance accent (red for a loss), the margin line in amber, the 20% target dashed.
const COLORS = { revenue: "#cbd5e1", profit: "#167c70", loss: "#dc2626", margin: "#d97706", target: "#4b5563" } as const;
const LEGEND_ORDER = ["Revenue", "Operating profit", "Operating margin"];

function MonthTooltip({ active, payload, rows }: { active?: boolean; payload?: Array<{ payload: TrendChartPoint }>; rows: TrendRow[] }) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  const status = rows.find((row) => row.month === point.month)?.status ?? "DRAFT";
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 shadow-sm">
      <div className="mb-1 font-semibold">{monthLong(point.month)} · {statusLabel(status)}</div>
      <div className="flex justify-between gap-4"><span>Revenue</span><span className="font-mono">{money(point.revenue)}</span></div>
      <div className="flex justify-between gap-4"><span>Operating profit</span><span className="font-mono">{money(point.profit)}</span></div>
      <div className="flex justify-between gap-4"><span>Operating margin</span><span className="font-mono">{point.margin === null ? "—" : `${point.margin.toFixed(1)}%`}</span></div>
    </div>
  );
}

/**
 * Finance → Overview, the CEO's page: four tiles (operating margin, collected, overdue rent today, idle cars), the P&L
 * and the month as cash, and the month-by-month trend as a chart with its numbers underneath.
 */
export default function Overview({
  report,
  input,
  drivers,
  month,
  trend,
  overdueChange,
  onGo,
}: {
  report: FinanceReport | null;
  input: FinanceInput;
  drivers: DriverWithMetrics[];
  month: string;
  trend: TrendRow[] | null;
  /** This week's change in overdue rent, as the cash line shows it; null when the cash line is not available. */
  overdueChange: number | null;
  onGo: (page: Page) => void;
}) {
  // The reporting month's collection rate and its split; overdue rent is today's, active drivers (as on Collections).
  const rent = useMemo(() => {
    const now = kualaLumpurNow();
    const key = month.slice(0, 7);
    return {
      collection: monthCollection(drivers, key, now),
      split: collectionSplit(drivers, [monthPeriod(key)], now)[0],
      overdue: drivers.filter((driver) => !driver.isDelisted).reduce((sum, driver) => sum + overdueRent(driver, now), 0),
    };
  }, [drivers, month]);
  const chart = useMemo(() => trendChartData(trend ?? []), [trend]);
  const axes = useMemo(() => trendChartAxes(chart), [chart]);
  if (!report)
    return (
      <section className="finance-panel">
        <Skeleton lines={8} />
      </section>
    );
  const totals = report.totals;
  const target = marginTarget(report, 0.2);
  const cashFlow = monthCashFlow(input, report);
  // Sewa Beli downpayments received and deposits forfeited this month: income, but kept aside from revenue and the
  // target (owner, 2026-10-06). Deposits used for rent (contra) are already rent revenue through their rent payment.
  const extraIncome = Math.round((input.deposits ?? []).filter((d) => (d.kind === "DOWNPAYMENT" && d.entry === "RECEIVED") || d.entry === "FORFEITED").reduce((sum, d) => sum + Number(d.amount), 0) * 100) / 100;
  const direct = directCostBreakdown(totals);
  const pct = (value: number | null) => (value === null ? "—" : percent1(value));
  const businesses = (Object.entries(report.businesses) as Array<[string, FinanceReport["totals"]]>).filter(
    ([name, row]) => row.revenue || (name !== "UNMATCHED" && row.contribution),
  );
  const line = (label: string, value: number, className = "") => (
    <tr key={label} className={className}><td>{label}</td><td className={value < 0 ? "finance-negative" : ""}>{money(value)}</td></tr>
  );
  const go = (page: Page, label: string) => (
    <button className="finance-link" onClick={() => onGo(page)}>{label} <ChevronRightIcon /></button>
  );
  const { collection, split, overdue } = rent;
  const change = overdueChange;
  const idle = target.idle.count;
  const profitInclExtra = Math.round((report.management_profit + extraIncome) * 100) / 100;
  return (
    <div className="finance-content">
      <section className="finance-panel">
        <SectionHeading title="Operating margin, target 20%" detail={`${monthLong(month)}, except overdue rent, which is today's.`} />
        <div className="finance-summary-grid is-four">
          <StatTile
            label="Operating margin"
            value={pct(target.margin)}
            emphasis
            hint={target.margin === null ? "No revenue is recorded for this month yet" : target.gap > 0 ? `${money(target.gap)} more profit would reach 20%` : "20% target reached"}
          />
          <StatTile
            label="Collected (collection rate)"
            value={collection.rate === null ? "—" : `${percent(collection.rate)} of rent due`}
            hint={split ? `${money(split.current)} for the month's rent · ${money(split.arrears)} for old arrears` : undefined}
            action={go("collections", "Collections")}
          />
          <StatTile
            label="Overdue rent (today)"
            value={money(overdue)}
            negative={overdue > 0.005}
            hint={change === null ? undefined : change > 0.005 ? `▲ ${money(change)} this week` : change < -0.005 ? `▼ ${money(-change)} this week` : "No change this week"}
            action={go("collections", "Collections")}
          />
          <StatTile
            label="Idle cars"
            value={`${idle} ${idle === 1 ? "car" : "cars"}`}
            hint={`${money(target.idle.cost)} a month of cost`}
            action={go("vehicles", "Vehicles")}
          />
        </div>
      </section>
      <div className="finance-two-col">
        <section className="finance-panel">
          <SectionHeading title="Profit & Loss" detail="Operating results. Tax instalments and other cash-flow-only payments are not costs here." />
          <div className="finance-table-wrap">
            <table className="finance-table finance-statement">
              <tbody>
                <tr className="is-group"><td colSpan={2}>Revenue</td></tr>
                {businesses.map(([name, row]) => line(name === "UNMATCHED" ? "Unmatched vehicles" : name, row.revenue, "is-indent"))}
                {line("Total revenue", totals.revenue, "is-subtotal")}
                <tr className="is-group"><td colSpan={2}>Direct vehicle costs</td></tr>
                {line("Monthly vehicle cost", -direct.monthly_vehicle, "is-indent")}
                {line("Service & maintenance", -direct.service_maintenance, "is-indent")}
                {line("Insurance", -direct.insurance, "is-indent")}
                {line("Other (vehicle costs, commission)", -direct.other, "is-indent")}
                {line("Total direct costs", -direct.total, "is-subtotal")}
                <tr className="is-subtotal"><td>Contribution <small>({pct(target.contribution_margin)})</small></td><td>{money(totals.contribution)}</td></tr>
                {line("Operation Fix Cost", -report.corporate_opex)}
                <tr className="is-total"><td>Operating profit <small>({pct(target.margin)})</small></td><td className={report.management_profit < 0 ? "finance-negative" : ""}>{money(report.management_profit)}</td></tr>
                {extraIncome > 0 && <tr><td>Extra income: downpayments and forfeited deposits <small>(kept aside, not in revenue or the 20% target)</small></td><td>{money(extraIncome)}</td></tr>}
                {extraIncome > 0 && <tr className="is-total"><td>Profit incl. extra income</td><td className={profitInclExtra < 0 ? "finance-negative" : ""}>{money(profitInclExtra)}</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="finance-strip-note">{eHailingAsOf(input.month.refreshed_at)}</p>
        </section>
        <section className="finance-panel">
          <SectionHeading title="Cash flow" detail="The month as cash. Claims are not cash; tax instalments are. Built from Finance records, so it will not match the bank to the ringgit." />
          <div className="finance-table-wrap">
            <table className="finance-table finance-statement">
              <tbody>
                <tr className="is-group"><td colSpan={2}>Money in</td></tr>
                {line("Rent received in cash", cashFlow.in.rent_cash, "is-indent")}
                {line("Smart Drive after commission", cashFlow.in.smart_drive_net, "is-indent")}
                {line("Other income (confirmed)", cashFlow.in.other_income, "is-indent")}
                {cashFlow.in.deposits !== 0 && line("Deposits received (held for the driver)", cashFlow.in.deposits, "is-indent")}
                {cashFlow.in.downpayments !== 0 && line("Sewa Beli downpayments (extra income)", cashFlow.in.downpayments, "is-indent")}
                {line("Total in", cashFlow.in.total, "is-subtotal")}
                <tr className="is-group"><td colSpan={2}>Money out</td></tr>
                {line("Monthly vehicle costs", -cashFlow.out.monthly_vehicle, "is-indent")}
                {line("Workshop", -cashFlow.out.workshop, "is-indent")}
                {line("Other vehicle costs", -cashFlow.out.other_vehicle, "is-indent")}
                {line("Insurance (cover starting this month)", -cashFlow.out.insurance, "is-indent")}
                {line("Operation Fix Cost", -cashFlow.out.operation_fix, "is-indent")}
                {line(`Cash flow only${report.cash_flow_only_items.length ? ` (${report.cash_flow_only_items.map((item) => item.payee ? `${item.category} ${item.payee}` : item.category).join(", ")})` : ""}`, -cashFlow.out.cash_flow_only, "is-indent")}
                {cashFlow.out.deposits_refunded !== 0 && line("Deposits refunded", -cashFlow.out.deposits_refunded, "is-indent")}
                {line("Total out", -cashFlow.out.total, "is-subtotal")}
                <tr className="is-total"><td>Net cash flow</td><td className={cashFlow.net < 0 ? "finance-negative" : ""}>{money(cashFlow.net)}</td></tr>
                {input.deposits_held && Number(input.deposits_held.DEPOSIT) !== 0 && (
                  <tr><td colSpan={2} className="text-xs text-slate-500">Deposits held at month end: {money(Number(input.deposits_held.DEPOSIT))}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="finance-panel">
        <SectionHeading title="Month by month" detail="Each month since August 2026: revenue as the bar with operating profit inside it as its share (red is a loss), in ringgit on the left; operating margin as the line against the dashed 20% target, in percent on the right. Lighter bars are Draft months, which can still change; closed months are final." />
        {!trend ? <Skeleton lines={3} /> : (
          <figure className="m-0">
            <div className="h-64" role="img" aria-label={`Operating margin by month: ${chart.map((point) => `${point.label} ${point.margin === null ? "no revenue" : `${point.margin.toFixed(1)}%`}`).join(", ")}. Target 20%.`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} barSize={32} margin={{ top: 16, right: 4, bottom: 0, left: -8 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#4b5563" }} tickLine={false} axisLine={{ stroke: "#d1d5db" }} />
                  {/* Profit sits on its own hidden copy of the month axis so it draws inside the revenue bar, not beside it. */}
                  <XAxis xAxisId="inside" dataKey="label" hide />
                  <YAxis yAxisId="rm" tick={{ fontSize: 12, fill: "#4b5563" }} tickLine={false} axisLine={false} domain={axes.rm.domain} ticks={axes.rm.ticks}
                    tickFormatter={(value: number) => (Math.abs(value) >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value))} />
                  <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 12, fill: "#4b5563" }} tickLine={false} axisLine={false} width={44} domain={axes.pct.domain} ticks={axes.pct.ticks}
                    tickFormatter={(value: number) => `${value}%`} />
                  <Tooltip content={<MonthTooltip rows={trend} />} />
                  <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 8 }} itemSorter={(item) => LEGEND_ORDER.indexOf(String(item.value))} formatter={(value) => <span className="text-xs text-gray-700">{value}</span>} />
                  <ReferenceLine yAxisId="pct" y={20} stroke={COLORS.target} strokeDasharray="6 4"
                    label={{ value: "20% target", position: "insideTopRight", fontSize: 11, fill: COLORS.target }} />
                  <ReferenceLine yAxisId="rm" y={0} stroke="#9ca3af" />
                  <Bar yAxisId="rm" dataKey="revenue" name="Revenue" fill={COLORS.revenue} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {chart.map((point) => <Cell key={point.month} fillOpacity={point.draft ? 0.45 : 1} />)}
                  </Bar>
                  <Bar xAxisId="inside" yAxisId="rm" dataKey="profit" name="Operating profit" fill={COLORS.profit} isAnimationActive={false}>
                    {chart.map((point) => <Cell key={point.month} fill={point.profit < 0 ? COLORS.loss : COLORS.profit} fillOpacity={point.draft ? 0.45 : 1} />)}
                  </Bar>
                  <Line yAxisId="pct" type="linear" dataKey="margin" name="Operating margin" stroke={COLORS.margin} strokeWidth={2} dot={{ r: 3.5, fill: COLORS.margin }} isAnimationActive={false}>
                    {chart.length <= 6 && <LabelList dataKey="margin" position="top" formatter={(value: unknown) => (typeof value === "number" ? `${value.toFixed(1)}%` : "")} style={{ fontSize: 11, fill: "#374151" }} />}
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-blue-700 font-semibold">Show the numbers</summary>
              <div className="mt-2">
                <DataTable headers={["Month", "Status", "Revenue", "Contribution", "Operating profit", "Operating margin"]}>
                  {[...trend].reverse().map((row) => (
                    <tr key={row.month}>
                      <td className="finance-strong">{monthLong(row.month)}</td>
                      <td><span className={`finance-tag ${row.status === "CLOSED" ? "is-good" : ""}`}>{statusLabel(row.status)}</span></td>
                      <td>{money(row.revenue)}</td>
                      <td>{money(row.contribution)}</td>
                      <td className={row.profit < 0 ? "finance-negative finance-strong" : "finance-strong"}>{money(row.profit)}</td>
                      <td>{row.margin === null ? "—" : <>{pct(row.margin)} {row.margin >= 0.2 ? <span className="finance-tag is-good">On target</span> : <span className="finance-tag is-warn">{((0.2 - row.margin) * 100).toFixed(1)} pts short</span>}</>}</td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            </details>
          </figure>
        )}
      </section>
    </div>
  );
}
