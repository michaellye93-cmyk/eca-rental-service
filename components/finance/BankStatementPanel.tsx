import { formatCurrency } from "../../utils";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { EhailingPayment, FinanceInput } from "../../types/finance";
import type {
  BankMatchKind,
  BankReviewRow,
  BankStatementPreview,
} from "../../types/finance-bank";
import {
  extractBankStatement,
  previewBankStatement,
  readBankStatement,
  validateBankReview,
} from "../../services/finance/bankStatements";
import { postBankStatement, reviewBankMatch } from "../../services/finance/api";
import { senderLooksLike, senderName, unsolvedPayments, type PaymentSuggestion } from "../../services/finance/bankMatchSuggestions";
import { clearReconcileDraft, loadReconcileDraft, saveReconcileDraft } from "../../services/finance/reconcileDraft";
import { applySureMatches, isCashInHand, matchItems, matchRow, moneyInOnly, reconcilePairs, rowDepositIds, rowPaymentIds, suggestAcrossStatements, summarizeProblems, withinMonth } from "../../services/finance/reconcileQueue";

const vehicleCategories = [
  "Road Tax",
  "APAD / Permit",
  "Puspakom",
  "Tyres",
  "Battery",
  "Repair",
  "Accident",
  "Towing",
  "Restoration",
  "Other Vehicle Cost",
];
const corporateCategories = [
  "Office Rental",
  "Accounting Fee",
  "Salary",
  "KWSP",
  "PERKESO",
  "PCB",
  "Utilities",
  "Internet",
  "Professional Fees",
  "General Software",
  "Other Corporate Cost",
];
const money = (n: number) => formatCurrency(n || 0);

/** One bank statement loaded for review: ECA has two bank accounts, so several can be open at once. */
type LoadedStatement = BankStatementPreview & {
  source_hash: string;
  /** The original file; absent when the statement was restored from the saved draft. */
  file?: File;
  headers: string[];
  mapping: Record<string, string | undefined>;
  /** Money-out lines left out of the review (money in only). */
  skipped?: { count: number; amount: number };
  /** Lines dated in another month, left out. */
  outside?: number;
};
// The browser's storage, when it allows it (private windows and blocked site data do not).
const browserStore = () => { try { return window.localStorage; } catch { return null; } };
const shortDate = (date: string) => { const d = new Date(`${date}T00:00:00`); return Number.isNaN(d.getTime()) ? date || "No date" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); };
const matchedPaymentIds = (rows: BankReviewRow[]) => rows.flatMap(rowPaymentIds);

