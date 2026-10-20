import React, { useState } from "react";
import { klDateTime, money } from "../../services/fmt";
import { useConfirm } from "../Dialog";
import type { FinanceExpense, FinanceInput, FinanceVehicle, FixedCostTreatment } from "../../types/finance";
import type { DriverWithMetrics } from "../../types";
import type { SectionKind } from "../../services/finance/workspace";
import type { FinanceEditableExportKind } from "../../services/finance/exports";
import Dialog from "./FinanceDialog";
import { ExpenseForm } from "./FinanceRecordForms";
import { FixedOperatingCostsPanel, OtherIncomePanel, WorkshopSummaryPanel } from "./FinanceCustomizationForms";
import SettingsSection, { type SettingsSectionProps } from "./FinanceSettingsSection";
import { DataTable, Empty, FileButton, SectionHeading, Skeleton } from "./FinancePrimitives";

const ServiceClaims = React.lazy(() => import("../money/ServiceClaims"));

/** The Records page's tabs. */
export type ExpenseWorkspaceTab = FinanceExpense["payment_source"] | "monthly_vehicle_costs" | "insurance" | "smart_drive" | "other_income" | "service_claims" | "vehicle_master";
/** An Excel file's kind when chosen for import: Smart Drive, the workshop bills, or a Records section. */
export type UploadKind = "SMART_DRIVE" | "WORKSHOP" | SectionKind;

export interface FinanceRecordsProps {
  input: FinanceInput;
  month: string;
  /** True while Finance is busy or the month is closed. */
  disabled: boolean;
  /** The tab to open on (Month close links straight to a section). */
  initialSource: ExpenseWorkspaceTab;
  drivers: DriverWithMetrics[];
  /** Each save resolves true when it worked (the form then closes). */
  onSaveExpense: (record: FinanceExpense) => Promise<boolean>;
  onDeleteExpense: (record: FinanceExpense, reason: string) => Promise<boolean>;
  onFile: (kind: UploadKind, file?: File) => unknown;
  onSaveSummary: React.ComponentProps<typeof WorkshopSummaryPanel>["onSave"];
  onLink: React.ComponentProps<typeof WorkshopSummaryPanel>["onLink"];
  onExport: (kind: FinanceEditableExportKind, rows: readonly object[]) => unknown;
  onSaveSetting: SettingsSectionProps["onSave"];
  onDeleteVehicle: SettingsSectionProps["onDelete"];
  onCancel: SettingsSectionProps["onCancel"];
  onSaveFixed: React.ComponentProps<typeof FixedOperatingCostsPanel>["onSave"];
  treatments: FixedCostTreatment[];
  onTreatment: React.ComponentProps<typeof FixedOperatingCostsPanel>["onTreatment"];
  onSaveOtherIncome: React.ComponentProps<typeof OtherIncomePanel>["onSave"];
  onExportOtherIncome: () => void;
  /** Reviews the Smart Drive file chosen earlier again (shown while one is waiting). */
  onReviewSelected?: () => void;
}

