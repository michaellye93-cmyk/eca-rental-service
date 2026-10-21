import React, { useState } from "react";
import { money } from "../../services/fmt";
import type { FinanceInput, FinanceVehicle, Insurance, RecurringCost } from "../../types/finance";
import type { DriverWithMetrics } from "../../types";
import type { SectionKind } from "../../services/finance/workspace";
import type { FinanceEditableExportKind } from "../../services/finance/exports";
import { insuranceCashOutflow, insuranceHeaderTotals, insuranceProblems, overlappingInsurance } from "../../services/finance/insurance";
import { activeMonthlyCostTotal, monthlyCostByOwnership, type CostShare } from "../../services/finance/calculations";
import Dialog from "./FinanceDialog";
import PlatesToCheck from "./PlatesToCheck";
import { InsuranceForm, RecurringForm, VehicleForm } from "./FinanceRecordForms";
import { DataTable, FileButton, SectionHeading } from "./FinancePrimitives";

/** The Records tabs that edit Finance's master lists. */
export type SettingsTab = "monthly_vehicle_costs" | "insurance" | "vehicle_master";

export interface SettingsSectionProps {
  tab: SettingsTab;
  input: FinanceInput;
  month: string;
  disabled: boolean;
  /** Saves a vehicle, monthly cost or policy; resolves true when saved (the form then closes). */
  onSave: React.ComponentProps<typeof VehicleForm>["onSave"];
  onDelete: React.ComponentProps<typeof VehicleForm>["onDelete"];
  onCancel: React.ComponentProps<typeof RecurringForm>["onCancel"];
  /** An Excel file chosen for import (reviewed before anything is posted). */
  onFile: (kind: SectionKind, file?: File) => unknown;
  onExport: (kind: FinanceEditableExportKind, rows: readonly object[]) => unknown;
  /** For the plates-to-check list under Vehicle Master. */
  drivers: DriverWithMetrics[];
}

