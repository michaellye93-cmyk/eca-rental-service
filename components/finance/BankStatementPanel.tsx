import { formatCurrency } from "../../utils";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { FinanceInput } from "../../types/finance";
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
import { suggestPaymentMatches, unsolvedPayments, type PaymentSuggestion } from "../../services/finance/bankMatchSuggestions";

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
  const [accountLabel, setAccountLabel] = useState("");
  const [preview, setPreview] = useState<
    (BankStatementPreview & { source_hash?: string }) | null
  >(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | undefined>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<
    (BankReviewRow & { import_id: string; match_valid?: boolean }) | null
  >(null);
  const generation = useRef(0);
  // Payments already matched to a posted bank credit this month, and in the statement being reviewed
  const postedPaymentIds = useMemo(() => new Set((input?.bank_rows ?? []).filter((row) => row.decision === "MATCHED" && row.matched_kind === "payment" && row.matched_id && row.match_valid !== false).map((row) => row.matched_id as string)), [input]);
  const previewPaymentIds = useMemo(() => new Set((preview?.rows ?? []).filter((row) => row.decision === "MATCHED" && row.matched_kind === "payment" && row.matched_id).map((row) => row.matched_id as string)), [preview]);
  // Suggested matches for pending credits, ported from the retired Bank Recon screen
  const suggestions = useMemo(() => (preview && input ? suggestPaymentMatches(preview.rows, input.ehailing, new Set([...postedPaymentIds, ...previewPaymentIds]), paymentReferences) : new Map<number, PaymentSuggestion>()), [preview, input, postedPaymentIds, previewPaymentIds, paymentReferences]);
  const paymentLabel = (id: string) => {
    const payment = input?.ehailing.find((p) => p.source_payment_id === id);
    return payment ? `${payment.driver_name_snapshot ?? "Driver"} · ${payment.car_plate_snapshot ?? payment.plate_key ?? ""} · ${payment.payment_date} · ${money(payment.cash_amount)}` : id;
  };
  const applySuggestion = (suggestion: PaymentSuggestion) =>
    setPreview((current) => current ? { ...current, rows: current.rows.map((row) => row.source_row === suggestion.sourceRow ? { ...row, decision: "MATCHED", payment_source: null, category: null, plate_key: null, matched_kind: "payment", matched_id: suggestion.paymentId, review_note: `Suggested match: ${suggestion.reason}` } : row) } : current);
  // "Use all" takes only certain and strong matches; weak ones (loose name, wide date gap, cash deposits) wait for a look.
  const sureSuggestions = [...suggestions.values()].filter((suggestion) => suggestion.confidence !== "WEAK");
  const weakSuggestions = suggestions.size - sureSuggestions.length;
  const applyAllSuggestions = () => sureSuggestions.forEach((suggestion) => applySuggestion(suggestion));
  // After matching, the lines still waiting are usually money out (loans, payouts, bills already in Records) and money in
  // that is not a recorded driver payment (daily rental, transfers between own accounts). Exclude them in one step,
  // with a reason, so the statement can be posted; nothing becomes revenue or a new expense.
  const pendingRows = (side: "debit" | "credit") => (preview?.rows ?? []).filter((row) => row.decision === "PENDING" && (side === "debit" ? row.debit > 0 : row.credit > 0));
  const excludePending = (side: "debit" | "credit", note: string) =>
    setPreview((current) => current ? { ...current, rows: current.rows.map((row) => row.decision === "PENDING" && (side === "debit" ? row.debit > 0 : row.credit > 0) ? { ...row, decision: "EXCLUDED", payment_source: null, category: null, plate_key: null, matched_kind: null, matched_id: null, review_note: note } : row) } : current);
  // Prints only the reconciliation report (same approach as the termination report)
  const printReport = () => {
    document.body.classList.add("printing-reconcile-report");
    const cleanup = () => document.body.classList.remove("printing-reconcile-report");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    cleanup();
  };
  useEffect(() => {
    generation.current++;
    setPreview(null);
    setReviewing(null);
    setSourceFile(null);
    setHeaders([]);
    setMapping({});
    setAccountLabel("");
  }, [month, input?.month.revision]);
  const upload = async (file?: File, selectedMapping = mapping) => {
    if (!file || !input) return;
    const current = generation.current;
    setBusy(true);
    try {
      const original = await file.arrayBuffer();
      const originalHash = await sha256Buffer(original);
      setSourceFile(file);
      if (file.type.includes("pdf") || file.type.startsWith("image/")) {
        const extracted = await extractBankStatement(file);
        if (current !== generation.current) return;
        setPreview({
          rows: extracted.rows.map((row) => ({
            ...row,
            decision: "PENDING",
            payment_source: null,
            category: null,
            plate_key: null,
            matched_kind: null,
            matched_id: null,
            review_note: "",
          })),
          issues: [],
          total_debits: extracted.total_debits,
          total_credits: extracted.total_credits,
          filename: file.name,
          account_label: accountLabel,
          finance_month: month,
          source_hash: originalHash,
        });
      } else {
        const read = await readBankStatement(original, file.name);
        if (current !== generation.current) return;
        setHeaders(read.headers);
        const next = await previewBankStatement(
          original,
          file.name,
          month,
          input,
          selectedMapping,
        );
        if (current !== generation.current) return;
        setPreview({
          ...next,
          account_label: accountLabel || next.account_label,
        });
      }
    } catch (e) {
      if (current === generation.current)
        onError(
          e instanceof Error ? e.message : "Could not extract bank statement.",
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const update = (index: number, values: Partial<BankReviewRow>) =>
    setPreview((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row, i) =>
              i === index ? { ...row, ...values } : row,
            ),
          }
        : current,
    );
  const post = async () => {
    if (!preview || !input || input.month.status !== "DRAFT") return;
    const current = generation.current;
    setBusy(true);
    try {
      const issues = validateBankReview(preview.rows, month, input);
      if (issues.length)
        throw new Error(issues.map((issue) => issue.detail).join("; "));
      const hash = preview.source_hash;
      if (!hash)
        throw new Error(
          "Original bank file hash is unavailable; upload the statement again.",
        );
      const result = await postBankStatement(
        month,
        preview.filename,
        accountLabel.trim(),
        preview.rows,
        input.month.revision,
        hash,
      );
      if (current !== generation.current) return;
      onPosted(result, "Reviewed bank statement posted.");
      setPreview(null);
    } catch (e) {
      if (current === generation.current)
        onError(
          e instanceof Error
            ? e.message
            : "Bank statement could not be posted.",
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
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
  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold">Bank statement review</h2>
        <button type="button" onClick={printReport} disabled={!input} className="rounded border px-3 py-1.5 text-sm">Print reconciliation report</button>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Statements support reconciliation only. Credits never create Finance
        revenue.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="text-sm">
          Account label
          <input
            required
            value={accountLabel}
            onChange={(e) => setAccountLabel(e.target.value)}
            placeholder="e.g. Maybank operating"
            className="ml-2 rounded border p-2"
          />
        </label>
        <input
          disabled={disabled || busy}
          type="file"
          accept=".csv,.xlsx,.xls,.json,.pdf,image/*"
          onChange={(e) => void upload(e.target.files?.[0])}
          className="text-sm"
        />
      </div>
      {headers.length > 0 && sourceFile && (
        <div className="mt-3 rounded border bg-slate-50 p-3">
          <p className="text-xs text-slate-600">
            Map only the displayed Finance-safe columns when auto-detection
            needs correction.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {[
              "date",
              "description",
              "reference",
              "debit",
              "credit",
              "amount",
              "direction",
            ].map((field) => (
              <label className="text-xs" key={field}>
                {field}
                <select
                  value={mapping[field] ?? ""}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      [field]: e.target.value || undefined,
                    })
                  }
                  className="mt-1 w-full rounded border p-1"
                >
                  <option value="">Auto detect</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void upload(sourceFile, mapping)}
            className="mt-2 rounded border px-2 py-1 text-xs"
          >
            Apply mapping
          </button>
        </div>
      )}
      {preview && (
        <>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <span>
              Debits: <b>{money(preview.total_debits)}</b>
            </span>
            <span>
              Credits: <b>{money(preview.total_credits)}</b>
            </span>
            <span>{preview.rows.length} extracted rows</span>
          </div>
          {suggestions.size > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-emerald-900">
              {suggestions.size} suggested {suggestions.size === 1 ? "match" : "matches"}: {sureSuggestions.length} certain or strong, {weakSuggestions} weak. Weak ones need a look at the receipt before you use them.
              {sureSuggestions.length > 0 && <button type="button" onClick={applyAllSuggestions} disabled={disabled || busy} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold">Use all {sureSuggestions.length} certain and strong</button>}
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
                <button type="button" disabled={disabled || busy} onClick={() => excludePending("credit", "Money in that is not a recorded driver payment (daily rental, transfer between own accounts or other income)")} className="rounded border px-2 py-1 text-xs font-semibold">
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
            disabled={disabled || busy || !accountLabel.trim()}
            onClick={() => void post()}
            className="mt-3 rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Post reviewed statement
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
      <SystemUnsolved input={input} matchedIds={new Set([...postedPaymentIds, ...previewPaymentIds])} />
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
/** Cash payments recorded this month that no bank credit has been matched to yet (the old Bank Recon "System Unsolved"). */
function SystemUnsolved({ input, matchedIds }: { input: FinanceInput | null; matchedIds: Set<string> }) {
  const [cashDepositsOnly, setCashDepositsOnly] = useState(false);
  if (!input) return null;
  const all = unsolvedPayments(input.ehailing, matchedIds);
  const rows = cashDepositsOnly ? all.filter((p) => String(p.payment_method ?? "").toUpperCase() === "CASH DEPOSIT") : all;
  const total = rows.reduce((sum, p) => sum + p.cash_amount, 0);
  return (
    <section className="mt-4 rounded border p-3" aria-labelledby="system-unsolved-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="system-unsolved-heading" className="font-semibold">
          System unsolved: {rows.length} {rows.length === 1 ? "payment" : "payments"}, {money(total)}
        </h3>
        <label className="text-sm">
          <input type="checkbox" checked={cashDepositsOnly} onChange={(e) => setCashDepositsOnly(e.target.checked)} className="mr-1" />
          Cash deposits only
        </label>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Payments recorded in the app this month that no bank credit is matched to yet: still to be matched, not in the bank yet, or recorded by mistake.
      </p>
      {rows.length > 0 && (
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead><tr><th>Date</th><th>Driver</th><th>Plate</th><th>Method</th><th>Cash</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr className="border-t" key={p.source_payment_id}>
                  <td>{p.payment_date}</td>
                  <td>{p.driver_name_snapshot ?? "—"}</td>
                  <td>{p.car_plate_snapshot ?? p.plate_key ?? "—"}</td>
                  <td>{p.payment_method ?? "BANK TRANSFER"}</td>
                  <td>{money(p.cash_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
