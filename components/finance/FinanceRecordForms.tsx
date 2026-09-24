import { formatCurrency } from "../../utils";
import React, { useEffect, useMemo, useRef, useState } from "react";
import FinanceDialog from "./FinanceDialog";
import { insuranceProblems, insuranceStatus, insuranceCashOutflow, ownerPremiumReview, validInsuranceDate } from "../../services/finance/insurance";
import type {
  BusinessUnit,
  FinanceExpense,
  FinanceInput,
  FinanceVehicle,
  Insurance,
  InsuranceResponsibility,
  RecurringCost,
} from "../../types/finance";
import {
  allocateInsurance,
  normalizePlate,
} from "../../services/finance/calculations";

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
const recurringCategories = [
  "Owner Payout",
  "Hire Purchase / Loan",
  "Consignment Owner Payout",
  "Sambung Bayar",
  "Other recurring vehicle costs",
];
const businessUnits: BusinessUnit[] = [
  "E-HAILING",
  "DAILY RENTAL",
  "SMART DRIVE",
  "SAMBUNG BAYAR",
];
const normalStatuses = ["Active", "Inactive"];

type ExpenseProps = {
  input: FinanceInput;
  month: string;
  source: FinanceExpense["payment_source"];
  disabled: boolean;
  onSave: (record: FinanceExpense) => Promise<boolean>;
  onCancel?: (record: FinanceExpense, reason: string) => Promise<boolean>;
  initialId?: string;
};
type MasterProps = {
  input: FinanceInput;
  month: string;
  disabled: boolean;
  onSave: (
    kind: "vehicle" | "recurring_cost" | "insurance",
    record: object,
  ) => Promise<boolean>;
  initialId?: string;
  onCancel?: (kind: "recurring_cost" | "insurance", record: object, reason: string) => Promise<boolean>;
};
type ExpenseValues = {
  plate_key: string;
  billing_date: string;
  category: string;
  amount: string;
  supplier: string;
  reference: string;
  description: string;
  frequency: "MONTHLY_RECURRING" | "MONTHLY_SUMMARY" | "ONE_OFF";
  start_month: string;
  end_month: string;
  source: string;
  notes: string;
};
type VehicleValues = {
  display_plate: string;
  model: string;
  business_unit: BusinessUnit;
  ownership_type: string;
  status: string;
};
type CostValues = {
  plate_key: string;
  cost_type: string;
  monthly_amount: string;
  start_month: string;
  end_month: string;
  payee: string;
  notes: string;
};
type PolicyValues = {
  responsibility: InsuranceResponsibility | "";
  plate_key: string;
  premium: string;
  coverage_start: string;
  coverage_end: string;
  payment_date: string;
  supplier: string;
  reference: string;
  source: string;
};

const monthStart = (month: string) => `${month.slice(0, 7)}-01`;
const monthEnd = (month: string) => {
  const [year, numericMonth] = month.slice(0, 7).split("-").map(Number);
  return `${month.slice(0, 7)}-${String(new Date(year, numericMonth, 0).getDate()).padStart(2, "0")}`;
};
const asMonth = (value: string | null | undefined) => value?.slice(0, 7) ?? "";
const nullable = (value: string) => value.trim() || null;
const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="finance-field">
    <span>{label}</span>
    {React.Children.map(children, (child) =>
      React.isValidElement<{ "aria-label"?: string }>(child)
        ? React.cloneElement(child, { "aria-label": label })
        : child,
    )}
  </label>
);
const ErrorLine = ({ error }: { error: string | null }) =>
  error ? (
    <p className="finance-message is-error" role="alert">
      {error}
    </p>
  ) : null;
const Pending = ({ pending }: { pending: boolean }) =>
  pending ? (
    <p className="finance-muted-action" aria-live="polite">
      Saving…
    </p>
  ) : null;
const recordKey = (record: unknown, fallback: string) =>
  (record as { id?: string }).id ?? fallback;

function failureMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "Unable to save this record.";
}

