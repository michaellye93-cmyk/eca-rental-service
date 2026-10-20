import { kualaLumpurToday } from "../../utils";
import { money, previousMonth } from "../../services/fmt";
import { useConfirm } from "../Dialog";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../../supabaseClient";
import type {
  FinanceExpense,
  FinanceInput,
  FinanceVehicle,
  FixedCostTreatment,
  SmartDriveRow,
} from "../../types/finance";
import {
  getFinanceAccess,
  loadMonth,
  loadMonthTotals,
  saveMonthTotals,
  generateFixedCosts,
  postSmartDrive,
  refreshPayments,
  mutateRecord,
  deleteVehicle,
  transitionMonth,
  saveFixedCost,
  setFixedCostTreatment,
  saveWorkshopSummary,
  linkWorkshopAllocation,
  saveOtherIncome,
} from "../../services/finance/api";
import { addDeposit, depositKindFor, depositKindLabel } from "../../services/depositsApi";
import { buildFinanceReport, fixedCostsMissing } from "../../services/finance/calculations";
import {
  previewSmartDrive,
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
import { Skeleton } from "./FinancePrimitives";
import Overview from "./FinanceOverview";
import Vehicles, { VehicleDialog } from "./FinanceVehicles";
import Expenses, { type ExpenseWorkspaceTab, type UploadKind } from "./FinanceRecords";
import FinanceImportPreview from "./FinanceImportPreview";
import Dialog from "./FinanceDialog";
import FinanceAudit from "./FinanceAudit";
import MonthClose, { groupedIssues, readableIssue } from "./FinanceMonthClose";
import { exportFinanceEditableWorkbook, type FinanceEditableExportKind } from "../../services/finance/exports";
import { monthCashFlow, needsStoredTotals, planTrend, storedRevisionMap, storedTotals, trendMonths, trendRow, type StoredMonthTotals, type TrendRow } from "../../services/finance/dashboard";
import CashPage from "../money/CashPage";
import type { CashBalanceEntry, CashLineSummary, CashOutlookData } from "../../services/cashOutlook";
import type { DriverWithMetrics } from "../../types";
import "./finance.css";
import "./finance-mobile.css";

const CollectionsPage = React.lazy(() => import("../money/CollectionsPage"));
import { MONEY_PAGE_GROUPS, monthLoadNeeded, type Page } from "../../services/finance/pages";
export type { Page } from "../../services/finance/pages";
// The tabs come in two labelled groups (services/finance/pages.ts): Reports (Overview, Cash, Collections, Vehicles)
// for reading the month, and Work (Records, Reconcile, Month close) for entering and closing it.
const monthBased = (page: Page) => page !== "cash" && page !== "collections";
const PAGE_HEADINGS: Record<Page, [string, string]> = {
  overview: ["Overview", "How the month did, and how far it is from a 20% operating margin."],
  cash: ["Cash", "Cash in bank, the next three months, and bills coming up."],
  collections: ["Collections", "Who owes rent, and whether it is getting better."],
  vehicles: ["Vehicles", "Which businesses and cars make or lose money this month."],
  expenses: ["Records", "Every cost and income entry for the month, in one place."],
  close: ["Month close", "Check each source, then mark the month ready and close it."],
  reconcile: ["Reconcile", "Match the bank statement to the payments recorded in the system."],
};
interface MoneyProps {
  /** The page to show; with onPageChange the parent controls it (the cash line opens Cash). */
  page?: Page;
  onPageChange?: (page: Page) => void;
  drivers?: DriverWithMetrics[];
  today?: string;
  outlook?: CashOutlookData | null;
  outlookState?: "loading" | "ready" | "unavailable";
  cashSummary?: CashLineSummary | null;
  onBalancesChange?: (rows: CashBalanceEntry[]) => void;
  onReloadOutlook?: () => void;
  /** Changes a payment's method to Cash (in hand) on the Drivers page (Reconcile's "Paid in cash"). */
  onMarkPaymentCash?: (paymentId: string) => Promise<void>;
}
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

export default function FinanceView(props: MoneyProps = {}) {
  const [sessionState, setSessionState] = useState<
    "checking" | "login" | "denied" | "ready"
  >("checking");
  // Opens on the last completed month (Kuala Lumpur calendar).
  const [month, setMonth] = useState(() => previousMonth(kualaLumpurToday()));
  const { ask, dialog } = useConfirm();
  const [input, setInput] = useState<FinanceInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [pageState, setPageState] = useState<Page>(props.page ?? "overview");
  const page = props.page ?? pageState;
  const setPage = (next: Page) => (props.onPageChange ? props.onPageChange(next) : setPageState(next));
  const [auditOpen, setAuditOpen] = useState(false);
  // Payment references recorded in the driver ledger, for Reconcile's match suggestions
  const paymentReferences = useMemo(
    () => new Map((props.drivers ?? []).flatMap((driver) => driver.paymentHistory.flatMap((payment) => (payment.reference ? [[payment.id, payment.reference] as [string, string]] : [])))),
    [props.drivers],
  );
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
  const [expenseSource, setExpenseSource] =
    useState<ExpenseWorkspaceTab>("Workshop Billing");
  const previewGeneration = useRef(0);
  const generation = useRef(0);
  const authorizationGeneration = useRef(0);
  const mounted = useRef(false);
  const authenticatedUserId = useRef<string | null>(null);
  // The month already read (or being read) for the pages that use it; cleared with the private data.
  const requestedMonth = useRef<string | null>(null);
  // Stored trend figures of closed months: undefined until read, null when unavailable (database update not run).
  const [stored, setStored] = useState<StoredMonthTotals[] | null | undefined>(undefined);
  // Month (YYYY-MM) to the revision stored for it, kept current as figures are saved; null while unavailable.
  const storedRevisions = useRef<Map<string, number> | null>(null);
  const clearPrivate = useCallback(() => {
    previewGeneration.current++;
    requestedMonth.current = null;
    storedRevisions.current = null;
    setStored(undefined);
    setInput(null);
    setPreview(null);
    setSmartFile(null);
    setPreviewFresh(false);
    setPreviewError(null);
    setWorkspaceMeta(null);
    setSelectedVehicle(null);
    setIssuesOpen(false);
    setAuditOpen(false);
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
        let [loaded, meta] = await Promise.all([
          loadMonth(selectedMonth),
          loadWorkspaceMeta(selectedMonth),
        ]);
        // A Draft month opened for the first time gets its Operation Fix Cost lines from Records.
        if (fixedCostsMissing(loaded)) {
          try {
            loaded = await generateFixedCosts(selectedMonth, loaded.month.revision);
            meta = await loadWorkspaceMeta(selectedMonth);
          } catch {
            // Another tab changed the month first: show what was read; the next reload creates the lines.
          }
        }
        if (current === generation.current && selectedMonth === month) {
          setInput(loaded);
          setWorkspaceMeta(meta);
          setAcknowledged(false);
        }
      } catch (cause) {
        if (current === generation.current) {
          // Opening another page that uses the month tries again (as does the Retry button).
          if (requestedMonth.current === selectedMonth) requestedMonth.current = null;
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load Finance data.",
          );
        }
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [month, sessionState],
  );
  // The month is read only by the pages that use it (not Collections), once per chosen month.
  useEffect(() => {
    if (sessionState !== "ready" || !monthLoadNeeded(page, month, requestedMonth.current)) return;
    requestedMonth.current = month;
    void reload(month);
  }, [month, reload, page, sessionState]);
  const report = useMemo(
    () => (input ? buildFinanceReport(input) : null),
    [input],
  );
  // Each time the Overview is opened its stored figures are read again (a month may have been closed, reopened or
  // stored since, here or on another device), and the trend is worked out again from them.
  const [overviewVisit, setOverviewVisit] = useState(0);
  const previousPage = useRef<Page | null>(null);
  useEffect(() => {
    if (sessionState !== "ready") return;
    if (page === "overview" && previousPage.current !== "overview") {
      storedRevisions.current = null;
      setStored(undefined);
      setOverviewVisit((visit) => visit + 1);
    }
    previousPage.current = page;
  }, [page, sessionState]);
  // Stored trend figures are read when the Overview opens or a closed month is shown (one light read, no Finance lock).
  useEffect(() => {
    if (sessionState !== "ready" || stored !== undefined) return;
    if (page !== "overview" && input?.month.status !== "CLOSED") return;
    const current = generation.current;
    loadMonthTotals()
      .then((rows) => {
        if (current !== generation.current) return;
        storedRevisions.current = storedRevisionMap(rows);
        setStored(rows);
      })
      .catch(() => { if (current === generation.current) setStored(null); });
  }, [sessionState, stored, page, input?.month.status]);
  // Saves a closed month's trend figures when nothing is stored for it at this revision (after closing, or on reading it).
  const keepTotals = useCallback((monthKey: string, revision: number, row: TrendRow) => {
    const revisions = storedRevisions.current;
    if (!needsStoredTotals({ finance_month: monthKey, status: "CLOSED", revision }, revisions)) return;
    revisions!.set(monthKey, revision);
    saveMonthTotals(monthKey, revision, storedTotals(row)).catch(() => {
      if (revisions!.get(monthKey) === revision) revisions!.delete(monthKey);
    });
  }, []);
  useEffect(() => {
    if (!input || !report || stored === undefined || input.month.status !== "CLOSED") return;
    keepTotals(month, input.month.revision, trendRow(month, input.month.status, report));
  }, [input, report, stored, month, keepTotals]);
  // Month-by-month trend for the Overview: closed months come from their stored figures; the others are read once per
  // chosen month and Overview visit (all of them before the database update is run); the chosen one is live. The last
  // trend stays on screen while a newer one is worked out.
  const [earlierTrend, setEarlierTrend] = useState<{ month: string; visit: number; rows: TrendRow[] } | null>(null);
  useEffect(() => {
    if (sessionState !== "ready" || page !== "overview" || stored === undefined) return;
    if (earlierTrend?.month === month && earlierTrend.visit === overviewVisit) return;
    let cancelled = false;
    (async () => {
      const earlierMonths = trendMonths(month).slice(0, -1);
      const plan = planTrend(earlierMonths, stored);
      for (const earlier of plan.live) {
        try {
          const data = await loadMonth(earlier);
          const row = trendRow(earlier, data.month.status, buildFinanceReport(data));
          plan.rows.set(earlier, row);
          if (data.month.status === "CLOSED") keepTotals(earlier, data.month.revision, row);
        } catch {
          // A month that cannot be read is left out of the trend.
        }
      }
      if (!cancelled) setEarlierTrend({ month, visit: overviewVisit, rows: earlierMonths.flatMap((m) => plan.rows.get(m) ?? []) });
    })();
    return () => { cancelled = true; };
  }, [sessionState, page, month, earlierTrend?.month, earlierTrend?.visit, overviewVisit, stored, keepTotals]);
  const trend = useMemo(
    () => (report && input && earlierTrend?.month === month ? [...earlierTrend.rows, trendRow(month, input.month.status, report)] : null),
    [report, input, earlierTrend, month],
  );
  const revise = input?.month.revision ?? 0;
  const isDraft = input?.month.status === "DRAFT";
  const isOpen = Boolean(input && input.month.status !== "CLOSED");
  const invoke = async (
    work: () => Promise<FinanceInput | void>,
    message: string,
    // A form inside a dialog covers the page error line, so it asks for the failure back to show it in place.
    rethrow = false,
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
      if (rethrow) throw cause;
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
            : await previewSectionWorkbook(bytes, file.name, kind === "WORKSHOP" ? "workshop" : kind, month, input);
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
      const safe = !localErrors && kind !== "SMART_DRIVE"
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
          <p className="finance-eyebrow">Finance</p>
          <h1>{PAGE_HEADINGS[page][0]}</h1>
          <p className="finance-subtitle">{PAGE_HEADINGS[page][1]}</p>
        </div>
        {/* Cash shows the month too: its bank check is for the chosen month. */}
        {(monthBased(page) || page === "cash") && <div className="finance-top-actions">
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
        </div>}
      </header>
      <nav aria-label="Finance sections" className="finance-nav">
        {MONEY_PAGE_GROUPS.map((group) => (
          <React.Fragment key={group.label}>
            <span className="finance-nav-group">{group.label}</span>
            {group.pages.map(([id, label]) => (
              <button
                key={id}
                className={page === id ? "is-active" : ""}
                aria-current={page === id ? "page" : undefined}
                onClick={() => setPage(id)}
              >
                {label}
              </button>
            ))}
          </React.Fragment>
        ))}
        {monthBased(page) && (
          <div className="finance-more">
            <button onClick={() => setAuditOpen(true)}>Audit details</button>
          </div>
        )}
      </nav>
      {page === "cash" && (
        <CashPage
          today={props.today ?? kualaLumpurToday()}
          drivers={props.drivers ?? []}
          outlook={props.outlook ?? null}
          outlookState={props.outlookState ?? "unavailable"}
          summary={props.cashSummary ?? null}
          onBalancesChange={(rows) => props.onBalancesChange?.(rows)}
          onReload={() => props.onReloadOutlook?.()}
          bank={input && report ? { month: month.slice(0, 7), netCashFlow: monthCashFlow(input, report).net } : null}
        />
      )}
      {page === "collections" && (
        <React.Suspense fallback={<Skeleton lines={8} />}>
          <CollectionsPage drivers={props.drivers ?? []} />
        </React.Suspense>
      )}
      {monthBased(page) && error && <Message type="error">{error}</Message>}
      {monthBased(page) && notice && <Message type="success">{notice}</Message>}
      {report && (page === "overview" || page === "vehicles" || page === "close") && (report.totals.workshop_unallocated ?? 0) > 0 && (
        <Message type="warning">{money(report.totals.workshop_unallocated)} workshop costs are not yet allocated to vehicles. Vehicle margins are incomplete until those costs are assigned.</Message>
      )}
      {!monthBased(page) ? null : !input ? (
        <section className="finance-panel">
          {error ? (
            <button
              className="finance-secondary"
              disabled={busy}
              onClick={() => { requestedMonth.current = month; void reload(); }}
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
              input={input}
              drivers={props.drivers ?? []}
              month={month}
              trend={trend}
              onGo={setPage}
            />
          )}
          {page === "close" && (
            <><MonthClose
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
              onReview={(section, decision) =>
                invoke(async () => {
                  await reviewSection(month, section, decision, revise);
                }, "Section review saved.")
              }
              onShowAudit={() => setAuditOpen(true)}
              onShowIssues={() => setIssuesOpen(true)}
              onOverview={() => setPage("overview")}
              onReconcile={() => setPage("reconcile")}
              onExpenses={(source) => {
                setExpenseSource(source);
                setPage("expenses");
              }}
            /></>
          )}
          {page === "vehicles" && (
            <Vehicles report={report} onVehicle={setSelectedVehicle} />
          )}
          {page === "reconcile" && (
            <BankStatementPanel
              month={month}
              input={input}
              paymentReferences={paymentReferences}
              disabled={busy || !isDraft}
              onPosted={(next, message) => {
                void invoke(async () => next, message);
              }}
              onError={setError}
              onMarkCash={props.onMarkPaymentCash ? (paymentId) => invoke(async () => { await props.onMarkPaymentCash!(paymentId); return refreshPayments(month); }, "Payment marked as paid in cash.") : undefined}
              depositKindOf={(driverId) => depositKindFor(props.drivers?.find((d) => d.id === driverId)?.category)}
              onRecordDeposit={async (driverId, amount, date, chosen) => {
                let id: string | undefined;
                const kind = chosen ?? depositKindFor(props.drivers?.find((d) => d.id === driverId)?.category);
                await invoke(async () => {
                  const saved = await addDeposit({ driver_id: driverId, kind, entry: "RECEIVED", entry_date: date, amount, note: "Recorded from Reconcile" });
                  id = saved.id;
                  return loadMonth(month);
                }, `${depositKindLabel(kind)} recorded.`);
                return id;
              }}
            />
          )}
          {page === "expenses" && (
            <Expenses
              key={`${month}:${expenseSource}`}
              initialSource={expenseSource}
              drivers={props.drivers ?? []}
              onSaveOtherIncome={(action: "ADD" | "UPDATE" | "CANCEL", record: object) => invoke(() => saveOtherIncome(action, record, revise), "Other Income saved.")}
              onExportOtherIncome={() => exportRecords("other_income", (input.other_income ?? []).filter((row) => !row.cancelled_at && row.finance_month.slice(0, 7) === month) as unknown as Record<string, unknown>[])}
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
              onReviewSelected={smartFile ? () => selectFile("SMART_DRIVE", smartFile.file, smartFile.mapping) : undefined}
              onExport={(kind: FinanceEditableExportKind, rows: readonly object[]) => exportRecords(kind, rows as readonly Record<string, unknown>[])}
              onSaveSetting={async (kind: "vehicle" | "recurring_cost" | "insurance", record: any) => {
                const action = kind === "vehicle" && record.old_plate ? "CORRECT_PLATE" : (record.id || record.vehicle_id) ? "UPDATE" : "ADD";
                let reason = record.correction_reason || (action === "ADD" ? "Added in Finance" : "Edited in Finance");
                if (kind === "recurring_cost" && action === "ADD" && input.recurring_costs.some((row) => !row.cancelled_at && row.plate_key === record.plate_key && row.monthly_amount === record.monthly_amount && (row.payee ?? "") === (record.payee ?? "") && row.start_month === record.start_month && (row.end_month ?? "") === (record.end_month ?? ""))) {
                  if (!(await ask("A matching monthly obligation exists. Add this as a separate obligation?", { destructive: false }))) return false;
                  reason = "Explicit separate obligation confirmed in Finance";
                }
                return invoke(() => mutateRecord(kind, action, record, month, revise, reason), "Finance record saved.", true);
              }}
              onDeleteVehicle={(vehicle: FinanceVehicle) =>
                invoke(() => deleteVehicle(month, vehicle.plate_key, revise), "Vehicle deleted from the current master list.")
              }
              onCancel={(kind: "recurring_cost" | "insurance", record: any, reason: string) => invoke(() => mutateRecord(kind, "CANCEL", record, month, revise, reason), "Finance record deleted with audit history retained.")}
              onSaveFixed={(action: any, record: object) => invoke(() => saveFixedCost(action, record, month, revise), "Fixed operating cost saved.")}
              treatments={input.fixed_cost_treatments ?? []}
              onTreatment={(seriesId: string, treatment: FixedCostTreatment["treatment"]) =>
                invoke(async () => { await setFixedCostTreatment(seriesId, treatment); }, treatment === "CASH_FLOW_ONLY" ? "This cost now counts only in cash flow." : "This cost now counts in the P&L.")}
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
      {selectedVehicle && report && (
        <VehicleDialog
          vehicle={report.vehicles.find(
            (vehicle) => vehicle.plate_key === selectedVehicle,
          )}
          month={month}
          onClose={() => setSelectedVehicle(null)}
        />
      )}
      {dialog}
    </main>
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

function AuditDialog({ onClose, ...props }: any) {
  return (
    <Dialog title="Audit details" onClose={onClose}>
      <FinanceAudit {...props} />
    </Dialog>
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
