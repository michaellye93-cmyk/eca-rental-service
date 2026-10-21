import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../Dialog";
import Dialog from "./FinanceDialog";
import { Skeleton } from "./FinancePrimitives";
import VehicleLoansView, { BLANK_WHAT_IF, scheduleKey, type WhatIfForm } from "./VehicleLoansView";
import { loadVehicleLoans, saveVehicleLoan } from "../../services/finance/api";
import { exportHpScheduleWorkbook, hpScheduleFileName } from "../../services/finance/hpScheduleExport";
import { firstInstalmentDate, instalment, letterFigures, LOAN_STATUS_LABELS, RATE_TYPE_LABELS, type LoanStatus, type RateType, type VehicleLoan } from "../../services/finance/loans";
import { money } from "../../services/fmt";
import { fleet } from "../../services/fleet/client";
import type { Car, VehicleDetails } from "../../services/fleet/rules";
import { normalizePlate } from "../../utils";

// Finance → Vehicle loans (admin only): loads the loans, Fleet's own-fleet cars and their vehicle details (the registered
// owner prefills a loan's Ownership), and owns the Add / Edit form, which follows the loan provider's letter line for line.
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
  const [details, setDetails] = useState<VehicleDetails[]>([]);
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
    const [loaded, fleetCars, fleetDetails] = await Promise.allSettled([loadVehicleLoans(), fleet.listCars(), fleet.listDetails()]);
    if (!mounted.current) return;
    if (loaded.status === "fulfilled") setLoans(loaded.value ?? []);
    else setLoadError(messageOf(loaded.reason));
    if (fleetCars.status === "fulfilled") { setCars(fleetCars.value.filter((car) => car.ownership === "Own Fleet")); setCarsError(null); }
    else setCarsError(messageOf(fleetCars.reason));
    // Vehicle details only prefill Ownership: if they cannot be read, the field is simply typed.
    setDetails(fleetDetails.status === "fulfilled" ? fleetDetails.value : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const carNames = useMemo(() => new Map(cars.map((car) => [normalizePlate(car.plateNumber), [car.make, car.model].filter(Boolean).join(" ")])), [cars]);
  // Fleet's registered owner by plate, matched to the car by its id.
  const owners = useMemo(() => {
    const plateOf = new Map(cars.map((car) => [car.id, normalizePlate(car.plateNumber)]));
    return new Map(details.flatMap((detail) => {
      const plate = plateOf.get(detail.carId);
      const owner = detail.ownerName?.trim();
      return plate && owner ? [[plate, owner] as [string, string]] : [];
    }));
  }, [cars, details]);
  const hirers = useMemo(() => [...new Set((loans ?? []).map((loan) => loan.hirer?.trim()).filter((hirer): hirer is string => Boolean(hirer)))].sort((a, b) => a.localeCompare(b)), [loans]);

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
            owners={owners}
            hirers={hirers}
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

/** The Add / Edit form as typed, in the bank letter's order (browser state only). */
export interface LoanValues {
  plate_key: string;
  hirer: string;
  bank: string;
  cash_price: string;
  downpayment: string;
  finance_amount: string;
  flat_rate_percent: string;
  rate_type: RateType;
  commencement_date: string;
  first_payment_date: string;
  tenure_months: string;
  override: boolean;
  monthly_instalment: string;
  status: LoanStatus;
  closed_on: string;
  notes: string;
  /** Lines typed by hand, so the lines they follow from no longer fill them (true for a stored loan's own figures). */
  typed: { finance_amount: boolean; first_payment_date: boolean; hirer: boolean };
}

export const valuesOf = (loan: VehicleLoan | null): LoanValues => {
  if (!loan) {
    return {
      plate_key: "", hirer: "", bank: "", cash_price: "", downpayment: "0", finance_amount: "", flat_rate_percent: "", rate_type: "FLAT",
      commencement_date: "", first_payment_date: "", tenure_months: "", override: false, monthly_instalment: "", status: "ACTIVE", closed_on: "", notes: "",
      typed: { finance_amount: false, first_payment_date: false, hirer: false },
    };
  }
  const rateType: RateType = loan.rate_type === "VARIABLE" ? "VARIABLE" : "FLAT";
  const calculated = instalment(loan.finance_amount, loan.flat_rate_percent, loan.tenure_months);
  return {
    plate_key: loan.plate_key, hirer: loan.hirer ?? "", bank: loan.bank,
    cash_price: loan.cash_price === null || loan.cash_price === undefined ? "" : String(loan.cash_price),
    downpayment: String(loan.downpayment ?? 0), finance_amount: String(loan.finance_amount), flat_rate_percent: String(loan.flat_rate_percent),
    rate_type: rateType, commencement_date: loan.commencement_date ?? "", first_payment_date: loan.first_payment_date, tenure_months: String(loan.tenure_months),
    override: rateType === "VARIABLE" || calculated !== Number(loan.monthly_instalment), monthly_instalment: String(loan.monthly_instalment),
    status: loan.status, closed_on: loan.closed_on ?? "", notes: loan.notes ?? "",
    typed: { finance_amount: true, first_payment_date: true, hirer: Boolean(loan.hirer?.trim()) },
  };
};

type LetterKey = Exclude<keyof LoanValues, "typed" | "override" | "status">;

/**
 * One line of the form typed, and the lines that follow from it: picking the car fills Ownership from Fleet's vehicle
 * details (owners, by plate) while Ownership is not typed by hand; Cost or Downpayment fills HP Financing (Cost −
 * Downpayment) until financing is typed; Commencement fills the first instalment date (one month on) until that is
 * typed; a variable rate turns the typed instalment on.
 */
export function changeLoanForm(current: LoanValues, key: LetterKey, value: string, owners: ReadonlyMap<string, string>): LoanValues {
  const next: LoanValues = { ...current, [key]: value, typed: { ...current.typed } };
  if (key === "plate_key" && !next.typed.hirer) next.hirer = owners.get(value) ?? "";
  if (key === "hirer") next.typed.hirer = value.trim() !== "";
  if (key === "finance_amount") next.typed.finance_amount = true;
  if ((key === "cash_price" || key === "downpayment") && !next.typed.finance_amount && next.cash_price.trim() !== "") {
    const financing = Math.round((Number(next.cash_price) - Number(next.downpayment || 0)) * 100) / 100;
    if (Number.isFinite(financing)) next.finance_amount = financing > 0 ? String(financing) : "";
  }
  if (key === "first_payment_date") next.typed.first_payment_date = true;
  if (key === "commencement_date" && !next.typed.first_payment_date) {
    const first = firstInstalmentDate(value);
    if (first) next.first_payment_date = first;
  }
  if (key === "rate_type") {
    next.rate_type = value === "VARIABLE" ? "VARIABLE" : "FLAT";
    if (next.rate_type === "VARIABLE") next.override = true;
  }
  return next;
}

/** A read-only line of the letter: its figure, or a dash. */
const shown = (value: number | null) => (value === null ? "—" : money(value));

export function LoanForm({ loan, cars, owners, hirers, carsError, notInFinance, busy, onSave, onCancel }: {
  loan: VehicleLoan | null;
  cars: Car[];
  /** Fleet's registered owner by plate (capitals, no spaces): Ownership's prefill. */
  owners: ReadonlyMap<string, string>;
  /** The hirers already on the loans, for the Ownership suggestions. */
  hirers: string[];
  carsError: string | null;
  notInFinance: Set<string>;
  busy: boolean;
  onSave: (record: Partial<VehicleLoan>) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<LoanValues>(() => valuesOf(loan));
  const [formError, setFormError] = useState<string | null>(null);
  const change = (key: LetterKey) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setValues((current) => changeLoanForm(current, key, value, owners));
  };
  const set = <K extends keyof LoanValues>(key: K, value: LoanValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const variable = values.rate_type === "VARIABLE";
  const calculated = variable ? 0 : instalment(Number(values.finance_amount), Number(values.flat_rate_percent || 0), Number(values.tenure_months));
  const typedInstalment = variable || values.override;
  const chosen = typedInstalment ? Number(values.monthly_instalment) : calculated;
  const figures = letterFigures({
    finance_amount: Number(values.finance_amount), flat_rate_percent: Number(values.flat_rate_percent || 0), tenure_months: Number(values.tenure_months),
    monthly_instalment: chosen, rate_type: values.rate_type,
  });
  // Fleet's own-fleet cars; the loan's own car stays in the list even if Fleet no longer shows it.
  const options = cars.map((car) => ({ plate: normalizePlate(car.plateNumber), label: [car.plateNumber, [car.make, car.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "), model: [car.make, car.model].filter(Boolean).join(" ") }))
    .filter((option) => option.plate)
    .sort((a, b) => a.plate.localeCompare(b.plate));
  if (loan && !options.some((option) => option.plate === loan.plate_key)) options.unshift({ plate: loan.plate_key, label: loan.display_plate, model: "" });
  const model = options.find((option) => option.plate === values.plate_key)?.model || "—";
  const fleetOwner = owners.get(values.plate_key);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!values.plate_key) return setFormError("Choose the car.");
    if (!(chosen > 0)) return setFormError(variable ? "Type the monthly instalment from the bank's letter." : "Enter the finance amount, rate and tenure, or override the instalment.");
    if (values.status !== "ACTIVE" && !values.closed_on) return setFormError("Enter the date the loan was settled or the car sold.");
    try {
      await onSave({
        id: loan?.id, record_version: loan?.record_version, plate_key: values.plate_key, hirer: values.hirer.trim() || null, bank: values.bank.trim(),
        cash_price: values.cash_price.trim() === "" ? null : Number(values.cash_price), downpayment: Number(values.downpayment || 0),
        finance_amount: Number(values.finance_amount), flat_rate_percent: Number(values.flat_rate_percent || 0), rate_type: values.rate_type,
        commencement_date: values.commencement_date || null, first_payment_date: values.first_payment_date, tenure_months: Number(values.tenure_months),
        monthly_instalment: chosen, status: values.status, closed_on: values.status === "ACTIVE" ? null : values.closed_on, notes: values.notes.trim() || null,
      });
    } catch (cause) {
      setFormError(messageOf(cause));
    }
  };
  const label = (text: string) => <span className="loans-letter-label">{text}</span>;
  return (
    <form className="finance-form" onSubmit={(event) => void submit(event)}>
      {formError && <p role="alert" className="finance-message is-error">{formError}</p>}
      {carsError && <p className="finance-message is-warning">Fleet's car list could not be read: {carsError}</p>}
      <p className="finance-muted-action">In the order of the loan provider's letter.</p>
      <div className="finance-form-grid">
        <label className="finance-field">
          {label("Registration No.")}
          <select required value={values.plate_key} disabled={busy} onChange={change("plate_key")}>
            <option value="">Choose a car (Own Fleet)…</option>
            {options.map((option) => (
              <option key={option.plate} value={option.plate}>{option.label}{notInFinance.has(option.plate) ? ` · ${NOT_IN_FINANCE}` : ""}</option>
            ))}
          </select>
        </label>
        <div className="finance-field">{label("Model")}<output className="loans-letter-figure">{model}</output></div>
        <label className="finance-field">
          {label("Ownership (hirer)")}
          <input list="loan-hirers" value={values.hirer} disabled={busy} placeholder={fleetOwner ? undefined : "Set under Fleet → Vehicle details, or type it"} onChange={change("hirer")} />
          <datalist id="loan-hirers">{hirers.map((hirer) => <option key={hirer} value={hirer} />)}</datalist>
        </label>
        <label className="finance-field">{label("Loan provider (E-hak)")}<input required value={values.bank} disabled={busy} onChange={change("bank")} /></label>
        <label className="finance-field">{label("Cost (RM)")}<input type="number" min="0" step="0.01" inputMode="decimal" value={values.cash_price} disabled={busy} onChange={change("cash_price")} /></label>
        <label className="finance-field">{label("Less: Downpayment paid (RM)")}<input type="number" min="0" step="0.01" inputMode="decimal" value={values.downpayment} disabled={busy} onChange={change("downpayment")} /></label>
        <label className="finance-field">{label("HP Financing (RM)")}<input required type="number" min="0.01" step="0.01" inputMode="decimal" value={values.finance_amount} disabled={busy} onChange={change("finance_amount")} /></label>
        <label className="finance-field">{label("Interest rate, % a year")}<input required type="number" min="0" step="0.001" inputMode="decimal" value={values.flat_rate_percent} disabled={busy} onChange={change("flat_rate_percent")} /></label>
        <label className="finance-field">
          {label("Rate type")}
          <select value={values.rate_type} disabled={busy} onChange={change("rate_type")}>
            {(Object.keys(RATE_TYPE_LABELS) as RateType[]).map((type) => <option key={type} value={type}>{RATE_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        <div className="finance-field">{label("Interest")}<output className="loans-letter-figure">{shown(figures.interest)}</output></div>
        <div className="finance-field">{label("Total")}<output className="loans-letter-figure">{shown(figures.total)}</output></div>
        <label className="finance-field">{label("Commencement date")}<input type="date" value={values.commencement_date} disabled={busy} onChange={change("commencement_date")} /></label>
        <label className="finance-field">{label("First instalment date")}<input required type="date" value={values.first_payment_date} disabled={busy} onChange={change("first_payment_date")} /></label>
        <label className="finance-field">{label("No. of instalments")}<input required type="number" min="1" step="1" inputMode="numeric" value={values.tenure_months} disabled={busy} onChange={change("tenure_months")} /></label>
        <label className="finance-field">
          {label("Monthly instalment")}
          {typedInstalment
            ? <input required type="number" min="0.01" step="0.01" inputMode="decimal" value={values.monthly_instalment} disabled={busy} onChange={change("monthly_instalment")} />
            : <output className="finance-strong">{calculated > 0 ? money(calculated) : "—"}</output>}
        </label>
        <div className="finance-field">{label("Final instalment")}<output className="loans-letter-figure">{shown(figures.final)}</output></div>
      </div>
      <label className="loans-override">
        <input type="checkbox" checked={typedInstalment} disabled={busy || variable} onChange={(event) => setValues((current) => ({ ...current, override: event.target.checked, monthly_instalment: current.monthly_instalment || (calculated > 0 ? String(calculated) : "") }))} />
        {variable
          ? "Variable rate: type the instalment from the bank's letter; the bank's statement gives the interest split."
          : `Override the calculated instalment (only for the bank's rounding; calculated: ${calculated > 0 ? money(calculated) : "—"})`}
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
