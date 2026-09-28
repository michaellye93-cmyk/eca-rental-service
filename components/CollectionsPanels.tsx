import React, { useState } from 'react';
import { HandCoins, Target } from 'lucide-react';
import type { Driver } from '../types';
import { formatCurrency, formatDate } from '../utils';
import { catchUpStatus, latestPromise, promiseStatus, runningPlan, type CatchUpStatus, type PromiseState } from '../services/collections';
import { whoLabel } from '../services/paymentLog';
import { logPromise, removePromise, startPlan, stopPlan } from '../services/collectionsApi';
import type { CollectionsExtras } from './useCollectionsExtras';
import { ConfirmDialog } from './Dialog';

interface CollectionsPanelsProps {
  driver: Driver;
  extras: CollectionsExtras;
  isAdmin: boolean;
  /** Kuala Lumpur calendar day (YYYY-MM-DD) and wall-clock time. */
  today: string;
  now: Date;
}

const PROMISE_LOOK: Record<PromiseState, { label: string; look: string }> = {
  OPEN: { label: 'Open', look: 'bg-blue-50 text-blue-800 border-blue-200' },
  KEPT: { label: 'Kept', look: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  MISSED: { label: 'Missed', look: 'bg-rose-50 text-rose-800 border-rose-200' },
};

const PLAN_LOOK: Record<CatchUpStatus['state'], string> = {
  ON_TRACK: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BEHIND: 'bg-rose-50 text-rose-800 border-rose-200',
  NOT_STARTED: 'bg-gray-50 text-gray-700 border-gray-200',
  ENDED: 'bg-gray-50 text-gray-700 border-gray-200',
  STOPPED: 'bg-gray-50 text-gray-700 border-gray-200',
};

/** A plan's state as a short label, e.g. "Behind by RM 50.00". */
export const planLabel = (status: CatchUpStatus, startDate: string) =>
  status.state === 'ON_TRACK' ? 'On track'
    : status.state === 'BEHIND' ? `Behind by ${formatCurrency(status.behindBy)}`
      : status.state === 'NOT_STARTED' ? `Starts ${formatDate(startDate)}`
        : status.state === 'ENDED' ? 'Ended' : 'Stopped';

const reachText = (date: string | null) => (date === 'NOW' ? 'already' : date ? formatDate(date) : 'not before the contract stops');

const input = 'w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const label = 'text-xs font-bold text-gray-500 uppercase';

/** Promise to pay and catch-up plan for one driver, below their expanded details. */
export default function CollectionsPanels({ driver, extras, isAdmin, today, now }: CollectionsPanelsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
      <PromisePanel driver={driver} extras={extras} isAdmin={isAdmin} today={today} />
      <PlanPanel driver={driver} extras={extras} isAdmin={isAdmin} today={today} now={now} />
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 text-sm text-gray-800">
      <h5 className="flex items-center gap-2 text-sm font-bold text-gray-900">{icon}{title}</h5>
      {children}
    </section>
  );
}