export function ExpenseForm({
  input,
  month,
  source,
  disabled,
  onSave,
  onCancel,
  initialId,
}: ExpenseProps) {
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<ExpenseValues>(() =>
    blankExpense(month),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const isCorporate = source === "Corporate Opex";
  const categories =
    source === "Corporate Opex"
      ? corporateCategories
      : source === "Workshop Billing"
        ? ["Service & Maintenance"]
        : vehicleCategories;
  const records = useMemo(
    () =>
      input.expenses.filter(
        (record) =>
          record.payment_source === source &&
          record.finance_month.slice(0, 7) === month.slice(0, 7),
      ),
    [input.expenses, month, source],
  );

  useEffect(() => {
    generation.current++;
    const record = input.expenses.find((item) => item.id === initialId && item.payment_source === source);
    setSelected(record?.id ?? "");
    setValues(record ? expenseValues(record) : blankExpense(month));
    setError(null);
  }, [month, source, initialId, input.expenses]);
  const choose = (id: string) => {
    setSelected(id);
    setError(null);
    const record = records.find(
      (item, index) => recordKey(item, `expense-${index}`) === id,
    );
    setValues(record ? expenseValues(record) : blankExpense(month));
  };
  const recurring = records.find((item, index) => recordKey(item, `expense-${index}`) === selected);
  const isRecurring = isCorporate && values.frequency === "MONTHLY_RECURRING";
  const isMonthlySummary = !isCorporate && values.frequency === "MONTHLY_SUMMARY";
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !values.category ||
      !values.amount ||
      (!isCorporate && !values.plate_key)
    )
      return;
    const original = records.find(
      (item, index) => recordKey(item, `expense-${index}`) === selected,
    );
    const record: FinanceExpense = {
      ...original,
      id: original?.id,
      finance_month: monthStart(month),
      billing_date: isRecurring || isMonthlySummary ? null : values.billing_date || null,
      plate_key: isCorporate ? null : values.plate_key,
      category: values.category,
      payment_source: source,
      supplier: nullable(values.supplier),
      amount: Number(values.amount),
      reference: nullable(values.reference),
      description: nullable(values.description),
      frequency: values.frequency,
      start_month: isRecurring ? monthStart(values.start_month || month) : isMonthlySummary ? monthStart(month) : null,
      end_month: isRecurring && values.end_month ? monthStart(values.end_month) : isMonthlySummary ? monthStart(month) : null,
      source: nullable(values.source),
      notes: nullable(values.notes),
    };
    const current = generation.current;
    setPending(true);
    setError(null);
    try {
      const saved = await onSave(record);
      if (current === generation.current && saved) {
        setSelected("");
        setValues(blankExpense(month));
      }
    } catch (cause) {
      if (current === generation.current) setError(failureMessage(cause));
    } finally {
      if (current === generation.current) setPending(false);
    }
  };
  const locked = disabled || pending;
  return (
    <form className="finance-form" onSubmit={save}>
      <Field label="Existing record">
        <select
          value={selected}
          disabled={locked}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">New expense…</option>
          {records.map((record, index) => (
            <option
              key={recordKey(record, `expense-${index}`)}
              value={recordKey(record, `expense-${index}`)}
            >
              {record.billing_date ?? "Monthly recurring"} · {record.category} ·{" "}
              {formatCurrency(record.amount)}
            </option>
          ))}
        </select>
      </Field>
      {isRecurring && <p className="finance-muted-action">Monthly recurring · {recurring?.start_month?.slice(0, 7) ?? values.start_month} to {(recurring?.end_month?.slice(0, 7) ?? values.end_month) || "ongoing"}. Expense Date is optional.</p>}
      <div className="finance-form-grid">
        <Field label={isCorporate ? "Frequency" : "Entry basis"}>
          <select value={values.frequency} disabled={locked} onChange={(event) => setValues({ ...values, frequency: event.target.value as ExpenseValues["frequency"] })}>
            <option value="ONE_OFF">One-off with actual date</option>{isCorporate ? <option value="MONTHLY_RECURRING">Monthly recurring</option> : <option value="MONTHLY_SUMMARY">Monthly vehicle total (no exact date)</option>}
          </select>
        </Field>
        {!isCorporate && (
          <Field label="Vehicle">
            <select
              required
              value={values.plate_key}
              disabled={locked}
              onChange={(event) =>
                setValues({ ...values, plate_key: event.target.value })
              }
            >
              <option value="">Select vehicle</option>
              {input.vehicles.map((vehicle) => (
                <option key={vehicle.plate_key} value={vehicle.plate_key}>
                  {vehicle.display_plate}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!isMonthlySummary && <Field label={isRecurring ? "Expense Date (optional)" : "Actual date"}>
          <input
            required={!isRecurring}
            type="date"
            min={isRecurring ? undefined : monthStart(month)}
            max={isRecurring ? undefined : monthEnd(month)}
            value={values.billing_date}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, billing_date: event.target.value })
            }
          />
        </Field>}
        <Field label="Category">
          <select
            required
            value={values.category}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, category: event.target.value })
            }
          >
            <option value="">Select category</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <input
            required
            min="0"
            step="0.01"
            type="number"
            value={values.amount}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, amount: event.target.value })
            }
          />
        </Field>
        <Field label="Supplier">
          <input
            value={values.supplier}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, supplier: event.target.value })
            }
          />
        </Field>
        {isRecurring && <><Field label="Start month"><input required type="month" value={values.start_month} disabled={locked} onChange={(event) => setValues({ ...values, start_month: event.target.value })} /></Field><Field label="End month (optional)"><input type="month" value={values.end_month} disabled={locked} onChange={(event) => setValues({ ...values, end_month: event.target.value })} /></Field></>}
        <Field label="Source (optional)"><input value={values.source} disabled={locked} onChange={(event) => setValues({ ...values, source: event.target.value })} /></Field>
        <Field label="Reference (optional)">
          <input
            value={values.reference}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, reference: event.target.value })
            }
          />
        </Field>
      </div>
      <Field label="Note (optional)">
        <input
          value={values.description}
          disabled={locked}
          onChange={(event) =>
            setValues({ ...values, description: event.target.value })
          }
        />
      </Field>
      <Field label="Internal notes (optional)"><input value={values.notes} disabled={locked} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></Field>
      <ErrorLine error={error} />
      <Pending pending={pending} />
      <button className="finance-primary" disabled={locked}>
        {selected ? "Save changes" : "Save expense"}
      </button>
      {recurring && onCancel && <button type="button" className="finance-destructive" disabled={locked} onClick={() => { if (!window.confirm(`Delete ${recurring.category} for ${formatCurrency(recurring.amount)} from ${recurring.finance_month.slice(0, 7)} open calculations? Closed snapshots and audit history remain unchanged.`)) return; const reason = window.prompt("Reason for deleting this expense"); if (reason?.trim()) void onCancel(recurring, reason.trim()); }}>Delete expense</button>}
    </form>
  );
}

