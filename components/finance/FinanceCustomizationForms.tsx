import React, { useMemo, useRef, useState } from "react";
import type {
  BusinessUnit,
  FinanceExpense,
  FinanceVehicle,
  FixedCostTemplate,
  OtherIncome,
  WorkshopSummary,
} from "../../types/finance";
import Dialog from "./FinanceDialog";

const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

const monthStart = (month: string) => `${month.slice(0, 7)}-01`;
const nullable = (value: string) => value.trim() || null;
const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Unable to save this record.";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ "aria-label"?: string }>;
}) {
  return (
    <label className="finance-field">
      <span>{label}</span>
      {React.cloneElement(children, { "aria-label": label })}
    </label>
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

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="finance-message is-error" role="alert">
      {error}
    </p>
  ) : null;
}

function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return (
    <tr>
      <td colSpan={columns}>
        <p className="finance-empty">{text}</p>
      </td>
    </tr>
  );
}

type FixedCostAction = "ADD" | "UPDATE_FUTURE" | "DELETE";

export interface FixedOperatingCostsPanelProps {
  templates: FixedCostTemplate[];
  occurrences?: FinanceExpense[];
  month: string;
  disabled?: boolean;
  onSave: (
    action: FixedCostAction,
    record: Partial<FixedCostTemplate>,
  ) => Promise<boolean>;
  onExport?: () => void;
  onImport?: (file?: File) => void;
}

type FixedDraft = {
  category: string;
  monthly_amount: string;
  payee: string;
  note: string;
};

const fixedDraft = (month: string, row?: FixedCostTemplate, occurrence?: FinanceExpense): FixedDraft => ({
  category: occurrence?.category ?? row?.category ?? "",
  monthly_amount: occurrence ? String(occurrence.amount) : row ? String(row.monthly_amount) : "",
  payee: occurrence?.supplier ?? row?.payee ?? "",
  note: occurrence?.description ?? occurrence?.notes ?? row?.note ?? "",
});
const fixedDisplayName = (row: FixedCostTemplate) =>
  row.category === "Other Corporate Cost" &&
  row.monthly_amount === 1013 &&
  (/Business Module\.xlsx/i.test(row.source ?? "") || /statutory P&L treatment/i.test(row.note ?? ""))
    ? "Company Loan / Financing"
    : row.category;

