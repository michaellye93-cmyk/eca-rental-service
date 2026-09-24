import React from "react";
import type { FinanceInput, FinanceReport } from "../../types/finance";
import type { WorkspaceMeta } from "../../services/finance/workspace";

export default function FinanceAudit({
  input,
  report,
  workspaceMeta,
  onUndo,
  onReplace,
}: {
  input: FinanceInput | null;
  report: FinanceReport | null;
  workspaceMeta: WorkspaceMeta | null;
  onUndo?: (uploadId: string) => Promise<boolean>;
  onReplace?: (upload: { id: string; kind: string }, file?: File) => void;
}) {
  if (!input) return <p>No month loaded.</p>;
  return (
    <>
      <p className="finance-dialog-copy">
        Source records and import history for investigating monthly figures.
      </p>
      <section className="finance-audit">
        <h3>Payment controls</h3>
        <dl className="finance-audit-controls">
          {Object.entries({
            Month: input.month.finance_month,
            Revision: input.month.revision,
            "Refreshed at": input.month.refreshed_at,
            "Frozen at": input.month.frozen_at,
            "Source count": input.month.source_count,
            "Total cash": input.month.total_cash,
            "Total claim": input.month.total_claim,
            "Earliest date": input.month.earliest_date,
            "Latest date": input.month.latest_date,
          }).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="finance-audit">
        <h3>Import history</h3>
        <Table headers={["Type", "File", "Rows", "Imported", "Status", "Action"]}>
          {[...input.imports, ...(workspaceMeta?.uploads ?? [])].map((item) => {
            const reviewedUpload = workspaceMeta?.uploads.some((upload) => upload.id === item.id) ?? false;
            return <tr key={item.id}>
              <td>{item.kind}</td>
              <td>{item.filename}</td>
              <td>{item.row_count}</td>
              <td>{item.imported_at}</td>
              <td>{"status" in item ? item.status : "POSTED"}</td>
              <td>{reviewedUpload && "status" in item && item.status === "POSTED" ? <div className="finance-dialog-actions">{onUndo && <button type="button" className="finance-secondary" onClick={() => void onUndo(item.id)}>Undo import</button>}{onReplace && <label className="finance-secondary">Replace selected upload<input className="finance-file-input" type="file" accept=".xlsx" onChange={(event) => { onReplace({ id: item.id, kind: item.kind }, event.target.files?.[0]); event.target.value = ""; }} /></label>}</div> : "—"}</td>
            </tr>
          })}
        </Table>
      </section>
      <details className="finance-audit">
        <summary>E-Hailing source rows ({input.ehailing.length})</summary>
        <Table
          headers={[
            "Payment ID",
            "Driver",
            "Car plate",
            "Date",
            "Cash",
            "Claim",
            "Gross revenue",
            "Refreshed at",
          ]}
        >
          {input.ehailing.map((row) => (
            <tr key={row.source_payment_id}>
              <td>{row.source_payment_id}</td>
              <td>{row.driver_name_snapshot}</td>
              <td>{row.car_plate_snapshot}</td>
              <td>{row.payment_date}</td>
              <td>{row.cash_amount}</td>
              <td>{row.service_claim}</td>
              <td>{row.gross_rental_revenue}</td>
              <td>{row.refreshed_at}</td>
            </tr>
          ))}
        </Table>
      </details>
      <details className="finance-audit">
        <summary>Smart Drive source rows ({input.smart_rows.length})</summary>
        <Table
          headers={[
            "Sheet",
            "Source row",
            "Reference",
            "Car plate",
            "Pickup",
            "Return",
            "Revenue",
            "Commission",
            "Status",
          ]}
        >
          {input.smart_rows.map((row, index) => (
            <tr key={index}>
              <td>{row.sheet_name}</td>
              <td>{row.source_row}</td>
              <td>{row.reference}</td>
              <td>{row.display_plate}</td>
              <td>{row.pickup_date}</td>
              <td>{row.return_date}</td>
              <td>{row.gross_revenue}</td>
              <td>{row.commission}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </Table>
      </details>
      <details className="finance-audit">
        <summary>Expense source rows ({input.expenses.length})</summary>
        <Table
          headers={[
            "Record ID",
            "Source",
            "Sheet",
            "Source row",
            "Reference",
            "Car plate",
            "Date",
            "Amount",
          ]}
        >
          {input.expenses.map((expense) => {
            const row = expense as typeof expense & {
              sheet_name?: string;
              source_row?: number;
            };
            return (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.payment_source === "Corporate Opex" ? "Operation Fix Cost" : row.payment_source}</td>
                <td>{row.sheet_name ?? "Manual / reviewed bank entry"}</td>
                <td>{row.source_row ?? "—"}</td>
                <td>{row.reference}</td>
                <td>{row.plate_key ?? "Shared cost"}</td>
                <td>{row.billing_date ?? "—"}</td>
                <td>{row.amount}</td>
              </tr>
            );
          })}
        </Table>
      </details>
      {(
        [...input.imports, ...(workspaceMeta?.uploads ?? [])] as Array<{
          id: string;
          filename: string;
          source_audit?: Array<{
            sheet_name?: string;
            source_row?: number | string;
            record_kind?: string;
            record_id?: string;
            plate_key?: string;
          }>;
        }>
      ).map((upload) => (
        <details className="finance-audit" key={upload.id}>
          <summary>{upload.filename} — source records</summary>
          <Table
            headers={[
              "Sheet",
              "Source row",
              "Record type",
              "Record ID",
              "Car plate",
            ]}
          >
            {(upload.source_audit ?? []).map((row, index) => (
              <tr key={index}>
                <td>{row.sheet_name}</td>
                <td>{row.source_row}</td>
                <td>{row.record_kind}</td>
                <td>{row.record_id ?? "—"}</td>
                <td>{row.plate_key ?? "—"}</td>
              </tr>
            ))}
          </Table>
        </details>
      ))}
      <section className="finance-audit">
        <h3>Technical issues</h3>
        {report?.issues.length ? (
          <ul className="finance-issues">
            {report.issues.map((issue, index) => (
              <li key={index}>
                {issue.code}: {issue.detail}
                {issue.plate_key ? ` · ${issue.plate_key}` : ""}
                {issue.source_id ? ` · ${issue.source_id}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p>No audit issues recorded.</p>
        )}
      </section>
    </>
  );
}
function Table({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="finance-table-wrap">
      <table className="finance-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