export function VehicleForm({ input, month, disabled, onSave, onDelete, initialId }: MasterProps & {
  onDelete: (vehicle: FinanceVehicle) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<VehicleValues>(blankVehicle);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [plateCorrectionReason, setPlateCorrectionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    const vehicle = input.vehicles.find((item) => item.vehicle_id === initialId || item.plate_key === initialId);
    setSelected(vehicle?.plate_key ?? "");
    setValues(vehicle ? vehicleValues(vehicle) : blankVehicle());
    setError(null);
    setPending(false);
    setConfirmDelete(false);
    setPlateCorrectionReason("");
  }, [month, initialId, input.vehicles]);
  const vehicles = input.vehicles.filter((vehicle) => !vehicle.deleted_at);
  const original = vehicles.find(
    (vehicle) => vehicle.plate_key === selected,
  );
  const statusChoices =
    original && !normalStatuses.includes(original.status)
      ? [...normalStatuses, original.status]
      : normalStatuses;
  const choose = (key: string) => {
    setSelected(key);
    setError(null);
    const vehicle = vehicles.find(
      (item) => item.plate_key === key,
    );
    setValues(vehicle ? vehicleValues(vehicle) : blankVehicle());
    setPlateCorrectionReason("");
  };
  const correctedPlate = normalizePlate(values.display_plate);
  const isPlateCorrection = Boolean(
    original && correctedPlate !== original.plate_key,
  );
  const linkedCount = original
    ? input.recurring_costs.filter((row) => row.plate_key === original.plate_key).length +
      input.insurance.filter((row) => row.plate_key === original.plate_key).length +
      input.expenses.filter((row) => row.plate_key === original.plate_key).length +
      (input.other_income ?? []).filter((row) => row.plate_key === original.plate_key).length
    : 0;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.display_plate.trim()) return;
    if (isPlateCorrection && !plateCorrectionReason.trim()) {
      setError("Enter a reason to confirm this plate correction.");
      return;
    }
    const current = generation.current;
    setPending(true);
    setError(null);
    const record = {
      ...original,
      display_plate: values.display_plate.trim(),
      plate_key: correctedPlate,
      old_plate: isPlateCorrection ? original?.plate_key : undefined,
      correction_reason: isPlateCorrection ? plateCorrectionReason.trim() : null,
      model: nullable(values.model),
      business_unit: values.business_unit,
      ownership_type: values.ownership_type.trim(),
      status: values.status,
    };
    try {
      const saved = await onSave("vehicle", record);
      if (current === generation.current && saved) {
        setSelected("");
        setValues(blankVehicle());
      }
    } catch (cause) {
      if (current === generation.current) setError(failureMessage(cause));
    } finally {
      if (current === generation.current) setPending(false);
    }
  };
  const remove = async () => {
    if (disabled || pending || !original) return;
    const current = generation.current;
    setPending(true);
    setError(null);
    try {
      const deleted = await onDelete(original);
      if (current === generation.current) {
        if (deleted) {
          setConfirmDelete(false);
          setSelected("");
          setValues(blankVehicle());
        } else {
          setError("Vehicle was not deleted. Close this confirmation to review the error, then try again.");
        }
      }
    } catch (cause) {
      if (current === generation.current) setError(failureMessage(cause));
    } finally {
      if (current === generation.current) setPending(false);
    }
  };
  const locked = disabled || pending;
  return (
    <>
    <form className="finance-form" onSubmit={save}>
      <Field label="Existing record">
        <select
          value={selected}
          disabled={locked}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">New vehicle…</option>
          {vehicles.map((vehicle) => (
            <option
              key={vehicle.plate_key}
              value={vehicle.plate_key}
            >
              {vehicle.display_plate}
            </option>
          ))}
        </select>
      </Field>
      <div className="finance-form-grid">
        <Field label="Car plate">
          <input
            required
            value={values.display_plate}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, display_plate: event.target.value })
            }
          />
        </Field>
        <Field label="Business unit">
          <select
            value={values.business_unit}
            disabled={locked}
            onChange={(event) =>
              setValues({
                ...values,
                business_unit: event.target.value as BusinessUnit,
              })
            }
          >
            {businessUnits.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vehicle model (optional)">
          <input value={values.model} disabled={locked} onChange={(event) => setValues({ ...values, model: event.target.value })} />
        </Field>
        <Field label="Ownership type">
          <input
            required
            value={values.ownership_type}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, ownership_type: event.target.value })
            }
          />
        </Field>
        <Field label="Status">
          <select
            value={values.status}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, status: event.target.value })
            }
          >
            {statusChoices.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {isPlateCorrection && original && (
        <section className="finance-message is-warning" aria-label="Plate correction confirmation">
          <p>
            Correct <strong>{original.display_plate}</strong> to <strong>{values.display_plate.trim()}</strong>. This updates {linkedCount} linked Finance record(s) and preserves the old plate as an alias. Operational driver and payment data are not changed.
          </p>
          <Field label="Plate correction reason">
            <textarea
              required
              value={plateCorrectionReason}
              disabled={locked}
              onChange={(event) => setPlateCorrectionReason(event.target.value)}
            />
          </Field>
        </section>
      )}
      <ErrorLine error={error} />
      <Pending pending={pending} />
      <button className="finance-primary" disabled={locked}>
        {isPlateCorrection ? "Confirm plate correction" : selected ? "Save changes" : "Save vehicle"}
      </button>
      {original && (
        <button type="button" className="finance-destructive" disabled={locked}
          onClick={() => { setError(null); setConfirmDelete(true); }}>
          Delete vehicle
        </button>
      )}
    </form>
    {confirmDelete && original && (
      <FinanceDialog title={`Delete ${original.display_plate}?`}
        onClose={() => { if (!pending) setConfirmDelete(false); }}>
        <p className="finance-dialog-copy">This removes {original.display_plate} from the current Vehicle Master list. Past revenue, expenses and closed reports are retained.</p>
        <p className="finance-dialog-copy">Monthly costs continue until you end them under <strong>Monthly Vehicle Costs</strong>. Deleting a vehicle does not end its costs.</p>
        <ErrorLine error={error} />
        <div className="finance-dialog-actions">
          <button type="button" className="finance-secondary" disabled={pending} onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button type="button" className="finance-destructive" disabled={locked} onClick={remove}>
            {pending ? "Deleting…" : "Delete vehicle"}
          </button>
        </div>
      </FinanceDialog>
    )}
    </>
  );
}