function PromisePanel({ driver, extras, isAdmin, today }: Omit<CollectionsPanelsProps, 'now'>) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const icon = <HandCoins className="w-4 h-4 text-blue-600" aria-hidden="true" />;

  if (!extras.loaded) return <Card title="Promise to pay" icon={icon}><p className="text-gray-500">Loading…</p></Card>;
  if (extras.promises === null) return <Card title="Promise to pay" icon={icon}><p className="text-gray-600">Promises need the database update, which has not been run yet.</p></Card>;

  const promise = latestPromise(extras.promises, driver.id);
  const status = promise ? promiseStatus(promise, driver, today) : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!(value > 0)) { setError('Enter the promised amount.'); return; }
    if (!date || date < today) { setError('Choose today or a later date.'); return; }
    setBusy(true);
    setError(null);
    try {
      await logPromise(driver.id, value, date, note);
      setAmount(''); setDate(''); setNote('');
      await extras.reload();
    } catch (err) {
      setError(`Not saved: ${err instanceof Error ? err.message : 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!promise) return;
    setConfirmRemove(false);
    try {
      await removePromise(promise.id);
      await extras.reload();
    } catch (err) {
      setError(`Not removed: ${err instanceof Error ? err.message : 'try again'}`);
    }
  };

  return (
    <Card title="Promise to pay" icon={icon}>
      {promise && status ? (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{formatCurrency(promise.amount)} by {formatDate(promise.promised_date)}</span>
            <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${PROMISE_LOOK[status.state].look}`}>{PROMISE_LOOK[status.state].label}</span>
          </p>
          <p className="text-xs text-gray-600">
            {status.state === 'KEPT' ? `${formatCurrency(status.paid)} paid since it was logged.` : `${formatCurrency(status.paid)} paid so far, ${formatCurrency(status.left)} to go.`}
            {' '}Logged by {whoLabel(promise.logged_by_role, promise.logged_by_name)} on {formatDate(promise.logged_on)}.
          </p>
          {promise.note && <p className="text-xs text-gray-700">Note: {promise.note}</p>}
          {isAdmin && <button type="button" onClick={() => setConfirmRemove(true)} className="text-xs font-semibold text-rose-700 underline">Remove this promise</button>}
        </div>
      ) : (
        <p className="text-gray-600">No promise logged.</p>
      )}
      <form onSubmit={submit} className="grid grid-cols-2 gap-2" aria-label="Log a promise to pay">
        <div>
          <label htmlFor={`promise-amount-${driver.id}`} className={label}>Amount (RM)</label>
          <input id={`promise-amount-${driver.id}`} type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor={`promise-date-${driver.id}`} className={label}>By date</label>
          <input id={`promise-date-${driver.id}`} type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className={input} />
        </div>
        <div className="col-span-2">
          <label htmlFor={`promise-note-${driver.id}`} className={label}>Note <span className="normal-case font-medium">(optional)</span></label>
          <input id={`promise-note-${driver.id}`} type="text" maxLength={300} value={note} onChange={e => setNote(e.target.value)} className={input} />
        </div>
        {error && <p role="alert" className="col-span-2 text-xs font-medium text-rose-700">{error}</p>}
        <button type="submit" disabled={busy} className="col-span-2 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg">{busy ? 'Saving…' : 'Log promise'}</button>
      </form>
      {confirmRemove && promise && (
        <ConfirmDialog title="Remove promise" confirmLabel="Remove" onConfirm={() => void remove()} onCancel={() => setConfirmRemove(false)}>
          <p>Remove the promise of {formatCurrency(promise.amount)} by {formatDate(promise.promised_date)}? Only do this for a promise logged by mistake.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function PlanPanel({ driver, extras, isAdmin, today, now }: CollectionsPanelsProps) {
  const [extra, setExtra] = useState('');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const icon = <Target className="w-4 h-4 text-indigo-600" aria-hidden="true" />;
  const cycle = driver.rentalCycle === 'MONTHLY' ? 'month' : 'week';

  if (!extras.loaded) return <Card title="Catch-up plan" icon={icon}><p className="text-gray-500">Loading…</p></Card>;
  if (extras.plans === null) return <Card title="Catch-up plan" icon={icon}><p className="text-gray-600">Catch-up plans need the database update, which has not been run yet.</p></Card>;

  const plan = runningPlan(extras.plans, driver.id, today);
  const status = plan ? catchUpStatus(plan, driver, now) : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(extra);
    if (!(value > 0)) { setError(`Enter the extra amount each ${cycle}.`); return; }
    if (!start) { setError('Choose the start date.'); return; }
    if (end && end < start) { setError('The end date must be on or after the start date.'); return; }
    setBusy(true);
    setError(null);
    try {
      await startPlan({ driverId: driver.id, extra: value, start, end: end || null, note }, plan?.id ?? null, today);
      setExtra(''); setEnd(''); setNote(''); setFormOpen(false);
      await extras.reload();
    } catch (err) {
      setError(`Not saved: ${err instanceof Error ? err.message : 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!plan) return;
    setConfirmStop(false);
    try {
      await stopPlan(plan.id, today);
      await extras.reload();
    } catch (err) {
      setError(`Not stopped: ${err instanceof Error ? err.message : 'try again'}`);
    }
  };

  return (
    <Card title="Catch-up plan" icon={icon}>
      {plan && status ? (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1.5">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{formatCurrency(plan.extra_per_cycle)} extra each {cycle} from {formatDate(plan.start_date)}{plan.end_date ? ` until ${formatDate(plan.end_date)}` : ''}</span>
            <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${PLAN_LOOK[status.state]}`}>{planLabel(status, plan.start_date)}</span>
          </p>
          {status.state !== 'NOT_STARTED' && (
            <p className="text-xs text-gray-600">Overdue now {formatCurrency(status.overdue)}; the plan's target is {formatCurrency(status.target)} (from {formatCurrency(status.startBalance)} at the start).</p>
          )}
          <p className="text-xs text-gray-600">Paying rent plus the extra every {cycle}: under the BAD line {reachText(status.reachesMid)}, nothing owed {reachText(status.reachesGood)}.</p>
          {status.endsBeforeGood && <p className="text-xs font-semibold text-amber-800">The plan ends before the balance is cleared.</p>}
          {status.checkpoints.length > 0 && (
            <ul className="text-xs text-gray-700 space-y-0.5" aria-label="Check after each rent due date">
              {status.checkpoints.map(point => (
                <li key={point.due} className={point.onTrack ? '' : 'text-rose-700 font-semibold'}>
                  {formatDate(point.due)}: {point.onTrack ? 'on track' : 'behind'} ({formatCurrency(point.overdue)} overdue, target {formatCurrency(point.target)})
                </li>
              ))}
            </ul>
          )}
          {plan.note && <p className="text-xs text-gray-700">Note: {plan.note}</p>}
          <p className="text-xs text-gray-500">Set by {whoLabel(plan.created_by_role, plan.created_by_name)}.</p>
          {isAdmin && <button type="button" onClick={() => setConfirmStop(true)} className="text-xs font-semibold text-rose-700 underline">Stop this plan</button>}
        </div>
      ) : (
        <p className="text-gray-600">No catch-up plan.{isAdmin ? '' : ' An admin can start one.'}</p>
      )}
      {isAdmin && !formOpen && (
        <button type="button" onClick={() => { setStart(today); setFormOpen(true); }} className="text-sm font-semibold text-blue-700 underline">
          {plan ? 'Replace with a new plan' : 'Start a catch-up plan'}
        </button>
      )}
      {isAdmin && formOpen && (
        <form onSubmit={submit} className="grid grid-cols-2 gap-2" aria-label="Start a catch-up plan">
          <div>
            <label htmlFor={`plan-extra-${driver.id}`} className={label}>Extra each {cycle} (RM)</label>
            <input id={`plan-extra-${driver.id}`} type="number" min="0" step="0.01" value={extra} onChange={e => setExtra(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`plan-start-${driver.id}`} className={label}>Start</label>
            <input id={`plan-start-${driver.id}`} type="date" value={start} onChange={e => setStart(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`plan-end-${driver.id}`} className={label}>End <span className="normal-case font-medium">(optional)</span></label>
            <input id={`plan-end-${driver.id}`} type="date" min={start} value={end} onChange={e => setEnd(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`plan-note-${driver.id}`} className={label}>Note</label>
            <input id={`plan-note-${driver.id}`} type="text" maxLength={300} value={note} onChange={e => setNote(e.target.value)} className={input} />
          </div>
          {plan && <p className="col-span-2 text-xs text-gray-600">The current plan stops today when the new one is saved.</p>}
          {error && <p role="alert" className="col-span-2 text-xs font-medium text-rose-700">{error}</p>}
          <div className="col-span-2 flex gap-2">
            <button type="button" onClick={() => { setFormOpen(false); setError(null); }} className="flex-1 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={busy} className="flex-1 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg">{busy ? 'Saving…' : 'Save plan'}</button>
          </div>
        </form>
      )}
      {!formOpen && error && <p role="alert" className="text-xs font-medium text-rose-700">{error}</p>}
      {confirmStop && plan && (
        <ConfirmDialog title="Stop catch-up plan" confirmLabel="Stop plan" onConfirm={() => void stop()} onCancel={() => setConfirmStop(false)}>
          <p>Stop the plan of {formatCurrency(plan.extra_per_cycle)} extra each {cycle} from today? Rent itself does not change.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
