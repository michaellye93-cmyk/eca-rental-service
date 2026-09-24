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
  postSmartDrive,
  refreshPayments,
  mutateRecord,
  deleteVehicle,
  transitionMonth,
  saveFixedCost,
  saveWorkshopSummary,
  linkWorkshopAllocation,
  saveOtherIncome,
} from "../../services/finance/api";
import { buildFinanceReport } from "../../services/finance/calculations";
import { insuranceCashOutflow, insuranceProblems } from "../../services/finance/insurance";
import {
  previewBootstrap,
  previewSmartDrive,
  previewWorkshop,
  readFinanceWorkbook,
  type FieldMapping,
  type WorkbookReadResult,
} from "../../services/finance/imports";
import {
  applySafeSectionImport,
  loadWorkspaceMeta,
  previewSafeSectionImport,
  previewSectionWorkbook,
  reviewSection,
  undoSafeSectionImport,
  type SafeImportPreview,
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
import { FixedOperatingCostsPanel, OtherIncomePanel, WorkshopSummaryPanel } from "./FinanceCustomizationForms";
import { exportFinanceEditableWorkbook, type FinanceEditableExportKind } from "../../services/finance/exports";
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
type Page = "overview" | "close" | "vehicles" | "expenses";
type UploadKind = "SMART_DRIVE" | "WORKSHOP" | "BOOTSTRAP" | SectionKind;
type UploadPreview = {
  kind: UploadKind;
  file: File;
  hash: string;
  value: any;
  workbook: WorkbookReadResult;
  mapping: FieldMapping;
  safe?: SafeImportPreview;
  replaceUploadId?: string | null;
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
  const isOpen = Boolean(input && input.month.status !== "CLOSED");
  const invoke = async (
    work: () => Promise<FinanceInput | void>,
    message: string,
  ) => {
    const current = generation.current;
    setBusy(true);
    setError(null);
    setNotice(null);
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
      setError(null);
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
    replaceUploadId: string | null = null,
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
            ? await previewSectionWorkbook(bytes, file.name, "workshop", month, input)
            : kind === "BOOTSTRAP"
              ? await previewBootstrap(bytes, file.name, month)
              : await previewSectionWorkbook(
                  bytes,
                  file.name,
                  kind,
                  month,
                  input,
                );
      const localErrors = value.issues?.some((issue: any) => issue.severity === "error");
      if ((value as any).rows) {
        const aliasTargets = new Map<string, Set<string>>();
        for (const alias of latestInput.vehicle_plate_history ?? []) {
          const currentPlate = latestInput.vehicles.find((vehicle) => vehicle.vehicle_id === alias.vehicle_id && !vehicle.deleted_at)?.plate_key;
          if (currentPlate) aliasTargets.set(alias.plate_key, new Set([...(aliasTargets.get(alias.plate_key) ?? []), currentPlate]));
        }
        (value as any).rows = (value as any).rows.map((row: any) => {
          const targets = aliasTargets.get(row.plate_key);
          return targets?.size === 1 ? { ...row, source_plate_key: row.plate_key, plate_key: [...targets][0] } : row;
        });
      }
      const safeKind = kind === "WORKSHOP" ? "workshop" : kind;
      const safe = !localErrors && kind !== "SMART_DRIVE" && kind !== "BOOTSTRAP"
        ? await previewSafeSectionImport(safeKind as SectionKind, month, file.name, (value as any).rows, latestInput.month.revision, hash, replaceUploadId ? "REPLACE" : "UPDATE", replaceUploadId)
        : undefined;
      if (safe?.counts.needs_review) value.issues = [...(value.issues ?? []), { code: "IMPORT_NEEDS_REVIEW", severity: "error", detail: `${safe.counts.needs_review} row(s) need an explicit duplicate, restore, or target decision before posting.` }];
      if (isCurrent()) {
        setPreview({ kind, file, hash, value, workbook, mapping, safe, replaceUploadId });
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
      !isOpen ||
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
        : preview.safe
          ? await invoke(() => applySafeSectionImport(preview.safe!, revise), "Reviewed workbook changes posted.")
          : false;
    if (ok) {
      setPreview(null);
      setPreviewFresh(false);
      if (preview.kind === "SMART_DRIVE") setSmartFile(null);
    }
  };
  const exportRecords = async (kind: FinanceEditableExportKind, rows: readonly Record<string, unknown>[]) => {
    try {
      const bytes = await exportFinanceEditableWorkbook(kind, rows);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `Finance-${kind}-${month}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export Finance records.");
    }
  };
  const resolvePreviewRow = async (index: number, resolution: "ADD_SEPARATE" | "KEEP_EXISTING" | "RESTORE" | "UPDATE_EXISTING", targetRecordId?: string) => {
    if (!preview?.safe || !input || !(preview.value as any).rows) return;
    setBusy(true);
    setError(null);
    try {
      const rows = (preview.value as any).rows.map((row: any, rowIndex: number) => rowIndex === index ? { ...row, resolution, target_record_id: targetRecordId ?? row.target_record_id } : row);
      const kind = (preview.kind === "WORKSHOP" ? "workshop" : preview.kind) as SectionKind;
      const safe = await previewSafeSectionImport(kind, month, preview.file.name, rows, input.month.revision, preview.hash);
      const issues = (preview.value.issues ?? []).filter((issue: any) => issue.code !== "IMPORT_NEEDS_REVIEW");
      if (safe.counts.needs_review) issues.push({ code: "IMPORT_NEEDS_REVIEW", severity: "error", detail: `${safe.counts.needs_review} row(s) still need an explicit decision before posting.` });
      setPreview({ ...preview, value: { ...preview.value, rows, issues }, safe });
      setPreviewFresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply the import-row decision.");
    } finally { setBusy(false); }
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
      {report && (page === "overview" || page === "vehicles" || page === "close") && (report.totals.workshop_unallocated ?? 0) > 0 && (
        <Message type="warning">{formatMoney(report.totals.workshop_unallocated)} workshop costs are not yet allocated to vehicles. Vehicle margins are incomplete until those costs are assigned.</Message>
      )}
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
            <><OtherIncomePanel
              records={input.other_income ?? []}
              vehicles={input.vehicles}
              month={month}
              disabled={busy || !isOpen}
              onSave={(action, record) => invoke(() => saveOtherIncome(action, record, revise), "Other Income saved.")}
              onExport={() => exportRecords("other_income", (input.other_income ?? []).filter((row) => !row.cancelled_at && row.finance_month.slice(0, 7) === month))}
            /><MonthClose
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
              onClose={(workshopAcknowledged) =>
                invoke(
                  () =>
                    transitionMonth(
                      month,
                      "CLOSE",
                      revise,
                      `Warnings acknowledged in Finance UI${workshopAcknowledged ? "; WORKSHOP_ALLOCATION_ACK" : ""}`,
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
            /></>
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
              disabled={busy || !isOpen}
              onSaveExpense={(record: FinanceExpense) =>
                invoke(() => mutateRecord("expense", record.id ? "UPDATE" : "ADD", record, month, revise, record.id ? "Edited in Finance" : "Added in Finance"), "Expense saved.")
              }
              onDeleteExpense={(record: FinanceExpense, reason: string) => invoke(() => mutateRecord("expense", "CANCEL", record, month, revise, reason), "Expense deleted with audit history retained.")}
              onSaveSummary={(action: "ADD" | "UPDATE" | "CANCEL", record: object) => invoke(() => saveWorkshopSummary(action, record, revise), "Workshop monthly total saved.")}
              onLink={(summaryId: string, expenseId: string) => invoke(() => linkWorkshopAllocation(summaryId, expenseId, revise), "Workshop expense allocated.")}
              onFile={selectFile}
              onExport={(kind: FinanceEditableExportKind, rows: readonly Record<string, unknown>[]) => exportRecords(kind, rows)}
              onSaveSetting={(kind: "vehicle" | "recurring_cost" | "insurance", record: any) => {
                const action = kind === "vehicle" && record.old_plate ? "CORRECT_PLATE" : (record.id || record.vehicle_id) ? "UPDATE" : "ADD";
                let reason = record.correction_reason || (action === "ADD" ? "Added in Finance" : "Edited in Finance");
                if (kind === "recurring_cost" && action === "ADD" && input.recurring_costs.some((row) => !row.cancelled_at && row.plate_key === record.plate_key && row.monthly_amount === record.monthly_amount && (row.payee ?? "") === (record.payee ?? "") && row.start_month === record.start_month && (row.end_month ?? "") === (record.end_month ?? ""))) {
                  if (!window.confirm("A matching monthly obligation exists. Add this as a separate obligation?")) return Promise.resolve(false);
                  reason = "Explicit separate obligation confirmed in Finance";
                }
                return invoke(() => mutateRecord(kind, action, record, month, revise, reason), "Finance record saved.");
              }}
              onDeleteVehicle={(vehicle: FinanceVehicle) =>
                invoke(() => deleteVehicle(month, vehicle.plate_key, revise), "Vehicle deleted from the current master list.")
              }
              onCancel={(kind: "recurring_cost" | "insurance", record: any, reason: string) => invoke(() => mutateRecord(kind, "CANCEL", record, month, revise, reason), "Finance record deleted with audit history retained.")}
              onSaveFixed={(action: any, record: object) => invoke(() => saveFixedCost(action, record, month, revise), "Fixed operating cost saved.")}
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
            selectFile(preview.kind, preview.file, preview.mapping, preview.replaceUploadId ?? null)
          }
          month={month}
          onMapping={(mapping) =>
            selectFile(preview.kind, preview.file, mapping, preview.replaceUploadId ?? null)
          }
          onCancel={() => {
            if (!busy) {
              previewGeneration.current++;
              setPreview(null);
              setPreviewFresh(false);
            }
          }}
          onPost={postPreview}
          onResolve={resolvePreviewRow}
        />
      )}
      {auditOpen && (
        <AuditDialog
          workspaceMeta={workspaceMeta}
          input={input}
          report={report}
          onUndo={(uploadId: string) => invoke(() => undoSafeSectionImport(uploadId, revise), "Import undone; records retained as audited tombstones.")}
          onReplace={(upload: any, file?: File) => { if (!file) return; setAuditOpen(false); void selectFile(upload.kind as SectionKind, file, {}, upload.id); }}
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
          label="Operation Fix Cost"
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

type ExpenseWorkspaceTab = FinanceExpense["payment_source"] | "monthly_vehicle_costs" | "insurance" | "vehicle_master";

function Expenses({
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
}: any) {
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
    ["vehicle_master", "Vehicle Master", "Vehicle identity and Finance classification."],
  ];
  const isExpenseTab = tab === "Workshop Billing" || tab === "Vehicle Direct Cost" || tab === "Corporate Opex";
  const visible = input.expenses.filter(
    (x: FinanceExpense) => isExpenseTab && x.payment_source === tab && !x.cancelled_at && x.finance_month.slice(0, 7) === month.slice(0, 7),
  );
  const activeFixedTemplates = (input.fixed_cost_templates ?? []).filter((row: any) => !row.cancelled_at);
  const representedOccurrences = tab === "Corporate Opex"
    ? activeFixedTemplates
        .map((template: any) => visible.find((row: FinanceExpense) => row.fixed_cost_template_id === template.id))
        .filter((row: FinanceExpense | undefined): row is FinanceExpense => Boolean(row))
    : [];
  const displayedExpenses = tab === "Corporate Opex"
    ? visible.filter((row: FinanceExpense) => !representedOccurrences.includes(row))
    : visible;
  return (
    <div className="finance-content">
      <section className="finance-title-row">
        <div>
          <p className="finance-eyebrow">Monthly cost records</p>
          <h2>Expenses</h2>
          {isExpenseTab && <strong>{formatMoney(visible.reduce((sum: number, row: FinanceExpense) => sum + row.amount, 0))} selected month actual</strong>}
        </div>
      </section>
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
      {!isExpenseTab && <SettingsSection
        key={tab}
        tab={tab}
        input={input}
        month={month}
        disabled={disabled}
        onSave={onSaveSetting}
        onDelete={onDeleteVehicle}
        onCancel={onCancel}
        onFile={onFile}
        onExport={onExport}
      />}
      {tab === "Workshop Billing" && (
        <WorkshopSummaryPanel summaries={input.workshop_summaries ?? []} expenses={input.expenses} vehicles={input.vehicles} allocations={input.workshop_allocations ?? []} month={month} disabled={disabled} onSave={onSaveSummary} onLink={onLink} />
      )}
      {tab === "Corporate Opex" && <FixedOperatingCostsPanel
        templates={input.fixed_cost_templates ?? []}
        occurrences={representedOccurrences}
        month={month}
        disabled={disabled}
        onSave={onSaveFixed}
        onExport={() => onExport("fixed_cost", (input.fixed_cost_templates ?? []).filter((row: any) => !row.cancelled_at))}
        onImport={(file) => onFile("fixed_cost", file)}
      />}
      {isExpenseTab && tab !== "Corporate Opex" && <section className="finance-panel">
        <SectionHeading
          title={tab === "Corporate Opex" ? "Standalone and additional monthly entries" : groups.find((x) => x[0] === tab)?.[1] ?? "Expenses"}
          detail={tab === "Corporate Opex" ? "One-off costs and any selected-month entries not represented by a recurring schedule above." : groups.find((x) => x[0] === tab)?.[2]}
          action={<div className="finance-dialog-actions"><button className="finance-secondary" onClick={() => onExport(tab === "Workshop Billing" ? "workshop" : tab === "Vehicle Direct Cost" ? "vehicle_expenses" : "company_expenses", visible)}>Export Excel</button><button className="finance-primary" disabled={disabled} onClick={() => setEditor(null)}>Add expense</button><FileButton
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
                <td>{row.category}{tab === "Corporate Opex" && (row.description || row.notes) && <><br /><small>{row.description || row.notes}</small></>}</td>
                <td>{row.supplier ?? "—"}</td>
                <td className="finance-strong">{formatMoney(row.amount)}</td>
                <td><div className="finance-dialog-actions"><button className="finance-secondary" disabled={disabled} onClick={() => setEditor(row.id ?? null)}>Edit</button><button className="finance-destructive" disabled={disabled} onClick={() => { if (!window.confirm(`Delete ${row.category} for ${formatMoney(row.amount)} from ${row.finance_month.slice(0, 7)} open calculations? Closed snapshots and audit history remain unchanged.`)) return; const reason = window.prompt(`Reason for deleting ${row.category}`); if (reason?.trim()) void onDeleteExpense(row, reason.trim()); }}>Delete</button></div></td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6}>
                <Empty text={tab === "Corporate Opex" ? "No standalone or additional costs for the selected month." : "No records in this section for the selected month."} />
              </td>
            </tr>
          )}
        </DataTable>
      </section>
      }
      {editor !== undefined && isExpenseTab && <Dialog title={editor ? "Edit expense" : "Add expense"} onClose={() => setEditor(undefined)}><ExpenseForm input={input} month={month} source={tab} disabled={disabled} onSave={async (record) => { const saved = await onSaveExpense(record); if (saved) setEditor(undefined); return saved; }} onCancel={async (record, reason) => { const saved = await onDeleteExpense(record, reason); if (saved) setEditor(undefined); return saved; }} initialId={editor ?? undefined} /></Dialog>}
    </div>
  );
}

function SettingsSection({ tab, input, month, disabled, onSave, onDelete, onCancel, onFile, onExport }: any) {
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
  const monthlyCostTotal = activeCosts.reduce(
    (sum: number, cost: RecurringCost) => sum + cost.monthly_amount,
    0,
  );
  const activeInsurance = input.insurance.filter((policy: Insurance) => !policy.cancelled_at);
  const insuranceCostTotal = activeInsurance.reduce(
    (sum: number, policy: Insurance) => sum + (policy.responsibility === "ECA_PAID" && policy.premium > 0 ? policy.premium : 0),
    0,
  );
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
      ) : tab === "monthly_vehicle_costs" ? (
        <section className="finance-panel">
          <SectionHeading
            title="Monthly Vehicle Costs"
            detail="Excel columns: Car Plate, Start Month, Cost Type, Monthly Amount. Active costs are applied automatically."
            summary={<strong>Total cost: {formatMoney(monthlyCostTotal)}</strong>}
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
                <td>{formatMoney(x.monthly_amount)}</td>
                <td>{x.start_month.slice(0, 7)}</td>
                <td>{x.end_month?.slice(0, 7) ?? "Ongoing"}</td>
                <td><button className="finance-secondary" disabled={disabled} onClick={() => setEditor(x.id ?? null)}>Edit</button></td>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : (
        <section className="finance-panel">
          <SectionHeading
            title="Insurance"
            detail="Excel columns: Car Plate, Premium (RM), Coverage Start, Coverage End, RESPONSIBILITY. RM0 records may have blank coverage dates."
            summary={<strong>Total cost: {formatMoney(insuranceCostTotal)}</strong>}
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
              const problems = insuranceProblems(x);
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
                <td>{formatMoney(x.premium)}</td>
                <td>
                  {x.coverage_start ?? "—"} – {x.coverage_end ?? "—"}
                </td>
                <td>{formatMoney(cashOutflow.amount)}{cashOutflow.date ? ` · ${cashOutflow.date}` : ""}</td>
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
  headers: Array<string | {
    key: string;
    content: React.ReactNode;
    ariaSort?: "ascending" | "descending" | "none";
  }>;
  children: React.ReactNode;
}) {
  return (
    <div className="finance-table-wrap">
      <table className="finance-table">
        <thead>
          <tr>
            {headers.map((header, index) => typeof header === "string" ? (
              <th key={`${header}-${index}`}>{header}</th>
            ) : (
              <th key={header.key} aria-sort={header.ariaSort}>{header.content}</th>
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
  summary,
  action,
}: {
  title: string;
  detail?: string;
  summary?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="finance-section-heading">
      <div>
        <h3>{title}</h3>
        {detail && <p>{detail}</p>}
        {summary}
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
  type: "error" | "success" | "warning";
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