/** Records → Vehicle Master, Monthly Vehicle Costs and Insurance: the list, its import and export, and the add/edit form. */
export default function SettingsSection({ tab, input, month, disabled, onSave, onDelete, onCancel, onFile, onExport, drivers }: SettingsSectionProps) {
  const [editor, setEditor] = useState<string | null | undefined>(undefined);
  const [costSort, setCostSort] = useState<{
    key: "type" | "amount";
    direction: "asc" | "desc";
  } | null>(null);
  const [vehicleSort, setVehicleSort] = useState<{
    key: "business" | "ownership";
    direction: "asc" | "desc";
  } | null>(null);
  const activeVehicles = input.vehicles.filter(
    (vehicle: FinanceVehicle) => !vehicle.deleted_at,
  );
  const displayedVehicles = vehicleSort
    ? activeVehicles
        .map((vehicle: FinanceVehicle, index: number) => ({ vehicle, index }))
        .sort((left: { vehicle: FinanceVehicle; index: number }, right: { vehicle: FinanceVehicle; index: number }) => {
          const leftValue = vehicleSort.key === "business" ? left.vehicle.business_unit : left.vehicle.ownership_type;
          const rightValue = vehicleSort.key === "business" ? right.vehicle.business_unit : right.vehicle.ownership_type;
          const comparison = leftValue.localeCompare(rightValue, "en", { sensitivity: "base" });
          if (comparison !== 0) return vehicleSort.direction === "asc" ? comparison : -comparison;
          return left.index - right.index;
        })
        .map(({ vehicle }: { vehicle: FinanceVehicle }) => vehicle)
    : activeVehicles;
  const activeCosts = input.recurring_costs.filter(
    (cost: RecurringCost) => !cost.cancelled_at,
  );
  // Only the costs running in the month viewed: a loan that has ended, or one not started yet, is listed but not added
  const monthlyCostTotal = activeMonthlyCostTotal(activeCosts, month);
  const costSplit = monthlyCostByOwnership(activeCosts, input.vehicles, month);
  const shareText = (part: CostShare) => `${money(part.amount)} (${part.share}%)`;
  const insuranceTotals = insuranceHeaderTotals(input.insurance, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }));
  const insuranceOverlaps = overlappingInsurance(input.insurance);
  const displayedCosts = costSort
    ? activeCosts
        .map((cost: RecurringCost, index: number) => ({ cost, index }))
        .sort((left: { cost: RecurringCost; index: number }, right: { cost: RecurringCost; index: number }) => {
          const comparison = costSort.key === "type"
            ? left.cost.cost_type.localeCompare(right.cost.cost_type, "en", { sensitivity: "base" })
            : left.cost.monthly_amount - right.cost.monthly_amount;
          if (comparison !== 0) return costSort.direction === "asc" ? comparison : -comparison;
          return left.index - right.index;
        })
        .map(({ cost }: { cost: RecurringCost }) => cost)
    : activeCosts;
  const toggleCostSort = (key: "type" | "amount") =>
    setCostSort((current) => ({
      key,
      direction: current?.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  const costSortHeader = (key: "type" | "amount", label: string) => {
    const direction = costSort?.key === key ? costSort.direction : null;
    return {
      key,
      ariaSort: direction === "asc" ? "ascending" as const : direction === "desc" ? "descending" as const : "none" as const,
      content: <button type="button" className="finance-table-sort" onClick={() => toggleCostSort(key)} aria-label={`Sort ${label} ${direction === "asc" ? "descending" : "ascending"}`}>
        {label} <span className="finance-sort-indicator" aria-hidden="true">{direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕"}</span>
      </button>,
    };
  };
  const vehicleSortHeader = (key: "business" | "ownership", label: string) => {
    const direction = vehicleSort?.key === key ? vehicleSort.direction : null;
    return {
      key,
      ariaSort: direction === "asc" ? "ascending" as const : direction === "desc" ? "descending" as const : "none" as const,
      content: <button type="button" className="finance-table-sort" onClick={() => setVehicleSort((current) => ({ key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" }))} aria-label={`Sort ${label} ${direction === "asc" ? "descending" : "ascending"}`}>
        {label} <span className="finance-sort-indicator" aria-hidden="true">{direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕"}</span>
      </button>,
    };
  };
  return (
    <>
      {tab === "vehicle_master" ? (
        <>
        <section className="finance-panel">
          <SectionHeading
            title="Vehicle Master"
            detail="Excel columns: Car Plate, Business Unit, Ownership Type, Status."
            action={<div className="finance-dialog-actions"><button className="finance-secondary" onClick={() => onExport("vehicle_master", input.vehicles.filter((row: FinanceVehicle) => !row.deleted_at))}>Export Excel</button><button className="finance-primary" disabled={disabled} onClick={() => setEditor(null)}>Add vehicle</button><FileButton
                disabled={disabled}
                label="Import Vehicle Master Excel"
                onFile={(file) => onFile("vehicle", file)}
              /></div>}
          />
          <DataTable
            headers={["Car plate", "Model", vehicleSortHeader("business", "Business unit"), vehicleSortHeader("ownership", "Ownership"), "Status", "Actions"]}
          >
            {displayedVehicles.map((v: FinanceVehicle) => (
              <tr key={v.plate_key}>
                <td className="finance-strong">{v.display_plate}</td>
                <td>{v.model ?? "—"}</td>
                <td>{v.business_unit}</td>
                <td>{v.ownership_type}</td>
                <td>{v.status}</td>
                <td><button className="finance-secondary" disabled={disabled} onClick={() => setEditor(v.vehicle_id ?? v.plate_key)}>Edit</button></td>
              </tr>
            ))}
          </DataTable>
        </section>
        <PlatesToCheck vehicles={input.vehicles} drivers={drivers ?? []} />
        </>
      ) : tab === "monthly_vehicle_costs" ? (
        <section className="finance-panel">
          <SectionHeading
            title="Monthly Vehicle Costs"
            detail="Excel columns: Car Plate, Start Month, Cost Type, Monthly Amount. Active costs are applied automatically."
            summary={<><strong>Total this month: {money(monthlyCostTotal)}</strong>{monthlyCostTotal > 0 && (
              <p>
                Car Owner {shareText(costSplit.carOwner)} versus Company {shareText(costSplit.company)}
                {costSplit.notInMaster.amount > 0 && <> · Not in Vehicle Master {shareText(costSplit.notInMaster)}</>}
              </p>
            )}</>}
            action={<div className="finance-dialog-actions"><button className="finance-secondary" onClick={() => onExport("vehicle_monthly_costs", input.recurring_costs.filter((row: RecurringCost) => !row.cancelled_at))}>Export Excel</button><button className="finance-primary" disabled={disabled} onClick={() => setEditor(null)}>Add monthly cost</button><FileButton
                disabled={disabled}
                label="Import Excel"
                onFile={(file) => onFile("recurring_cost", file)}
              /></div>}
          />
          <DataTable
            headers={[
              "Vehicle",
              costSortHeader("type", "Type"),
              costSortHeader("amount", "Monthly amount"),
              "Active from",
              "End month",
              "Actions",
            ]}
          >
            {displayedCosts.map((x: RecurringCost) => (
              <tr key={x.id ?? `${x.plate_key}${x.cost_type}`}>
                <td>
                  {input.vehicles.find(
                    (v: FinanceVehicle) => v.plate_key === x.plate_key,
                  )?.display_plate ?? "Unmatched"}
                </td>
                <td>{x.cost_type}</td>
                <td>{money(x.monthly_amount)}</td>
                <td>{x.start_month.slice(0, 7)}</td>
                <td>{x.end_month?.slice(0, 7) ?? "Ongoing"}</td>
                {/* A cost a loan owns is changed in Finance → Vehicle loans, not here. */}
                <td>{x.loan_id ? <span className="finance-status">From Vehicle loans</span> : <button className="finance-secondary" disabled={disabled} onClick={() => setEditor(x.id ?? null)}>Edit</button>}</td>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : (
        <section className="finance-panel">
          <SectionHeading
            title="Insurance"
            detail="Excel columns: Car Plate, Premium (RM), Coverage Start, Coverage End, RESPONSIBILITY. RM0 records may have blank coverage dates."
            summary={<><strong>Active now: {money(insuranceTotals.active)} · All years: {money(insuranceTotals.allYears)}</strong>{insuranceOverlaps.size > 0 && <small className="finance-inline-warning">{insuranceOverlaps.size} policies overlap another policy for the same car, so the shared days are charged twice. See the warnings below.</small>}</>}
            action={<div className="finance-dialog-actions"><button className="finance-secondary" onClick={() => onExport("insurance", input.insurance.filter((row: Insurance) => !row.cancelled_at))}>Export Excel</button><button className="finance-primary" disabled={disabled} onClick={() => setEditor(null)}>Add policy</button><FileButton
                disabled={disabled}
                label="Import Excel"
                onFile={(file) => onFile("insurance", file)}
              /></div>}
          />
          <DataTable
            headers={["Vehicle", "Responsibility", "Premium (RM)", "Coverage", "Finance cash outflow", "Actions"]}
          >
            {input.insurance.filter((x: Insurance) => !x.cancelled_at).map((x: Insurance) => {
              const overlaps = insuranceOverlaps.get(x) ?? [];
              const problems = [...insuranceProblems(x), ...(overlaps.length ? [`Overlaps ${overlaps.map((other: Insurance) => `${other.coverage_start} – ${other.coverage_end}`).join(", ")} for this car; both are charged for the shared days. Fix the dates or delete the duplicate.`] : [])];
              const cashOutflow = insuranceCashOutflow(x, input.calculation_version ?? 1);
              return <tr key={x.id ?? `${x.plate_key}${x.coverage_start}`}>
                <td>
                  {input.vehicles.find(
                    (v: FinanceVehicle) => v.plate_key === x.plate_key,
                  )?.display_plate ?? "Unmatched"}
                </td>
                <td>
                  {x.responsibility?.replace("_", " ") ?? "Not specified"}
                  {problems.length > 0 && <small className="finance-inline-warning">{problems.join(" ")}</small>}
                </td>
                <td>{money(x.premium)}</td>
                <td>
                  {x.coverage_start ?? "—"} – {x.coverage_end ?? "—"}
                </td>
                <td>{money(cashOutflow.amount)}{cashOutflow.date ? ` · ${cashOutflow.date}` : ""}</td>
                <td><button className="finance-secondary" disabled={disabled} onClick={() => setEditor(x.id ?? null)}>Edit</button></td>
              </tr>;
            })}
          </DataTable>
        </section>
      )}
      {editor !== undefined && <Dialog title={editor ? `Edit ${tab === "vehicle_master" ? "vehicle" : tab === "monthly_vehicle_costs" ? "monthly cost" : "policy"}` : `Add ${tab === "vehicle_master" ? "vehicle" : tab === "monthly_vehicle_costs" ? "monthly cost" : "policy"}`} onClose={() => setEditor(undefined)}>
        {tab === "vehicle_master" ? <VehicleForm input={input} month={month} disabled={disabled} onSave={async (kind, record) => { const saved = await onSave(kind, record); if (saved) setEditor(undefined); return saved; }} onDelete={onDelete} initialId={editor ?? undefined} /> : tab === "monthly_vehicle_costs" ? <RecurringForm input={input} month={month} disabled={disabled} onSave={async (kind, record) => { const saved = await onSave(kind, record); if (saved) setEditor(undefined); return saved; }} onCancel={onCancel} initialId={editor ?? undefined} /> : <InsuranceForm input={input} month={month} disabled={disabled} onSave={async (kind, record) => { const saved = await onSave(kind, record); if (saved) setEditor(undefined); return saved; }} onCancel={onCancel} initialId={editor ?? undefined} />}
      </Dialog>}
    </>
  );
}
