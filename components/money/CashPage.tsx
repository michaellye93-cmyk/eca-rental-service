import React, { useMemo, useState } from 'react';
import type { Driver } from '../../types';
import { formatCurrency, formatDate } from '../../utils';
import {
  COLLECTION_WEEKS, monthlyOutlook, STALE_BALANCE_DAYS, TIGHT_DAYS, WINDOW_DAYS, addDays, currentCash,
  type CashBalanceEntry, type CashLineSummary, type CashOutlookData,
} from '../../services/cashOutlook';
import { cancelCashBalance, saveCashBalance } from '../../services/finance/api';
import { CashStatusPill, sentenceBody } from './CashLine';

const money = (n: number) => formatCurrency(n || 0);
/** Money going out, shown in brackets as on a statement. */
const out = (n: number) => (n ? `(${formatCurrency(n)})` : formatCurrency(0));
const percent = (n: number) => `${Math.round(n * 100)}%`;

interface CashPageProps {
  today: string;
  drivers: Driver[];
  outlook: CashOutlookData | null;
  outlookState: 'loading' | 'ready' | 'unavailable';
  summary: CashLineSummary | null;
  onBalancesChange: (rows: CashBalanceEntry[]) => void;
  onReload: () => void;
}

/** Money → Cash: cash in bank (typed in here), the next three months, and bills coming up. */
export default function CashPage({ today, drivers, outlook, outlookState, summary, onBalancesChange, onReload }: CashPageProps) {
  if (outlookState === 'unavailable' || (!outlook && outlookState !== 'loading')) {
    return (
      <div className="finance-content">
        <p role="alert" className="finance-message is-warning">
          The cash view needs its database update (supabase/migrations/20260927090000_cash_position_and_outlook.sql) to be run in the
          Supabase SQL Editor first. Until then balances cannot be saved and bills cannot be read.
        </p>
        <div><button className="finance-secondary" onClick={onReload}>Try again</button></div>
      </div>
    );
  }
  if (!outlook || !summary) {
    return <section className="finance-panel"><p className="finance-dialog-copy">Working out your cash position…</p></section>;
  }
  return (
    <div className="finance-content">
      <StatusBlock summary={summary} />
      <BalanceTable today={today} outlook={outlook} onBalancesChange={onBalancesChange} />
      <OutlookTable today={today} outlook={outlook} drivers={drivers} rate={summary.rate} />
      <BillsComing today={today} outlook={outlook} />
      <Method summary={summary} outlook={outlook} />
    </div>
  );
}

function StatusBlock({ summary }: { summary: CashLineSummary }) {
  const change = summary.overdueChange;
  return (
    <>
      <section className="finance-panel cash-status" aria-labelledby="cash-status-heading">
        <h2 id="cash-status-heading" className="sr-only">Cash status</h2>
        <div className="cash-status-line">
          <CashStatusPill status={summary.status} size="md" />
          <p>{sentenceBody(summary.sentence)}</p>
        </div>
        {summary.notes.length > 0 && <ul className="cash-notes">{summary.notes.map(note => <li key={note}>{note}</li>)}</ul>}
      </section>
      <section className="finance-summary-grid" aria-label={`Cash figures for the next ${WINDOW_DAYS} days`}>
        <Figure label="Cash in bank" value={summary.cash ? money(summary.cash.total) : 'Not entered'} />
        <Figure label={`Money in, next ${WINDOW_DAYS} days`} value={money(summary.expectedIn)} hint={`Rent at ${percent(summary.rate)} of ${money(summary.rent.full)} still to come, plus ${money(summary.otherIncome)} other income`} />
        <Figure label={`Bills, next ${WINDOW_DAYS} days`} value={out(summary.bills.total)} negative />
        <Figure label="Left after those bills" value={summary.left === null ? '—' : money(summary.left)} negative={summary.left !== null && summary.left < 0} emphasis />
        <Figure label="Full days of bills left" value={summary.daysLeft === null ? '—' : summary.daysLeft < 0 ? 'None' : String(Math.floor(summary.daysLeft))} />
        <Figure label="Overdue rent" value={money(summary.overdue)} hint={change > 0.005 ? `Up ${money(change)} this week` : change < -0.005 ? `Down ${money(-change)} this week` : 'No change this week'} />
      </section>
    </>
  );
}

