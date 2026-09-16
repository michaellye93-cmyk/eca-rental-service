import React, { useState } from "react";
import { insuranceStatus } from "../../services/finance/insurance";
import type {
  FieldMapping,
  WorkbookReadResult,
} from "../../services/finance/imports";
const money = (n: number) =>
  !Number.isFinite(n) ? "Invalid amount" : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(
    n,
  );
export default function FinanceImportPreview({
  preview,
  month,
  smartExists,
  disabled,
  onMapping,
  onCancel,
  onPost,
  onRevalidate,
  validated,
  validationError,
}: any) {
  const value = preview.value,
    workbook = preview.workbook as WorkbookReadResult,
    mapping = preview.mapping as FieldMapping;
  const [limit, setLimit] = useState(50);
  const sheet =
    workbook.sheets.find((s) => s.name === mapping.sheet) ?? workbook.sheets[0];
  const smart = preview.kind === "SMART_DRIVE",
    workshop = preview.kind === "WORKSHOP";
  const fields = smart
    ? [
        ["plate", "Car plate"],
        ["pickup", "Pickup date"],
        ["return", "Return date"],
        ["revenue", "Gross revenue"],
        ["commission", "Commission"],
        ["status", "Status"],
        ["reference", "Reference (optional)"],
        ["paymentStatus", "Payment status (optional)"],
      ]
    : [
        ["plate", "Car plate"],
        ["billingDate", "Billing date"],
        ["amount", "Amount"],
        ["supplier", "Supplier (optional)"],
        ["reference", "Reference (optional)"],
        ["description", "Note (optional)"],
      ];
  const rows = value.rows ?? [
    ...(value.data?.vehicles ?? []),
    ...(value.data?.recurring_costs ?? []),
    ...(value.data?.insurance ?? []),
  ];
  const errors = value.issues?.some((issue: any) => issue.severity === "error");
  const hasInsurance = rows.some((row: any) => row.coverage_start !== undefined);
  const insuranceSummary = preview.kind === "insurance" ? value.insurance_summary : undefined;
  const total = preview.kind === "corporate_expense" ? value.total_amount :
    value.gross_revenue ||
    value.total_amount ||
    rows.reduce(
      (sum: number, row: any) =>
        sum +
        (row.amount ??
          row.gross_revenue ??
          row.monthly_amount ??
          row.premium ??
          0),
      0,
    );
  return (
    <>
      <p className="finance-dialog-copy">
        Posting to{" "}
        <strong>
          {new Date(`${month}-01T00:00:00`).toLocaleDateString("en-MY", {
            month: "long",
            year: "numeric",
          })}
        </strong>
        . Review the records and amounts before approving
        {smartExists && smart ? " this replacement" : ""}.
      </p>
      {(smart || workshop) && (
        <details className="finance-mapping">
          <summary>Adjust worksheet and columns</summary>
          <div className="finance-form-grid">
            <label className="finance-field">
              <span>Worksheet</span>
              <select
                aria-label="Worksheet"
                disabled={disabled}
                value={sheet?.name ?? ""}
                onChange={(e) => onMapping({ sheet: e.target.value })}
              >
                {workbook.sheets.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            {fields.map(([field, label]) => (
              <label className="finance-field" key={field}>
                <span>{label}</span>
                <select
                  aria-label={label}
                  disabled={disabled}
                  value={mapping[field] ?? ""}
                  onChange={(e) =>
                    onMapping({
                      ...mapping,
                      sheet: sheet?.name,
                      [field]: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">Detect automatically</option>
                  {sheet?.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}
      {insuranceSummary ? <div className="finance-preview-stats">
        <Stat label="Records" value={String(insuranceSummary.records)} />
        <Stat label="Total ECA Premium" value={money(insuranceSummary.total_eca_premium)} />
        <Stat label="Valid ECA Paid policies" value={String(insuranceSummary.valid_eca_policies)} />
        <Stat label="Future ECA renewal responsibility" value={String(insuranceSummary.future_eca_renewals)} />
        <Stat label="Owner Paid / No ECA Cost" value={String(insuranceSummary.owner_paid_no_cost)} />
        <Stat label="Review Items" value={String(insuranceSummary.review_items)} />
      </div> : <div className="finance-preview-stats">
        <Stat label="Records" value={String(value.total_rows ?? rows.length)} />
        <Stat label="Total amount" value={money(total)} />
        {smart ? (
          <Stat label="Commission" value={money(value.commission ?? 0)} />
        ) : (
          <Stat
            label="Review items"
            value={String(value.issues?.length ?? 0)}
          />
        )}
      </div>}
      {!!value.skipped_rows && <p className="finance-dialog-copy">{value.skipped_rows} recurring {value.skipped_rows === 1 ? "row is" : "rows are"} outside the selected month and will not be posted.</p>}
      {smart && (
        <div aria-live="polite">
          {validated ? (
            <>
              <p>
                {value.matched_rows} matched rows · {value.unmatched_rows}{" "}
                unmatched rows
              </p>
              <p>
                {value.matched_vehicles} matched vehicles ·{" "}
                {value.unmatched_vehicles} unmatched vehicles
              </p>
            </>
          ) : (
            <p>
              {validationError
                ? "Validation incomplete. Fetch the latest Vehicle Master to continue."
                : "Checking the latest Vehicle Master…"}
            </p>
          )}
          {validationError && (
            <p role="alert" className="finance-message is-error">
              {validationError}
            </p>
          )}
          <button
            type="button"
            className="finance-secondary"
            disabled={disabled}
            onClick={onRevalidate}
          >
            Revalidate
          </button>
        </div>
      )}
      {!!value.issues?.length && (!smart || validated) && (
        <ul className="finance-issues" aria-label="Import checks">
          {value.issues.map((issue: any, index: number) => (
            <li key={index}>
              {String(issue.detail)
                .replace(/plate_key/g, "car plate")
                .replace(/_/g, " ")}
              {issue.plate_key ? ` · ${issue.plate_key}` : ""}
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <>
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Date / coverage</th>
                  <th>Category / business</th>
                  <th>{insuranceSummary ? "Premium (RM)" : preview.kind === "corporate_expense" ? "Amount (RM)" : "Amount"}</th>
                  {preview.kind === "corporate_expense" && <th>Frequency</th>}
                  {hasInsurance && <th>Responsibility</th>}
                  {hasInsurance && <th>Insurance status</th>}
                  {smart && (
                    <>
                      <th>Commission</th>
                      <th>Status</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((row: any, index: number) => (
                  <tr key={index}>
                    <td>
                      {row.display_plate ?? row.plate_key ?? "Shared cost"}
                    </td>
                    <td>
                      {row.frequency === "MONTHLY_RECURRING" ? `${row.start_month?.slice(0, 7) ?? "—"} – ${row.end_month?.slice(0, 7) ?? "ongoing"}` : row.billing_date ??
                        (row.pickup_date
                          ? `${row.pickup_date} – ${row.return_date}`
                          : null) ??
                        (row.coverage_start !== undefined
                          ? `${row.coverage_start ?? "—"} – ${row.coverage_end ?? "—"}`
                          : row.start_month) ??
                        "—"}
                    </td>
                    <td>
                      {row.category ??
                        row.cost_type ??
                        row.business_unit ??
                        (smart ? "Rental revenue" : "Insurance")}
                    </td>
                    <td>
                      {row.business_unit
                        ? "—"
                        : money(
                            row.amount ??
                              row.gross_revenue ??
                              row.monthly_amount ??
                              row.premium ??
                              0,
                          )}
                    </td>
                    {preview.kind === "corporate_expense" && <td>{row.frequency === "MONTHLY_RECURRING" ? "Monthly recurring" : row.frequency === "ONE_OFF" ? "One-off" : "Needs review"}</td>}
                    {hasInsurance && <td>{row.coverage_start !== undefined ? row.responsibility?.replace("_", " ") ?? "Not specified" : "—"}</td>}
                    {hasInsurance && <td>{row.coverage_start !== undefined ? insuranceStatus(row) : "—"}</td>}
                    {smart && (
                      <>
                        <td>{money(row.commission)}</td>
                        <td>{row.status}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <button
              className="finance-link"
              onClick={() => setLimit((n) => n + 100)}
            >
              Show more records ({Math.min(limit, rows.length)} of {rows.length}
              )
            </button>
          )}
        </>
      )}
      {smart && smartExists && (
        <p className="finance-dialog-copy">
          Approval replaces the current Smart Drive report for this month. The
          previous import stays in the audit history.
        </p>
      )}
      <div className="finance-dialog-actions">
        <button
          className="finance-secondary"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="finance-primary"
          disabled={disabled || !validated || errors || !rows.length}
          onClick={() => onPost(smart && smartExists)}
        >
          Approve and post{smart && smartExists ? " replacement" : ""}
        </button>
      </div>
    </>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="finance-total">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
