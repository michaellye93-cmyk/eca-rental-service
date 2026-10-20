import { formatCurrency, monthLong } from "../../services/fmt";
import BackupButton from "../money/BackupButton";
import { bankCheck, bankCloseState, BANK_CHECK_TOLERANCE, type CashBalanceEntry } from "../../services/cashOutlook";
import { loadCashOutlook } from "../../services/finance/api";
import { monthCashFlow } from "../../services/finance/dashboard";
import { kualaLumpurToday } from "../../utils";
import React from "react";
import { CheckIcon, CircleIcon, ReloadIcon } from "@radix-ui/react-icons";
import type {
  FinanceInput,
  FinanceReport,
  QualityIssue,
} from "../../types/finance";
import type {
  WorkspaceMeta,
  WorkspaceSection,
} from "../../services/finance/workspace";
import type { ExpenseWorkspaceTab } from "./FinanceRecords";

// Plain formatCurrency (not fmt's money): this screen has always shown a minus-zero total as "-RM 0.00".
const money = formatCurrency;
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
    SIMILAR_PLATE:
      "Vehicle Master plates that differ only by two swapped characters. Check each one for a typo.",
    UNMATCHED_PLATE:
      "Vehicle plates need to be added or corrected in Records → Vehicle Master.",
    MISSING_PLATE: "An E-Hailing payment needs a vehicle assignment.",
    MISSING_DRIVER: "An E-Hailing payment needs its driver details checked.",
    COST_WITHOUT_REVENUE:
      "Vehicles have costs with no revenue recorded this month.",
    HISTORICAL_ATTRIBUTION_CHANGED:
      "Vehicle assignments changed since the previous refresh. Check the affected payments.",
    BANK_MATCH_CHANGED:
      "An existing bank match needs review on the Reconcile tab.",
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
        Number(a.issue.severity === "error"),
  );
}
/** The CFO's month, written once: where each figure is entered, then the close, then the CEO's read. */
const MONTH_STEPS = [
  "Through the month: record payments on the Drivers page; type bank balances on Cash to keep the cash line current between statements.",
  "Records: upload the Smart Drive report, workshop bills, other vehicle costs, one-off company costs and other income (set each Confirmed); check Monthly Vehicle Costs and Insurance.",
  "Reconcile: upload both companies' bank statements, match, post.",
  "Month close: mark the four sections reviewed, tick the checks, Ready, Close.",
  "The CEO reads Overview.",
];
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
  onReview: (section: WorkspaceSection, decision: "NONE" | "REVIEWED") => void;
  onShowAudit: () => void;
  onShowIssues: () => void;
  onOverview: () => void;
  onReconcile?: () => void;
  /** Opens Records on a tab (the Smart Drive card opens its upload there). */
  onExpenses: (source: ExpenseWorkspaceTab) => void;
};
export default function FinanceMonthClose(p: Props) {
  const [workshopAcknowledged, setWorkshopAcknowledged] = React.useState(false);
  // Cash's bank balances: which accounts are in use, for the per-account reconcile check and the bank check.
  // undefined while loading, null when they could not be read.
  const [balances, setBalances] = React.useState<CashBalanceEntry[] | null | undefined>(undefined);
  React.useEffect(() => {
    let live = true;
    setBalances(undefined);
    loadCashOutlook(kualaLumpurToday()).then((outlook) => { if (live) setBalances(outlook.balances); }).catch(() => { if (live) setBalances(null); });
    return () => { live = false; };
  }, [p.input.month.revision]);
  // Accounts with no statement this month are confirmed by a tick; it is cleared when the month or that list changes.
  const [accountsAcknowledged, setAccountsAcknowledged] = React.useState(false);
  const { input, month, busy, workspaceMeta } = p;
  const draft = input.month.status === "DRAFT",
    closed = input.month.status === "CLOSED";
  const monthName = monthLong(month);
  const issues = groupedIssues(p.report?.issues ?? []);
  const optional = [
    {
      key: "workshop" as const,
      title: "Workshop",
      source: "Workshop Billing" as const,
      hint: "Workshop bills paid directly by ECA.",
    },
    {
      key: "vehicle_expense" as const,
      title: "Other vehicle costs",
      source: "Vehicle Direct Cost" as const,
      hint: "Road tax, permits, tyres and other vehicle-specific costs.",
    },
    {
      key: "corporate_expense" as const,
      title: "Operation Fix Cost",
      source: "Corporate Opex" as const,
      hint: "Company running costs such as salaries, rent and utilities. Tax instalments count in cash flow only.",
    },
    {
      key: "other_income" as const,
      title: "Other Income",
      source: null,
      hint: "Confirmed manual income, attributed to a vehicle or business unit.",
    },
  ];
  const isReviewed = (key: WorkspaceSection) =>
    Boolean(workspaceMeta?.reviews.find((row) => row.section === key)?.valid);
  const allReviewed = optional.every((section) => isReviewed(section.key));
  const noBlockingIssues = !p.report?.issues.some(
    (issue) => issue.severity === "error",
  );
  // Reconcile is a required step: at least one statement posted (every line of it matched, posted or excluded). A bank
  // account in use (a balance on Cash near this month) with no statement of its own is listed and ticked as checked
  // before closing, so cash in hand, an e-wallet or a new account never blocks the close.
  const bank = bankCloseState(balances, input.bank_imports ?? [], month, monthName);
  const bankReconciled = (input.bank_imports ?? []).length > 0;
  const accountsKey = bank.accounts.join("|");
  React.useEffect(() => { setAccountsAcknowledged(false); }, [month, accountsKey]);
  const bankReadyToClose = bank.status === "reconciled" || (bank.status === "needs-ack" && accountsAcknowledged);
  const check = balances && p.report ? bankCheck(balances, month, monthCashFlow(input, p.report).net) : null;
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
  const prepared = Boolean(
    input.month.refreshed_at &&
    input.smart_import &&
    activeCosts &&
    activeInsurance &&
    allReviewed &&
    bankReconciled &&
    noBlockingIssues,
  );
  const unallocatedWorkshop = p.report?.totals.workshop_unallocated ?? 0;
  const hasUnallocatedWorkshop = unallocatedWorkshop > 0;
  const checks: [boolean, string, boolean?][] = [
    [Boolean(input.month.refreshed_at), "E-Hailing revenue refreshed"],
    [Boolean(input.smart_import), "Smart Drive Sales Report approved"],
    [activeCosts, "Monthly vehicle costs available"],
    [activeInsurance, "Insurance available"],
    ...optional.map(
      (s) => [isReviewed(s.key), `${s.title} reviewed`] as [boolean, string],
    ),
    // While Cash is loading the line reads "checking…", neither ticked nor shown as still to do.
    [bank.ready, bank.label, bank.status === "checking"],
    [noBlockingIssues, "Blocking data exceptions cleared"],
  ];
  // The bank check is shown, not required: the cash flow is built from the month's records, so timing can differ.
  const bankCheckLine = !check ? null
    : check.unexplained === null ? `Bank check: waiting for month-end balances (${check.missing.map((m) => `${m.account} at the ${m.when === "start" ? "start" : "end"}`).join(", ")}). Posting a bank statement adds them.`
    : check.flagged ? `Bank check: the bank moved ${formatCurrency(check.unexplained)} more than the month's cash flow explains (over ${formatCurrency(BANK_CHECK_TOLERANCE)}). See Cash.`
    : `Bank check: the bank moved as the month's cash flow says (within ${formatCurrency(BANK_CHECK_TOLERANCE)}).`;
  return (
    <div className="finance-content">
      <section className="finance-close-header">
        <div>
          <h2>{monthName}{closed ? ": closed" : ""}</h2>
          <p>
            {closed
              ? `Closed ${updated(input.month.frozen_at)}. Figures stay frozen until reopened.`
              : "Each source below must be loaded and reviewed. Then check the Overview and close the month."}
          </p>
          <ol className="finance-month-steps" aria-label="The month, step by step">
            {MONTH_STEPS.map((step) => <li key={step}>{step}</li>)}
          </ol>
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
                "Upload the monthly Smart Drive Sales Report in Records → Smart Drive."}
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
            <button className="finance-link" onClick={() => p.onExpenses("smart_drive")}>
              Open in Records
            </button>
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
              </div>
              <div className="finance-section-action">
                {!closed && (
                  <>
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
                <button
                  className="finance-link"
                  onClick={() => p.onExpenses(section.source ?? "other_income")}
                >
                  Open in Records
                </button>
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
          {checks.map(([ready, label, checking]) => (
            <li className={ready || checking ? "" : "is-pending"} key={label}>
              {ready ? <CheckIcon /> : <CircleIcon />}
              {label}
            </li>
          ))}
        </ul>
        {bankCheckLine && <p className="finance-strip-note">{bankCheckLine}</p>}
        {(!activeCosts || !activeInsurance) && (
          <p>
            The month cannot close without its monthly vehicle costs and insurance: add them in Records.
          </p>
        )}
        <div className="finance-dialog-actions">
          {!bankReconciled && p.onReconcile && (
            <button className="finance-secondary" onClick={p.onReconcile}>
              Reconcile the bank statement
            </button>
          )}
          <button className="finance-secondary" onClick={p.onOverview}>
            Review the Overview
          </button>
          {input.month.status === "READY FOR REVIEW" && (
            <>
              {bank.status === "needs-ack" && (
                <label>
                  <input type="checkbox" checked={accountsAcknowledged} onChange={(e) => setAccountsAcknowledged(e.target.checked)} />{" "}
                  {bank.acknowledgement}
                </label>
              )}
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
                disabled={busy || !prepared || !bankReadyToClose || !p.acknowledged || (hasUnallocatedWorkshop && !workshopAcknowledged)}
                onClick={() => p.onClose(workshopAcknowledged)}
              >
                Close {monthName}
              </button>
            </>
          )}
        </div>
      </section>
      <BackupButton />
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
