import React from "react";
import { CheckIcon, CircleIcon, ReloadIcon } from "@radix-ui/react-icons";
import type {
  FinanceExpense,
  FinanceInput,
  FinanceReport,
  QualityIssue,
} from "../../types/finance";
import type {
  WorkspaceMeta,
  WorkspaceSection,
} from "../../services/finance/workspace";

const money = (value: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(
    value,
  );
const updated = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("en-MY", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not yet updated";
export function readableIssue(issue: QualityIssue) {
  const labels: Record<string, string> = {
    MISSING_REFRESHED_AT:
      "E-Hailing data has not been refreshed for this month.",
    MISSING_SMART_IMPORT:
      "Smart Drive Sales Report has not been uploaded for this month.",
    MISSING_COST_MASTER:
      "Vehicles with revenue need their monthly costs checked.",
    UNMATCHED_PLATE:
      "Vehicle plates need to be added or corrected in Settings.",
    MISSING_PLATE: "An E-Hailing payment needs a vehicle assignment.",
    MISSING_DRIVER: "An E-Hailing payment needs its driver details checked.",
    COST_WITHOUT_REVENUE:
      "Vehicles have costs with no revenue recorded this month.",
    HISTORICAL_ATTRIBUTION_POSSIBLE:
      "Confirm that historical payments are assigned to the correct vehicles.",
    HISTORICAL_ATTRIBUTION_CHANGED:
      "Vehicle assignments changed since the previous refresh. Check the affected payments.",
    BANK_MATCH_CHANGED:
      "An existing bank match needs review in Reconciliation Tools.",
    UNCLASSIFIED_RECURRING_COST:
      "Choose a cost type for the monthly costs awaiting classification.",
    SOURCE_COUNT_MISMATCH:
      "The payment count needs checking. Refresh E-Hailing data.",
    SOURCE_CASH_MISMATCH: "Cash totals need checking. Refresh E-Hailing data.",
    SOURCE_CLAIM_MISMATCH:
      "Service claim totals need checking. Refresh E-Hailing data.",
  };
  return labels[issue.code] ?? issue.detail;
}
export function groupedIssues(issues: QualityIssue[]) {
  const groups = new Map<
    string,
    { issue: QualityIssue; count: number; plates: Set<string> }
  >();
  for (const issue of issues) {
    const group = groups.get(issue.code) ?? {
      issue,
      count: 0,
      plates: new Set<string>(),
    };
    group.count++;
    if (issue.plate_key) group.plates.add(issue.plate_key);
    groups.set(issue.code, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.issue.severity === "error") -
        Number(a.issue.severity === "error") ||
      Number(a.issue.code === "HISTORICAL_ATTRIBUTION_POSSIBLE") -
        Number(b.issue.code === "HISTORICAL_ATTRIBUTION_POSSIBLE"),
  );
}
type Props = {
  month: string;
  input: FinanceInput;
  report: FinanceReport | null;
  workspaceMeta: WorkspaceMeta | null;
  busy: boolean;
  acknowledged: boolean;
  setAcknowledged: (value: boolean) => void;
  reason: string;
  setReason: (value: string) => void;
  onRefresh: () => void;
  onReady: () => void;
  onClose: (workshopAcknowledged: boolean) => void;
  onReopen: () => void;
  onFile: (kind: any, file?: File) => void;
  onReview: (section: WorkspaceSection, decision: "NONE" | "REVIEWED") => void;
  onShowAudit: () => void;
  onShowIssues: () => void;
  onOverview: () => void;
  onExpenses: (source: FinanceExpense["payment_source"]) => void;
  onViewImport: () => void;
  onReviewSelected?: () => void;
};
export default function FinanceMonthClose(p: Props) {
  const [workshopAcknowledged, setWorkshopAcknowledged] = React.useState(false);
  const { input, month, busy, workspaceMeta } = p;
  const draft = input.month.status === "DRAFT",
    closed = input.month.status === "CLOSED";
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString(
    "en-MY",
    { month: "long", year: "numeric" },
  );
  const issues = groupedIssues(p.report?.issues ?? []);
  const optional = [
    {
      key: "workshop" as const,
      title: "Workshop billing",
      source: "Workshop Billing" as const,
      kind: "WORKSHOP",
      hint: "Workshop bills paid directly by ECA.",
    },
    {
      key: "vehicle_expense" as const,
      title: "Other vehicle costs",
      source: "Vehicle Direct Cost" as const,
      kind: "vehicle_expense",
      hint: "Road tax, permits, tyres and other vehicle-specific costs.",
    },
    {
      key: "corporate_expense" as const,
      title: "Operation Fix Cost",
      source: "Corporate Opex" as const,
      kind: "corporate_expense",
      hint: "Use Amount (RM). Monthly recurring costs use Start Month and optional End Month; Expense Date is optional.",
    },
    {
      key: "other_income" as const,
      title: "Other Income",
      source: null,
      kind: "other_income",
      hint: "Confirmed manual income, attributed to a vehicle or business unit.",
    },
  ];
  const isReviewed = (key: WorkspaceSection) =>
    Boolean(workspaceMeta?.reviews.find((row) => row.section === key)?.valid);
  const allReviewed = optional.every((section) => isReviewed(section.key));
  const noBlockingIssues = !p.report?.issues.some(
    (issue) => issue.severity === "error",
  );
  const prepared = Boolean(
    input.month.refreshed_at &&
    input.smart_import &&
    allReviewed &&
    noBlockingIssues,
  );
  const activeCosts = input.recurring_costs.some(
    (cost) =>
      cost.start_month.slice(0, 7) <= month &&
      (!cost.end_month || cost.end_month.slice(0, 7) >= month),
  );
  const activeInsurance = input.insurance.some(
    (policy) =>
      Boolean(policy.coverage_start && policy.coverage_end) &&
      policy.coverage_start!.slice(0, 7) <= month &&
      policy.coverage_end!.slice(0, 7) >= month,
  );
  const unallocatedWorkshop = p.report?.totals.workshop_unallocated ?? 0;
  const hasUnallocatedWorkshop = unallocatedWorkshop > 0;
  const checks: [boolean, string][] = [
    [Boolean(input.month.refreshed_at), "E-Hailing revenue refreshed"],
    [Boolean(input.smart_import), "Smart Drive Sales Report approved"],
    [activeCosts, "Monthly vehicle costs available"],
    [activeInsurance, "Insurance available"],
    ...optional.map(
      (s) => [isReviewed(s.key), `${s.title} reviewed`] as [boolean, string],
    ),
    [noBlockingIssues, "Blocking data exceptions cleared"],
  ];
  return (
    <div className="finance-content">
      <section className="finance-close-header">
        <div>
          <p className="finance-eyebrow">{monthName}</p>
          <h2>{closed ? "Month is closed" : "Prepare month close"}</h2>
          <p>
            {closed
              ? `Closed ${updated(input.month.frozen_at)}. Figures stay frozen until reopened.`
              : "Prepare each data source, review your P&L, then close the month."}
          </p>
        </div>
        <div className="finance-close-actions">
          {!closed && (
            <button
              className="finance-secondary"
              disabled={busy || !draft}
              onClick={p.onRefresh}
            >
              <ReloadIcon /> Refresh E-Hailing Data
            </button>
          )}
          {draft ? (
            <button
              className="finance-primary"
              disabled={busy || !prepared}
              onClick={p.onReady}
            >
              Ready for review
            </button>
          ) : (
            <>
              <label className="finance-field">
                <span>{closed ? "Reason to reopen" : "Return reason"}</span>
                <input
                  value={p.reason}
                  onChange={(e) => p.setReason(e.target.value)}
                  placeholder="Explain the change needed"
                />
              </label>
              <button
                className="finance-secondary"
                disabled={busy || !p.reason.trim()}
                onClick={p.onReopen}
              >
                {closed ? "Reopen month" : "Return to draft"}
              </button>
            </>
          )}
        </div>
      </section>
      <div className="finance-sections">
        <section className="finance-close-section">
          <div className="finance-section-main">
            <div className="finance-section-title">
              <h3>E-Hailing revenue</h3>
              <Badge status={input.month.refreshed_at ? "READY" : "MISSING"} />
            </div>
            <p>Automatic E-Hailing payment ledger</p>
            <ul>
              <li>Cash rental received: {money(input.month.total_cash)}</li>
              <li>Service claims: {money(input.month.total_claim)}</li>
              <li>{input.month.source_count} payment rows</li>
            </ul>
            <strong>
              Gross rental revenue settled:{" "}
              {money(input.month.total_cash + input.month.total_claim)}
            </strong>
            <p>Last updated: {updated(input.month.refreshed_at)}</p>
          </div>
          <div className="finance-section-action">
            {!closed && (
              <button
                className="finance-secondary"
                disabled={busy || !draft}
                onClick={p.onRefresh}
              >
                Refresh E-Hailing Data
              </button>
            )}
            <button className="finance-link" onClick={p.onShowAudit}>
              View audit details
            </button>
          </div>
        </section>
        <section className="finance-close-section">
          <div className="finance-section-main">
            <div className="finance-section-title">
              <h3>Smart Drive Sales Report</h3>
              <Badge status={input.smart_import ? "READY" : "MISSING"} />
            </div>
            <p>
              {input.smart_import?.filename ??
                "Upload the monthly Smart Drive Sales Report."}
            </p>
            {input.smart_import && (
              <>
                <ul>
                  <li>
                    {input.smart_rows.length} rows ·{" "}
                    {new Set(input.smart_rows.map((r) => r.plate_key)).size}{" "}
                    vehicles
                  </li>
                  <li>
                    Gross revenue:{" "}
                    {money(
                      input.smart_rows.reduce(
                        (sum, r) => sum + r.gross_revenue,
                        0,
                      ),
                    )}
                  </li>
                  <li>
                    Commission:{" "}
                    {money(
                      input.smart_rows.reduce(
                        (sum, r) => sum + r.commission,
                        0,
                      ),
                    )}
                  </li>
                </ul>
                <p>Last uploaded: {updated(input.smart_import.imported_at)}</p>
              </>
            )}
          </div>
          <div className="finance-section-action">
            {!closed && (
              <Upload
                disabled={busy || !draft}
                label={input.smart_import ? "Replace file" : "Upload Excel"}
                onFile={(file) => p.onFile("SMART_DRIVE", file)}
              />
            )}{" "}
            {input.smart_import && (
              <button className="finance-link" onClick={p.onViewImport}>
                View import
              </button>
            )}
            {p.onReviewSelected && !closed && (
              <button
                className="finance-link"
                disabled={busy || !draft}
                onClick={p.onReviewSelected}
              >
                Review selected file
              </button>
            )}
          </div>
        </section>
        {optional.map((section) => {
          const rows = section.key === "other_income" ? (input.other_income ?? []).filter((row) => !row.cancelled_at) : input.expenses.filter(
              (row) => !row.cancelled_at && row.payment_source === section.source,
            ),
            review = workspaceMeta?.reviews.find(
              (row) => row.section === section.key,
            );
          // Current uploads are tracked in section_uploads; older workshop months only in the legacy imports table.
          const upload =
            workspaceMeta?.uploads.find((row) => row.kind === section.key) ??
            (section.key === "workshop" ? input.imports.find((row) => row.kind === "WORKSHOP") : undefined);
          return (
            <section className="finance-close-section" key={section.key}>
              <div className="finance-section-main">
                <div className="finance-section-title">
                  <h3>{section.title}</h3>
                  <Badge
                    status={
                      isReviewed(section.key)
                        ? "READY"
                        : rows.length
                          ? "NEEDS REVIEW"
                          : "OPTIONAL"
                    }
                  />
                </div>
                <p>{section.hint}</p>
                <strong>
                  {money(rows.reduce((sum, row) => sum + row.amount, 0))}
                </strong>
                <p>
                  {rows.length} records
                  {section.source !== "Corporate Opex"
                    ? ` · ${new Set(rows.map((row) => row.plate_key).filter(Boolean)).size} vehicles`
                    : ""}
                </p>
                {upload && <p>Last uploaded: {updated(upload.imported_at)}</p>}
                {review?.valid && (
                  <p>
                    {review.decision === "NONE"
                      ? "Confirmed none this month"
                      : "Reviewed"}{" "}
                    · {updated(review.reviewed_at)}
                  </p>
                )}
                <p className="finance-column-hint">
                  Excel columns:{" "}
                  {section.key === "other_income" ? "Finance Month, Income Type, Amount, Car Plate or Business Unit" : section.source === "Corporate Opex"
                    ? "Frequency, Start Month, End Month, Expense Date, Category, Amount (RM)"
                    : "Car Plate, Date, Amount"}
                  {section.source === "Vehicle Direct Cost" ? ", Category" : ""}
                  {section.source === "Corporate Opex" ? ". Payee, Source and Notes are optional." : ". Supplier, Reference and Note are optional."}
                </p>
              </div>
              <div className="finance-section-action">
                {!closed && (
                  <>
                    {section.source && <button
                      className="finance-secondary"
                      disabled={busy || !draft}
                      onClick={() => p.onExpenses(section.source)}
                    >
                      Add expense
                    </button>}
                    <Upload
                      disabled={busy || !draft}
                      onFile={(file) => p.onFile(section.kind, file)}
                    />
                    <button
                      className="finance-secondary"
                      disabled={busy || !draft || Boolean(review?.valid)}
                      onClick={() =>
                        p.onReview(
                          section.key,
                          rows.length ? "REVIEWED" : "NONE",
                        )
                      }
                    >
                      {review?.valid
                        ? "Reviewed"
                        : rows.length
                          ? "Mark reviewed"
                          : "Confirm none this month"}
                    </button>
                  </>
                )}
                {section.source && <button
                  className="finance-link"
                  onClick={() => p.onExpenses(section.source)}
                >
                  View records
                </button>}
              </div>
            </section>
          );
        })}
      </div>
      <section className="finance-panel finance-check">
        <div className="finance-section-heading">
          <h3>Data check</h3>
          <button className="finance-link" onClick={p.onShowIssues}>
            Review issues
          </button>
        </div>
        {!issues.length ? (
          <p className="finance-ok">
            <CheckIcon />
            All data checks are clear.
          </p>
        ) : (
          <ul>
            {issues.slice(0, 4).map((group) => (
              <li key={group.issue.code}>
                {readableIssue(group.issue)}{" "}
                {group.plates.size > 0 && (
                  <span>({group.plates.size} vehicles)</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="finance-panel finance-checklist">
        <h3>{monthName} closing checklist</h3>
        <ul>
          {checks.map(([ready, label]) => (
            <li className={ready ? "" : "is-pending"} key={label}>
              {ready ? <CheckIcon /> : <CircleIcon />}
              {label}
            </li>
          ))}
        </ul>
        {(!activeCosts || !activeInsurance) && (
          <p>
            Check Settings for any missing monthly costs or insurance before
            acknowledging the month.
          </p>
        )}
        <div className="finance-dialog-actions">
          <button className="finance-secondary" onClick={p.onOverview}>
            Review P&amp;L
          </button>
          {input.month.status === "READY FOR REVIEW" && (
            <>
              {hasUnallocatedWorkshop && (
                <label>
                  <input type="checkbox" checked={workshopAcknowledged} onChange={(e) => setWorkshopAcknowledged(e.target.checked)} />{" "}
                  I acknowledge {money(unallocatedWorkshop)} of workshop costs are not allocated to vehicles, so vehicle margins are incomplete.
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={p.acknowledged}
                  onChange={(e) => p.setAcknowledged(e.target.checked)}
                />{" "}
                I have reviewed the data warnings.
              </label>
              <button
                className="finance-primary"
                disabled={busy || !prepared || !p.acknowledged || (hasUnallocatedWorkshop && !workshopAcknowledged)}
                onClick={() => p.onClose(workshopAcknowledged)}
              >
                Close {monthName}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span
      className={`finance-status is-${status.toLowerCase().replace(/\s/g, "-")}`}
    >
      {status}
    </span>
  );
}
function Upload({
  disabled,
  label = "Upload Excel",
  onFile,
}: {
  disabled: boolean;
  label?: string;
  onFile: (file?: File) => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        className="finance-file-input"
        type="file"
        accept=".xlsx"
        disabled={disabled}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        className="finance-secondary"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        {label}
      </button>
    </>
  );
}
