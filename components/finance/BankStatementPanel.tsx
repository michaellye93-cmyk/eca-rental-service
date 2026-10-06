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
import { unsolvedPayments, type PaymentSuggestion } from "../../services/finance/bankMatchSuggestions";
import { applySureMatches, bankLinesForPayment, matchRow, paymentCheck, suggestAcrossStatements } from "../../services/finance/reconcileQueue";

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
  file: File;
  headers: string[];
  mapping: Record<string, string | undefined>;
};
const matchedPaymentIds = (rows: BankReviewRow[]) =>
  rows.filter((row) => row.decision === "MATCHED" && row.matched_kind === "payment" && row.matched_id).map((row) => row.matched_id as string);

export default function BankStatementPanel({
  month,
  input,
  disabled,
  onPosted,
  onError,
  paymentReferences,
}: {
  month: string;
  input: FinanceInput | null;
  disabled: boolean;
  onPosted: (next: FinanceInput, message: string) => void;
  onError: (message: string) => void;
  /** The receipt or DuitNow reference recorded with each payment, by payment id. */
  paymentReferences?: Map<string, string>;
}) {
  const [statements, setStatements] = useState<LoadedStatement[]>([]);
  const [active, setActive] = useState(0);
  const preview = statements[active] ?? null;
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<
    (BankReviewRow & { import_id: string; match_valid?: boolean }) | null
  >(null);
  const generation = useRef(0);
  // Payments already matched to a posted bank credit this month, and in the statements being reviewed
  const postedPaymentIds = useMemo(() => new Set((input?.bank_rows ?? []).filter((row) => row.decision === "MATCHED" && row.matched_kind === "payment" && row.matched_id && row.match_valid !== false).map((row) => row.matched_id as string)), [input]);
  const draftPaymentIds = useMemo(() => new Set(statements.flatMap((statement) => matchedPaymentIds(statement.rows))), [statements]);
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
    setRows(active, (rows) => rows.map((row) => row.decision === "PENDING" && (side === "debit" ? row.debit > 0 : row.credit > 0) ? { ...row, decision: "EXCLUDED", payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, review_note: note } : row));
  // Prints only the reconciliation report (same approach as the termination report)
  const printReport = () => {
    document.body.classList.add("printing-reconcile-report");
    const cleanup = () => document.body.classList.remove("printing-reconcile-report");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    cleanup();
  };
  // Loaded statements stay open while another one is posted; they are cleared only when the month changes.
  useEffect(() => {
    generation.current++;
    setStatements([]);
    setActive(0);
    setReviewing(null);
  }, [month]);
  const readStatement = async (file: File, mapping: Record<string, string | undefined> = {}): Promise<LoadedStatement> => {
    if (!input) throw new Error("Finance data is not loaded yet.");
    const original = await file.arrayBuffer();
    const source_hash = await sha256Buffer(original);
    const fallbackLabel = file.name.replace(/\.[^.]+$/, "");
    if (file.type.includes("pdf") || file.type.startsWith("image/")) {
      const extracted = await extractBankStatement(file);
      return {
        rows: extracted.rows.map((row) => ({ ...row, decision: "PENDING", payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, review_note: "" })),
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
    const issues = validateBankReview(statement.rows, month, input).map((issue) => issue.detail);
    if (!statement.account_label.trim()) issues.unshift("Account label is required.");
    // A payment may be matched to one bank credit only, across posted and loaded statements.
    const elsewhere = new Set([...postedPaymentIds, ...statements.filter((other) => other !== statement).flatMap((other) => matchedPaymentIds(other.rows))]);
    const seen = new Set<string>();
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
  const matchFromQueue = (statement: number, sourceRow: number, paymentId: string) =>
    setRows(statement, (rows) => rows.map((row) => (row.source_row === sourceRow ? matchRow(row, paymentId, "Matched from the unsolved payments list") : row)));
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
        {busy && <span className="text-sm text-slate-500">Working…</span>}
      </div>
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
      {preview && preview.headers.length > 0 && (
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
            <span>Debits: <b>{money(preview.total_debits)}</b></span>
            <span>Credits: <b>{money(preview.total_credits)}</b></span>
            <span>{preview.rows.length} lines</span>
          </div>
          {(autoMatched > 0 || suggestions.size > 0) && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-emerald-900">
              {autoMatched > 0 && <span>✓ {autoMatched} certain or strong {autoMatched === 1 ? "match was" : "matches were"} used automatically.</span>}
              {weakSuggestions > 0 && <span className="text-amber-900">{weakSuggestions} weak {weakSuggestions === 1 ? "match needs" : "matches need"} a look at the receipt.</span>}
              {sureSuggestions.length > 0 && <button type="button" onClick={applyAllSuggestions} disabled={disabled || busy} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold">Use all {sureSuggestions.length} certain and strong</button>}
              {weakSuggestions > 0 && <button type="button" disabled={disabled || busy} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold" onClick={() => { if (window.confirm(`Use all ${weakSuggestions} weak matches? Each is the same amount from a looser name match, a wider date gap or a cash deposit. Only do this after looking through them.`)) [...suggestions.values()].filter((suggestion) => suggestion.confidence === "WEAK").forEach((suggestion) => applySuggestion(suggestion)); }}>Use the {weakSuggestions} weak ones too</button>}
            </p>
          )}
          {(pendingRows("credit").length > 0 || pendingRows("debit").length > 0) && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
              Still to decide: {pendingRows("credit").length} money in, {pendingRows("debit").length} money out.
              {pendingRows("debit").length > 0 && (
                <button type="button" disabled={disabled || busy} onClick={() => excludePending("debit", "Money out: payouts, loans and bills are recorded in Records, so not part of the rent check")} className="rounded border px-2 py-1 text-xs font-semibold">
                  Exclude all {pendingRows("debit").length} money-out lines
                </button>
              )}
              {pendingRows("credit").length > 0 && (
                <button type="button" disabled={disabled || busy} onClick={() => { if (weakSuggestions === 0 || window.confirm(`${weakSuggestions} of these money-in lines have a weak suggested match. Exclude them too?`)) excludePending("credit", "Money in that is not a recorded driver payment (daily rental, transfer between own accounts or other income)"); }} className="rounded border px-2 py-1 text-xs font-semibold">
                  Exclude the other {pendingRows("credit").length} money-in lines
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
          <div className="mt-3 max-h-96 overflow-auto">
            <table className="w-full min-w-[960px] text-xs">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Transaction / reference</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Decision</th>
                  <th>Finance detail / review note</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, index) => {
                  const suggestion = suggestions.get(row.source_row);
                  return (
                    <ReviewRow
                      key={`${row.source_row}-${row.reference ?? ""}`}
                      row={row}
                      input={input}
                      onChange={(values) => update(index, values)}
                      suggestion={suggestion ? { text: `${paymentLabel(suggestion.paymentId)} (${suggestion.reason})`, confidence: suggestion.confidence, onUse: () => applySuggestion(suggestion) } : undefined}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
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
                      {row.decision !== "EXPENSE" ? (
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
      <PaymentCheckPanel
        input={input}
        postedIds={postedPaymentIds}
        draftIds={draftPaymentIds}
        statements={statements}
        disabled={disabled || busy}
        onMatch={matchFromQueue}
        onOpen={setActive}
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
function PaymentCheckPanel({ input, postedIds, draftIds, statements, disabled, onMatch, onOpen }: {
  input: FinanceInput | null;
  postedIds: Set<string>;
  draftIds: Set<string>;
  statements: Array<{ account_label: string; filename: string; rows: BankReviewRow[] }>;
  disabled: boolean;
  onMatch: (statement: number, sourceRow: number, paymentId: string) => void;
  onOpen: (statement: number) => void;
}) {
  const [cashDepositsOnly, setCashDepositsOnly] = useState(false);
  if (!input) return null;
  const check = paymentCheck(input.ehailing, postedIds, draftIds);
  const isCashDeposit = (p: EhailingPayment) => String(p.payment_method ?? "").toUpperCase() === "CASH DEPOSIT";
  const queue = cashDepositsOnly ? check.unsolved.filter(isCashDeposit) : check.unsolved;
  const rowsOf = statements.map((statement) => statement.rows);
  const percent = check.total ? Math.round((check.solved.length / check.total) * 100) : 0;
  return (
    <section className="mt-4 rounded border p-3" aria-labelledby="payment-check-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="payment-check-heading" className="font-semibold">
          Payment check: <span className="text-emerald-700">✓ {check.solved.length} solved</span>, <span className={check.unsolved.length ? "text-red-700" : "text-emerald-700"}>{check.unsolved.length} unsolved</span>{check.unsolved.length > 0 && ` (${money(check.unsolvedAmount)})`}
        </h3>
        <label className="text-sm">
          <input type="checkbox" checked={cashDepositsOnly} onChange={(e) => setCashDepositsOnly(e.target.checked)} className="mr-1" />
          Cash deposits only
        </label>
      </div>
      <div className="reconcile-progress mt-2" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Payments solved">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {check.total} cash payments recorded in the app this month. Solved means a bank credit is matched to it
        {check.waitingToPost > 0 && <>; <b>{check.waitingToPost}</b> of the solved are in a statement still to post</>}.
        Unsolved payments are still to be matched, not in the bank yet, or recorded by mistake.
      </p>
      {queue.length > 0 && (
        <div className="mt-2 max-h-96 overflow-auto">
          <table className="w-full min-w-[760px] text-xs">
            <caption className="sr-only">Unsolved payments, oldest first</caption>
            <thead><tr><th>#</th><th>Date</th><th>Driver</th><th>Plate</th><th>Method</th><th>Cash</th><th>Bank lines with this amount</th></tr></thead>
            <tbody>
              {queue.map((p, n) => {
                const lines = statements.length ? bankLinesForPayment(p, rowsOf).slice(0, 3) : [];
                return (
                  <tr className="border-t align-top" key={p.source_payment_id}>
                    <td>{n + 1}</td>
                    <td>{p.payment_date}</td>
                    <td>{p.driver_name_snapshot ?? "—"}</td>
                    <td>{p.car_plate_snapshot ?? p.plate_key ?? "—"}</td>
                    <td>{p.payment_method ?? "BANK TRANSFER"}</td>
                    <td>{money(p.cash_amount)}</td>
                    <td>
                      {!statements.length ? <span className="text-slate-500">Load the bank statements to see candidates</span>
                        : !lines.length ? <span className="text-red-700">No open bank line with this amount. Check the other account, the receipt, or the next month's statement.</span>
                        : lines.map((line) => (
                          <div className="reconcile-candidate" key={`${line.statement}-${line.row.source_row}`}>
                            <button type="button" className="reconcile-candidate-open" onClick={() => onOpen(line.statement)} title="Open this statement">
                              {line.row.transaction_date} · {statements[line.statement].account_label || statements[line.statement].filename} · {line.row.description.slice(0, 60)}
                            </button>
                            <button type="button" disabled={disabled} onClick={() => onMatch(line.statement, line.row.source_row, p.source_payment_id)}>Match</button>
                          </div>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {check.solved.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm">Show the {check.solved.length} solved payments</summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead><tr><th></th><th>Date</th><th>Driver</th><th>Plate</th><th>Cash</th><th>Status</th></tr></thead>
              <tbody>
                {check.solved.map((p) => (
                  <tr className="border-t" key={p.source_payment_id}>
                    <td className="text-emerald-700" aria-label="Solved">✓</td>
                    <td>{p.payment_date}</td>
                    <td>{p.driver_name_snapshot ?? "—"}</td>
                    <td>{p.car_plate_snapshot ?? p.plate_key ?? "—"}</td>
                    <td>{money(p.cash_amount)}</td>
                    <td>{postedIds.has(p.source_payment_id) ? "Posted" : "To post"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
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
            <tr key={`${row.import_id}-${row.source_row}`}><td>{row.transaction_date}</td><td>{row.description}</td><td className="num">{money(row.credit)}</td><td>{row.matched_kind === "payment" && row.matched_id ? paymentLabel(row.matched_id) : row.matched_kind}</td></tr>
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
