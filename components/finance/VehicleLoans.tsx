import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../Dialog";
import Dialog from "./FinanceDialog";
import { Skeleton } from "./FinancePrimitives";
import VehicleLoansView, { BLANK_WHAT_IF, scheduleKey, type WhatIfForm } from "./VehicleLoansView";
import { loadVehicleLoans, saveVehicleLoan } from "../../services/finance/api";
import { exportHpScheduleWorkbook, hpScheduleFileName } from "../../services/finance/hpScheduleExport";
import { instalment, LOAN_STATUS_LABELS, type LoanStatus, type VehicleLoan } from "../../services/finance/loans";
import { money } from "../../services/fmt";
import { fleet } from "../../services/fleet/client";
import type { Car } from "../../services/fleet/rules";
import { normalizePlate } from "../../utils";

// Finance → Vehicle loans (admin only): loads the loans and Fleet's own-fleet cars, and owns the Add / Edit form.
// What is shown lives in VehicleLoansView.tsx; the rules in services/finance/loans.ts.

const NOT_IN_FINANCE = "Add this car to Finance's vehicle list first";
const MIGRATION = "supabase/migrations/20261021090000_vehicle_loans.sql";

/** The database update has not been run yet (the functions are unknown to Supabase). */
const updateMissing = (message: string) => /could not find the function|does not exist|schema cache/i.test(message);
const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : "Could not reach Vehicle loans.");