function Figure({ label, value, hint, negative = false, emphasis = false }: { label: string; value: string; hint?: string; negative?: boolean; emphasis?: boolean }) {
  return (
    <div className={`finance-total ${emphasis ? 'is-emphasis' : ''}`}>
      <span>{label}</span>
      <strong className={negative ? 'finance-negative' : ''}>{value}</strong>
      {hint && <small className="cash-hint">{hint}</small>}
    </div>
  );
}

/** The bank balance column the owner types into; the latest entry per account counts. */
function BalanceTable({ today, outlook, onBalancesChange }: { today: string; outlook: CashOutlookData; onBalancesChange: (rows: CashBalanceEntry[]) => void }) {
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [asOf, setAsOf] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);

  const cash = currentCash(outlook.balances, today);
  const accountNames = [...new Set(outlook.balances.map(b => b.account_label))];
  const latestIds = new Set(
    (cash?.accounts ?? []).map(a => outlook.balances.find(b => b.account_label === a.label && b.as_of.slice(0, 10) === a.asOf)?.id),
  );
  const rows = showAll ? outlook.balances : outlook.balances.filter(b => latestIds.has(b.id));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(null);
    const typed = amount.replace(/[,\s]/g, '');
    const value = Number(typed);
    if (!account.trim()) return setError('Enter the account name, for example "Maybank operating".');
    if (!/^-?\d+(\.\d{1,2})?$/.test(typed)) return setError('Enter the balance in ringgit with at most two decimals, for example 12500.50. Use a minus sign for an overdraft.');
    if (!asOf || asOf > today) return setError('Choose the date of the balance: today or earlier.');
    setBusy(true);
    try {
      onBalancesChange(await saveCashBalance(account.trim(), value, asOf, note.trim()));
      setSaved(`Saved ${account.trim()}: ${money(value)} on ${formatDate(asOf)}.`);
      setAmount('');
      setNote('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The balance could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    if (!removing.reason.trim()) return setError('Give a reason for removing this balance.');
    setBusy(true);
    setError(null);
    try {
      onBalancesChange(await cancelCashBalance(removing.id, removing.reason.trim()));
      setRemoving(null);
      setSaved('Balance removed. It stays in the audit log.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The balance could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="finance-panel" aria-labelledby="cash-balance-heading">
      <div className="finance-section-heading">
        <div>
          <h3 id="cash-balance-heading">Cash in bank</h3>
          <p>
            Type each account's balance from your banking app at least once a week (the cash line says Watch after {STALE_BALANCE_DAYS} days).
            The latest entry per account counts. Nothing is deleted; a mistake is removed with a reason.
          </p>
          <strong>{cash ? `Total now: ${money(cash.total)}` : 'No balance entered yet'}</strong>
        </div>
        {outlook.balances.length > (cash?.accounts.length ?? 0) && (
          <button className="finance-link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show latest only' : `Show all ${outlook.balances.length} entries`}</button>
        )}
      </div>
      <form onSubmit={save} noValidate>
        <div className="finance-table-wrap">
          <table className="finance-table cash-balance-table">
            <thead>
              <tr><th scope="col">Account</th><th scope="col">Balance (RM)</th><th scope="col">As of</th><th scope="col">Note</th><th scope="col">Entered</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              <tr className="cash-input-row">
                <td>
                  <label className="sr-only" htmlFor="cash-account">Account</label>
                  <input id="cash-account" list="cash-accounts" value={account} onChange={e => setAccount(e.target.value)} placeholder="e.g. Maybank operating" maxLength={80} disabled={busy} />
                  <datalist id="cash-accounts">{accountNames.map(name => <option key={name} value={name} />)}</datalist>
                </td>
                <td>
                  <label className="sr-only" htmlFor="cash-amount">Balance in ringgit</label>
                  <input id="cash-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" disabled={busy} />
                </td>
                <td>
                  <label className="sr-only" htmlFor="cash-as-of">Balance date</label>
                  <input id="cash-as-of" type="date" value={asOf} max={today} onChange={e => setAsOf(e.target.value)} disabled={busy} />
                </td>
                <td>
                  <label className="sr-only" htmlFor="cash-note">Note (optional)</label>
                  <input id="cash-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" maxLength={500} disabled={busy} />
                </td>
                <td colSpan={2}><button type="submit" className="finance-primary" disabled={busy}>{busy ? 'Saving…' : 'Save balance'}</button></td>
              </tr>
              {rows.map(entry => (
                <tr key={entry.id} className={latestIds.has(entry.id) ? '' : 'cash-older-row'}>
                  <td className="finance-strong">{entry.account_label}</td>
                  <td className={Number(entry.balance) < 0 ? 'finance-negative' : ''}>{money(Number(entry.balance))}</td>
                  <td>{formatDate(entry.as_of)}</td>
                  <td>{entry.note ?? '—'}</td>
                  <td>{formatDate(entry.entered_at)}</td>
                  <td>
                    {removing?.id === entry.id ? (
                      <span className="cash-remove">
                        <label className="sr-only" htmlFor={`cash-remove-${entry.id}`}>Reason for removing</label>
                        <input id={`cash-remove-${entry.id}`} value={removing.reason} onChange={e => setRemoving({ id: entry.id, reason: e.target.value })} placeholder="Reason" autoFocus />
                        <button type="button" className="finance-destructive" disabled={busy} onClick={() => void remove()}>Remove</button>
                        <button type="button" className="finance-secondary" disabled={busy} onClick={() => setRemoving(null)}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" className="finance-link" disabled={busy} onClick={() => setRemoving({ id: entry.id, reason: '' })}>Remove…</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
      {error && <p role="alert" className="finance-message is-error">{error}</p>}
      {saved && <p role="status" className="finance-message is-success">{saved}</p>}
    </section>
  );
}

function OutlookTable({ today, outlook, drivers, rate }: { today: string; outlook: CashOutlookData; drivers: Driver[]; rate: number }) {
  const buckets = useMemo(() => monthlyOutlook({ today, outlook, drivers }), [today, outlook, drivers]);
  const hasBalance = outlook.balances.length > 0;
  const lowest = Math.min(...buckets.map(b => b.closing));
  const row = (label: string, values: string[], className = '') => (
    <tr className={className}><th scope="row">{label}</th>{values.map((v, i) => <td key={i}>{v}</td>)}</tr>
  );
  return (
    <section className="finance-panel" aria-labelledby="cash-outlook-heading">
      <div className="finance-section-heading">
        <div>
          <h3 id="cash-outlook-heading">The next three months</h3>
          <p>
            Rent is counted at your recent collection rate ({percent(rate)} of rent due over the last {COLLECTION_WEEKS} weeks). Monthly bills are
            spread over the month because Finance does not record their due days yet. Bills are shown in brackets.
          </p>
          {!hasBalance && <p className="cash-warning">No bank balance entered, so each month starts from RM 0.00. Enter a balance above.</p>}
        </div>
      </div>
      <div className="finance-table-wrap">
        <table className="finance-table cash-outlook-table">
          <thead><tr><th scope="col">RM</th>{buckets.map(b => <th scope="col" key={b.from}>{b.label}</th>)}</tr></thead>
          <tbody>
            {row('Cash at start', buckets.map(b => money(b.opening)))}
            <tr className="cash-group"><th scope="row" colSpan={buckets.length + 1}>Money in</th></tr>
            {row(`Rent expected (${percent(rate)} of rent still due)`, buckets.map(b => money(b.rent.expected)))}
            {row('Rent still due in full (not added)', buckets.map(b => money(b.rent.full)), 'cash-reference')}
            {row('Smart Drive and other income (estimate)', buckets.map(b => money(b.otherIncome)))}
            <tr className="cash-group"><th scope="row" colSpan={buckets.length + 1}>Bills</th></tr>
            {row('Financing and owner payouts', buckets.map(b => out(b.bills.financing)))}
            {row('Operation fix cost', buckets.map(b => out(b.bills.fixed)))}
            {row('Insurance falling due', buckets.map(b => out(b.bills.insurance)))}
            {row('Workshop (3-month average)', buckets.map(b => out(b.bills.workshop)))}
            {row('Other vehicle costs (3-month average)', buckets.map(b => out(b.bills.vehicleCosts)))}
            {row('One-off company costs (3-month average)', buckets.map(b => out(b.bills.oneOffOpex)))}
            <tr className="cash-total-row">
              <th scope="row">Cash at end</th>
              {buckets.map(b => <td key={b.from} className={`${b.closing < 0 ? 'finance-negative' : ''} ${b.closing === lowest ? 'cash-lowest' : ''}`}>{money(b.closing)}</td>)}
            </tr>
            {row('…if all rent due is collected', buckets.map(b => money(b.closingIfAllRentPaid)), 'cash-if-paid')}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BillsComing({ today, outlook }: { today: string; outlook: CashOutlookData }) {
  const until = addDays(today, 59);
  const insurance = outlook.insurance.filter(item => item.due_date.slice(0, 10) >= today && item.due_date.slice(0, 10) <= until);
  const thisMonth = outlook.months[0];
  return (
    <section className="finance-panel" aria-labelledby="cash-bills-heading">
      <div className="finance-section-heading">
        <div>
          <h3 id="cash-bills-heading">Bills coming up</h3>
          <p>
            Every month: {money(Number(thisMonth?.recurring ?? 0))} financing and owner payouts, and {money(Number(thisMonth?.fixed ?? 0))} operation
            fix cost. Insurance due in the next 60 days is listed below.
          </p>
        </div>
      </div>
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead><tr><th scope="col">Due</th><th scope="col">Vehicle</th><th scope="col">What</th><th scope="col">Amount</th></tr></thead>
          <tbody>
            {insurance.length ? insurance.map(item => (
              <tr key={`${item.plate_key}-${item.due_date}-${item.kind}`}>
                <td>{formatDate(item.due_date)}</td>
                <td className="finance-strong">{item.display_plate}</td>
                <td>{item.kind === 'RENEWAL' ? 'Insurance renewal (last premium)' : 'Insurance policy starting'}</td>
                <td>{out(Number(item.amount))}</td>
              </tr>
            )) : <tr><td colSpan={4}><p className="finance-empty">No ECA-paid insurance falls due in the next 60 days.</p></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Method({ summary, outlook }: { summary: CashLineSummary; outlook: CashOutlookData }) {
  const months = outlook.history.filter(h => h.has_data).map(h => new Date(`${h.month.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }));
  return (
    <details className="finance-panel cash-method">
      <summary>How these figures are worked out</summary>
      <ul>
        <li>Cash means money received. Repair credits (service claims) settle rent but bring in no money, so they never count as cash.</li>
        <li>Cash in bank is the latest balance you entered for each account. Money received after that date is not counted until you enter a newer balance, so update it weekly.</li>
        <li>Overdue rent is rent that fell due before today and is still unpaid; rent due today is not overdue yet. The driver list's Outstanding also includes rent due today, so it can be higher.</li>
        <li>Collection rate: cash received divided by rent due over the last {COLLECTION_WEEKS} weeks, for active drivers, capped at 100%. It is {percent(summary.rate)} now.</li>
        <li>Rent due comes from the same rent schedule as the driver list, including drivers past their recorded contract length (rent continues until an end date or delist). Rent paid in advance is already in the bank, so it is not counted again.</li>
        <li>Bills: monthly vehicle costs and operation fix costs from Finance, insurance on each policy's start date (Finance's date for premiums, so a policy you paid early still shows until it starts), and 3-month averages for workshop, other vehicle costs and one-off company costs{months.length ? ` (${months.join(', ')})` : ' (no months with Finance data yet)'}.</li>
        <li>Status: Short when bills are more than cash plus money in; Tight when fewer than {TIGHT_DAYS} days of bills would be left; Watch when the bank balance is missing or more than {STALE_BALANCE_DAYS} days old, or overdue rent grew this week; otherwise Covered.</li>
      </ul>
    </details>
  );
}