export function FixedOperatingCostsPanel({
  templates,
  occurrences = [],
  month,
  disabled = false,
  onSave,
  onExport,
  onImport,
}: FixedOperatingCostsPanelProps) {
  const importRef = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<{
    row?: FixedCostTemplate;
    values: FixedDraft;
  } | null>(null);
  const [confirm, setConfirm] = useState<FixedCostTemplate | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const occurrenceByTemplate = new Map(
    occurrences
      .filter((row) => !row.cancelled_at && row.fixed_cost_template_id)
      .map((row) => [row.fixed_cost_template_id!, row]),
  );
  const selectedMonth = monthStart(month);
  const managedBySeries = new Map<string, FixedCostTemplate>();
  for (const row of templates.filter((template) => !template.cancelled_at)) {
    const hasOccurrence = occurrenceByTemplate.has(row.id);
    const isApplicable = row.effective_from <= selectedMonth && (!row.effective_until || row.effective_until >= selectedMonth);
    if (!hasOccurrence && !isApplicable) continue;
    const current = managedBySeries.get(row.series_id);
    const score = hasOccurrence ? 2 : 1;
    const currentScore = !current
      ? -1
      : occurrenceByTemplate.has(current.id) ? 2 : 1;
    if (!current || score > currentScore || (score === currentScore && row.version_no > current.version_no)) {
      managedBySeries.set(row.series_id, row);
    }
  }
  const managed = [...managedBySeries.values()];
  const selectedMonthRecurring = managed.reduce(
    (sum, row) => sum + (occurrenceByTemplate.get(row.id)?.amount ?? row.monthly_amount),
    0,
  );

  const openEditor = (row?: FixedCostTemplate) => {
    setError(null);
    setEditor({ row, values: fixedDraft(month, row) });
  };
  const run = async (work: () => Promise<boolean>, close: () => void) => {
    setPending(true);
    setError(null);
    try {
      if (await work()) close();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="finance-panel">
      <div className="finance-section-heading">
        <div>
          <h3>Operation Fix Cost</h3>
          <p>
            These monthly costs recur automatically. Changes apply from the selected
            open month forward; prior and closed months stay unchanged.
          </p>
          <strong>{money.format(selectedMonthRecurring)} monthly total</strong>
        </div>
        <div className="finance-dialog-actions">{onExport && <button type="button" className="finance-secondary" onClick={onExport}>Export Excel</button>}{onImport && <><input ref={importRef} className="finance-file-input" type="file" accept=".xlsx" disabled={disabled} onChange={(event) => { onImport(event.target.files?.[0]); event.target.value = ""; }} /><button type="button" className="finance-secondary" disabled={disabled} onClick={() => importRef.current?.click()}>Import Excel</button></>}<button
          type="button"
          className="finance-primary"
          disabled={disabled}
          onClick={() => openEditor()}
        >
          Add fixed cost
        </button></div>
      </div>
      <Table
        headers={[
          "Category",
          "Payee",
          "Amount",
          "Actions",
        ]}
      >
        {managed.length ? (
          managed.map((row) => {
            const occurrence = occurrenceByTemplate.get(row.id);
            const category = occurrence?.category ?? row.category;
            const payee = occurrence?.supplier ?? row.payee;
            const note = occurrence?.description ?? occurrence?.notes ?? row.note;
            return <tr key={row.id}>
              <td className="finance-strong">
                {fixedDisplayName({ ...row, category })}
                {note && <><br /><small>{note}</small></>}
              </td>
              <td>{payee ?? "—"}</td>
              <td>{money.format(occurrence?.amount ?? row.monthly_amount)}</td>
              <td>
                <div className="finance-dialog-actions">
                  <button
                    type="button"
                    className="finance-secondary"
                    disabled={disabled}
                    onClick={() => openEditor(row)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="finance-destructive"
                    disabled={disabled}
                    onClick={() => setConfirm(row)}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>;
          })
        ) : (
          <EmptyRow columns={4} text="No Operation Fix Cost entries have been set up." />
        )}
      </Table>

      {editor && (
        <Dialog
          title={editor.row ? "Edit Operation Fix Cost" : "Add Operation Fix Cost"}
          onClose={() => !pending && setEditor(null)}
        >
          <form
            className="finance-form"
            onSubmit={(event) => {
              event.preventDefault();
              const amount = Number(editor.values.monthly_amount);
              if (!editor.values.category.trim() || !(amount >= 0)) return;
              void run(
                () =>
                  onSave(editor.row ? "UPDATE_FUTURE" : "ADD", {
                    id: editor.row?.id,
                    category: editor.values.category.trim(),
                    monthly_amount: amount,
                    payee: nullable(editor.values.payee),
                    note: nullable(editor.values.note),
                  }),
                () => setEditor(null),
              );
            }}
          >
            <ErrorLine error={error} />
            <div className="finance-form-grid">
              <Field label="Category">
                <input
                  required
                  value={editor.values.category}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: { ...editor.values, category: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Monthly amount (RM)">
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={editor.values.monthly_amount}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: {
                        ...editor.values,
                        monthly_amount: event.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Payee">
                <input
                  value={editor.values.payee}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: { ...editor.values, payee: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Note">
                <input
                  value={editor.values.note}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: { ...editor.values, note: event.target.value },
                    })
                  }
                />
              </Field>
            </div>
            <div className="finance-dialog-actions">
              <button
                type="button"
                className="finance-secondary"
                disabled={pending}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className="finance-primary" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {confirm && (
        <Dialog
          title="Delete Operation Fix Cost"
          onClose={() => !pending && setConfirm(null)}
        >
          <p className="finance-dialog-copy">
            Delete {confirm.category} ({money.format(occurrenceByTemplate.get(confirm.id)?.amount ?? confirm.monthly_amount)} per month) from {month.slice(0, 7)} forward? Earlier and closed months remain unchanged.
          </p>
          <ErrorLine error={error} />
          <div className="finance-dialog-actions">
            <button
              type="button"
              className="finance-secondary"
              disabled={pending}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="finance-destructive"
              disabled={pending}
              onClick={() =>
                void run(
                  () => onSave("DELETE", { id: confirm.id }),
                  () => setConfirm(null),
                )
              }
            >
              {pending ? "Saving…" : "Delete cost"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

type OtherIncomeAction = "ADD" | "UPDATE" | "CANCEL";

export interface OtherIncomePanelProps {
  records: OtherIncome[];
  vehicles: FinanceVehicle[];
  month: string;
  disabled?: boolean;
  onSave: (
    action: OtherIncomeAction,
    record: Record<string, unknown>,
  ) => Promise<boolean>;
  onExport?: () => void;
}

type IncomeDraft = {
  status: "DRAFT" | "CONFIRMED";
  source_type: string;
  source_record_id: string;
  amount: string;
  description: string;
  plate_key: string;
  business_unit: BusinessUnit;
  receipt_date: string;
};

const incomeDraft = (row?: OtherIncome): IncomeDraft => ({
  status: row?.status ?? "DRAFT",
  source_type: row?.income_type ?? "",
  source_record_id: row?.reference ?? "",
  amount: row ? String(row.amount) : "",
  description: row?.notes ?? "",
  plate_key: row?.plate_key ?? "",
  business_unit: row?.business_unit ?? "E-HAILING",
  receipt_date: row?.receipt_date ?? "",
});

export function OtherIncomePanel({
  records,
  vehicles,
  month,
  disabled = false,
  onSave,
  onExport,
}: OtherIncomePanelProps) {
  const [editor, setEditor] = useState<{
    row?: OtherIncome;
    values: IncomeDraft;
  } | null>(null);
  const [deleting, setDeleting] = useState<OtherIncome | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = records.filter(
    (row) =>
      !row.cancelled_at && row.finance_month.slice(0, 7) === month.slice(0, 7),
  );
  const vehicleByPlate = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.plate_key, vehicle])),
    [vehicles],
  );
  const run = async (work: () => Promise<boolean>, close: () => void) => {
    setPending(true);
    setError(null);
    try {
      if (await work()) close();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const payload = (values: IncomeDraft, row?: OtherIncome) => {
    const vehicle = values.plate_key
      ? vehicleByPlate.get(values.plate_key)
      : undefined;
    return {
      id: row?.id,
      finance_month: monthStart(month),
      status: values.status,
      income_type: values.source_type.trim(),
      source_type: values.source_type.trim(),
      amount: Number(values.amount),
      plate_key: values.plate_key || null,
      business_unit: vehicle?.business_unit ?? values.business_unit,
      receipt_date: values.receipt_date || null,
      reference: nullable(values.source_record_id),
      source_record_id: nullable(values.source_record_id),
      notes: nullable(values.description),
      description: nullable(values.description),
      source: "Manual / Other Income",
    };
  };

  return (
    <section className="finance-panel">
      <div className="finance-section-heading">
        <div>
          <h3>Other Income</h3>
          <p>Record income outside the standard rental import for this month.</p>
          <strong>{money.format(current.reduce((sum, row) => sum + row.amount, 0))} recorded this month</strong>
        </div>
        <div className="finance-dialog-actions">{onExport && <button type="button" className="finance-secondary" onClick={onExport}>Export Excel</button>}<button
          type="button"
          className="finance-primary"
          disabled={disabled}
          onClick={() => {
            setError(null);
            setEditor({ values: incomeDraft() });
          }}
        >
          Add Other Income
        </button></div>
      </div>
      <Table
        headers={[
          "Source",
          "Description",
          "Vehicle / business",
          "Status",
          "Amount",
          "Actions",
        ]}
      >
        {current.length ? (
          current.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{row.income_type}</strong>
                <br />
                {row.reference ?? "—"}
              </td>
              <td>{row.notes ?? "—"}</td>
              <td>
                {row.plate_key
                  ? vehicleByPlate.get(row.plate_key)?.display_plate ?? row.plate_key
                  : row.business_unit}
              </td>
              <td>{row.status}</td>
              <td className="finance-strong">{money.format(row.amount)}</td>
              <td>
                <div className="finance-dialog-actions">
                  <button
                    type="button"
                    className="finance-secondary"
                    disabled={disabled}
                    onClick={() => {
                      setError(null);
                      setEditor({ row, values: incomeDraft(row) });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="finance-destructive"
                    disabled={disabled}
                    onClick={() => setDeleting(row)}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))
        ) : (
          <EmptyRow columns={6} text="No Other Income has been recorded for this month." />
        )}
      </Table>

      {editor && (
        <Dialog
          title={editor.row ? "Edit Other Income" : "Add Other Income"}
          onClose={() => !pending && setEditor(null)}
        >
          <form
            className="finance-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !editor.values.source_type.trim() ||
                !(Number(editor.values.amount) > 0)
              )
                return;
              void run(
                () =>
                  onSave(
                    editor.row ? "UPDATE" : "ADD",
                    payload(editor.values, editor.row),
                  ),
                () => setEditor(null),
              );
            }}
          >
            <ErrorLine error={error} />
            <div className="finance-form-grid">
              <Field label="Source type">
                <input
                  required
                  value={editor.values.source_type}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: {
                        ...editor.values,
                        source_type: event.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Source record ID">
                <input
                  value={editor.values.source_record_id}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: {
                        ...editor.values,
                        source_record_id: event.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Amount (RM)">
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={editor.values.amount}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: { ...editor.values, amount: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Receipt date">
                <input
                  type="date"
                  value={editor.values.receipt_date}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: {
                        ...editor.values,
                        receipt_date: event.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Vehicle">
                <select
                  value={editor.values.plate_key}
                  disabled={pending}
                  onChange={(event) => {
                    const vehicle = vehicleByPlate.get(event.target.value);
                    setEditor({
                      ...editor,
                      values: {
                        ...editor.values,
                        plate_key: event.target.value,
                        business_unit:
                          vehicle?.business_unit ?? editor.values.business_unit,
                      },
                    });
                  }}
                >
                  <option value="">No vehicle</option>
                  {vehicles
                    .filter((vehicle) => !vehicle.deleted_at)
                    .map((vehicle) => (
                      <option key={vehicle.plate_key} value={vehicle.plate_key}>
                        {vehicle.display_plate}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Business unit">
                <select
                  value={editor.values.business_unit}
                  disabled={pending || Boolean(editor.values.plate_key)}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: {
                        ...editor.values,
                        business_unit: event.target.value as BusinessUnit,
                      },
                    })
                  }
                >
                  {[
                    "E-HAILING",
                    "DAILY RENTAL",
                    "SMART DRIVE",
                    "SAMBUNG BAYAR",
                  ].map((business) => (
                    <option key={business}>{business}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={editor.values.status}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: {
                        ...editor.values,
                        status: event.target.value as "DRAFT" | "CONFIRMED",
                      },
                    })
                  }
                >
                  <option value="DRAFT">Draft</option>
                  <option value="CONFIRMED">Confirmed</option>
                </select>
              </Field>
              <Field label="Description">
                <input
                  value={editor.values.description}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: {
                        ...editor.values,
                        description: event.target.value,
                      },
                    })
                  }
                />
              </Field>
            </div>
            {editor.values.plate_key && (
              <p className="finance-muted-action">
                Business unit is derived from the selected vehicle:{" "}
                {vehicleByPlate.get(editor.values.plate_key)?.business_unit ?? "Unknown"}.
              </p>
            )}
            <div className="finance-dialog-actions">
              <button
                type="button"
                className="finance-secondary"
                disabled={pending}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className="finance-primary" disabled={pending}>
                {pending ? "Saving…" : "Save Other Income"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {deleting && (
        <Dialog title="Delete Other Income" onClose={() => setDeleting(null)}>
          <p className="finance-dialog-copy">
            Delete {deleting.income_type} for {money.format(deleting.amount)} from {deleting.finance_month.slice(0, 7)}?
          </p>
          <ErrorLine error={error} />
          <div className="finance-dialog-actions">
            <button
              type="button"
              className="finance-secondary"
              disabled={pending}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="finance-destructive"
              disabled={pending}
              onClick={() =>
                void run(
                  () =>
                    onSave("CANCEL", {
                      id: deleting.id,
                      finance_month: deleting.finance_month,
                      reason: "Deleted from Other Income",
                    }),
                  () => setDeleting(null),
                )
              }
            >
              {pending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

type WorkshopAction = "ADD" | "UPDATE" | "CANCEL";

export interface WorkshopAllocationView {
  summary_id: string;
  expense_id: string;
}

export interface WorkshopSummaryPanelProps {
  summaries: WorkshopSummary[];
  expenses: FinanceExpense[];
  vehicles: FinanceVehicle[];
  allocations?: WorkshopAllocationView[];
  month: string;
  disabled?: boolean;
  onSave: (
    action: WorkshopAction,
    record: Record<string, unknown>,
  ) => Promise<boolean>;
  onLink: (summaryId: string, expenseId: string) => Promise<boolean>;
}

type SummaryDraft = {
  business_unit: BusinessUnit | "";
  amount: string;
  supplier: string;
  reference: string;
  note: string;
  reason: string;
};

const summaryDraft = (row?: WorkshopSummary): SummaryDraft => ({
  business_unit: row?.business_unit ?? "",
  amount: row ? String(row.amount) : "",
  supplier: row?.supplier ?? "",
  reference: row?.reference ?? "",
  note: row?.note ?? "",
  reason: "",
});

export function WorkshopSummaryPanel({
  summaries,
  expenses,
  vehicles,
  allocations = [],
  month,
  disabled = false,
  onSave,
  onLink,
}: WorkshopSummaryPanelProps) {
  const [mode, setMode] = useState<"vehicle" | "summary">("vehicle");
  const [editor, setEditor] = useState<{
    row?: WorkshopSummary;
    values: SummaryDraft;
  } | null>(null);
  const [deleting, setDeleting] = useState<WorkshopSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<Record<string, string>>(
    {},
  );
  const activeSummaries = summaries.filter(
    (row) =>
      !row.cancelled_at && row.finance_month.slice(0, 7) === month.slice(0, 7),
  );
  const workshopExpenses = expenses.filter(
    (row) =>
      !row.cancelled_at &&
      row.payment_source === "Workshop Billing" &&
      row.finance_month.slice(0, 7) === month.slice(0, 7),
  );
  const vehicleByPlate = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.plate_key, vehicle])),
    [vehicles],
  );
  const allocatedExpenseIds = new Set(
    allocations.map((allocation) => allocation.expense_id),
  );
  const run = async (work: () => Promise<boolean>, close?: () => void) => {
    setPending(true);
    setError(null);
    try {
      if (await work()) close?.();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="finance-panel">
      <div className="finance-section-heading">
        <div>
          <h3>Workshop Billing</h3>
          <p>Review vehicle entries or reconcile them to a monthly total.</p>
        </div>
        {mode === "summary" && (
          <button
            type="button"
            className="finance-primary"
            disabled={disabled}
            onClick={() => {
              setError(null);
              setEditor({ values: summaryDraft() });
            }}
          >
            Add monthly total
          </button>
        )}
      </div>
      <div className="finance-tabs" role="tablist" aria-label="Workshop entry mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "vehicle"}
          className={mode === "vehicle" ? "is-active" : ""}
          onClick={() => setMode("vehicle")}
        >
          By vehicle
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "summary"}
          className={mode === "summary" ? "is-active" : ""}
          onClick={() => setMode("summary")}
        >
          Monthly total
        </button>
      </div>
      <ErrorLine error={error} />

      {mode === "vehicle" ? (
        <Table
          headers={[
            "Date",
            "Vehicle",
            "Supplier",
            "Reference",
            "Amount",
            "Allocation",
          ]}
        >
          {workshopExpenses.length ? (
            workshopExpenses.map((row) => (
              <tr key={row.id}>
                <td>{row.billing_date ?? "—"}</td>
                <td>
                  {row.plate_key
                    ? vehicleByPlate.get(row.plate_key)?.display_plate ??
                      row.plate_key
                    : "Unmatched"}
                </td>
                <td>{row.supplier ?? "—"}</td>
                <td>{row.reference ?? "—"}</td>
                <td className="finance-strong">{money.format(row.amount)}</td>
                <td>
                  {row.id && allocatedExpenseIds.has(row.id)
                    ? "Linked to monthly total"
                    : "Not linked"}
                </td>
              </tr>
            ))
          ) : (
            <EmptyRow columns={6} text="No vehicle workshop entries for this month." />
          )}
        </Table>
      ) : (
        <Table
          headers={[
            "Scope",
            "Supplier / reference",
            "Total",
            "Allocated",
            "Unallocated",
            "Link vehicle entry",
            "Actions",
          ]}
        >
          {activeSummaries.length ? (
            activeSummaries.map((row) => {
              const candidates = workshopExpenses.filter((expense) => {
                if (!expense.id || allocatedExpenseIds.has(expense.id)) return false;
                if (!row.business_unit) return true;
                return (
                  (expense.plate_key &&
                    vehicleByPlate.get(expense.plate_key)?.business_unit) ===
                  row.business_unit
                );
              });
              return (
                <tr key={row.id}>
                  <td>{row.business_unit ?? "Unallocated fleet maintenance"}</td>
                  <td>
                    {row.supplier ?? "—"}
                    <br />
                    {row.reference ?? "—"}
                  </td>
                  <td>{money.format(row.amount)}</td>
                  <td>{money.format(row.allocated_amount)}</td>
                  <td className="finance-strong">
                    {money.format(row.unallocated_amount)}
                  </td>
                  <td>
                    <div className="finance-dialog-actions">
                      <select
                        aria-label={`Vehicle entry for ${row.reference ?? row.id}`}
                        disabled={disabled || pending || !candidates.length}
                        value={selectedExpense[row.id] ?? ""}
                        onChange={(event) =>
                          setSelectedExpense({
                            ...selectedExpense,
                            [row.id]: event.target.value,
                          })
                        }
                      >
                        <option value="">Select entry</option>
                        {candidates.map((expense) => (
                          <option key={expense.id} value={expense.id}>
                            {expense.plate_key
                              ? vehicleByPlate.get(expense.plate_key)?.display_plate ??
                                expense.plate_key
                              : "Unmatched"}{" "}
                            · {money.format(expense.amount)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="finance-secondary"
                        disabled={
                          disabled || pending || !selectedExpense[row.id]
                        }
                        onClick={() =>
                          void run(async () => {
                            const expenseId = selectedExpense[row.id];
                            if (!expenseId) return false;
                            const saved = await onLink(row.id, expenseId);
                            if (saved)
                              setSelectedExpense((current) => ({
                                ...current,
                                [row.id]: "",
                              }));
                            return saved;
                          })
                        }
                      >
                        Link
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="finance-dialog-actions">
                      <button
                        type="button"
                        className="finance-secondary"
                        disabled={disabled}
                        onClick={() => {
                          setError(null);
                          setEditor({ row, values: summaryDraft(row) });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="finance-destructive"
                        disabled={disabled || row.allocated_amount > 0}
                        title={
                          row.allocated_amount > 0
                            ? "Reassign linked vehicle entries before deleting"
                            : undefined
                        }
                        onClick={() => setDeleting(row)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <EmptyRow columns={7} text="No monthly workshop total has been entered." />
          )}
        </Table>
      )}

      {editor && (
        <Dialog
          title={editor.row ? "Edit monthly workshop total" : "Add monthly workshop total"}
          onClose={() => !pending && setEditor(null)}
        >
          <form
            className="finance-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!(Number(editor.values.amount) >= 0)) return;
              void run(
                () =>
                  onSave(editor.row ? "UPDATE" : "ADD", {
                    id: editor.row?.id,
                    finance_month: monthStart(month),
                    business_unit: editor.values.business_unit || null,
                    amount: Number(editor.values.amount),
                    supplier: nullable(editor.values.supplier),
                    reference: nullable(editor.values.reference),
                    note: nullable(editor.values.note),
                    reason: nullable(editor.values.reason),
                  }),
                () => setEditor(null),
              );
            }}
          >
            <ErrorLine error={error} />
            <div className="finance-form-grid">
              <Field label="Business unit">
                <select
                  value={editor.values.business_unit}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: {
                        ...editor.values,
                        business_unit: event.target.value as BusinessUnit | "",
                      },
                    })
                  }
                >
                  <option value="">Unallocated fleet maintenance</option>
                  {[
                    "E-HAILING",
                    "DAILY RENTAL",
                    "SMART DRIVE",
                    "SAMBUNG BAYAR",
                  ].map((business) => (
                    <option key={business}>{business}</option>
                  ))}
                </select>
              </Field>
              <Field label="Monthly total (RM)">
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={editor.values.amount}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: { ...editor.values, amount: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Supplier">
                <input
                  value={editor.values.supplier}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: { ...editor.values, supplier: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Reference">
                <input
                  value={editor.values.reference}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: { ...editor.values, reference: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Note">
                <input
                  value={editor.values.note}
                  disabled={pending}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      values: { ...editor.values, note: event.target.value },
                    })
                  }
                />
              </Field>
              {editor.row && Number(editor.values.amount) !== editor.row.amount && (
                <Field label="Correction reason">
                  <input required value={editor.values.reason} disabled={pending} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, reason: event.target.value } })} />
                </Field>
              )}
            </div>
            <div className="finance-dialog-actions">
              <button
                type="button"
                className="finance-secondary"
                disabled={pending}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className="finance-primary" disabled={pending}>
                {pending ? "Saving…" : "Save monthly total"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {deleting && (
        <Dialog
          title="Delete monthly workshop total"
          onClose={() => !pending && setDeleting(null)}
        >
          <p className="finance-dialog-copy">
            Delete this {money.format(deleting.amount)} monthly total for {deleting.finance_month.slice(0, 7)}? Vehicle
            workshop entries remain unchanged.
          </p>
          <ErrorLine error={error} />
          <div className="finance-dialog-actions">
            <button
              type="button"
              className="finance-secondary"
              disabled={pending}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="finance-destructive"
              disabled={pending}
              onClick={() =>
                void run(
                  () =>
                    onSave("CANCEL", {
                      id: deleting.id,
                      finance_month: deleting.finance_month,
                      reason: "Deleted from Workshop Billing",
                    }),
                  () => setDeleting(null),
                )
              }
            >
              {pending ? "Deleting…" : "Delete total"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
