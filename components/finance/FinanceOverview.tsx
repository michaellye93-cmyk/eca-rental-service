import { useMemo } from "react";
import { ChevronRightIcon } from "@radix-ui/react-icons";
import { kualaLumpurNow } from "../../utils";
import { money, monthLong, percent1 } from "../../services/fmt";
import StatTile from "../StatTile";
import type { FinanceInput, FinanceReport } from "../../types/finance";
import type { DriverWithMetrics } from "../../types";
import type { Page } from "../../services/finance/pages";
import { marginTarget, monthCashFlow, type TrendRow } from "../../services/finance/dashboard";
import { directCostBreakdown } from "../../services/finance/directCost";
import { monthCollection } from "../../services/driverLedger";
import { DataTable, SectionHeading, Skeleton } from "./FinancePrimitives";

/** Finance → Overview: the 20% net margin target, the P&L, the month as cash, and the month-by-month trend. */
export default function Overview({
  report,
  input,
  drivers,
  month,
  trend,
  onGo,
}: {
  report: FinanceReport | null;
  input: FinanceInput;
  drivers: DriverWithMetrics[];
  month: string;
  trend: TrendRow[] | null;
  onGo: (page: Page) => void;
}) {
  const collection = useMemo(() => monthCollection(drivers, month.slice(0, 7), kualaLumpurNow()), [drivers, month]);
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
  return (
    <div className="finance-content">
      <section className="finance-panel">
        <SectionHeading
          title="20% net margin target"
          detail={target.margin === null ? "No revenue is recorded for this month yet." : target.gap > 0
            ? `${money(target.gap)} more profit this month would reach 20% (${money(target.target_profit)}).`
            : "This month reached the 20% target."}
        />
        <div className="finance-summary-grid is-four">
          <StatTile label="Net margin (target 20%)" value={pct(target.margin)} emphasis />
          <StatTile label="Gap to 20%" value={money(target.gap)} negative={target.gap > 0} />
          <StatTile label="Rent collected, cash and claims (live)" value={collection.rate === null ? "—" : `${pct(collection.rate)} of ${money(collection.billed)}`} />
          <StatTile label={`Idle cars (${target.idle.count})`} value={money(-target.idle.cost)} negative={target.idle.cost > 0} />
        </div>
        <p className="finance-strip-note">
          <button className="finance-link" onClick={() => onGo("collections")}>Who owes rent <ChevronRightIcon /></button>{" "}
          <button className="finance-link" onClick={() => onGo("vehicles")}>Idle and low-margin cars <ChevronRightIcon /></button>
        </p>
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
              </tbody>
            </table>
          </div>
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
        <SectionHeading title="Month by month" detail="Each month since August 2026, against the 20% target. Draft months can still change; closed months are final." />
        {!trend ? <Skeleton lines={3} /> : (
          <DataTable headers={["Month", "Status", "Revenue", "Contribution", "Operating profit", "Net margin"]}>
            {[...trend].reverse().map((row) => (
              <tr key={row.month}>
                <td className="finance-strong">{monthLong(row.month)}</td>
                <td><span className={`finance-tag ${row.status === "CLOSED" ? "is-good" : ""}`}>{row.status === "READY FOR REVIEW" ? "Ready" : row.status === "CLOSED" ? "Closed" : "Draft"}</span></td>
                <td>{money(row.revenue)}</td>
                <td>{money(row.contribution)}</td>
                <td className={row.profit < 0 ? "finance-negative finance-strong" : "finance-strong"}>{money(row.profit)}</td>
                <td>{row.margin === null ? "—" : <>{pct(row.margin)} {row.margin >= 0.2 ? <span className="finance-tag is-good">On target</span> : <span className="finance-tag is-warn">{((0.2 - row.margin) * 100).toFixed(1)} pts short</span>}</>}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
    </div>
  );
}
