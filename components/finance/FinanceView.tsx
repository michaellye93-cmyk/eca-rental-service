import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronRightIcon, FileTextIcon } from "@radix-ui/react-icons";
import { supabase } from "../../supabaseClient";
import type {
  FinanceExpense,
  FinanceInput,
  FinanceReport,
  FinanceVehicle,
  Insurance,
  RecurringCost,
  SmartDriveRow,
} from "../../types/finance";
import {
  getFinanceAccess,
  loadMonth,
  postBootstrap,
  postSmartDrive,
  postWorkshop,
  refreshPayments,
  saveRecord,
  deleteVehicle,
  transitionMonth,
} from "../../services/finance/api";
import { buildFinanceReport } from "../../services/finance/calculations";
import { insuranceStatus, insuranceCashOutflow } from "../../services/finance/insurance";
import {
  previewBootstrap,
  previewSmartDrive,
  previewWorkshop,
  readFinanceWorkbook,
  type FieldMapping,
  type WorkbookReadResult,
} from "../../services/finance/imports";
import {
  copyPreviousSharedCosts,
  loadWorkspaceMeta,
  postSectionWorkbook,
  previewPreviousSharedCosts,
  previewSectionWorkbook,
  reviewSection,
  type SectionKind,
  type WorkspaceMeta,
} from "../../services/finance/workspace";
import BankStatementPanel from "./BankStatementPanel";
import FinanceImportPreview from "./FinanceImportPreview";
import Dialog from "./FinanceDialog";
import FinanceAudit from "./FinanceAudit";
import MonthClose, { groupedIssues, readableIssue } from "./FinanceMonthClose";
import {
  ExpenseForm,
  VehicleForm,
  RecurringForm,
  InsuranceForm,
} from "./FinanceRecordForms";
import "./finance.css";
import "./finance-mobile.css";

const DEFAULT_MONTH = "2026-08";
const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});
const formatMoney = (value = 0) => money.format(Number(value || 0));
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("en-MY", {
    month: "long",
    year: "numeric",
  });
type Page = "overview" | "close" | "vehicles" | "expenses" | "settings";
type UploadKind = "SMART_DRIVE" | "WORKSHOP" | "BOOTSTRAP" | SectionKind;
type UploadPreview = {
  kind: UploadKind;
  file: File;
  hash: string;
  value: any;
  workbook: WorkbookReadResult;
  mapping: FieldMapping;
};