export default function BankStatementPanel({
  month,
  input,
  disabled,
  onPosted,
  onError,
  paymentReferences,
  onMarkCash,
  depositKindOf,
  onRecordDeposit,
}: {
  month: string;
  input: FinanceInput | null;
  disabled: boolean;
  onPosted: (next: FinanceInput, message: string) => void;
  onError: (message: string) => void;
  /** The receipt or DuitNow reference recorded with each payment, by payment id. */
  paymentReferences?: Map<string, string>;
  /** Marks a payment as paid in cash in hand (changes its method and refreshes Finance's copy). */
  onMarkCash?: (paymentId: string) => unknown;
  /** Deposit (Sewa Biasa) or downpayment (Sewa Beli) for a driver. */
  depositKindOf?: (driverId: string) => "DEPOSIT" | "DOWNPAYMENT";
  /** Records a deposit or downpayment received and reloads the month; resolves with its id. */
  onRecordDeposit?: (driverId: string, amount: number, date: string) => Promise<string | undefined>;
}) {
  const [statements, setStatements] = useState<LoadedStatement[]>([]);
  const [active, setActive] = useState(0);
  // The rent check needs money in only, so money-out lines are skipped when a file is read (on by default).
  const [moneyIn, setMoneyIn] = useState(true);
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const preview = statements[active] ?? null;
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<
    (BankReviewRow & { import_id: string; match_valid?: boolean }) | null
  >(null);
  const generation = useRef(0);
  // Payments already matched to a posted bank credit this month, and in the statements being reviewed
  const postedPaymentIds = useMemo(() => new Set((input?.bank_rows ?? []).filter((row) => row.match_valid !== false).flatMap(rowPaymentIds)), [input]);
  const draftPaymentIds = useMemo(() => new Set(statements.flatMap((statement) => matchedPaymentIds(statement.rows))), [statements]);
  // Deposit and downpayment receipts already matched to a posted or loaded bank credit
  const usedDepositIds = useMemo(() => new Set([...(input?.bank_rows ?? []).filter((row) => row.match_valid !== false).flatMap(rowDepositIds), ...statements.flatMap((statement) => statement.rows.flatMap(rowDepositIds))]), [input, statements]);
  const depositLabel = (id: string) => {
    const d = input?.deposits?.find((x) => x.id === id);
    return d ? `${d.kind === "DOWNPAYMENT" ? "Downpayment" : "Deposit"} · ${d.driver_name ?? "Driver"} · ${money(Number(d.amount))}` : "Deposit";
  };
  const matchLabel = (row: BankReviewRow) => [...rowPaymentIds(row).map(paymentLabel), ...rowDepositIds(row).map(depositLabel)].join(" + ");
  // Suggested matches for pending credits, across every loaded statement so one payment is suggested only once
  const allSuggestions = useMemo(() => (input ? suggestAcrossStatements(statements.map((statement) => statement.rows), input.ehailing, new Set([...postedPaymentIds, ...draftPaymentIds]), paymentReferences) : []), [statements, input, postedPaymentIds, draftPaymentIds, paymentReferences]);
  const suggestions = allSuggestions[active] ?? new Map<number, PaymentSuggestion>();
  const paymentLabel = (id: string) => {
    const payment = input?.ehailing.find((p) => p.source_payment_id === id);
    return payment ? `${payment.driver_name_snapshot ?? "Driver"} · ${payment.car_plate_snapshot ?? payment.plate_key ?? ""} · ${payment.payment_date} · ${money(payment.cash_amount)}` : id;
  };
  const setRows = (index: number, change: (rows: BankReviewRow[]) => BankReviewRow[]) =>
    setStatements((list) => list.map((statement, i) => (i === index ? { ...statement, rows: change(statement.rows) } : statement)));
  const applySuggestion = (suggestion: PaymentSuggestion) =>
    setRows(active, (rows) => rows.map((row) => (row.source_row === suggestion.sourceRow ? matchRow(row, suggestion.paymentId, `Suggested match: ${suggestion.reason}`) : row)));
  // Certain and strong matches are applied when a statement is loaded; what is left here are weak ones waiting for a look.
  const sureSuggestions = [...suggestions.values()].filter((suggestion) => suggestion.confidence !== "WEAK");
  const weakSuggestions = suggestions.size - sureSuggestions.length;
  const applyAllSuggestions = () => sureSuggestions.forEach((suggestion) => applySuggestion(suggestion));
  const autoMatched = (preview?.rows ?? []).filter((row) => row.decision === "MATCHED" && row.review_note.startsWith("Auto-matched")).length;
  // After matching, the lines still waiting are usually money out (loans, payouts, bills already in Records) and money in
  // that is not a recorded driver payment (daily rental, transfers between own accounts). Exclude them in one step,
  // with a reason, so the statement can be posted; nothing becomes revenue or a new expense.
  const pendingRows = (side: "debit" | "credit", rows = preview?.rows ?? []) => rows.filter((row) => row.decision === "PENDING" && (side === "debit" ? row.debit > 0 : row.credit > 0));
  const excludePending = (side: "debit" | "credit", note: string) =>
    setRows(active, (rows) => rows.map((row) => row.decision === "PENDING" && (side === "debit" ? row.debit > 0 : row.credit > 0) ? { ...row, decision: "EXCLUDED", payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, matched_ids: null, matched_deposit_ids: null, review_note: note } : row));
  // Prints only the reconciliation report (same approach as the termination report)
  const printReport = () => {
    document.body.classList.add("printing-reconcile-report");
    const cleanup = () => document.body.classList.remove("printing-reconcile-report");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    cleanup();
  };
  // Unposted work is kept in this browser per month: leaving the page, switching tab or reloading brings it back.
  const [draftMonth, setDraftMonth] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const inputReady = !!input;
  useEffect(() => {
    generation.current++;
    setActive(0);
    setReviewing(null);
    const store = browserStore();
    const draft = store && input ? loadReconcileDraft(store, month, new Set((input.bank_imports ?? []).map((item) => item.source_hash))) : null;
    setStatements(draft ? draft.statements.map((statement) => ({ ...statement, rows: withinMonth(statement.rows, month).rows, headers: [], mapping: {} })).filter((statement) => statement.rows.length) : []);
    setRestoredAt(draft ? draft.saved_at : null);
    setDraftMonth(input ? month : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, inputReady]);
  useEffect(() => {
    const store = browserStore();
    if (store && draftMonth === month) saveReconcileDraft(store, month, statements);
  }, [statements, draftMonth, month]);
  const discardDraft = () => {
    if (!window.confirm("Discard the unposted statements and every match made on them?")) return;
    const store = browserStore();
    if (store) clearReconcileDraft(store, month);
    setStatements([]);
    setRestoredAt(null);
    setActive(0);
  };
  const readStatement = async (file: File, mapping: Record<string, string | undefined> = {}): Promise<LoadedStatement> => {
    const statement = await readWholeStatement(file, mapping);
    // Only lines dated in the reporting month can be reconciled for it.
    const inMonth = withinMonth(statement.rows, month);
    if (!inMonth.rows.length && inMonth.outside) throw new Error(`${file.name} has no lines dated in ${monthLabel}. Check the Reporting month at the top of the page (or the date column).`);
    const kept = { ...statement, rows: inMonth.rows, outside: inMonth.outside };
    return moneyIn ? { ...kept, ...moneyInOnly(kept.rows) } : kept;
  };
  const readWholeStatement = async (file: File, mapping: Record<string, string | undefined> = {}): Promise<LoadedStatement> => {
    if (!input) throw new Error("Finance data is not loaded yet.");
    const original = await file.arrayBuffer();
    const source_hash = await sha256Buffer(original);
    const fallbackLabel = file.name.replace(/\.[^.]+$/, "");
    if (file.type.includes("pdf") || file.type.startsWith("image/")) {
      const extracted = await extractBankStatement(file);
      return {
        rows: extracted.rows.map((row) => ({ ...row, decision: "PENDING", payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, matched_ids: null, matched_deposit_ids: null, review_note: "" })),
        issues: [],
        total_debits: extracted.total_debits,
        total_credits: extracted.total_credits,
        filename: file.name,
        account_label: fallbackLabel,
        finance_month: month,
        source_hash, file, headers: [], mapping,
      };
    }
    const read = await readBankStatement(original, file.name);
    const next = await previewBankStatement(original, file.name, month, input, mapping);
    return { ...next, account_label: next.account_label || fallbackLabel, source_hash, file, headers: read.headers, mapping };
  };
  // Sure matches are applied across every loaded statement at once; weak ones stay as suggestions.
  // Only the statements just loaded are auto-matched, so a line set back to PENDING by hand stays that way.
  const withSureMatches = (list: LoadedStatement[], only: Set<string>) => {
    if (!input) return list;
    const taken = new Set([...postedPaymentIds, ...list.flatMap((statement) => matchedPaymentIds(statement.rows))]);
    const found = suggestAcrossStatements(list.map((statement) => statement.rows), input.ehailing, taken, paymentReferences);
    return list.map((statement, i) => (only.has(statement.source_hash) ? { ...statement, rows: applySureMatches(statement.rows, found[i]) } : statement));
  };
  const upload = async (files: File[]) => {
    if (!files.length || !input) return;
    const current = generation.current;
    setBusy(true);
    try {
      const loaded: LoadedStatement[] = [];
      for (const file of files) loaded.push(await readStatement(file));
      if (current !== generation.current) return;
      const known = new Set([...statements.map((s) => s.source_hash), ...(input.bank_imports ?? []).map((item) => item.source_hash)]);
      const fresh = loaded.filter((statement, i) => !known.has(statement.source_hash) && loaded.findIndex((other) => other.source_hash === statement.source_hash) === i);
      if (fresh.length < loaded.length) onError(`${loaded.length - fresh.length} file(s) skipped: already loaded or already posted.`);
      if (!fresh.length) return;
      const freshHashes = new Set(fresh.map((statement) => statement.source_hash));
      setStatements((list) => {
        const next = [...list, ...fresh.filter((statement) => !list.some((other) => other.source_hash === statement.source_hash))];
        setActive(list.length);
        return withSureMatches(next, freshHashes);
      });
    } catch (e) {
      if (current === generation.current)
        onError(e instanceof Error ? e.message : "Could not extract bank statement.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const remap = async () => {
    if (!preview) return;
    if (!preview.file) { onError("Choose the file again to change its column mapping."); return; }
    const current = generation.current;
    setBusy(true);
    try {
      const next = await readStatement(preview.file, preview.mapping);
      if (current !== generation.current) return;
      setStatements((list) => withSureMatches(list.map((statement) => (statement.source_hash === next.source_hash ? { ...next, account_label: statement.account_label } : statement)), new Set([next.source_hash])));
    } catch (e) {
      if (current === generation.current) onError(e instanceof Error ? e.message : "Could not read the bank statement.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const update = (index: number, values: Partial<BankReviewRow>) =>
    setRows(active, (rows) => rows.map((row, i) => (i === index ? { ...row, ...values } : row)));
  const problemsOf = (statement: LoadedStatement) => {
    if (!input) return ["Finance data is not loaded yet."];
    const issues = summarizeProblems(validateBankReview(statement.rows, month, input), monthLabel);
    if (!statement.account_label.trim()) issues.unshift("Account label is required.");
    // A payment may be matched to one bank credit only, across posted and loaded statements.
    const elsewhere = new Set([...postedPaymentIds, ...statements.filter((other) => other !== statement).flatMap((other) => matchedPaymentIds(other.rows))]);
    const seen = new Set<string>();
    const depositsElsewhere = new Set([...(input.bank_rows ?? []).filter((row) => row.match_valid !== false).flatMap(rowDepositIds), ...statements.filter((other) => other !== statement).flatMap((other) => other.rows.flatMap(rowDepositIds))]);
    const seenDeposits = new Set<string>();
    for (const id of statement.rows.flatMap(rowDepositIds)) {
      if (depositsElsewhere.has(id) || seenDeposits.has(id)) issues.push(`${depositLabel(id)} is matched to more than one bank line`);
      seenDeposits.add(id);
    }
    for (const id of matchedPaymentIds(statement.rows)) {
      if (elsewhere.has(id) || seen.has(id)) issues.push(`${paymentLabel(id)} is matched to more than one bank line`);
      seen.add(id);
    }
    return issues;
  };
  // Posts the chosen statements one after another; each post moves the month to a new revision.
  const post = async (indexes: number[]) => {
    if (!input || input.month.status !== "DRAFT" || !indexes.length) return;
    const current = generation.current;
    setBusy(true);
    const posted: number[] = [];
    let latest: FinanceInput | null = null;
    let failure = "";
    try {
      for (const index of indexes) {
        const problems = problemsOf(statements[index]);
        if (problems.length) throw new Error(`${statements[index].account_label || statements[index].filename}: ${problems.join("; ")}`);
      }
      let revision = input.month.revision;
      for (const index of indexes) {
        const statement = statements[index];
        latest = await postBankStatement(month, statement.filename, statement.account_label.trim(), statement.rows, revision, statement.source_hash);
        revision = latest.month.revision;
        posted.push(index);
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : "Bank statement could not be posted.";
      if (current === generation.current && !latest) onError(failure);
    } finally {
      if (current === generation.current) {
        if (latest) {
          const done = posted.length === 1 ? "1 bank statement posted." : `${posted.length} bank statements posted.`;
          // After a partial "Post all", the failure goes in the same notice so it is not hidden by the success message.
          onPosted(latest, failure ? `${done} Not posted (still loaded below): ${failure}` : done);
          setStatements((list) => list.filter((_, i) => !posted.includes(i)));
          setActive(0);
        }
        setBusy(false);
      }
    }
  };
  const removeStatement = (index: number) => {
    setStatements((list) => list.filter((_, i) => i !== index));
    setActive(0);
  };
  const saveReview = async () => {
    if (disabled || !reviewing || !input || input.month.status !== "DRAFT" || !reviewing.review_note.trim()) return;
    const current = generation.current;
    setBusy(true);
    try {
      const result = await reviewBankMatch(
        month,
        reviewing.import_id,
        reviewing,
        input.month.revision,
      );
      if (current !== generation.current) return;
      onPosted(result, "Bank match review saved.");
      setReviewing(null);
    } catch (e) {
      if (current === generation.current)
        onError(
          e instanceof Error ? e.message : "Could not save the bank review.",
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const readyIndexes = statements.map((statement, i) => (problemsOf(statement).length ? -1 : i)).filter((i) => i >= 0);
  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold">Bank statement review</h2>
        <button type="button" onClick={printReport} disabled={!input} className="rounded border px-3 py-1.5 text-sm">Print reconciliation report</button>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Statements support reconciliation only. Credits never create Finance
        revenue. Choose every bank account's statement for the month together: certain and strong matches are used
        straight away, weak ones wait for you.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium">
          Bank statements
          <input
            disabled={disabled || busy}
            type="file"
            multiple
            accept=".csv,.xlsx,.xls,.json,.pdf,image/*"
            onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; void upload(files); }}
            className="ml-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <input type="checkbox" checked={moneyIn} disabled={busy} onChange={(e) => setMoneyIn(e.target.checked)} className="mr-1" />
          Money in only (skip money-out lines)
        </label>
        {busy && <span className="text-sm text-slate-500">Working…</span>}
      </div>
      {restoredAt && statements.length > 0 && (
        <p className="reconcile-restored mt-3">
          Unposted work restored (saved {new Date(restoredAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}). It is kept in this browser until you post it.
          <button type="button" onClick={discardDraft} disabled={busy}>Discard</button>
        </p>
      )}
      {statements.length > 0 && (
        <div className="reconcile-statements mt-3" role="tablist" aria-label="Loaded bank statements">
          {statements.map((statement, i) => {
            const toDecide = pendingRows("credit", statement.rows).length + pendingRows("debit", statement.rows).length;
            return (
              <span key={statement.source_hash} className={`reconcile-statement${i === active ? " is-active" : ""}`}>
                <button type="button" role="tab" aria-selected={i === active} onClick={() => setActive(i)}>
                  <b>{statement.account_label || statement.filename}</b> · {statement.rows.length} lines · {toDecide ? `${toDecide} to decide` : "ready to post"}
                </button>
                <button type="button" aria-label={`Remove ${statement.filename}`} title="Remove this file" onClick={() => removeStatement(i)} disabled={busy}>×</button>
              </span>
            );
          })}
          {statements.length > 1 && (
            <button type="button" disabled={disabled || busy || readyIndexes.length !== statements.length} onClick={() => void post(statements.map((_, i) => i))} className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-50" title={readyIndexes.length !== statements.length ? "Decide every line of every statement first" : undefined}>
              Post all {statements.length} statements
            </button>
          )}
        </div>
      )}
      {preview && preview.file && preview.headers.length > 0 && (
        <details className="mt-3 rounded border bg-slate-50 p-3">
          <summary className="cursor-pointer text-xs text-slate-600">Column mapping for {preview.filename} (only when auto-detection needs correction)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {["date", "description", "reference", "debit", "credit", "amount", "direction"].map((field) => (
              <label className="text-xs" key={field}>
                {field}
                <select
                  value={preview.mapping[field] ?? ""}
                  onChange={(e) => setStatements((list) => list.map((statement, i) => (i === active ? { ...statement, mapping: { ...statement.mapping, [field]: e.target.value || undefined } } : statement)))}
                  className="mt-1 w-full rounded border p-1"
                >
                  <option value="">Auto detect</option>
                  {preview.headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void remap()} className="mt-2 rounded border px-2 py-1 text-xs">
            Apply mapping
          </button>
        </details>
      )}
      {preview && (
        <>
          <h3 className="mt-5 font-semibold">Bank lines: {preview.account_label || preview.filename}</h3>
          <p className="text-sm text-slate-600">Every money-in line must be matched or marked Not rent before the statement can be posted.</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <label>
              Account label
              <input
                required
                value={preview.account_label}
                onChange={(e) => setStatements((list) => list.map((statement, i) => (i === active ? { ...statement, account_label: e.target.value } : statement)))}
                placeholder="e.g. RHB operating"
                className="ml-2 rounded border p-1.5"
              />
            </label>
            <span>Money in: <b>{money(preview.total_credits)}</b> · {preview.rows.filter((row) => row.credit > 0).length} lines</span>
            {!!preview.outside && <span className="text-slate-500">{preview.outside} {preview.outside === 1 ? "line" : "lines"} from other months left out</span>}
            {preview.skipped && preview.skipped.count > 0
              ? <span className="text-slate-500">Money out skipped: {preview.skipped.count} {preview.skipped.count === 1 ? "line" : "lines"} ({money(preview.skipped.amount)})</span>
              : <span>Money out: <b>{money(preview.total_debits)}</b></span>}
          </div>
          {(autoMatched > 0 || suggestions.size > 0 || pendingRows("credit").length > 0 || pendingRows("debit").length > 0) && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
              {autoMatched > 0 && <span className="text-emerald-800">✓ {autoMatched} matched automatically.</span>}
              {weakSuggestions > 0 && <span className="text-amber-800">{weakSuggestions} weak {weakSuggestions === 1 ? "match needs" : "matches need"} a look.</span>}
              {pendingRows("credit").length + pendingRows("debit").length > 0 && <span>{pendingRows("credit").length + pendingRows("debit").length} still to decide.</span>}
              {sureSuggestions.length > 0 && <button type="button" onClick={applyAllSuggestions} disabled={disabled || busy} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold">Use all {sureSuggestions.length} certain and strong</button>}
              {weakSuggestions > 0 && <button type="button" disabled={disabled || busy} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold" onClick={() => { if (window.confirm(`Use all ${weakSuggestions} weak matches? Each is the same amount from a looser name match, a wider date gap or a cash deposit. Only do this after looking through them.`)) [...suggestions.values()].filter((suggestion) => suggestion.confidence === "WEAK").forEach((suggestion) => applySuggestion(suggestion)); }}>Use the {weakSuggestions} weak ones too</button>}
              {pendingRows("debit").length > 0 && (
                <button type="button" disabled={disabled || busy} onClick={() => excludePending("debit", "Money out: payouts, loans and bills are recorded in Records, so not part of the rent check")} className="rounded border px-2 py-1 text-xs font-semibold">
                  Exclude all {pendingRows("debit").length} money-out lines
                </button>
              )}
              {pendingRows("credit").length > 0 && (
                <button type="button" disabled={disabled || busy} onClick={() => { if (weakSuggestions === 0 || window.confirm(`${weakSuggestions} of these money-in lines have a weak suggested match. Mark them Not rent too?`)) excludePending("credit", NOT_RENT); }} className="rounded border px-2 py-1 text-xs font-semibold">
                  Mark the other {pendingRows("credit").length} as Not rent
                </button>
              )}
            </p>
          )}
          {preview.issues.length > 0 && (
            <ul className="mt-3 text-sm text-amber-800">
              {preview.issues.map((issue, i) => (
                <li key={i}>
                  {issue.code}: {issue.detail}
                </li>
              ))}
            </ul>
          )}
          <BankLines
            key={preview.source_hash}
            rows={preview.rows}
            input={input}
            suggestions={suggestions}
            usedPaymentIds={new Set([...postedPaymentIds, ...draftPaymentIds])}
            usedDepositIds={usedDepositIds}
            depositKindOf={depositKindOf}
            onRecordDeposit={onRecordDeposit}
            matchLabel={matchLabel}
            paymentLabel={paymentLabel}
            disabled={disabled || busy}
            onChange={update}
            onUse={applySuggestion}
          />
          <button
            disabled={disabled || busy || !preview.account_label.trim()}
            onClick={() => void post([active])}
            className="mt-3 rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Post this statement
          </button>
        </>
      )}
      {input?.bank_imports?.length ? (
        <details className="mt-4 rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Posted statement audit
          </summary>
          <div className="mt-3 max-h-64 overflow-auto">
            <table className="w-full min-w-[620px] text-xs">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Account</th>
                  <th>Rows</th>
                  <th>Debits</th>
                  <th>Credits</th>
                </tr>
              </thead>
              <tbody>
                {input.bank_imports.map((item) => (
                  <tr className="border-t" key={item.id}>
                    <td>{item.filename}</td>
                    <td>{item.account_label}</td>
                    <td>{item.row_count}</td>
                    <td>{money(item.total_debits)}</td>
                    <td>{money(item.total_credits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="mt-3 w-full min-w-[620px] text-xs">
              <thead>
                <tr>
                  <th>Source row</th>
                  <th>Date</th>
                  <th>Transaction / reference</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Decision</th>
                  <th>Review note</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {input.bank_rows?.map((row) => (
                  <tr
                    className="border-t"
                    key={`${row.import_id}-${row.source_row}`}
                  >
                    <td>{row.source_row}</td>
                    <td>{row.transaction_date}</td>
                    <td>{row.description}<div className="text-slate-500">{row.reference}</div></td>
                    <td>{money(row.debit)}</td>
                    <td>{money(row.credit)}</td>
                    <td>{row.decision}</td>
                    <td>{row.review_note}</td>
                    <td>
                      {(row as typeof row & { match_valid?: boolean })
                        .match_valid === false && (
                        <span className="mr-2 text-red-700">Invalid match</span>
                      )}
                      {rowPaymentIds(row).length + rowDepositIds(row).length > 1 || rowDepositIds(row).length ? (
                        <span className="text-slate-500" title="One transfer matched to several items; it cannot be amended here">{rowDepositIds(row).length ? "Rent + deposit" : `${rowPaymentIds(row).length} payments`}</span>
                      ) : row.decision !== "EXPENSE" ? (
                        <button
                          disabled={disabled || busy}
                          onClick={() => setReviewing(row)}
                          className="rounded border px-2 py-1"
                        >
                          Review match
                        </button>
                      ) : (
                        "Financial fields locked"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      <SideBySide
        input={input}
        statements={statements}
        suggestions={allSuggestions}
        disabled={disabled || busy}
        onMatch={(statement, sourceRow, paymentId, note) => setRows(statement, (rows) => rows.map((row) => (row.source_row === sourceRow ? matchRow(row, paymentId, note) : row)))}
        onUndo={(statement, sourceRow) => setRows(statement, (rows) => rows.map((row) => (row.source_row === sourceRow ? { ...row, decision: "PENDING", payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, matched_ids: null, matched_deposit_ids: null, review_note: "" } : row)))}
        onOpen={setActive}
        onMarkCash={onMarkCash}
      />
      {input && <ReconcileReport month={month} input={input} postedIds={postedPaymentIds} paymentLabel={paymentLabel} />}
      {reviewing && (
        <div className="mt-4 rounded border-2 border-amber-300 bg-amber-50 p-3">
          <h3 className="font-semibold">Review posted bank match</h3>
          <p className="text-xs">
            Only the review decision and note can change; original Finance
            sources remain unchanged.
          </p>
          <table className="mt-2 w-full text-xs">
            <tbody>
              <ReviewRow
                row={reviewing}
                input={input}
                restrict
                onChange={(values) => setReviewing({ ...reviewing, ...values })}
              />
            </tbody>
          </table>
          <button
            disabled={disabled || busy || !reviewing.review_note.trim()}
            onClick={() => void saveReview()}
            className="mt-2 rounded bg-blue-700 px-3 py-2 text-sm text-white"
          >
            Save review
          </button>
          <button
            onClick={() => setReviewing(null)}
            className="ml-2 rounded border px-3 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
const NOT_RENT = "Money in that is not a recorded driver payment (daily rental, transfer between own accounts or other income)";
type LineFilter = "todo" | "weak" | "matched" | "excluded" | "all";
/**
 * The loaded statement's lines, one plain row per transaction: date, amount, the sender's name pulled out of the bank
 * text (full text underneath), what it is matched to, and one action. Opens on the lines that still need a decision.
 */
function BankLines({ rows, input, suggestions, usedPaymentIds, usedDepositIds, depositKindOf, onRecordDeposit, matchLabel, paymentLabel, disabled, onChange, onUse }: {
  rows: BankReviewRow[];
  input: FinanceInput | null;
  suggestions: Map<number, PaymentSuggestion>;
  usedPaymentIds: Set<string>;
  usedDepositIds: Set<string>;
  depositKindOf?: (driverId: string) => "DEPOSIT" | "DOWNPAYMENT";
  onRecordDeposit?: (driverId: string, amount: number, date: string) => Promise<string | undefined>;
  matchLabel: (row: BankReviewRow) => string;
  paymentLabel: (id: string) => string;
  disabled: boolean;
  onChange: (index: number, values: Partial<BankReviewRow>) => void;
  onUse: (suggestion: PaymentSuggestion) => void;
}) {
  const [filter, setFilter] = useState<LineFilter>("todo");
  const [picking, setPicking] = useState<number | null>(null);
  const isWeak = (row: BankReviewRow) => row.decision === "PENDING" && suggestions.get(row.source_row)?.confidence === "WEAK";
  const groups: Record<LineFilter, (row: BankReviewRow) => boolean> = {
    todo: (row) => row.decision === "PENDING",
    weak: isWeak,
    matched: (row) => row.decision === "MATCHED",
    excluded: (row) => row.decision === "EXCLUDED" || row.decision === "EXPENSE",
    all: () => true,
  };
  const labels: Record<LineFilter, string> = { todo: "To decide", weak: "Weak matches", matched: "Matched", excluded: "Not rent", all: "All" };
  const shown = rows.map((row, index) => ({ row, index })).filter(({ row }) => groups[filter](row));
  const reset = { decision: "PENDING" as const, payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, matched_ids: null, matched_deposit_ids: null, review_note: "" };
  return (
    <div className="mt-3">
      <div className="reconcile-filters" role="tablist" aria-label="Show bank lines">
        {(Object.keys(labels) as LineFilter[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)}>
            {labels[key]} <span>{rows.filter(groups[key]).length}</span>
          </button>
        ))}
      </div>
      <div className="reconcile-table-wrap">
        <table className="reconcile-table">
          <thead><tr><th>Date</th><th className="num">Amount</th><th>From</th><th>Matched to</th><th aria-label="Action"></th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={5} className="reconcile-empty">{filter === "todo" ? "Nothing left to decide on this statement." : "No lines here."}</td></tr>}
            {shown.map(({ row, index }) => {
              if (row.debit > 0) return <ReviewRow key={`d-${row.source_row}`} row={row} input={input} onChange={(values) => onChange(index, values)} />;
              const suggestion = row.decision === "PENDING" ? suggestions.get(row.source_row) : undefined;
              const name = senderName(row.description) || row.description.slice(0, 40);
              const open = picking === index && row.decision === "PENDING";
              const smart = open ? matchCandidates(row, input).find((c) => c.kind === "smart_import") : undefined;
              return (
                <tr key={row.source_row} className={`is-${row.decision.toLowerCase()}`}>
                  <td className="nowrap">{shortDate(row.transaction_date)}</td>
                  <td className="num"><b>{money(row.credit)}</b></td>
                  <td>
                    <b>{name}</b>
                    {(name !== row.description || row.reference) && <div className="reconcile-sub" title={`${row.description}${row.reference ? ` · ${row.reference}` : ""}`}>{row.description}{row.reference ? ` · ${row.reference}` : ""}</div>}
                  </td>
                  <td>
                    {row.decision === "MATCHED" && <span className="reconcile-status is-matched">✓ {matchLabel(row) || (row.matched_kind === "smart_import" ? "Smart Drive import" : row.matched_kind)}</span>}
                    {row.decision === "EXCLUDED" && <span className="reconcile-status is-excluded">Not rent{row.review_note && row.review_note !== NOT_RENT ? `: ${row.review_note}` : ""}</span>}
                    {suggestion && (
                      <span className="reconcile-status">
                        <span className={`reconcile-confidence is-${suggestion.confidence.toLowerCase()}`}>{suggestion.confidence === "CERTAIN" ? "Certain" : suggestion.confidence === "STRONG" ? "Strong" : "Weak"}</span>{" "}
                        {paymentLabel(suggestion.paymentId)}
                      </span>
                    )}
                    {row.decision === "PENDING" && !suggestion && !open && <span className="text-slate-500">No match found</span>}
                    {open && (
                      <>
                        <PaymentPicker row={row} input={input} usedPaymentIds={usedPaymentIds} usedDepositIds={usedDepositIds} depositKindOf={depositKindOf} onRecordDeposit={onRecordDeposit} onCancel={() => setPicking(null)} onPick={(ids, depositIds, note) => { onChange(index, matchItems(row, ids, depositIds, note)); setPicking(null); }} />
                        {smart && <button type="button" className="mt-1 rounded border px-2 py-0.5 text-xs" onClick={() => { onChange(index, { ...reset, decision: "MATCHED", matched_kind: "smart_import", matched_id: smart.id, review_note: "Matched by hand" }); setPicking(null); }}>It's the Smart Drive payout instead</button>}
                      </>
                    )}
                  </td>
                  <td className="reconcile-actions">
                    {row.decision === "PENDING" ? (
                      <>
                        {suggestion && <button type="button" className="is-primary" disabled={disabled} onClick={() => onUse(suggestion)}>Use</button>}
                        <button type="button" disabled={disabled} onClick={() => setPicking(picking === index ? null : index)}>{picking === index ? "Cancel" : "Pick"}</button>
                        <button type="button" disabled={disabled} onClick={() => onChange(index, { ...reset, decision: "EXCLUDED", review_note: NOT_RENT })}>Not rent</button>
                      </>
                    ) : (
                      <button type="button" disabled={disabled} onClick={() => onChange(index, reset)}>Undo</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
/**
 * Picks the payment, or several payments, a bank credit pays for. Tick payments until they add up to the bank amount;
 * one transfer covering rent and a penalty recorded separately is matched to both. Payments already matched elsewhere
 * are not offered; the sender's own payments come first, then the nearest dates.
 */
function PaymentPicker({ row, input, usedPaymentIds, usedDepositIds, depositKindOf, onRecordDeposit, onPick, onCancel }: {
  row: BankReviewRow;
  input: FinanceInput | null;
  usedPaymentIds: Set<string>;
  usedDepositIds: Set<string>;
  depositKindOf?: (driverId: string) => "DEPOSIT" | "DOWNPAYMENT";
  onRecordDeposit?: (driverId: string, amount: number, date: string) => Promise<string | undefined>;
  onPick: (paymentIds: string[], depositIds: string[], note: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedDeposits, setSelectedDeposits] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [recording, setRecording] = useState(false);
  const toCents = (n: number) => Math.round(n * 100);
  const target = toCents(row.credit);
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const pool = (input?.ehailing ?? [])
    .filter((p) => p.cash_amount > 0 && !usedPaymentIds.has(p.source_payment_id))
    .map((p) => ({ p, same: senderLooksLike(row.description, p.driver_name_snapshot), fits: toCents(p.cash_amount) <= target, gap: Math.abs(day(p.payment_date) - day(row.transaction_date)) }))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || Number(b.same) - Number(a.same) || a.gap - b.gap);
  // Deposits and downpayments received this month that no bank line has taken yet.
  const deposits = (input?.deposits ?? []).filter((d) => d.entry === "RECEIVED" && !usedDepositIds.has(d.id));
  const term = search.trim().toUpperCase();
  const matches = (text: string) => !term || text.toUpperCase().includes(term);
  const ticked = pool.filter(({ p }) => selected.includes(p.source_payment_id));
  const shown = [...ticked, ...pool.filter(({ p }) => !selected.includes(p.source_payment_id) && matches(`${p.driver_name_snapshot ?? ""} ${p.car_plate_snapshot ?? p.plate_key ?? ""}`)).slice(0, 40)];
  const shownDeposits = deposits.filter((d) => selectedDeposits.includes(d.id) || matches(`${d.driver_name ?? ""} ${d.car_plate ?? ""}`)).slice(0, 10);
  const total = selected.reduce((sum, id) => sum + toCents(input?.ehailing.find((p) => p.source_payment_id === id)?.cash_amount ?? 0), 0)
    + selectedDeposits.reduce((sum, id) => sum + toCents(Number(deposits.find((d) => d.id === id)?.amount ?? 0)), 0);
  const left = target - total;
  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const toggleDeposit = (id: string) => setSelectedDeposits((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const count = selected.length + selectedDeposits.length;
  const note = selectedDeposits.length ? (selected.length ? "Rent and deposit in one transfer" : "Deposit or downpayment") : selected.length > 1 ? `One transfer for ${selected.length} payments` : "Matched by hand";
  // What is left after the ticked rent can be recorded as the same driver's deposit or downpayment, then matched.
  const firstDriver = selected.length ? input?.ehailing.find((p) => p.source_payment_id === selected[0])?.driver_id ?? null : null;
  const leftoverKind = firstDriver && depositKindOf ? depositKindOf(firstDriver) : "DEPOSIT";
  const leftoverLabel = leftoverKind === "DOWNPAYMENT" ? "downpayment" : "deposit";
  const recordLeftover = async () => {
    if (!firstDriver || !onRecordDeposit || left <= 0) return;
    setRecording(true);
    try {
      const id = await onRecordDeposit(firstDriver, left / 100, row.transaction_date);
      if (id) onPick(selected, [...selectedDeposits, id], selectedDeposits.length || selected.length ? "Rent and deposit in one transfer" : "Deposit or downpayment");
    } finally {
      setRecording(false);
    }
  };
  return (
    <div className="reconcile-picker">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search driver or plate" className="rounded border p-1 text-xs" aria-label="Search payments" />
      <div className="reconcile-picker-list">
        {shown.length === 0 && shownDeposits.length === 0 && <p className="text-xs text-slate-500">{term ? "No unmatched payment for that search." : "Every payment this month is already matched."}</p>}
        {shown.map(({ p, same }) => (
          <label key={p.source_payment_id} className={`${same ? "is-same" : ""}${toCents(p.cash_amount) > target ? " is-over" : ""}`} title={toCents(p.cash_amount) > target ? "More than the bank amount" : undefined}>
            <input type="checkbox" checked={selected.includes(p.source_payment_id)} onChange={() => toggle(p.source_payment_id)} />
            <span>{shortDate(p.payment_date)}</span>
            <b>{p.driver_name_snapshot ?? "Driver"}</b>
            <span>{p.car_plate_snapshot ?? p.plate_key ?? ""}</span>
            <span className="num">{money(p.cash_amount)}</span>
          </label>
        ))}
        {shownDeposits.map((d) => (
          <label key={d.id} className={toCents(Number(d.amount)) > target ? "is-over" : ""}>
            <input type="checkbox" checked={selectedDeposits.includes(d.id)} onChange={() => toggleDeposit(d.id)} />
            <span>{shortDate(d.entry_date)}</span>
            <b>{d.driver_name ?? "Driver"} <span className="reconcile-tag">{d.kind === "DOWNPAYMENT" ? "Downpayment" : "Deposit"}</span></b>
            <span>{d.car_plate ?? ""}</span>
            <span className="num">{money(Number(d.amount))}</span>
          </label>
        ))}
      </div>
      <div className="reconcile-picker-foot">
        <span className={left === 0 && count ? "text-emerald-700" : left < 0 ? "text-red-700" : ""}>
          Ticked {money(total / 100)} of {money(row.credit)}{left === 0 && count ? " ✓" : left > 0 ? ` · ${money(left / 100)} left` : ` · ${money(-left / 100)} too much`}
        </span>
        <button type="button" className="is-primary" disabled={!count || left !== 0} onClick={() => onPick(selected, selectedDeposits, note)}>Match</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
      {onRecordDeposit && firstDriver && left > 0 && (
        <button type="button" className="reconcile-picker-leftover" disabled={recording} onClick={() => void recordLeftover()}>
          {recording ? "Recording…" : `Record the ${money(left / 100)} left as ${input?.ehailing.find((p) => p.source_payment_id === selected[0])?.driver_name_snapshot ?? "the driver"}'s ${leftoverLabel} and match`}
        </button>
      )}
    </div>
  );
}

function ReviewRow({
  row,
  input,
  onChange,
  restrict = false,
  suggestion,
}: {
  key?: React.Key;
  row: BankReviewRow;
  input: FinanceInput | null;
  onChange: (v: Partial<BankReviewRow>) => void;
  restrict?: boolean;
  suggestion?: { text: string; confidence: "CERTAIN" | "STRONG" | "WEAK"; onUse: () => void };
}) {
  const vehicles = input?.vehicles ?? [];
  const expense = row.decision === "EXPENSE";
  const categories =
    row.payment_source === "Corporate Opex"
      ? corporateCategories
      : row.payment_source === "Vehicle Direct Cost"
        ? vehicleCategories
        : ["Service & Maintenance"];
  const candidates = matchCandidates(row, input);
  const changeDecision = (decision: BankReviewRow["decision"]) =>
    onChange({
      decision,
      payment_source: null,
      category: null,
      plate_key: null,
      matched_kind: null,
      matched_id: null,
      review_note: "",
    });
  return (
    <tr className="border-t align-top">
      <td>{row.transaction_date}</td>
      <td>{row.description}<div className="text-slate-500">{row.reference}</div></td>
      <td>{money(row.debit)}</td>
      <td>{money(row.credit)}</td>
      <td>
        <select
          value={row.decision}
          onChange={(e) =>
            changeDecision(e.target.value as BankReviewRow["decision"])
          }
          className="rounded border p-1"
        >
          {!restrict && <option>PENDING</option>}
          {!restrict && <option disabled={row.debit <= 0}>EXPENSE</option>}
          <option>MATCHED</option>
          <option>EXCLUDED</option>
        </select>
        {suggestion && row.decision === "PENDING" && (
          <span className="reconcile-suggestion">
            <span className={`reconcile-confidence is-${suggestion.confidence.toLowerCase()}`}>{suggestion.confidence === "CERTAIN" ? "Certain" : suggestion.confidence === "STRONG" ? "Strong" : "Weak: check the receipt"}</span>{" "}
            Suggested: {suggestion.text}
            <button type="button" onClick={suggestion.onUse}>Use</button>
          </span>
        )}
      </td>
      <td>
        {expense && (
          <>
            <select
              value={row.payment_source ?? ""}
              onChange={(e) =>
                onChange({
                  payment_source: e.target
                    .value as BankReviewRow["payment_source"],
                  category: null,
                  plate_key:
                    e.target.value === "Corporate Opex" ? null : row.plate_key,
                })
              }
              className="mr-1 rounded border p-1"
            >
              <option value="">Cost type</option>
              <option>Workshop Billing</option>
              <option>Vehicle Direct Cost</option>
              <option value="Corporate Opex">Operation Fix Cost</option>
            </select>
            {row.payment_source !== "Corporate Opex" && (
              <select
                value={row.plate_key ?? ""}
                onChange={(e) =>
                  onChange({ plate_key: e.target.value || null })
                }
                className="mr-1 rounded border p-1"
              >
                <option value="">Vehicle</option>
                {vehicles.map((v) => (
                  <option value={v.plate_key} key={v.plate_key}>
                    {v.display_plate}
                  </option>
                ))}
              </select>
            )}
            <select
              value={row.category ?? ""}
              onChange={(e) => onChange({ category: e.target.value })}
              className="rounded border p-1"
            >
              <option value="">Category</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              value={row.review_note}
              onChange={(e) => onChange({ review_note: e.target.value })}
              placeholder="Review note (optional)"
              className="mt-1 rounded border p-1"
            />
          </>
        )}
        {row.decision === "MATCHED" && (
          <>
            <select
              value={
                row.matched_id ? `${row.matched_kind}:${row.matched_id}` : ""
              }
              onChange={(e) => {
                const [matched_kind, ...id] = e.target.value.split(":");
                onChange({
                  matched_kind: (matched_kind || null) as BankMatchKind | null,
                  matched_id: id.join(":") || null,
                  review_note: /^(Auto-matched|Suggested match|Matched from the unsolved)/.test(row.review_note) ? "" : row.review_note,
                });
              }}
              className="rounded border p-1"
            >
              <option value="">Choose verified Finance source</option>
              {candidates.map((candidate) => (
                <option
                  key={`${candidate.kind}:${candidate.id}`}
                  value={`${candidate.kind}:${candidate.id}`}
                >
                  {candidate.label}
                </option>
              ))}
            </select>
            <input
              value={row.review_note}
              onChange={(e) => onChange({ review_note: e.target.value })}
              placeholder="Review note (optional)"
              className="mt-1 rounded border p-1"
            />
          </>
        )}
        {row.decision === "EXCLUDED" && (
          <input
            value={row.review_note}
            onChange={(e) => onChange({ review_note: e.target.value })}
            placeholder="Reason required"
            className="rounded border p-1"
          />
        )}
      </td>
    </tr>
  );
}
/**
 * Every cash payment recorded in the app this month, checked against the bank: solved when a bank credit is matched to
 * it (posted, or in a loaded statement still to post). Unsolved payments are listed oldest first with any open bank
 * line of the same amount, so each can be matched in one click or looked up in the bank.
 */
type PairFilter = "all" | "ticked" | "look" | "missing" | "cash";
/**
 * The reconciliation itself: every cash payment recorded in the app on the left, the bank line that proves it on the
 * right, and a tick when they are matched. Payments without a match show the matcher's suggestion or the nearest
 * same-amount line (labelled when the name differs), or "Not found in bank".
 */
function SideBySide({ input, statements, suggestions, disabled, onMatch, onUndo, onOpen, onMarkCash }: {
  input: FinanceInput | null;
  statements: Array<{ account_label: string; filename: string; rows: BankReviewRow[] }>;
  suggestions: Array<Map<number, PaymentSuggestion>>;
  disabled: boolean;
  onMatch: (statement: number, sourceRow: number, paymentId: string, note: string) => void;
  onUndo: (statement: number, sourceRow: number) => void;
  onOpen: (statement: number) => void;
  onMarkCash?: (paymentId: string) => unknown;
}) {
  const [filter, setFilter] = useState<PairFilter>("all");
  const [cashDepositsOnly, setCashDepositsOnly] = useState(false);
  if (!input) return null;
  const accountOf = new Map((input.bank_imports ?? []).map((item) => [item.id, item.account_label || item.filename]));
  const posted = (input.bank_rows ?? []).filter((row) => row.match_valid !== false).map((row) => ({ row, account: accountOf.get(row.import_id) ?? "Posted statement" }));
  const pairs = reconcilePairs(input.ehailing, posted, statements.map((s) => ({ rows: s.rows, account: s.account_label || s.filename })), suggestions, senderLooksLike);
  const isCashDeposit = (p: EhailingPayment) => String(p.payment_method ?? "").toUpperCase() === "CASH DEPOSIT";
  const groups: Record<PairFilter, (pair: (typeof pairs)[number]) => boolean> = {
    all: () => true,
    ticked: (pair) => pair.state === "posted" || pair.state === "matched",
    look: (pair) => pair.state === "suggested" || pair.state === "guess",
    missing: (pair) => pair.state === "missing",
    cash: (pair) => pair.state === "cash",
  };
  const labels: Record<PairFilter, string> = { all: "All", ticked: "✓ Matched", look: "Needs a look", missing: "Not found in bank", cash: "Cash in hand" };
  const ticked = pairs.filter(groups.ticked);
  const cash = pairs.filter(groups.cash);
  const open = pairs.filter((pair) => !groups.ticked(pair) && !groups.cash(pair));
  const shown = pairs.filter((pair) => groups[filter](pair) && (!cashDepositsOnly || isCashDeposit(pair.payment)));
  const percent = pairs.length ? Math.round(((ticked.length + cash.length) / pairs.length) * 100) : 0;
  const waiting = pairs.filter((pair) => pair.state === "matched").length;
  return (
    <section className="mt-4 rounded border p-3" aria-labelledby="payment-check-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="payment-check-heading" className="font-semibold">
          System vs bank: <span className="text-emerald-700">✓ {ticked.length} matched</span>{cash.length > 0 && <>, <span className="text-slate-600">{cash.length} cash in hand ({money(cash.reduce((sum, pair) => sum + pair.payment.cash_amount, 0))})</span></>}, <span className={open.length ? "text-red-700" : "text-emerald-700"}>{open.length} not yet</span>
          {open.length > 0 && ` (${money(open.reduce((sum, pair) => sum + pair.payment.cash_amount, 0))})`}
        </h3>
        <label className="text-sm">
          <input type="checkbox" checked={cashDepositsOnly} onChange={(e) => setCashDepositsOnly(e.target.checked)} className="mr-1" />
          Cash deposits only
        </label>
      </div>
      <div className="reconcile-progress mt-2" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Payments matched">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {pairs.length} cash payments recorded in the app this month, each beside the bank line that proves it.
        {waiting > 0 && <> <b>{waiting}</b> of the matches are in a statement still to post.</>}
      </p>
      <div className="reconcile-filters mt-2" role="tablist" aria-label="Show payments">
        {(Object.keys(labels) as PairFilter[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)}>
            {labels[key]} <span>{pairs.filter(groups[key]).length}</span>
          </button>
        ))}
      </div>
      <div className="reconcile-table-wrap">
        <table className="reconcile-table reconcile-pairs">
          <thead>
            <tr className="reconcile-sides"><th colSpan={4}>In the system</th><th></th><th colSpan={4}>On the bank statement</th><th></th></tr>
            <tr><th>Date</th><th>Driver</th><th>Plate</th><th className="num">Amount</th><th className="reconcile-mark" aria-label="Matched"></th><th>Date</th><th>From</th><th className="num">Amount</th><th>Bank</th><th aria-label="Action"></th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={10} className="reconcile-empty">{filter === "missing" ? "Every payment has a bank line." : "Nothing here."}</td></tr>}
            {shown.map((pair) => {
              const p = pair.payment;
              const bank = pair.bank;
              const mark = pair.state === "posted" || pair.state === "matched" ? "✓" : pair.state === "missing" ? "✗" : pair.state === "cash" ? "C" : "?";
              return (
                <tr key={p.source_payment_id} className={`is-${pair.state}`}>
                  <td className="nowrap">{shortDate(p.payment_date)}</td>
                  <td><b>{p.driver_name_snapshot ?? "—"}</b>{isCashDeposit(p) && <span className="reconcile-tag">Cash deposit</span>}</td>
                  <td className="nowrap">{p.car_plate_snapshot ?? p.plate_key ?? "—"}</td>
                  <td className="num"><b>{money(p.cash_amount)}</b></td>
                  <td className={`reconcile-mark is-${pair.state}`} aria-label={pair.state}>{mark}</td>
                  {bank ? (
                    <>
                      <td className="nowrap">{shortDate(bank.row.transaction_date)}</td>
                      <td>
                        <span title={bank.row.description}>{senderName(bank.row.description) || bank.row.description.slice(0, 40)}</span>
                        {!!pair.shared && <div className="reconcile-hint">One transfer for {pair.shared + 1} payments</div>}
                        {rowDepositIds(bank.row).length > 0 && <div className="reconcile-hint">Also pays a deposit or downpayment</div>}
                        {pair.state === "suggested" && pair.confidence && <div><span className={`reconcile-confidence is-${pair.confidence.toLowerCase()}`}>{pair.confidence === "WEAK" ? "Weak match: check the receipt" : pair.confidence === "STRONG" ? "Strong match" : "Certain match"}</span></div>}
                        {pair.state === "guess" && <div className={pair.sameName ? "reconcile-hint" : "reconcile-hint is-warn"}>{pair.sameName ? "Same amount, name agrees" : "Same amount, different name"}{pair.others ? ` · ${pair.others} other ${pair.others === 1 ? "line" : "lines"} with this amount` : ""}</div>}
                      </td>
                      <td className="num">{money(bank.row.credit)}</td>
                      <td className="nowrap">{bank.statement === null ? bank.account : <button type="button" className="reconcile-candidate-open" onClick={() => onOpen(bank.statement as number)}>{bank.account}</button>}</td>
                    </>
                  ) : (
                    pair.state === "cash"
                      ? <td colSpan={4} className="text-slate-600">{String(p.payment_method ?? "").toUpperCase() === "DEPOSIT CONTRA" ? "Settled from the driver's deposit (contra), so no bank line is expected." : "Paid in cash (in hand), so no bank line is expected."}</td>
                      : <td colSpan={4} className="text-red-700">{statements.length ? "Not found in bank. Check the other account, the receipt or next month's statement." : "Load the bank statements to check."}</td>
                  )}
                  <td className="reconcile-actions">
                    {pair.state === "posted" && <span className="text-slate-500">Posted</span>}
                    {pair.state === "matched" && bank && bank.statement !== null && <button type="button" disabled={disabled} onClick={() => onUndo(bank.statement as number, bank.row.source_row)}>Undo</button>}
                    {(pair.state === "suggested" || pair.state === "guess") && bank && bank.statement !== null && (
                      <button type="button" className={pair.state === "suggested" || pair.sameName ? "is-primary" : ""} disabled={disabled} onClick={() => onMatch(bank.statement as number, bank.row.source_row, p.source_payment_id, pair.state === "suggested" ? "Suggested match confirmed" : "Matched by hand: same amount")}>Match</button>
                    )}
                    {onMarkCash && (pair.state === "suggested" || pair.state === "guess" || pair.state === "missing") && !isCashInHand(p) && (
                      <button type="button" disabled={disabled} title="Changes this payment's method to Cash (in hand) on the Drivers page" onClick={() => { if (window.confirm(`Mark ${p.driver_name_snapshot ?? "this driver"}'s ${money(p.cash_amount)} on ${shortDate(p.payment_date)} as paid in cash (in hand)? Its payment method changes to Cash.`)) void onMarkCash(p.source_payment_id); }}>Paid in cash</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The printable reconciliation report for the month's posted statements (shown only when printing). */
function ReconcileReport({ month, input, postedIds, paymentLabel }: { month: string; input: FinanceInput; postedIds: Set<string>; paymentLabel: (id: string) => string }) {
  const rows = input.bank_rows ?? [];
  const byDecision = (decision: BankReviewRow["decision"]) => rows.filter((row) => row.decision === decision);
  const amountOf = (list: BankReviewRow[]) => list.reduce((sum, row) => sum + row.credit + row.debit, 0);
  const matched = byDecision("MATCHED");
  const expenses = byDecision("EXPENSE");
  const excluded = byDecision("EXCLUDED");
  const unsolved = unsolvedPayments(input.ehailing, postedIds);
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return (
    <div className="reconcile-report" aria-hidden="true">
      <h2>Bank reconciliation, {monthName}</h2>
      <p>Printed {new Date().toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" })} (Malaysia time). Posted statements only.</p>
      <h3>Statements</h3>
      <table>
        <thead><tr><th>File</th><th>Account</th><th>Rows</th><th>Debits</th><th>Credits</th></tr></thead>
        <tbody>
          {(input.bank_imports ?? []).map((item) => (
            <tr key={item.id}><td>{item.filename}</td><td>{item.account_label}</td><td className="num">{item.row_count}</td><td className="num">{money(item.total_debits)}</td><td className="num">{money(item.total_credits)}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>Summary</h3>
      <table>
        <tbody>
          <tr><td>Matched to Finance records</td><td className="num">{matched.length}</td><td className="num">{money(amountOf(matched))}</td></tr>
          <tr><td>Posted as expenses</td><td className="num">{expenses.length}</td><td className="num">{money(amountOf(expenses))}</td></tr>
          <tr><td>Excluded, with reasons</td><td className="num">{excluded.length}</td><td className="num">{money(amountOf(excluded))}</td></tr>
          <tr><td>System unsolved (recorded, not matched to the bank)</td><td className="num">{unsolved.length}</td><td className="num">{money(unsolved.reduce((sum, p) => sum + p.cash_amount, 0))}</td></tr>
        </tbody>
      </table>
      <h3>Matched credits</h3>
      <table>
        <thead><tr><th>Date</th><th>Bank description</th><th>Amount</th><th>Matched to</th></tr></thead>
        <tbody>
          {matched.filter((row) => row.credit > 0).map((row) => (
            <tr key={`${row.import_id}-${row.source_row}`}><td>{row.transaction_date}</td><td>{row.description}</td><td className="num">{money(row.credit)}</td><td>{rowPaymentIds(row).length || rowDepositIds(row).length ? [...rowPaymentIds(row).map(paymentLabel), ...rowDepositIds(row).map((id) => `Deposit ${id.slice(0, 8)}`)].join(" + ") : row.matched_kind}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>Excluded rows</h3>
      <table>
        <thead><tr><th>Date</th><th>Bank description</th><th>Amount</th><th>Reason</th></tr></thead>
        <tbody>
          {excluded.map((row) => (
            <tr key={`${row.import_id}-${row.source_row}`}><td>{row.transaction_date}</td><td>{row.description}</td><td className="num">{money(row.credit || row.debit)}</td><td>{row.review_note}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>System unsolved</h3>
      <table>
        <thead><tr><th>Date</th><th>Driver</th><th>Plate</th><th>Method</th><th>Cash</th></tr></thead>
        <tbody>
          {unsolved.map((p) => (
            <tr key={p.source_payment_id}><td>{p.payment_date}</td><td>{p.driver_name_snapshot ?? "—"}</td><td>{p.car_plate_snapshot ?? p.plate_key ?? "—"}</td><td>{p.payment_method ?? "BANK TRANSFER"}</td><td className="num">{money(p.cash_amount)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function matchCandidates(
  row: BankReviewRow,
  input: FinanceInput | null,
): Array<{ kind: BankMatchKind; id: string; label: string }> {
  if (!input) return [];
  const value = row.credit > 0 ? row.credit : row.debit;
  const same = (amount: number) =>
    Math.round(amount * 100) === Math.round(value * 100);
  const month = input.month.finance_month.slice(0, 7);
  const candidates: Array<{ kind: BankMatchKind; id: string; label: string }> =
    [];
  if (row.credit > 0) {
    // Any payment recorded this month with the same cash amount, nearest date first (Finance checks month and amount)
    const distance = (date: string) => Math.abs(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${row.transaction_date}T00:00:00Z`));
    input.ehailing
      .filter(
        (payment) =>
          payment.finance_month.slice(0, 7) === month &&
          payment.cash_amount > 0 &&
          same(payment.cash_amount),
      )
      .sort((a, b) => distance(a.payment_date) - distance(b.payment_date))
      .forEach((payment) =>
        candidates.push({
          kind: "payment",
          id: payment.source_payment_id,
          label: `E-hailing ${payment.driver_name_snapshot ?? payment.driver_id ?? "driver"} · ${payment.car_plate_snapshot ?? ""} · ${payment.payment_date}${payment.payment_date === row.transaction_date ? " (same day)" : ""} · ${money(payment.cash_amount)}`,
        }),
      );
    if (input.smart_import?.finance_month.slice(0, 7) === month)
      candidates.push({
        kind: "smart_import",
        id: input.smart_import.id,
        label: `Smart Drive import · ${input.smart_import.filename}`,
      });
  } else {
    input.recurring_costs
      .filter(
        (cost) =>
          cost.start_month.slice(0, 7) <= month &&
          (!cost.end_month || cost.end_month.slice(0, 7) >= month) &&
          same(cost.monthly_amount),
      )
      .forEach((cost) =>
        candidates.push({
          kind: "recurring_cost",
          id: cost.id ?? `${cost.plate_key}:${cost.cost_type}`,
          label: `Recurring · ${cost.plate_key} · ${cost.cost_type} · ${money(cost.monthly_amount)}`,
        }),
      );
    input.insurance
      .filter(
        (policy) =>
          policy.responsibility !== "OWNER_PAID" && policy.payment_date?.slice(0, 7) === month && same(policy.premium),
      )
      .forEach((policy) =>
        candidates.push({
          kind: "insurance",
          id: policy.id ?? `${policy.plate_key}:${policy.coverage_start}`,
          label: `Insurance · ${policy.plate_key} · paid ${policy.payment_date} · ${money(policy.premium)}`,
        }),
      );
    input.expenses
      .filter(
        (expense) =>
          expense.finance_month.slice(0, 7) === month && same(expense.amount),
      )
      .forEach((expense) =>
        candidates.push({
          kind: "expense",
          id: expense.id ?? `${expense.billing_date}:${expense.category}`,
          label: `Expense · ${expense.category} · ${expense.plate_key ?? "corporate"} · ${expense.billing_date ?? `${expense.finance_month.slice(0, 7)} (monthly)`} · ${money(expense.amount)}`,
        }),
      );
  }
  return candidates;
}
async function sha256Buffer(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