/** Finance → Records: every cost and income entry for the month, by tab, with import, export and the add/edit forms. */
export default function Expenses({
  input,
  month,
  disabled,
  onSaveExpense,
  onDeleteExpense,
  onFile,
  initialSource,
  onSaveSummary,
  onLink,
  onExport,
  onSaveSetting,
  onDeleteVehicle,
  onCancel,
  onSaveFixed,
  treatments,
  onTreatment,
  drivers,
  onSaveOtherIncome,
  onExportOtherIncome,
  onReviewSelected,
}: FinanceRecordsProps) {
  const { ask, askText, dialog } = useConfirm();
  const [tab, setTab] = useState<ExpenseWorkspaceTab>(initialSource);
  const [editor, setEditor] = useState<string | null | undefined>(undefined);
  const groups: Array<[ExpenseWorkspaceTab, string, string]> = [
    ["Workshop Billing", "Workshop", "Workshop bills paid directly by ECA."],
    [
      "Vehicle Direct Cost",
      "Other Vehicle Costs",
      "Road tax, permits, repairs and other vehicle-specific costs.",
    ],
    ["Corporate Opex", "Operation Fix Cost", "Excel: Frequency, Start Month, End Month, Expense Date, Category, Description, Amount (RM), Payee, Source, Notes. Monthly recurring costs require Start Month; Expense Date is optional."],
    ["monthly_vehicle_costs", "Monthly Vehicle Costs", "Ongoing vehicle payout, rental and financing obligations."],
    ["insurance", "Insurance", "Insurance responsibility, coverage and premiums."],
    ["smart_drive", "Smart Drive", "The month's Smart Drive Sales Report."],
    ["other_income", "Other Income", "Income outside rent and Smart Drive. It counts in the P&L once Confirmed."],
    ["service_claims", "Service Claims", "Repairs drivers paid and deducted from rent (read only)."],
    ["vehicle_master", "Vehicle Master", "Vehicle identity and Finance classification."],
  ];
  const isSettingsTab = tab === "monthly_vehicle_costs" || tab === "insurance" || tab === "vehicle_master";
  const linkedExpenseIds = new Set((input.workshop_allocations ?? []).map((allocation: { expense_id: string }) => allocation.expense_id));
  const isExpenseTab = tab === "Workshop Billing" || tab === "Vehicle Direct Cost" || tab === "Corporate Opex";
  const visible = input.expenses.filter(
    (x: FinanceExpense) => isExpenseTab && x.payment_source === tab && !x.cancelled_at && x.finance_month.slice(0, 7) === month.slice(0, 7),
  );
  const activeFixedTemplates = (input.fixed_cost_templates ?? []).filter((row) => !row.cancelled_at);
  const representedOccurrences = tab === "Corporate Opex"
    ? activeFixedTemplates
        .map((template) => visible.find((row: FinanceExpense) => row.fixed_cost_template_id === template.id))
        .filter((row: FinanceExpense | undefined): row is FinanceExpense => Boolean(row))
    : [];
  const displayedExpenses = tab === "Corporate Opex"
    ? visible.filter((row: FinanceExpense) => !representedOccurrences.includes(row))
    : visible;
  return (
    <div className="finance-content">
      <div className="finance-tabs">
        {groups.map(([id, label]) => (
          <button
            className={tab === id ? "is-active" : ""}
            onClick={() => { setTab(id); setEditor(undefined); }}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      {isSettingsTab && <SettingsSection
        key={tab}
        tab={tab}
        input={input}
        drivers={drivers}
        month={month}
        disabled={disabled}
        onSave={onSaveSetting}
        onDelete={onDeleteVehicle}
        onCancel={onCancel}
        onFile={onFile}
        onExport={onExport}
      />}
      {tab === "Corporate Opex" && <FixedOperatingCostsPanel
        templates={input.fixed_cost_templates ?? []}
        occurrences={representedOccurrences}
        month={month}
        disabled={disabled}
        onSave={onSaveFixed}
        treatments={treatments}
        onTreatment={onTreatment}
        onExport={() => onExport("fixed_cost", (input.fixed_cost_templates ?? []).filter((row) => !row.cancelled_at))}
        onImport={(file) => onFile("fixed_cost", file)}
      />}
      {isExpenseTab && <section className="finance-panel">
        <SectionHeading
          title={tab === "Corporate Opex" ? "One-off company costs" : groups.find((x) => x[0] === tab)?.[1] ?? "Expenses"}
          detail={tab === "Corporate Opex" ? "Company costs that happen once. Monthly ones are in the list above. Excel columns: Frequency, Start Month, End Month, Expense Date, Category, Amount (RM)." : groups.find((x) => x[0] === tab)?.[2]}
          summary={<p><strong>{money(displayedExpenses.reduce((sum: number, row: FinanceExpense) => sum + row.amount, 0))}</strong> this month</p>}
          action={<div className="finance-dialog-actions"><button className="finance-secondary" onClick={() => onExport(tab === "Workshop Billing" ? "workshop" : tab === "Corporate Opex" ? "company_expenses" : "vehicle_expenses", displayedExpenses)}>Export Excel</button><button className="finance-primary" disabled={disabled} onClick={() => setEditor(null)}>Add expense</button><FileButton
              disabled={disabled}
              label="Upload Excel"
              onFile={(file) =>
                onFile(tab === "Workshop Billing" ? "WORKSHOP" : tab === "Corporate Opex" ? "corporate_expense" : "vehicle_expense", file)
              }
            /></div>}
        />
        <DataTable
          headers={["Date", "Vehicle", "Category", "Supplier", "Amount", "Actions"]}
        >
          {displayedExpenses.length ? (
            displayedExpenses.map((row: FinanceExpense) => (
              <tr key={row.id ?? `${row.billing_date}${row.category}`}>
                <td>{row.billing_date ?? (row.frequency === "MONTHLY_RECURRING" ? `${row.finance_month.slice(0, 7)} (monthly recurring)` : row.frequency === "MONTHLY_SUMMARY" ? `${row.finance_month.slice(0, 7)} (monthly total)` : "—")}</td>
                <td>
                  {row.plate_key
                    ? (input.vehicles.find(
                        (v: FinanceVehicle) => v.plate_key === row.plate_key,
                      )?.display_plate ?? "Unmatched")
                    : "—"}
                </td>
                <td>{row.category}</td>
                <td>{row.supplier ?? "—"}</td>
                <td className="finance-strong">{money(row.amount)}{tab === "Workshop Billing" && (input.workshop_summaries ?? []).some((summary) => !summary.cancelled_at && summary.finance_month.slice(0, 7) === month.slice(0, 7)) && <> {linkedExpenseIds.has(row.id ?? "") ? <span className="finance-tag is-good">Linked</span> : <span className="finance-tag">Not linked</span>}</>}</td>
                <td><div className="finance-dialog-actions"><button className="finance-secondary" disabled={disabled} onClick={() => setEditor(row.id ?? null)}>Edit</button><button className="finance-destructive" disabled={disabled} onClick={async () => { if (!(await ask(`Delete ${row.category} for ${money(row.amount)} from ${row.finance_month.slice(0, 7)} open calculations? Closed snapshots and audit history remain unchanged.`))) return; const reason = await askText(`Reason for deleting ${row.category}`); if (reason?.trim()) void onDeleteExpense(row, reason.trim()); }}>Delete</button></div></td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6}>
                <Empty text="No records in this section for the selected month." />
              </td>
            </tr>
          )}
        </DataTable>
      </section>
      }
      {tab === "Workshop Billing" && (
        <WorkshopSummaryPanel summaries={input.workshop_summaries ?? []} expenses={input.expenses} vehicles={input.vehicles} allocations={input.workshop_allocations ?? []} month={month} disabled={disabled} onSave={onSaveSummary} onLink={onLink} />
      )}
      {tab === "smart_drive" && (
        <SmartDrivePanel input={input} disabled={disabled} onFile={(file) => onFile("SMART_DRIVE", file)} onReviewSelected={onReviewSelected} />
      )}
      {tab === "other_income" && <>
        <OtherIncomePanel
          records={input.other_income ?? []}
          vehicles={input.vehicles}
          month={month}
          disabled={disabled}
          onSave={onSaveOtherIncome}
          onExport={onExportOtherIncome}
          onImport={(file) => onFile("other_income", file)}
        />
      </>}
      {tab === "service_claims" && (
        <React.Suspense fallback={<Skeleton lines={4} />}>
          <ServiceClaims drivers={drivers ?? []} month={month} />
        </React.Suspense>
      )}
      {editor !== undefined && isExpenseTab && <Dialog title={editor ? "Edit expense" : "Add expense"} onClose={() => setEditor(undefined)}><ExpenseForm input={input} month={month} source={tab} disabled={disabled} onSave={async (record) => { const saved = await onSaveExpense(record); if (saved) setEditor(undefined); return saved; }} onCancel={async (record, reason) => { const saved = await onDeleteExpense(record, reason); if (saved) setEditor(undefined); return saved; }} initialId={editor ?? undefined} /></Dialog>}
      {dialog}
    </div>
  );
}

/** Records → Smart Drive: the approved Smart Drive Sales Report for the month, its rows, and its upload (Draft only). */
function SmartDrivePanel({ input, disabled, onFile, onReviewSelected }: {
  input: FinanceInput;
  disabled: boolean;
  onFile: (file?: File) => void;
  onReviewSelected?: () => void;
}) {
  const approved = input.smart_import;
  const rows = input.smart_rows;
  // A new report is reviewed against the month's current figures, so it can only be posted while the month is Draft.
  const locked = disabled || input.month.status !== "DRAFT";
  return (
    <section className="finance-panel">
      <SectionHeading
        title="Smart Drive Sales Report"
        detail={approved
          ? `${approved.filename} · uploaded ${klDateTime(approved.imported_at) ?? "—"}`
          : "Upload the month's Smart Drive Sales Report (Excel)."}
        summary={approved ? (
          <p>
            {rows.length} rows · {new Set(rows.map((row) => row.plate_key)).size} vehicles · Gross revenue{" "}
            <strong>{money(rows.reduce((sum, row) => sum + row.gross_revenue, 0))}</strong> · Commission{" "}
            <strong>{money(rows.reduce((sum, row) => sum + row.commission, 0))}</strong>
          </p>
        ) : undefined}
        action={<div className="finance-dialog-actions">
          {onReviewSelected && <button className="finance-link" disabled={locked} onClick={onReviewSelected}>Review selected file</button>}
          <FileButton disabled={locked} label={approved ? "Replace file" : "Upload Excel"} onFile={onFile} />
        </div>}
      />
      {input.month.status !== "DRAFT" && <p className="finance-strip-note">The report can be uploaded or replaced while the month is Draft.</p>}
      <DataTable headers={["Vehicle", "Pickup", "Return", "Gross revenue", "Commission", "Status"]}>
        {rows.length ? rows.map((row, index) => (
          <tr key={index}>
            <td>{row.display_plate}</td>
            <td>{row.pickup_date}</td>
            <td>{row.return_date}</td>
            <td>{money(row.gross_revenue)}</td>
            <td>{money(row.commission)}</td>
            <td>{row.status}</td>
          </tr>
        )) : (
          <tr><td colSpan={6}><Empty text="No Smart Drive report is approved for this month." /></td></tr>
        )}
      </DataTable>
    </section>
  );
}