export default function FinanceView() {
  const [sessionState, setSessionState] = useState<
    "checking" | "login" | "denied" | "ready"
  >("checking");
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [input, setInput] = useState<FinanceInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [page, setPage] = useState<Page>("overview");
  const [moreOpen, setMoreOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [smartFile, setSmartFile] = useState<{
    file: File;
    mapping: FieldMapping;
  } | null>(null);
  const [previewFresh, setPreviewFresh] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [workspaceMeta, setWorkspaceMeta] = useState<WorkspaceMeta | null>(
    null,
  );
  const [previousShared, setPreviousShared] = useState<FinanceExpense[] | null>(
    null,
  );
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [expenseSource, setExpenseSource] =
    useState<FinanceExpense["payment_source"]>("Workshop Billing");
  const previewGeneration = useRef(0);
  const generation = useRef(0);
  const authorizationGeneration = useRef(0);
  const mounted = useRef(false);
  const authenticatedUserId = useRef<string | null>(null);
  const clearPrivate = useCallback(() => {
    previewGeneration.current++;
    setInput(null);
    setPreview(null);
    setSmartFile(null);
    setPreviewFresh(false);
    setPreviewError(null);
    setWorkspaceMeta(null);
    setPreviousShared(null);
    setSelectedVehicle(null);
    setIssuesOpen(false);
    setImportOpen(false);
    setAuditOpen(false);
    setBankOpen(false);
    setMoreOpen(false);
    setAcknowledged(false);
    setNotice(null);
    setError(null);
  }, []);
  const authorize = useCallback(
    async ({
      preservePrivate = false,
      expectedUserId,
    }: { preservePrivate?: boolean; expectedUserId?: string } = {}) => {
      const currentAuthorization = ++authorizationGeneration.current;
      const isCurrent = () =>
        mounted.current &&
        currentAuthorization === authorizationGeneration.current;
      const clearForState = (state: "login" | "denied") => {
        generation.current++;
        clearPrivate();
        setSessionState(state);
      };
      if (!preservePrivate) {
        generation.current++;
        clearPrivate();
        setSessionState("checking");
      }
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!isCurrent()) return;
        if (
          !user ||
          user.is_anonymous ||
          (expectedUserId && user.id !== expectedUserId)
        ) {
          authenticatedUserId.current = null;
          clearForState("login");
          return;
        }
        authenticatedUserId.current = user.id;
        if (!(await getFinanceAccess()) || !isCurrent()) {
          if (isCurrent()) clearForState("denied");
          return;
        }
        setSessionState("ready");
      } catch {
        if (isCurrent()) clearForState("denied");
      }
    },
    [clearPrivate],
  );
  useEffect(() => {
    mounted.current = true;
    void authorize();
    const deferAuthorization = (expectedUserId: string) => {
      const deferredGeneration = ++authorizationGeneration.current;
      window.setTimeout(() => {
        if (
          !mounted.current ||
          deferredGeneration !== authorizationGeneration.current
        )
          return;
        void authorize({ preservePrivate: true, expectedUserId });
      }, 0);
    };
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT" || (event as string) === "USER_DELETED") {
        authorizationGeneration.current++;
        generation.current++;
        authenticatedUserId.current = null;
        clearPrivate();
        setSessionState("login");
        return;
      }
      if (event !== "SIGNED_IN" && event !== "TOKEN_REFRESHED") return;
      if (!nextSession || nextSession.user.is_anonymous) {
        authorizationGeneration.current++;
        generation.current++;
        authenticatedUserId.current = null;
        clearPrivate();
        setSessionState("login");
        return;
      }
      const userChanged = authenticatedUserId.current !== nextSession.user.id;
      if (userChanged) {
        authorizationGeneration.current++;
        generation.current++;
        clearPrivate();
        setSessionState("checking");
      }
      authenticatedUserId.current = nextSession.user.id;
      deferAuthorization(nextSession.user.id);
    });
    return () => {
      mounted.current = false;
      authorizationGeneration.current++;
      generation.current++;
      data.subscription.unsubscribe();
    };
  }, [authorize, clearPrivate]);
  const reload = useCallback(
    async (selectedMonth = month) => {
      if (sessionState !== "ready") return;
      const current = generation.current;
      setBusy(true);
      setError(null);
      try {
        const [loaded, meta] = await Promise.all([
          loadMonth(selectedMonth),
          loadWorkspaceMeta(selectedMonth),
        ]);
        if (current === generation.current && selectedMonth === month) {
          setInput(loaded);
          setWorkspaceMeta(meta);
          setAcknowledged(false);
        }
      } catch (cause) {
        if (current === generation.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load Finance data.",
          );
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [month, sessionState],
  );
  useEffect(() => {
    void reload(month);
  }, [month, reload]);
  const report = useMemo(
    () => (input ? buildFinanceReport(input) : null),
    [input],
  );
  const revise = input?.month.revision ?? 0;
  const isDraft = input?.month.status === "DRAFT";
  const invoke = async (
    work: () => Promise<FinanceInput | void>,
    message: string,
  ) => {
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (current !== generation.current) return false;
      if (result) {
        setInput(result);
        const meta = await loadWorkspaceMeta(month);
        if (current !== generation.current) return false;
        setWorkspaceMeta(meta);
      } else await reload();
      if (current !== generation.current) return false;
      setNotice(message);
      return true;
    } catch (cause) {
      if (current === generation.current)
        setError(
          cause instanceof Error ? cause.message : "Finance action failed.",
        );
      return false;
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const returnToMainLogin = async () => {
    authorizationGeneration.current++;
    generation.current++;
    authenticatedUserId.current = null;
    clearPrivate();
    setSessionState("login");
    await supabase.auth.signOut();
  };
  const selectFile = async (
    kind: UploadKind,
    file?: File,
    mapping: FieldMapping = {},
  ) => {
    if (!file || !input) return;
    const current = generation.current;
    const request = ++previewGeneration.current;
    const isCurrent = () =>
      mounted.current &&
      current === generation.current &&
      request === previewGeneration.current;
    setBusy(true);
    setError(null);
    setPreviewFresh(false);
    setPreviewError(null);
    if (kind === "SMART_DRIVE") setSmartFile({ file, mapping });
    try {
      // Read again for every selection, mapping change, reopened review and Revalidate.
      // A Draft month read includes the current Finance masters; closed snapshots stay frozen.
      const [latestInput, latestMeta] =
        kind === "SMART_DRIVE"
          ? await Promise.all([loadMonth(month), loadWorkspaceMeta(month)])
          : [input, workspaceMeta];
      if (!isCurrent()) return;
      if (kind === "SMART_DRIVE") {
        setInput(latestInput);
        setWorkspaceMeta(latestMeta);
        if (latestInput.month.status !== "DRAFT")
          throw new Error(
            "Return this month to Draft before reviewing a new Smart Drive import.",
          );
      }
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const workbook = await readFinanceWorkbook(bytes);
      const value =
        kind === "SMART_DRIVE"
          ? await previewSmartDrive(
              bytes,
              file.name,
              month,
              latestInput.vehicles,
              mapping,
            )
          : kind === "WORKSHOP"
            ? await previewWorkshop(
                bytes,
                file.name,
                month,
                input.vehicles,
                mapping,
              )
            : kind === "BOOTSTRAP"
              ? await previewBootstrap(bytes, file.name, month)
              : await previewSectionWorkbook(
                  bytes,
                  file.name,
                  kind,
                  month,
                  input,
                );
      if (isCurrent()) {
        setPreview({ kind, file, hash, value, workbook, mapping });
        setPreviewFresh(true);
      }
    } catch (cause) {
      if (isCurrent()) {
        const message =
          cause instanceof Error
            ? cause.message
            : "Could not validate this workbook.";
        setError(message);
        setPreviewError(message);
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const postPreview = async (replace = false) => {
    if (
      !preview ||
      !previewFresh ||
      !input ||
      !isDraft ||
      preview.value.issues?.some((issue: any) => issue.severity === "error")
    )
      return;
    const ok =
      preview.kind === "SMART_DRIVE"
        ? await invoke(
            () =>
              postSmartDrive(
                month,
                preview.file.name,
                preview.value.rows as SmartDriveRow[],
                replace,
                revise,
                preview.hash,
              ),
            replace
              ? "Smart Drive report replaced."
              : "Smart Drive report approved.",
          )
        : preview.kind === "WORKSHOP"
          ? await invoke(
              () =>
                postWorkshop(
                  month,
                  preview.file.name,
                  preview.value.rows as FinanceExpense[],
                  revise,
                  preview.hash,
                ),
              "Workshop billing posted.",
            )
          : preview.kind === "BOOTSTRAP"
            ? await invoke(
                () => postBootstrap(preview.value.data, preview.file.name),
                "Finance master workbook saved.",
              )
            : await invoke(
                () =>
                  postSectionWorkbook(
                    preview.kind,
                    month,
                    preview.file.name,
                    preview.value.rows,
                    revise,
                    preview.hash,
                  ),
                "Workbook posted.",
              );
    if (ok) {
      setPreview(null);
      setPreviewFresh(false);
      if (preview.kind === "SMART_DRIVE") setSmartFile(null);
    }
  };
  const showPreviousShared = async () => {
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const rows = await previewPreviousSharedCosts(month);
      if (current === generation.current) setPreviousShared(rows);
    } catch (cause) {
      if (current === generation.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load previous shared costs.",
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  if (sessionState === "checking")
    return (
      <div className="finance-workspace finance-loading">
        <Skeleton lines={5} />
      </div>
    );
  if (sessionState === "login")
    return <AccessRequired onReturnToMainLogin={returnToMainLogin} />;
  if (sessionState === "denied")
    return <AccessDenied onReturnToMainLogin={returnToMainLogin} />;
  return (
    <main className="finance-workspace">
      <header className="finance-topbar">
        <div>
          <p className="finance-eyebrow">Management finance</p>
          <h1>Management P&amp;L</h1>
          <p className="finance-subtitle">
            Monthly performance, costs and close preparation.
          </p>
        </div>
        <div className="finance-top-actions">
          <label className="finance-month">
            <span>Reporting month</span>
            <input
              aria-label="Reporting month"
              type="month"
              disabled={busy}
              value={month}
              onChange={(e) => {
                if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
                generation.current++;
                clearPrivate();
                setReason("");
                setMonth(e.target.value);
              }}
            />
          </label>
          <StatusBadge status={input?.month.status} />
        </div>
      </header>
      <nav aria-label="Finance sections" className="finance-nav">
        {(
          [
            ["overview", "Overview"],
            ["close", "Month Close"],
            ["vehicles", "Vehicles"],
            ["expenses", "Expenses"],
            ["settings", "Settings"],
          ] as [Page, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={page === id ? "is-active" : ""}
            onClick={() => setPage(id)}
          >
            {label}
          </button>
        ))}
        <div className="finance-more">
          <button
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            More <ChevronRightIcon />
          </button>
          {moreOpen && (
            <div className="finance-more-menu">
              <button
                onClick={() => {
                  setAuditOpen(true);
                  setMoreOpen(false);
                }}
              >
                Audit Details
              </button>
              <button
                onClick={() => {
                  setBankOpen(true);
                  setMoreOpen(false);
                }}
              >
                Reconciliation Tools
              </button>
            </div>
          )}
        </div>
      </nav>
      {error && <Message type="error">{error}</Message>}
      {notice && <Message type="success">{notice}</Message>}
      {!input ? (
        <section className="finance-panel">
          {error ? (
            <button
              className="finance-secondary"
              disabled={busy}
              onClick={() => void reload()}
            >
              Retry loading Finance
            </button>
          ) : (
            <Skeleton lines={9} />
          )}
        </section>
      ) : (
        <>
          {page === "overview" && (
            <Overview
              report={report}
              month={month}
              onVehicle={(plate?: string) =>
                plate ? setSelectedVehicle(plate) : setPage("vehicles")
              }
            />
          )}
          {page === "close" && (
            <MonthClose
              month={month}
              input={input}
              report={report}
              workspaceMeta={workspaceMeta}
              busy={busy}
              acknowledged={acknowledged}
              setAcknowledged={setAcknowledged}
              reason={reason}
              setReason={setReason}
              onRefresh={() =>
                invoke(
                  () => refreshPayments(month),
                  "E-Hailing data refreshed.",
                )
              }
              onReady={() =>
                invoke(
                  () => transitionMonth(month, "READY", revise),
                  "Month is ready for review.",
                )
              }
              onClose={() =>
                invoke(
                  () =>
                    transitionMonth(
                      month,
                      "CLOSE",
                      revise,
                      "Warnings acknowledged in Finance UI",
                    ),
                  "Month closed and frozen.",
                )
              }
              onReopen={() =>
                invoke(
                  () => transitionMonth(month, "REOPEN", revise, reason.trim()),
                  "Month reopened as Draft.",
                )
              }
              onFile={selectFile}
              onReview={(section, decision) =>
                invoke(async () => {
                  await reviewSection(month, section, decision, revise);
                }, "Section review saved.")
              }
              onCopyPrevious={showPreviousShared}
              onShowAudit={() => setAuditOpen(true)}
              onShowIssues={() => setIssuesOpen(true)}
              onOverview={() => setPage("overview")}
              onExpenses={(source) => {
                setExpenseSource(source);
                setPage("expenses");
              }}
              onViewImport={() => setImportOpen(true)}
              onReviewSelected={
                smartFile
                  ? () =>
                      selectFile(
                        "SMART_DRIVE",
                        smartFile.file,
                        smartFile.mapping,
                      )
                  : undefined
              }
            />
          )}
          {page === "vehicles" && (
            <Vehicles report={report} onVehicle={setSelectedVehicle} />
          )}
          {page === "expenses" && (
            <Expenses
              key={`${month}:${expenseSource}`}
              initialSource={expenseSource}
              input={input}
              month={month}
              disabled={busy || !isDraft}
              onSave={(record) =>
                invoke(() => saveRecord("expense", record), "Expense saved.")
              }
              onFile={selectFile}
            />
          )}
          {page === "settings" && (
            <Settings
              input={input}
              month={month}
              disabled={busy || !isDraft}
              onSave={(kind, record) =>
                invoke(() => saveRecord(kind, record), "Finance record saved.")
              }
              onDelete={(vehicle: FinanceVehicle) =>
                invoke(() => deleteVehicle(month, vehicle.plate_key, revise), "Vehicle deleted from the current master list.")
              }
              onFile={selectFile}
            />
          )}
        </>
      )}
      {preview && (
        <PreviewDialog
          preview={preview}
          smartExists={!!input?.smart_import}
          disabled={busy || !isDraft}
          validated={previewFresh}
          validationError={previewError}
          onRevalidate={() =>
            selectFile(preview.kind, preview.file, preview.mapping)
          }
          month={month}
          onMapping={(mapping) =>
            selectFile(preview.kind, preview.file, mapping)
          }
          onCancel={() => {
            if (!busy) {
              previewGeneration.current++;
              setPreview(null);
              setPreviewFresh(false);
            }
          }}
          onPost={postPreview}
        />
      )}
      {previousShared && (
        <PreviousSharedDialog
          rows={previousShared}
          disabled={busy || !isDraft}
          onClose={() => setPreviousShared(null)}
          onCopy={(rows) =>
            invoke(
              () => copyPreviousSharedCosts(month, rows, revise),
              "Selected shared costs copied.",
            )
          }
        />
      )}
      {auditOpen && (
        <AuditDialog
          workspaceMeta={workspaceMeta}
          input={input}
          report={report}
          onClose={() => setAuditOpen(false)}
        />
      )}
      {issuesOpen && (
        <Dialog title="Review data issues" onClose={() => setIssuesOpen(false)}>
          <ul className="finance-issues">
            {groupedIssues(report?.issues ?? []).map((group) => (
              <li key={group.issue.code}>
                <strong>{readableIssue(group.issue)}</strong>
                {group.plates.size > 0 && (
                  <p>Vehicles: {[...group.plates].join(", ")}</p>
                )}
                <p>{group.count} affected records</p>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {importOpen && input && (
        <Dialog title="Smart Drive import" onClose={() => setImportOpen(false)}>
          <p>{input.smart_import?.filename}</p>
          <DataTable
            headers={[
              "Vehicle",
              "Pickup",
              "Return",
              "Gross revenue",
              "Commission",
              "Status",
            ]}
          >
            {input.smart_rows.map((row, index) => (
              <tr key={index}>
                <td>{row.display_plate}</td>
                <td>{row.pickup_date}</td>
                <td>{row.return_date}</td>
                <td>{formatMoney(row.gross_revenue)}</td>
                <td>{formatMoney(row.commission)}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </DataTable>
        </Dialog>
      )}
      {selectedVehicle && report && (
        <VehicleDialog
          vehicle={report.vehicles.find(
            (vehicle) => vehicle.plate_key === selectedVehicle,
          )}
          month={month}
          onClose={() => setSelectedVehicle(null)}
        />
      )}
      {bankOpen && (
        <Dialog title="Reconciliation tools" onClose={() => setBankOpen(false)}>
          <BankStatementPanel
            month={month}
            input={input}
            disabled={busy || !isDraft}
            onPosted={(next, message) => {
              void invoke(async () => next, message);
            }}
            onError={setError}
          />
        </Dialog>
      )}
    </main>
  );
}

function Overview({
  report,
  month,
  onVehicle,
}: {
  report: FinanceReport | null;
  month: string;
  onVehicle: (plate?: string) => void;
}) {
  if (!report)
    return (
      <section className="finance-panel">
        <Skeleton lines={8} />
      </section>
    );
  const totals = report.totals;
  const cost =
    totals.commission +
    totals.recurring +
    totals.service_claim +
    totals.workshop +
    totals.insurance +
    totals.direct_costs;
  const businesses = Object.entries(report.businesses).filter(
    ([name, row]) => name !== "UNMATCHED" || row.revenue || row.contribution,
  );
  const vehicles = [...report.vehicles]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 8);
  return (
    <div className="finance-content">
      <section className="finance-title-row">
        <div>
          <p className="finance-eyebrow">{monthLabel(month)}</p>
          <h2>Monthly performance</h2>
        </div>
        <span className="finance-readonly">Read only</span>
      </section>
      <section className="finance-summary-grid">
        <Total label="Revenue" value={formatMoney(totals.revenue)} />
        <Total
          label="Direct vehicle costs"
          value={formatMoney(-cost)}
          negative
        />
        <Total
          label="Business contribution"
          value={formatMoney(totals.contribution)}
          emphasis
        />
        <Total
          label="Corporate / shared opex"
          value={formatMoney(-report.corporate_opex)}
          negative
        />
        <Total
          label="Management profit"
          value={formatMoney(report.management_profit)}
          emphasis
        />
        <Total
          label="Net margin"
          value={
            totals.revenue
              ? `${((report.management_profit / totals.revenue) * 100).toFixed(1)}%`
              : "—"
          }
        />
      </section>
      <section className="finance-panel">
        <SectionHeading
          title="Business performance"
          detail="Revenue and direct costs by operating business."
        />
        <DataTable
          headers={[
            "Business",
            "Revenue",
            "Direct cost",
            "Contribution",
            "Margin",
          ]}
        >
          {businesses.map(([business, value]) => {
            const direct =
              value.commission +
              value.recurring +
              value.service_claim +
              value.workshop +
              value.insurance +
              value.direct_costs;
            return (
              <tr key={business}>
                <td>{business}</td>
                <td>{formatMoney(value.revenue)}</td>
                <td className="finance-negative">{formatMoney(-direct)}</td>
                <td className="finance-strong">
                  {formatMoney(value.contribution)}
                </td>
                <td>
                  {value.margin === null
                    ? "—"
                    : `${(value.margin * 100).toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </DataTable>
      </section>
      <section className="finance-panel">
        <SectionHeading
          title="Vehicle performance"
          detail="Highest contribution vehicles for this month."
          action={
            <button className="finance-link" onClick={() => onVehicle()}>
              View all vehicles <ChevronRightIcon />
            </button>
          }
        />
        <DataTable
          headers={[
            "Vehicle",
            "Business",
            "Revenue",
            "Cost",
            "Contribution",
            "Margin",
          ]}
        >
          {vehicles.map((vehicle) => {
            const direct =
              vehicle.commission +
              vehicle.recurring +
              vehicle.service_claim +
              vehicle.workshop +
              vehicle.insurance +
              vehicle.direct_costs;
            return (
              <tr
                key={vehicle.plate_key}
                tabIndex={0}
                onClick={() => onVehicle(vehicle.plate_key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onVehicle(vehicle.plate_key);
                }}
                className="finance-click-row"
              >
                <td className="finance-strong">{vehicle.display_plate}</td>
                <td>{vehicle.business_unit}</td>
                <td>{formatMoney(vehicle.revenue)}</td>
                <td className="finance-negative">{formatMoney(-direct)}</td>
                <td className="finance-strong">
                  {formatMoney(vehicle.contribution)}
                </td>
                <td>
                  {vehicle.margin === null
                    ? "—"
                    : `${(vehicle.margin * 100).toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </DataTable>
      </section>
    </div>
  );
}

function Vehicles({
  report,
  onVehicle,
}: {
  report: FinanceReport | null;
  onVehicle: (plate: string) => void;
}) {
  if (!report)
    return (
      <section className="finance-panel">
        <Skeleton lines={8} />
      </section>
    );
  return (
    <div className="finance-content">
      <section className="finance-title-row">
        <div>
          <p className="finance-eyebrow">Vehicle profitability</p>
          <h2>Vehicles</h2>
        </div>
      </section>
      <section className="finance-panel">
        <DataTable
          headers={[
            "Vehicle",
            "Business",
            "Revenue",
            "Recurring",
            "Maintenance",
            "Insurance",
            "Other cost",
            "Contribution",
            "Margin",
          ]}
        >
          {report.vehicles.map((v) => (
            <tr
              key={v.plate_key}
              className="finance-click-row"
              tabIndex={0}
              onClick={() => onVehicle(v.plate_key)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onVehicle(v.plate_key);
              }}
            >
              <td className="finance-strong">{v.display_plate}</td>
              <td>{v.business_unit}</td>
              <td>{formatMoney(v.revenue)}</td>
              <td>{formatMoney(-v.recurring)}</td>
              <td>{formatMoney(-(v.workshop + v.service_claim))}</td>
              <td>{formatMoney(-v.insurance)}</td>
              <td>{formatMoney(-(v.direct_costs + v.commission))}</td>
              <td className="finance-strong">{formatMoney(v.contribution)}</td>
              <td>
                {v.margin === null ? "—" : `${(v.margin * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

function Expenses({
  input,
  month,
  disabled,
  onSave,
  onFile,
  initialSource,
}: any) {
  const [tab, setTab] = useState<
    "Workshop Billing" | "Vehicle Direct Cost" | "Corporate Opex"
  >(initialSource);
  const groups: Array<[typeof tab, string, string]> = [
    ["Workshop Billing", "Workshop", "Workshop bills paid directly by ECA."],
    [
      "Vehicle Direct Cost",
      "Other Vehicle Costs",
      "Road tax, permits, repairs and other vehicle-specific costs.",
    ],
    ["Corporate Opex", "Shared Opex", "Excel: Frequency, Start Month, End Month, Expense Date, Category, Description, Amount (RM), Payee, Source, Notes. Monthly recurring costs require Start Month; Expense Date is optional."],
  ];
  const visible = input.expenses.filter(
    (x: FinanceExpense) => x.payment_source === tab,
  );
  return (
    <div className="finance-content">
      <section className="finance-title-row">
        <div>
          <p className="finance-eyebrow">Monthly cost records</p>
          <h2>Expenses</h2>
        </div>
      </section>
      <div className="finance-tabs">
        {groups.map(([id, label]) => (
          <button
            className={tab === id ? "is-active" : ""}
            onClick={() => setTab(id)}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="finance-panel">
        <SectionHeading
          title={groups.find((x) => x[0] === tab)?.[1] ?? "Expenses"}
          detail={groups.find((x) => x[0] === tab)?.[2]}
          action={
            <FileButton
              disabled={disabled}
              label="Upload Excel"
              onFile={(file) =>
                onFile(
                  tab === "Workshop Billing"
                    ? "WORKSHOP"
                    : tab === "Vehicle Direct Cost"
                      ? "vehicle_expense"
                      : "corporate_expense",
                  file,
                )
              }
            />
          }
        />
        <ExpenseForm
          input={input}
          month={month}
          source={tab}
          disabled={disabled}
          onSave={onSave}
        />
        <DataTable
          headers={["Date", "Vehicle", "Category", "Supplier", "Amount"]}
        >
          {visible.length ? (
            visible.map((row: FinanceExpense) => (
              <tr key={row.id ?? `${row.billing_date}${row.category}`}>
                <td>{row.billing_date ?? (row.frequency === "MONTHLY_RECURRING" ? `${row.finance_month.slice(0, 7)} (monthly)` : "—")}</td>
                <td>
                  {row.plate_key
                    ? (input.vehicles.find(
                        (v: FinanceVehicle) => v.plate_key === row.plate_key,
                      )?.display_plate ?? "Unmatched")
                    : "—"}
                </td>
                <td>{row.category}</td>
                <td>{row.supplier ?? "—"}</td>
                <td className="finance-strong">{formatMoney(row.amount)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5}>
                <Empty text="No records in this section for the selected month." />
              </td>
            </tr>
          )}
        </DataTable>
      </section>
    </div>
  );
}

function Settings({ input, month, disabled, onSave, onDelete, onFile }: any) {
  const [tab, setTab] = useState<"vehicles" | "costs" | "insurance">(
    "vehicles",
  );
  return (
    <div className="finance-content">
      <section className="finance-title-row">
        <div>
          <p className="finance-eyebrow">Master data</p>
          <h2>Settings</h2>
          <p>
            Set up the vehicle information and ongoing costs used in monthly
            P&amp;L.
          </p>
        </div>
        {!input.bootstrap_completed && input.vehicles.length === 0 && (
          <FileButton
            disabled={disabled}
            label="Import initial Finance workbook"
            onFile={(file) => onFile("BOOTSTRAP", file)}
          />
        )}
      </section>
      <div className="finance-tabs">
        <button
          className={tab === "vehicles" ? "is-active" : ""}
          onClick={() => setTab("vehicles")}
        >
          Vehicle Master
        </button>
        <button
          className={tab === "costs" ? "is-active" : ""}
          onClick={() => setTab("costs")}
        >
          Monthly Vehicle Costs
        </button>
        <button
          className={tab === "insurance" ? "is-active" : ""}
          onClick={() => setTab("insurance")}
        >
          Insurance
        </button>
      </div>
      {tab === "vehicles" ? (
        <section className="finance-panel">
          <SectionHeading
            title="Vehicle Master"
            detail="Excel columns: Car Plate, Business Unit, Ownership Type, Status."
            action={
              <FileButton
                disabled={disabled}
                label="Import Vehicle Master Excel"
                onFile={(file) => onFile("vehicle", file)}
              />
            }
          />
          <VehicleForm
            input={input}
            month={month}
            disabled={disabled}
            onSave={onSave}
            onDelete={onDelete}
          />
          <DataTable
            headers={["Car plate", "Business unit", "Ownership", "Status"]}
          >
            {input.vehicles.filter((v: FinanceVehicle) => !v.deleted_at).map((v: FinanceVehicle) => (
              <tr key={v.plate_key}>
                <td className="finance-strong">{v.display_plate}</td>
                <td>{v.business_unit}</td>
                <td>{v.ownership_type}</td>
                <td>{v.status}</td>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : tab === "costs" ? (
        <section className="finance-panel">
          <SectionHeading
            title="Monthly Vehicle Costs"
            detail="Excel columns: Car Plate, Start Month, Cost Type, Monthly Amount. Active costs are applied automatically."
            action={
              <FileButton
                disabled={disabled}
                label="Import Excel"
                onFile={(file) => onFile("recurring_cost", file)}
              />
            }
          />
          <RecurringForm
            input={input}
            month={month}
            disabled={disabled}
            onSave={onSave}
          />
          <DataTable
            headers={[
              "Vehicle",
              "Type",
              "Monthly amount",
              "Active from",
              "End month",
            ]}
          >
            {input.recurring_costs.map((x: RecurringCost) => (
              <tr key={x.id ?? `${x.plate_key}${x.cost_type}`}>
                <td>
                  {input.vehicles.find(
                    (v: FinanceVehicle) => v.plate_key === x.plate_key,
                  )?.display_plate ?? "Unmatched"}
                </td>
                <td>{x.cost_type}</td>
                <td>{formatMoney(x.monthly_amount)}</td>
                <td>{x.start_month.slice(0, 7)}</td>
                <td>{x.end_month?.slice(0, 7) ?? "Ongoing"}</td>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : (
        <section className="finance-panel">
          <SectionHeading
            title="Insurance"
            detail="Excel columns: Car Plate, Premium (RM), Coverage Start, Coverage End, RESPONSIBILITY. RM0 records may have blank coverage dates."
            action={
              <FileButton
                disabled={disabled}
                label="Import Excel"
                onFile={(file) => onFile("insurance", file)}
              />
            }
          />
          <InsuranceForm
            input={input}
            month={month}
            disabled={disabled}
            onSave={onSave}
          />
          <DataTable
            headers={["Vehicle", "Responsibility", "Premium (RM)", "Coverage", "Status", "Finance cash outflow"]}
          >
            {input.insurance.map((x: Insurance) => (
              <tr key={x.id ?? `${x.plate_key}${x.coverage_start}`}>
                <td>
                  {input.vehicles.find(
                    (v: FinanceVehicle) => v.plate_key === x.plate_key,
                  )?.display_plate ?? "Unmatched"}
                </td>
                <td>{x.responsibility?.replace("_", " ") ?? "Not specified"}</td>
                <td>{formatMoney(x.premium)}</td>
                <td>
                  {x.coverage_start ?? "—"} – {x.coverage_end ?? "—"}
                </td>
                <td>{insuranceStatus(x)}</td>
                <td>{formatMoney(insuranceCashOutflow(x, input.calculation_version ?? 1).amount)}{insuranceCashOutflow(x, input.calculation_version ?? 1).date ? ` · ${insuranceCashOutflow(x, input.calculation_version ?? 1).date}` : ""}</td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}
    </div>
  );
}

function PreviewDialog(props: any) {
  return (
    <Dialog
      title={`Review ${props.preview.file.name}`}
      onClose={props.onCancel}
    >
      <FinanceImportPreview {...props} />
    </Dialog>
  );
}

function PreviousSharedDialog({
  rows,
  disabled,
  onClose,
  onCopy,
}: {
  rows: FinanceExpense[];
  disabled: boolean;
  onClose: () => void;
  onCopy: (rows: FinanceExpense[]) => Promise<boolean>;
}) {
  const [chosen, setChosen] = useState(
    () =>
      new Set(
        rows.map(
          (row) =>
            row.id ?? `${row.billing_date}:${row.category}:${row.amount}`,
        ),
      ),
  );
  const key = (row: FinanceExpense) =>
    row.id ?? `${row.billing_date}:${row.category}:${row.amount}`;
  const selected = rows.filter((row) => chosen.has(key(row)));
  return (
    <Dialog title="Copy previous shared costs" onClose={onClose}>
      <p className="finance-dialog-copy">
        Choose the recurring shared costs to bring into this month. Source
        records are preserved for review.
      </p>
      {rows.length ? (
        <DataTable headers={["Copy", "Date", "Category", "Supplier", "Amount"]}>
          {rows.map((row) => (
            <tr key={key(row)}>
              <td>
                <input
                  aria-label={`Copy ${row.category}`}
                  type="checkbox"
                  checked={chosen.has(key(row))}
                  onChange={(event) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      event.target.checked
                        ? next.add(key(row))
                        : next.delete(key(row));
                      return next;
                    })
                  }
                />
              </td>
              <td>{row.billing_date ?? (row.frequency === "MONTHLY_RECURRING" ? `${row.finance_month.slice(0, 7)} (monthly)` : "—")}</td>
              <td>{row.category}</td>
              <td>{row.supplier ?? "—"}</td>
              <td>{formatMoney(row.amount)}</td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <Empty text="There are no shared costs available from the previous month." />
      )}
      <div className="finance-dialog-actions">
        <button className="finance-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="finance-primary"
          disabled={disabled || !selected.length}
          onClick={async () => {
            if (await onCopy(selected)) onClose();
          }}
        >
          Copy selected costs
        </button>
      </div>
    </Dialog>
  );
}

function AuditDialog({ onClose, ...props }: any) {
  return (
    <Dialog title="Audit details" onClose={onClose}>
      <FinanceAudit {...props} />
    </Dialog>
  );
}
function VehicleDialog({
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
      title={`${vehicle.display_plate} — ${monthLabel(month)}`}
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
            <td>{formatMoney(vehicle.revenue)}</td>
          </tr>
        </DataTable>
      </section>
      <section className="finance-audit">
        <h3>Direct costs</h3>
        <DataTable headers={["Cost", "Amount"]}>
          <tr>
            <td>Owner payout / loan</td>
            <td>{formatMoney(-vehicle.recurring)}</td>
          </tr>
          {vehicle.commission > 0 && (
            <tr>
              <td>Agent commission</td>
              <td>{formatMoney(-vehicle.commission)}</td>
            </tr>
          )}
          <tr>
            <td>Service claim</td>
            <td>{formatMoney(-vehicle.service_claim)}</td>
          </tr>
          <tr>
            <td>Workshop billing</td>
            <td>{formatMoney(-vehicle.workshop)}</td>
          </tr>
          <tr>
            <td>Insurance</td>
            <td>{formatMoney(-vehicle.insurance)}</td>
          </tr>
          <tr>
            <td>Other vehicle costs</td>
            <td>{formatMoney(-vehicle.direct_costs)}</td>
          </tr>
        </DataTable>
      </section>
      <section className="finance-preview-stats">
        <Total
          label="Vehicle contribution"
          value={formatMoney(vehicle.contribution)}
        />
        <Total
          label="Margin"
          value={
            vehicle.margin === null
              ? "—"
              : `${(vehicle.margin * 100).toFixed(1)}%`
          }
        />
        <Total label="Business" value={vehicle.business_unit} />
      </section>
    </Dialog>
  );
}

function FileButton({
  label,
  disabled,
  onFile,
}: {
  label: string;
  disabled?: boolean;
  onFile: (file?: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
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
        type="button"
        className="finance-secondary"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        <FileTextIcon /> {label}
      </button>
    </>
  );
}
function DataTable({
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
            {headers.map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Total({
  label,
  value,
  negative = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  negative?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={`finance-total ${emphasis ? "is-emphasis" : ""}`}>
      <span>{label}</span>
      <strong className={negative ? "finance-negative" : ""}>{value}</strong>
    </div>
  );
}
function SectionHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="finance-section-heading">
      <div>
        <h3>{title}</h3>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}
function StatusBadge({ status }: { status?: string }) {
  const safe = status ?? "LOADING";
  return (
    <span
      className={`finance-status is-${safe.toLowerCase().replace(/\s/g, "-")}`}
    >
      {safe}
    </span>
  );
}
function Message({
  type,
  children,
}: {
  type: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <p role="alert" className={`finance-message is-${type}`}>
      {children}
    </p>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="finance-empty">{text}</p>;
}
function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="finance-skeleton" aria-label="Loading finance data">
      {Array.from({ length: lines }).map((_, i) => (
        <i key={i} style={{ width: `${92 - (i % 3) * 18}%` }} />
      ))}
    </div>
  );
}
function AccessRequired({
  onReturnToMainLogin,
}: {
  onReturnToMainLogin: () => Promise<void>;
}) {
  return (
    <main className="finance-workspace finance-access">
      <section className="finance-panel">
        <p className="finance-eyebrow">Protected area</p>
        <h1>Admin session required</h1>
        <p>
          Use the main Access ID login to continue. Finance data is unavailable
          until an authorized Admin session is active.
        </p>
        <button
          className="finance-primary"
          onClick={() => void onReturnToMainLogin()}
        >
          Return to main login
        </button>
      </section>
    </main>
  );
}
function AccessDenied({
  onReturnToMainLogin,
}: {
  onReturnToMainLogin: () => Promise<void>;
}) {
  return (
    <main className="finance-workspace finance-access">
      <section className="finance-panel">
        <p className="finance-eyebrow">Access restricted</p>
        <h1>Finance access denied</h1>
        <p>
          This area requires a current authenticated Admin session. Finance data
          has been cleared.
        </p>
        <button
          className="finance-primary"
          onClick={() => void onReturnToMainLogin()}
        >
          Return to main login
        </button>
      </section>
    </main>
  );
}