export default function VehicleLoans({ today, onChanged }: { today: string; onChanged?: () => void }) {
  const { ask, askText, dialog } = useConfirm();
  const [loans, setLoans] = useState<VehicleLoan[] | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [carsError, setCarsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<VehicleLoan | "new" | null>(null);
  const [whatIf, setWhatIf] = useState<WhatIfForm>(BLANK_WHAT_IF);
  // Loans whose HP schedule is open (browser state only).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Plates the server refused because Finance's vehicle list does not have them yet: shown with that hint.
  const [notInFinance, setNotInFinance] = useState<Set<string>>(() => new Set());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    const [loaded, fleetCars] = await Promise.allSettled([loadVehicleLoans(), fleet.listCars()]);
    if (!mounted.current) return;
    if (loaded.status === "fulfilled") setLoans(loaded.value ?? []);
    else setLoadError(messageOf(loaded.reason));
    if (fleetCars.status === "fulfilled") { setCars(fleetCars.value.filter((car) => car.ownership === "Own Fleet")); setCarsError(null); }
    else setCarsError(messageOf(fleetCars.reason));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const carNames = useMemo(() => new Map(cars.map((car) => [normalizePlate(car.plateNumber), [car.make, car.model].filter(Boolean).join(" ")])), [cars]);

  const save = async (action: "ADD" | "UPDATE" | "DELETE", record: Partial<VehicleLoan>, reason = "") => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveVehicleLoan(action, record, reason);
      if (!mounted.current) return true;
      setLoans(result ?? []);
      setNotice(action === "DELETE" ? "Loan deleted; its monthly cost in Records is deleted with it." : "Loan saved; its Hire Purchase / Loan monthly cost in Records is up to date.");
      // Finance's month figures changed: the next month-based page reads them again.
      onChanged?.();
      return true;
    } catch (cause) {
      const message = messageOf(cause);
      if (message.includes(NOT_IN_FINANCE) && record.plate_key) {
        const plate = normalizePlate(record.plate_key);
        setNotInFinance((current) => new Set(current).add(plate));
      }
      throw new Error(message.includes(NOT_IN_FINANCE) ? `${NOT_IN_FINANCE}: Records → Vehicle Master, Add vehicle.` : message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // Download Excel on an open schedule: the workbook is written in the browser and saved, nothing is stored.
  const downloadSchedule = async (loan: VehicleLoan) => {
    setError(null);
    try {
      const bytes = await exportHpScheduleWorkbook(loan, carNames.get(loan.plate_key));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = hpScheduleFileName(loan.display_plate);
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not write the HP schedule.");
    }
  };

  const remove = async (loan: VehicleLoan) => {
    if (!(await ask(`Delete the loan for ${loan.display_plate}? Its Hire Purchase / Loan monthly cost is deleted with it. Closed months keep their figures.`))) return;
    const reason = await askText("Reason for deleting this loan");
    if (!reason?.trim()) return;
    try { await save("DELETE", { id: loan.id, record_version: loan.record_version }, reason.trim()); }
    catch (cause) { setError(messageOf(cause)); }
  };

  if (loadError) {
    return (
      <section className="finance-panel">
        <p role="alert" className="finance-message is-error">
          {updateMissing(loadError) ? `Vehicle loans needs its database update: run ${MIGRATION} in the Supabase SQL Editor, then reload.` : loadError}
        </p>
        <button type="button" className="finance-secondary" onClick={() => void load()}>Retry</button>
      </section>
    );
  }
  if (!loans) return <section className="finance-panel"><Skeleton lines={8} /></section>;
  return (
    <>
      {error && <p role="alert" className="finance-message is-error">{error}</p>}
      {notice && <p role="alert" className="finance-message is-success">{notice}</p>}
      <VehicleLoansView
        loans={loans}
        today={today}
        cars={carNames}
        whatIf={whatIf}
        onWhatIfChange={(key, value) => setWhatIf((current) => ({ ...current, [key]: value }))}
        busy={busy}
        onAdd={() => setEditing("new")}
        onEdit={(loan) => setEditing(loan)}
        onDelete={(loan) => void remove(loan)}
        expanded={expanded}
        onToggleSchedule={(loan) => setExpanded((current) => {
          const next = new Set(current);
          const key = scheduleKey(loan);
          if (!next.delete(key)) next.add(key);
          return next;
        })}
        onDownloadSchedule={(loan) => void downloadSchedule(loan)}
      />
      {editing && (
        <Dialog title={editing === "new" ? "Add loan" : `Edit loan · ${editing.display_plate}`} onClose={() => !busy && setEditing(null)}>
          <LoanForm
            loan={editing === "new" ? null : editing}
            cars={cars}
            carsError={carsError}
            notInFinance={notInFinance}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={async (record) => {
              await save(editing === "new" ? "ADD" : "UPDATE", record);
              if (mounted.current) setEditing(null);
            }}
          />
        </Dialog>
      )}
      {dialog}
    </>
  );
}

interface LoanValues {
  plate_key: string;
  bank: string;
  finance_amount: string;
  flat_rate_percent: string;
  tenure_months: string;
  first_payment_date: string;
  downpayment: string;
  override: boolean;
  monthly_instalment: string;
  status: LoanStatus;
  closed_on: string;
  notes: string;
}
const valuesOf = (loan: VehicleLoan | null): LoanValues => {
  if (!loan) return { plate_key: "", bank: "", finance_amount: "", flat_rate_percent: "", tenure_months: "", first_payment_date: "", downpayment: "0", override: false, monthly_instalment: "", status: "ACTIVE", closed_on: "", notes: "" };
  const calculated = instalment(loan.finance_amount, loan.flat_rate_percent, loan.tenure_months);
  return {
    plate_key: loan.plate_key, bank: loan.bank, finance_amount: String(loan.finance_amount), flat_rate_percent: String(loan.flat_rate_percent),
    tenure_months: String(loan.tenure_months), first_payment_date: loan.first_payment_date, downpayment: String(loan.downpayment ?? 0),
    override: calculated !== Number(loan.monthly_instalment), monthly_instalment: String(loan.monthly_instalment),
    status: loan.status, closed_on: loan.closed_on ?? "", notes: loan.notes ?? "",
  };
};

function LoanForm({ loan, cars, carsError, notInFinance, busy, onSave, onCancel }: {
  loan: VehicleLoan | null;
  cars: Car[];
  carsError: string | null;
  notInFinance: Set<string>;
  busy: boolean;
  onSave: (record: Partial<VehicleLoan>) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<LoanValues>(() => valuesOf(loan));
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof LoanValues>(key: K, value: LoanValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const calculated = instalment(Number(values.finance_amount), Number(values.flat_rate_percent || 0), Number(values.tenure_months));
  const chosen = values.override ? Number(values.monthly_instalment) : calculated;
  // Fleet's own-fleet cars; the loan's own car stays in the list even if Fleet no longer shows it.
  const options = cars.map((car) => ({ plate: normalizePlate(car.plateNumber), label: [car.plateNumber, [car.make, car.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") }))
    .filter((option) => option.plate)
    .sort((a, b) => a.plate.localeCompare(b.plate));
  if (loan && !options.some((option) => option.plate === loan.plate_key)) options.unshift({ plate: loan.plate_key, label: loan.display_plate });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!values.plate_key) return setFormError("Choose the car.");
    if (!(chosen > 0)) return setFormError("Enter the finance amount, rate and tenure, or override the instalment.");
    if (values.status !== "ACTIVE" && !values.closed_on) return setFormError("Enter the date the loan was settled or the car sold.");
    try {
      await onSave({
        id: loan?.id, record_version: loan?.record_version, plate_key: values.plate_key, bank: values.bank.trim(),
        finance_amount: Number(values.finance_amount), flat_rate_percent: Number(values.flat_rate_percent || 0), tenure_months: Number(values.tenure_months),
        first_payment_date: values.first_payment_date, downpayment: Number(values.downpayment || 0), monthly_instalment: chosen,
        status: values.status, closed_on: values.status === "ACTIVE" ? null : values.closed_on, notes: values.notes.trim() || null,
      });
    } catch (cause) {
      setFormError(messageOf(cause));
    }
  };
  return (
    <form className="finance-form" onSubmit={(event) => void submit(event)}>
      {formError && <p role="alert" className="finance-message is-error">{formError}</p>}
      {carsError && <p className="finance-message is-warning">Fleet's car list could not be read: {carsError}</p>}
      <div className="finance-form-grid">
        <label className="finance-field">
          <span>Car (Own Fleet)</span>
          <select required value={values.plate_key} disabled={busy} onChange={(event) => set("plate_key", event.target.value)}>
            <option value="">Choose a car…</option>
            {options.map((option) => (
              <option key={option.plate} value={option.plate}>{option.label}{notInFinance.has(option.plate) ? ` · ${NOT_IN_FINANCE}` : ""}</option>
            ))}
          </select>
        </label>
        <label className="finance-field"><span>Loan provider (bank or finance company)</span><input required value={values.bank} disabled={busy} onChange={(event) => set("bank", event.target.value)} /></label>
        <label className="finance-field"><span>Finance amount (RM)</span><input required type="number" min="0.01" step="0.01" inputMode="decimal" value={values.finance_amount} disabled={busy} onChange={(event) => set("finance_amount", event.target.value)} /></label>
        <label className="finance-field"><span>Flat rate, % a year</span><input required type="number" min="0" step="0.001" inputMode="decimal" value={values.flat_rate_percent} disabled={busy} onChange={(event) => set("flat_rate_percent", event.target.value)} /></label>
        <label className="finance-field"><span>Tenure (months)</span><input required type="number" min="1" step="1" inputMode="numeric" value={values.tenure_months} disabled={busy} onChange={(event) => set("tenure_months", event.target.value)} /></label>
        <label className="finance-field"><span>First payment date</span><input required type="date" value={values.first_payment_date} disabled={busy} onChange={(event) => set("first_payment_date", event.target.value)} /></label>
        <label className="finance-field"><span>Downpayment (RM)</span><input type="number" min="0" step="0.01" inputMode="decimal" value={values.downpayment} disabled={busy} onChange={(event) => set("downpayment", event.target.value)} /></label>
        <label className="finance-field">
          <span>Monthly instalment</span>
          {values.override
            ? <input required type="number" min="0.01" step="0.01" inputMode="decimal" value={values.monthly_instalment} disabled={busy} onChange={(event) => set("monthly_instalment", event.target.value)} />
            : <output className="finance-strong">{calculated > 0 ? money(calculated) : "—"}</output>}
        </label>
      </div>
      <label className="loans-override">
        <input type="checkbox" checked={values.override} disabled={busy} onChange={(event) => setValues((current) => ({ ...current, override: event.target.checked, monthly_instalment: current.monthly_instalment || (calculated > 0 ? String(calculated) : "") }))} />
        Override the calculated instalment (only for the bank's rounding; calculated: {calculated > 0 ? money(calculated) : "—"})
      </label>
      <div className="finance-form-grid">
        <label className="finance-field">
          <span>Status</span>
          <select value={values.status} disabled={busy} onChange={(event) => set("status", event.target.value as LoanStatus)}>
            {(Object.keys(LOAN_STATUS_LABELS) as LoanStatus[]).map((status) => <option key={status} value={status}>{LOAN_STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        {values.status !== "ACTIVE" && (
          <label className="finance-field"><span>{values.status === "SOLD" ? "Car sold on" : "Settled on"}</span><input required type="date" value={values.closed_on} disabled={busy} onChange={(event) => set("closed_on", event.target.value)} /></label>
        )}
      </div>
      {values.status !== "ACTIVE" && <p className="finance-muted-action">The monthly cost in Finance stops from the month it closed.</p>}
      <label className="finance-field"><span>Notes</span><input value={values.notes} disabled={busy} onChange={(event) => set("notes", event.target.value)} /></label>
      <div className="finance-dialog-actions">
        <button type="button" className="finance-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="finance-primary" disabled={busy}>{busy ? "Saving…" : "Save loan"}</button>
      </div>
    </form>
  );
}