export function RecurringForm({ input, month, disabled, onSave, initialId, onCancel }: MasterProps) {
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<CostValues>(() => blankCost(month));
  const [ending, setEnding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    const cost = input.recurring_costs.find((item) => item.id === initialId);
    setSelected(cost?.id ?? "");
    setValues(cost ? costValues(cost) : blankCost(month));
    setEnding(false);
    setError(null);
  }, [month, initialId, input.recurring_costs]);
  const original = input.recurring_costs.find(
    (cost, index) => recordKey(cost, `cost-${index}`) === selected,
  );
  const choose = (key: string) => {
    setSelected(key);
    setError(null);
    setEnding(false);
    const cost = input.recurring_costs.find(
      (item, index) => recordKey(item, `cost-${index}`) === key,
    );
    setValues(cost ? costValues(cost) : blankCost(month));
  };
  const persist = async (endOnly = false) => {
    if (
      !values.plate_key ||
      !values.cost_type ||
      !values.monthly_amount ||
      (endOnly && !values.end_month)
    )
      return;
    const current = generation.current;
    setPending(true);
    setError(null);
    const record = {
      ...original,
      id: original?.id,
      plate_key: values.plate_key,
      cost_type: values.cost_type,
      monthly_amount: Number(values.monthly_amount),
      start_month: values.start_month,
      end_month: values.end_month || null,
      payee: nullable(values.payee),
      notes: nullable(values.notes),
    };
    try {
      const saved = await onSave("recurring_cost", record);
      if (current === generation.current && saved) {
        setSelected("");
        setValues(blankCost(month));
        setEnding(false);
      }
    } catch (cause) {
      if (current === generation.current) setError(failureMessage(cause));
    } finally {
      if (current === generation.current) setPending(false);
    }
  };
  const locked = disabled || pending;
  return (
    <form
      className="finance-form"
      onSubmit={(event) => {
        event.preventDefault();
        void persist();
      }}
    >
      <Field label="Existing record">
        <select
          value={selected}
          disabled={locked}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">New monthly cost…</option>
          {input.recurring_costs.filter((cost) => !cost.cancelled_at).map((cost, index) => (
            <option
              key={recordKey(cost, `cost-${index}`)}
              value={recordKey(cost, `cost-${index}`)}
            >
              {vehicleName(input.vehicles, cost.plate_key)} · {cost.cost_type} ·{" "}
              {formatCurrency(cost.monthly_amount)}
            </option>
          ))}
        </select>
      </Field>
      <div className="finance-form-grid">
        <Field label="Vehicle">
          <select
            required
            value={values.plate_key}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, plate_key: event.target.value })
            }
          >
            <option value="">Select vehicle</option>
            {input.vehicles.map((vehicle) => (
              <option key={vehicle.plate_key} value={vehicle.plate_key}>
                {vehicle.display_plate}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select
            required
            value={values.cost_type}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, cost_type: event.target.value })
            }
          >
            <option value="">Select type</option>
            {recurringCategories.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Monthly amount">
          <input
            required
            min="0"
            step="0.01"
            type="number"
            value={values.monthly_amount}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, monthly_amount: event.target.value })
            }
          />
        </Field>
        <Field label="Active from">
          <input
            required
            type="month"
            value={values.start_month}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, start_month: event.target.value })
            }
          />
        </Field>
        <Field label={ending ? "End month (included)" : "End month (optional)"}>
          <input
            required={ending}
            type="month"
            value={values.end_month}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, end_month: event.target.value })
            }
          />
        </Field>
        <Field label="Payee (optional)">
          <input
            value={values.payee}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, payee: event.target.value })
            }
          />
        </Field>
        <Field label="Note (optional)">
          <input
            value={values.notes}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, notes: event.target.value })
            }
          />
        </Field>
      </div>
      <ErrorLine error={error} />
      <Pending pending={pending} />
      <div className="finance-dialog-actions">
        <button className="finance-primary" disabled={locked}>
          {selected ? "Save changes" : "Add monthly cost"}
        </button>
        {original && !original.end_month && !ending && (
          <button
            type="button"
            className="finance-secondary"
            disabled={locked}
            onClick={() => { if (window.confirm(`Stop ${original.cost_type} at ${formatCurrency(original.monthly_amount)} per month? The selected end month remains included; later open months stop contributing and closed reports stay unchanged.`)) setEnding(true); }}
          >
            End cost
          </button>
        )}
        {original && onCancel && <button type="button" className="finance-destructive" disabled={locked} onClick={() => { if (!window.confirm(`Delete ${original.cost_type} at ${formatCurrency(original.monthly_amount)} from open calculations for ${original.start_month.slice(0, 7)} through ${original.end_month?.slice(0, 7) ?? "ongoing"}? Closed snapshots and audit history remain unchanged.`)) return; const reason = window.prompt("Reason for deleting this monthly cost"); if (reason?.trim()) void onCancel("recurring_cost", original, reason.trim()); }}>Delete cost</button>}
        {ending && (
          <>
            <button
              type="button"
              className="finance-secondary"
              disabled={locked}
              onClick={() => setEnding(false)}
            >
              Cancel end
            </button>
            <button
              type="button"
              className="finance-primary"
              disabled={locked || !values.end_month}
              onClick={() => void persist(true)}
            >
              End cost
            </button>
          </>
        )}
      </div>
    </form>
  );
}

