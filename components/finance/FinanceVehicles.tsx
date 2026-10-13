import { useState } from "react";
import { money, monthLong, percent1 } from "../../services/fmt";
import StatTile from "../StatTile";
import Dialog from "./FinanceDialog";
import type { FinanceReport } from "../../types/finance";
import { directCostBreakdown } from "../../services/finance/directCost";
import { nextVehicleSort, sortVehicles, type VehicleSort, type VehicleSortKey } from "../../services/finance/vehicleSort";
import { DataTable, SectionHeading, Skeleton } from "./FinancePrimitives";

/** Finance → Vehicles: revenue, direct costs and contribution by business and by car (click a car for its breakdown). */
export default function Vehicles({
  report,
  onVehicle,
}: {
  report: FinanceReport | null;
  onVehicle: (plate: string) => void;
}) {
  const [vehicleSort, setVehicleSort] = useState<VehicleSort>(null);
  if (!report)
    return (
      <section className="finance-panel">
        <Skeleton lines={8} />
      </section>
    );
  const businesses = Object.entries(report.businesses).filter(
    ([name, row]) => name !== "UNMATCHED" || row.revenue || row.contribution,
  );
  const sortHeader = (key: VehicleSortKey, label: string, nextLabel: (direction: "asc" | "desc") => string) => {
    const direction = vehicleSort?.key === key ? vehicleSort.direction : null;
    return {
      key,
      ariaSort: direction === "asc" ? "ascending" as const : direction === "desc" ? "descending" as const : "none" as const,
      content: <button type="button" className="finance-table-sort" onClick={() => setVehicleSort((current) => nextVehicleSort(current, key))} aria-label={`Sort ${label} ${nextLabel(nextVehicleSort(vehicleSort, key).direction)}`}>
        {label} <span className="finance-sort-indicator" aria-hidden="true">{direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕"}</span>
      </button>,
    };
  };
  return (
    <div className="finance-content">
      <section className="finance-panel">
        <SectionHeading title="By business" detail="Revenue and direct costs for each operating business." />
        <DataTable
          headers={[
            "Business",
            "Revenue",
            "Monthly vehicle cost",
            "Service & maintenance",
            "Insurance",
            "Other",
            "Direct cost",
            "Contribution",
            "Margin",
          ]}
        >
          {businesses.map(([business, value]) => {
            const direct = directCostBreakdown(value);
            return (
              <tr key={business}>
                <td className="finance-strong">{business}</td>
                <td>{money(value.revenue)}</td>
                <td>{money(-direct.monthly_vehicle)}</td>
                <td>{money(-direct.service_maintenance)}</td>
                <td>{money(-direct.insurance)}</td>
                <td>{money(-direct.other)}</td>
                <td className="finance-negative">{money(-direct.total)}</td>
                <td className="finance-strong">{money(value.contribution)}</td>
                <td>{value.margin === null ? "—" : percent1(value.margin)}</td>
              </tr>
            );
          })}
        </DataTable>
      </section>
      <section className="finance-panel">
        <SectionHeading title="By vehicle" detail="Click a car for its breakdown. Idle: no revenue this month but still costing money." />
        <DataTable
          headers={[
            "Vehicle",
            sortHeader("business", "Business", (direction) => direction === "asc" ? "A to Z" : "Z to A"),
            "Revenue",
            "Monthly cost",
            "Maintenance",
            "Insurance",
            "Other cost",
            sortHeader("contribution", "Contribution", (direction) => direction === "desc" ? "highest first" : "lowest first"),
            "Margin",
          ]}
        >
          {sortVehicles(report.vehicles, vehicleSort).map((v) => (
            <tr
              key={v.plate_key}
              className="finance-click-row"
              tabIndex={0}
              onClick={() => onVehicle(v.plate_key)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onVehicle(v.plate_key);
              }}
            >
              <td className="finance-strong">{v.display_plate}{v.revenue === 0 && v.contribution < 0 && <> <span className="finance-tag">Idle</span></>}</td>
              <td>{v.business_unit}</td>
              <td>{money(v.revenue)}</td>
              <td>{money(-v.recurring)}</td>
              <td>{money(-(v.workshop + v.service_claim))}</td>
              <td>{money(-v.insurance)}</td>
              <td>{money(-(v.direct_costs + v.commission))}</td>
              <td className="finance-strong">{money(v.contribution)}</td>
              <td>
                {v.margin === null ? "—" : percent1(v.margin)}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

/** One car's contribution breakdown for the reporting month. */
export function VehicleDialog({
  vehicle,
  month,
  onClose,
}: {
  vehicle: FinanceReport["vehicles"][number] | undefined;
  month: string;
  onClose: () => void;
}) {
  if (!vehicle) return null;
  return (
    <Dialog
      title={`${vehicle.display_plate} — ${monthLong(month)}`}
      onClose={onClose}
    >
      <p className="finance-dialog-copy">
        Vehicle contribution breakdown for the selected reporting month.
      </p>
      <section className="finance-audit">
        <h3>Revenue</h3>
        <DataTable headers={["Rental revenue", "Amount"]}>
          <tr>
            <td>Rental revenue</td>
            <td>{money(vehicle.revenue)}</td>
          </tr>
        </DataTable>
      </section>
      <section className="finance-audit">
        <h3>Direct costs</h3>
        <DataTable headers={["Cost", "Amount"]}>
          <tr>
            <td>Owner payout / loan</td>
            <td>{money(-vehicle.recurring)}</td>
          </tr>
          {vehicle.commission > 0 && (
            <tr>
              <td>Agent commission</td>
              <td>{money(-vehicle.commission)}</td>
            </tr>
          )}
          <tr>
            <td>Service claim</td>
            <td>{money(-vehicle.service_claim)}</td>
          </tr>
          <tr>
            <td>Workshop billing</td>
            <td>{money(-vehicle.workshop)}</td>
          </tr>
          <tr>
            <td>Insurance</td>
            <td>{money(-vehicle.insurance)}</td>
          </tr>
          <tr>
            <td>Other vehicle costs</td>
            <td>{money(-vehicle.direct_costs)}</td>
          </tr>
        </DataTable>
      </section>
      <section className="finance-preview-stats">
        <StatTile
          label="Vehicle contribution"
          value={money(vehicle.contribution)}
        />
        <StatTile
          label="Margin"
          value={
            vehicle.margin === null
              ? "—"
              : percent1(vehicle.margin)
          }
        />
        <StatTile label="Business" value={vehicle.business_unit} />
      </section>
    </Dialog>
  );
}
