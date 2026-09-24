import React, { useEffect, useRef, useState } from "react";
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
const money = (n: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(
    n || 0,
  );

export default function BankStatementPanel({
  month,
  input,
  disabled,
  onPosted,
  onError,
}: {
  month: string;
  input: FinanceInput | null;
  disabled: boolean;
  onPosted: (next: FinanceInput, message: string) => void;
  onError: (message: string) => void;
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
      <h2 className="font-semibold">Bank statement review</h2>
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
                {preview.rows.map((row, index) => (
                  <ReviewRow
                    key={`${row.source_row}-${row.reference ?? ""}`}
                    row={row}
                    input={input}
                    onChange={(values) => update(index, values)}
                  />
                ))}
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
}: {
  key?: React.Key;
  row: BankReviewRow;
  input: FinanceInput | null;
  onChange: (v: Partial<BankReviewRow>) => void;
  restrict?: boolean;
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
    input.ehailing
      .filter(
        (payment) =>
          payment.finance_month.slice(0, 7) === month &&
          payment.payment_date === row.transaction_date &&
          same(payment.cash_amount),
      )
      .forEach((payment) =>
        candidates.push({
          kind: "payment",
          id: payment.source_payment_id,
          label: `E-hailing ${payment.driver_name_snapshot ?? payment.driver_id ?? "driver"} · ${payment.payment_date} · ${money(payment.cash_amount)}`,
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