export function InsuranceForm({ input, month, disabled, onSave, initialId, onCancel }: MasterProps) {
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<PolicyValues>(blankPolicy);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    const policy = input.insurance.find((item) => item.id === initialId);
    setSelected(policy?.id ?? "");
    setValues(policy ? policyValues(policy) : blankPolicy());
    setError(null);
  }, [month, initialId, input.insurance]);
  const original = input.insurance.find(
    (policy, index) => recordKey(policy, `policy-${index}`) === selected,
  );
  const preview = useMemo<Insurance>(
    () => ({
      ...original,
      plate_key: values.plate_key,
      premium: Number(values.premium || 0),
      responsibility: values.responsibility || undefined,
      coverage_start: nullable(values.coverage_start),
      coverage_end: nullable(values.coverage_end),
      payment_date: nullable(values.payment_date),
      supplier: nullable(values.supplier),
      reference: nullable(values.reference),
      source: nullable(values.source),
    }),
    [original, values, input.calculation_version],
  );
  const allocation =
    values.coverage_start && values.coverage_end && values.premium
      ? allocateInsurance(preview, month, input.calculation_version ?? 1)
      : 0;
  const cashOutflow = insuranceCashOutflow(preview, input.calculation_version ?? 1);
  const choose = (key: string) => {
    setSelected(key);
    setError(null);
    const policy = input.insurance.find(
      (item, index) => recordKey(item, `policy-${index}`) === key,
    );
    setValues(policy ? policyValues(policy) : blankPolicy());
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !values.plate_key ||
      !values.premium ||
      !values.responsibility
    )
      return;
    const problems = insuranceProblems(preview);
    if (problems.length) { setError(problems.join(" ")); return; }
    const current = generation.current;
    setPending(true);
    setError(null);
    try {
      const saved = await onSave("insurance", preview);
      if (current === generation.current && saved) {
        setSelected("");
        setValues(blankPolicy());
      }
    } catch (cause) {
      if (current === generation.current) setError(failureMessage(cause));
    } finally {
      if (current === generation.current) setPending(false);
    }
  };
  const locked = disabled || pending;
  return (
    <form className="finance-form" onSubmit={save}>
      <Field label="Existing record">
        <select
          value={selected}
          disabled={locked}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">New policy…</option>
          {input.insurance.filter((policy) => !policy.cancelled_at).map((policy, index) => (
            <option
              key={recordKey(policy, `policy-${index}`)}
              value={recordKey(policy, `policy-${index}`)}
            >
              {vehicleName(input.vehicles, policy.plate_key)} ·{" "}
              {policy.coverage_start} · {formatCurrency(policy.premium)}
            </option>
          ))}
        </select>
      </Field>
      <div className="finance-form-grid">
        <Field label="Responsibility">
          <select required value={values.responsibility} disabled={locked}
            onChange={(event) => setValues({...values, responsibility: event.target.value as InsuranceResponsibility})}>
            <option value="">Select responsibility</option>
            <option value="ECA_PAID">ECA PAID</option>
            <option value="OWNER_PAID">OWNER PAID</option>
          </select>
        </Field>
        <Field label="Vehicle">
          <select
            required
            value={values.plate_key}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, plate_key: event.target.value })
            }
          >
            <option value="">Select vehicle</option>
            {input.vehicles.map((vehicle) => (
              <option key={vehicle.plate_key} value={vehicle.plate_key}>
                {vehicle.display_plate}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Premium (RM)">
          <input
            required
            min="0"
            step="0.01"
            type="number"
            value={values.premium}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, premium: event.target.value })
            }
          />
        </Field>
        <Field label="Coverage start">
          <input
            required={values.responsibility === "ECA_PAID" && Number(values.premium) > 0}
            type="date"
            value={values.coverage_start}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, coverage_start: event.target.value })
            }
          />
        </Field>
        <Field label="Coverage end">
          <input
            required={values.responsibility === "ECA_PAID" && Number(values.premium) > 0}
            type="date"
            value={values.coverage_end}
            disabled={locked}
            onChange={(event) =>
              setValues({ ...values, coverage_end: event.target.value })
            }
          />
        </Field>
        <Field label="Payment date (optional)">
          <input type="date" value={values.payment_date} disabled={locked} onChange={(event) => setValues({ ...values, payment_date: event.target.value })} />
        </Field>
        <Field label="Supplier (optional)">
          <input value={values.supplier} disabled={locked} onChange={(event) => setValues({ ...values, supplier: event.target.value })} />
        </Field>
        <Field label="Reference (optional)">
          <input value={values.reference} disabled={locked} onChange={(event) => setValues({ ...values, reference: event.target.value })} />
        </Field>
        <Field label="Source (optional)">
          <input value={values.source} disabled={locked} onChange={(event) => setValues({ ...values, source: event.target.value })} />
        </Field>
      </div>
      <p className="finance-muted-action">
        Selected-month ECA allocation: {formatCurrency(allocation)}
      </p>
      <p className="finance-muted-action">OWNER PAID is excluded from ECA costs. Add each renewal as a new policy to retain earlier premiums and coverage.</p>
      {values.responsibility && values.premium !== "" && <p className="finance-muted-action"><strong>{insuranceStatus(preview)}</strong></p>}
      {values.responsibility === "OWNER_PAID" && Number(values.premium) > 0 && <p className="finance-message is-warning" role="status">{ownerPremiumReview}</p>}
      {values.responsibility === "ECA_PAID" && Number(values.premium) === 0 && values.premium !== "" && <p className="finance-muted-action">Update this record when the renewal premium and coverage are known.</p>}
      <p className="finance-muted-action">Finance cash outflow: {formatCurrency(cashOutflow.amount)}{cashOutflow.date ? ` · ${cashOutflow.date}${input.calculation_version === 1 ? "" : " (same as Coverage Start)"}` : ""}</p>
      <ErrorLine error={error} />
      <Pending pending={pending} />
      <button className="finance-primary" disabled={locked}>
        {selected ? "Save changes" : "Save policy"}
      </button>
      {original && (
        <button type="button" className="finance-secondary" disabled={locked} onClick={() => {
          const start = validInsuranceDate(original.coverage_end) ? new Date(`${original.coverage_end}T00:00:00Z`) : null;
          start?.setUTCDate(start.getUTCDate() + 1);
          setSelected("");
          setError(null);
          setValues({...blankPolicy(), plate_key: original.plate_key, coverage_start: start?.toISOString().slice(0, 10) ?? ""});
        }}>Add renewal</button>
      )}
      {original && onCancel && <button type="button" className="finance-destructive" disabled={locked} onClick={() => { if (!window.confirm(`Delete this ${formatCurrency(original.premium)} policy covering ${original.coverage_start ?? "no start date"} through ${original.coverage_end ?? "no end date"}? It stops contributing to open-month calculations; closed snapshots and audit history remain unchanged.`)) return; const reason = window.prompt("Reason for deleting this insurance policy"); if (reason?.trim()) void onCancel("insurance", original, reason.trim()); }}>Delete policy</button>}
    </form>
  );
}

