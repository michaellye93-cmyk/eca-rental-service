import React from "react";
import StatTile from "../StatTile";
import { Empty, SectionHeading } from "./FinancePrimitives";
import { money, monthShort, MONTH_SHORT } from "../../services/fmt";
import {
  balanceLeft,
  commitmentSeries,
  groupLoansByHirer,
  hpSchedule,
  LOAN_STATUS_LABELS,
  loanSummary,
  nearPayoff,
  progress,
  VARIABLE_NOTE,
  type CommitmentSeries,
  type VehicleLoan,
  type WhatIfLoan,
} from "../../services/finance/loans";

// Finance → Vehicle loans, as shown: props only (no Supabase, no styles), so a test renders it with fixture loans.
// VehicleLoans.tsx loads the loans and owns the Add / Edit form.

/** The "What if" box as typed (browser state only, never stored). */
export interface WhatIfForm {
  finance_amount: string;
  flat_rate_percent: string;
  tenure_months: string;
  /** YYYY-MM */
  first_payment_month: string;
}
export const BLANK_WHAT_IF: WhatIfForm = { finance_amount: "", flat_rate_percent: "", tenure_months: "", first_payment_month: "" };

/** The typed what-if loan, or null until every figure is given. */
export function whatIfLoan(form: WhatIfForm): WhatIfLoan | null {
  const amount = Number(form.finance_amount);
  const rate = form.flat_rate_percent.trim() === "" ? NaN : Number(form.flat_rate_percent);
  const tenure = Number(form.tenure_months);
  if (!(amount > 0) || !(rate >= 0) || !(Number.isInteger(tenure) && tenure > 0) || !/^\d{4}-\d{2}$/.test(form.first_payment_month)) return null;
  return { finance_amount: amount, flat_rate_percent: rate, tenure_months: tenure, first_payment_month: form.first_payment_month };
}

export const ASSUMPTION = "Assumes every instalment is paid on time; the bank statement is the record.";
const CHART_MONTHS = 36;

export interface VehicleLoansViewProps {
  loans: VehicleLoan[];
  /** Kuala Lumpur's date, YYYY-MM-DD. */
  today: string;
  /** Fleet's make and model by plate (capitals, no spaces). */
  cars: Map<string, string>;
  whatIf: WhatIfForm;
  /** One what-if figure typed (the parent keeps the form). */
  onWhatIfChange?: (key: keyof WhatIfForm, value: string) => void;
  busy?: boolean;
  onAdd?: () => void;
  onEdit?: (loan: VehicleLoan) => void;
  onDelete?: (loan: VehicleLoan) => void;
  /** Loans whose HP schedule is open, by scheduleKey (the parent keeps the set). */
  expanded?: ReadonlySet<string>;
  onToggleSchedule?: (loan: VehicleLoan) => void;
  /** Download Excel on an open schedule (the parent writes the workbook and saves the file). */
  onDownloadSchedule?: (loan: VehicleLoan) => void;
}

/** The key a loan's open schedule is kept under. */
export const scheduleKey = (loan: VehicleLoan) => loan.id ?? loan.plate_key;