function blankExpense(month: string): ExpenseValues {
  return {
    plate_key: "",
    billing_date: "",
    category: "",
    amount: "",
    supplier: "",
    reference: "",
    description: "",
    frequency: "ONE_OFF",
    start_month: month.slice(0, 7),
    end_month: "",
    source: "Manual",
    notes: "",
  };
}
function expenseValues(record: FinanceExpense): ExpenseValues {
  return {
    plate_key: record.plate_key ?? "",
    billing_date: record.billing_date ?? "",
    category: record.category,
    amount: String(record.amount),
    supplier: record.supplier ?? "",
    reference: record.reference ?? "",
    description: record.description ?? "",
    frequency: record.frequency ?? "ONE_OFF",
    start_month: record.start_month?.slice(0, 7) ?? record.finance_month.slice(0, 7),
    end_month: record.end_month?.slice(0, 7) ?? "",
    source: record.source ?? "",
    notes: record.notes ?? "",
  };
}
function blankVehicle(): VehicleValues {
  return {
    display_plate: "",
    model: "",
    business_unit: "E-HAILING",
    ownership_type: "",
    status: "Active",
  };
}
function vehicleValues(vehicle: FinanceVehicle): VehicleValues {
  return {
    display_plate: vehicle.display_plate,
    model: vehicle.model ?? "",
    business_unit: vehicle.business_unit,
    ownership_type: vehicle.ownership_type,
    status: vehicle.status,
  };
}
function blankCost(month: string): CostValues {
  return {
    plate_key: "",
    cost_type: "",
    monthly_amount: "",
    start_month: month.slice(0, 7),
    end_month: "",
    payee: "",
    notes: "",
  };
}
function costValues(cost: RecurringCost): CostValues {
  return {
    plate_key: cost.plate_key,
    cost_type: cost.cost_type,
    monthly_amount: String(cost.monthly_amount),
    start_month: asMonth(cost.start_month),
    end_month: asMonth(cost.end_month),
    payee: cost.payee ?? "",
    notes: cost.notes ?? "",
  };
}
function blankPolicy(): PolicyValues {
  return {
    responsibility: "",
    plate_key: "",
    premium: "",
    coverage_start: "",
    coverage_end: "",
    payment_date: "",
    supplier: "",
    reference: "",
    source: "Manual",
  };
}
function policyValues(policy: Insurance): PolicyValues {
  return {
    responsibility: policy.responsibility ?? "",
    plate_key: policy.plate_key,
    premium: String(policy.premium),
    coverage_start: policy.coverage_start ?? "",
    coverage_end: policy.coverage_end ?? "",
    payment_date: policy.payment_date ?? "",
    supplier: policy.supplier ?? "",
    reference: policy.reference ?? "",
    source: policy.source ?? "",
  };
}
function vehicleName(vehicles: FinanceVehicle[], plateKey: string) {
  return (
    vehicles.find((vehicle) => vehicle.plate_key === plateKey)?.display_plate ??
    plateKey
  );
}