export default function VehicleLoansView({ loans, today, cars, whatIf, onWhatIfChange, busy, onAdd, onEdit, onDelete, expanded, onToggleSchedule, onDownloadSchedule }: VehicleLoansViewProps) {
  const summary = loanSummary(loans, today);
  const typed = whatIfLoan(whatIf);
  const series = commitmentSeries(loans, today, CHART_MONTHS, typed);
  const groups = groupLoansByHirer(loans, today);
  const set = (key: keyof WhatIfForm) => (event: React.ChangeEvent<HTMLInputElement>) => onWhatIfChange?.(key, event.target.value);
  return (
    <div className="finance-content">
      <p className="finance-dialog-copy">{ASSUMPTION}</p>
      <section className="finance-summary-grid is-three" aria-label="Vehicle loan figures">
        <StatTile
          emphasis
          label="Hire-purchase instalments, this month"
          value={money(summary.thisMonth)}
          hint={`${summary.activeCount} active ${summary.activeCount === 1 ? "loan" : "loans"}${summary.nextFinish ? ` · next finishes ${monthShort(summary.nextFinish.month)} (${summary.nextFinish.plate})` : ""}`}
        />
        <StatTile label="Balance left, all loans" value={money(summary.balanceLeft)} hint="instalments still to pay, no early settlement" />
        <StatTile label="Within 6 months of payoff" value={String(summary.nearPayoffCount)} hint="bars shown in amber below" />
      </section>

      <section className="finance-panel">
        <SectionHeading
          title={`Monthly instalment commitment, next ${CHART_MONTHS} months`}
          detail="Each step down is a loan ending. The dotted line adds the loan typed under What if."
        />
        <CommitmentChart series={series} />
        <fieldset className="loans-what-if" disabled={!onWhatIfChange}>
          <legend>What if</legend>
          <label className="finance-field"><span>Finance amount (RM)</span><input type="number" min="0" step="0.01" inputMode="decimal" value={whatIf.finance_amount} onChange={set("finance_amount")} /></label>
          <label className="finance-field"><span>Flat rate, % a year</span><input type="number" min="0" step="0.001" inputMode="decimal" value={whatIf.flat_rate_percent} onChange={set("flat_rate_percent")} /></label>
          <label className="finance-field"><span>Tenure (months)</span><input type="number" min="1" step="1" inputMode="numeric" value={whatIf.tenure_months} onChange={set("tenure_months")} /></label>
          <label className="finance-field"><span>First payment month</span><input type="month" value={whatIf.first_payment_month} onChange={set("first_payment_month")} /></label>
        </fieldset>
        {typed && (
          <p className="finance-muted-action">
            What if adds {money(series.whatIfInstalment)} a month from {monthShort(typed.first_payment_month)} for {typed.tenure_months} months. Not saved.
          </p>
        )}
      </section>

      <section className="finance-panel">
        <SectionHeading
          title="Loans, soonest to finish first"
          detail="Grouped by ownership (the hirer), the biggest monthly total first. Saving a loan keeps its Hire Purchase / Loan monthly cost in Records up to date."
          action={onAdd && <button type="button" className="finance-primary" disabled={busy} onClick={onAdd}>Add loan</button>}
        />
        {groups.length === 0 ? (
          <Empty text="No loans yet. Add each own-fleet car's hire-purchase loan from its loan provider's letter." />
        ) : (
          groups.map((group) => (
            <section key={group.hirer ?? ""} className="loans-group" aria-label={group.label}>
              <h4 className="loans-group-heading">
                {group.label} · {group.activeCount} active · {money(group.monthlyTotal)} /mo
              </h4>
              <ul className="loans-list">
                {group.loans.map((loan) => (
                  <LoanRow
                    key={scheduleKey(loan)} loan={loan} today={today} car={cars.get(loan.plate_key)} busy={busy} onEdit={onEdit} onDelete={onDelete}
                    open={expanded?.has(scheduleKey(loan)) ?? false} onToggleSchedule={onToggleSchedule} onDownloadSchedule={onDownloadSchedule}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </section>
    </div>
  );
}

function LoanRow({ loan, today, car, busy, onEdit, onDelete, open, onToggleSchedule, onDownloadSchedule }: {
  loan: VehicleLoan; today: string; car?: string; busy?: boolean; onEdit?: (loan: VehicleLoan) => void; onDelete?: (loan: VehicleLoan) => void;
  open: boolean; onToggleSchedule?: (loan: VehicleLoan) => void; onDownloadSchedule?: (loan: VehicleLoan) => void;
}) {
  const scheduleId = `loan-schedule-${loan.plate_key}`;
  const run = progress(loan, today);
  const active = loan.status === "ACTIVE";
  const near = nearPayoff(loan, today);
  const tone = !active ? " is-closed" : near ? " is-near" : "";
  const statusText = active
    ? `paid ${run.paid} of ${loan.tenure_months} · ${run.left} left · finishes ${monthShort(run.finishes)}`
    : `${LOAN_STATUS_LABELS[loan.status]} ${loan.closed_on ? monthShort(loan.closed_on) : ""} · no longer counted`;
  return (
    <li className="loan-row">
      <div className="loan-car">
        <strong>{loan.display_plate}</strong>
        {near && <span className="loan-pill is-near">Near payoff</span>}
        {!active && <span className="loan-pill is-closed">{LOAN_STATUS_LABELS[loan.status]}</span>}
        <small>
          {[car, loan.bank, rateText(loan), `${loan.tenure_months} months from ${monthShort(loan.first_payment_date)}`, loan.commencement_date && `commenced ${dayLong(loan.commencement_date)}`].filter(Boolean).join(" · ")}
        </small>
      </div>
      <div className="loan-progress">
        <div className="loan-bar" role="progressbar" aria-label={`${loan.display_plate} instalments paid`} aria-valuemin={0} aria-valuemax={loan.tenure_months} aria-valuenow={run.paid}>
          <div className={`loan-bar-fill${tone}`} style={{ width: `${run.percent}%` }} />
        </div>
        <div className="loan-bar-text"><span>{statusText}</span><span>{run.percent}%</span></div>
      </div>
      <div className="loan-amounts">
        <strong>{active ? `${money(loan.monthly_instalment)} /mo` : "—"}</strong>
        <small>{active ? `balance ${money(balanceLeft(loan, today))}` : "not counted"}</small>
      </div>
      <div className="loan-actions">
        <button type="button" className="finance-secondary" disabled={!onToggleSchedule} aria-expanded={open} aria-controls={scheduleId} onClick={() => onToggleSchedule?.(loan)}>Schedule</button>
        {onEdit && <button type="button" className="finance-secondary" disabled={busy} onClick={() => onEdit(loan)}>Edit</button>}
        {onDelete && <button type="button" className="finance-destructive" disabled={busy} onClick={() => onDelete(loan)}>Delete</button>}
      </div>
      {open && <LoanSchedule id={scheduleId} loan={loan} today={today} onDownload={onDownloadSchedule} />}
    </li>
  );
}

/** "15 Jan 2024" from YYYY-MM-DD. */
const dayLong = (date: string) => (date ? `${Number(date.slice(8, 10))} ${MONTH_SHORT[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : "");
/** A schedule figure as the bank prints it: 1,234.56, no currency; a dash where the bank's statement gives it. */
const figure = (value: number | null) => (value === null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** "3.00% flat" or "4.50% variable". */
const rateText = (loan: VehicleLoan) => `${Number(loan.flat_rate_percent).toFixed(2)}% ${loan.rate_type === "VARIABLE" ? "variable" : "flat"}`;

export const SCHEDULE_HEADERS = ["Year", "Ins. No", "Sum of Digit", "Instalment", "Interest", "Principal", "Total Instalment", "Total Interest", "Total Principal", "Bal Due"] as const;

/** The loan's HP schedule as the bank issues it, under its row; instalments after today are muted. */
function LoanSchedule({ id, loan, today, onDownload }: { id: string; loan: VehicleLoan; today: string; onDownload?: (loan: VehicleLoan) => void }) {
  const schedule = hpSchedule(loan);
  const first = schedule.rows[0]?.date ?? "";
  const last = schedule.rows[schedule.rows.length - 1]?.date ?? "";
  return (
    <div className="loan-schedule" id={id}>
      <div className="loan-schedule-head">
        <p>
          {schedule.totalPayable === null || schedule.totalInterest === null
            ? `${VARIABLE_NOTE} · ${rateText(loan)}`
            : `Total payable ${money(schedule.totalPayable)} · interest ${money(schedule.totalInterest)} at ${rateText(loan)} · Rule of 78 split`}
          {` · first payment ${dayLong(first)} · last instalment ${dayLong(last)}`}
        </p>
        <button type="button" className="finance-secondary" disabled={!onDownload} onClick={() => onDownload?.(loan)}>Download Excel</button>
      </div>
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead>
            <tr>{SCHEDULE_HEADERS.map((header, i) => <th key={header} className={i === 0 ? undefined : "num"}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {schedule.rows.map((row) => (
              <tr key={row.number} className={[row.yearEnd && "loan-schedule-year", row.date > today && "is-future"].filter(Boolean).join(" ") || undefined}>
                <td>{row.yearEnd?.label ?? ""}</td>
                <td className="num">{row.number}</td>
                <td className="num">{row.digit}</td>
                <td className="num">{figure(row.amount)}</td>
                <td className="num">{figure(row.interest)}</td>
                <td className="num">{figure(row.principal)}</td>
                <td className="num">{row.yearEnd ? figure(row.yearEnd.instalments) : ""}</td>
                <td className="num">{row.yearEnd ? figure(row.yearEnd.interest) : ""}</td>
                <td className="num">{row.yearEnd ? figure(row.yearEnd.principal) : ""}</td>
                <td className="num">{row.yearEnd ? figure(row.yearEnd.balance) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "12k", "1.5k", "800": an axis label. */
const short = (value: number) => (value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value));

/** A round grid step giving about four lines up to `max`. */
const gridStep = (max: number) => {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].map((m) => m * power).find((step) => step >= raw) ?? raw);
};

/** The 36-month step chart, drawn to scale from the commitment series (inline SVG). */
function CommitmentChart({ series }: { series: CommitmentSeries }) {
  const W = 820, H = 240, padL = 52, padR = 16, padT = 30, padB = 30;
  const count = series.committed.length;
  const peak = Math.max(0, ...series.committed, ...(series.withWhatIf ?? []));
  if (peak === 0) return <Empty text="No instalments in the next 36 months." />;
  const step = gridStep(peak);
  const yMax = Math.ceil(peak / step) * step;
  const x = (i: number) => padL + (i / count) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / yMax) * (H - padT - padB);
  const path = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} L${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const grid: number[] = [];
  for (let g = 0; g <= yMax + 0.001; g += step) grid.push(g);
  const ticks = series.months.map((month, i) => ({ month, i })).filter(({ i }) => i % 6 === 0);
  const sameMonth = new Map<number, number>();
  return (
    <svg className="loans-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Monthly hire-purchase instalments for the next ${count} months, stepping down as each loan ends`}>
      {grid.map((g) => (
        <g key={g}>
          <line className="loans-chart-grid" x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} />
          <text className="loans-chart-axis" x={padL - 8} y={y(g) + 4} textAnchor="end">{short(g)}</text>
        </g>
      ))}
      {ticks.map(({ month, i }) => (
        <text key={month} className="loans-chart-axis" x={x(i)} y={H - 10} textAnchor="middle">{monthShort(month)}</text>
      ))}
      <path className="loans-chart-area" d={`${path(series.committed)} L${x(count)} ${y(0)} L${x(0)} ${y(0)} Z`} />
      {series.withWhatIf && <path className="loans-chart-what-if" d={path(series.withWhatIf)} strokeDasharray="5 4" />}
      <path className="loans-chart-line" d={path(series.committed)} />
      {series.ends.map((end) => {
        const stack = sameMonth.get(end.index) ?? 0;
        sameMonth.set(end.index, stack + 1);
        const at = x(end.index + 1);
        const top = y(series.committed[end.index]) - 6 - stack * 14;
        const right = at > W - 120;
        return (
          <g key={`${end.plate_key}-${end.index}`}>
            <line className="loans-chart-tick" x1={at} x2={at} y1={y(series.committed[end.index])} y2={top} />
            <text className="loans-chart-label" x={right ? at - 4 : at + 4} y={top} textAnchor={right ? "end" : "start"}>{end.plate} ends</text>
          </g>
        );
      })}
      <text className="loans-chart-now" x={x(0) + 6} y={14}>{money(series.committed[0])} / month now</text>
    </svg>
  );
}
