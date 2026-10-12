import React, { useEffect, useState } from 'react';
import { HandCoins, MessagesSquare, Target } from 'lucide-react';
import type { Driver } from '../types';
import { formatCurrency, formatDate } from '../utils';
import { CONTACT_KINDS, catchUpStatus, contactsForDriver, latestPromise, promiseStatus, runningPlan, runSlotAt, type CatchUpStatus, type CollectionContact, type ContactKind, type PromiseState } from '../services/collections';
import { whoLabel } from '../services/paymentLog';
import { loadDriverContacts, logContact, logPromise, removeContact, removePromise, startPlan, stopPlan } from '../services/collectionsApi';
import { CONTACT_DAYS, type CollectionsExtras } from './useCollectionsExtras';
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

/** Promise to pay, catch-up plan and contact log for one driver, below their expanded details. */
export default function CollectionsPanels({ driver, extras, isAdmin, today, now }: CollectionsPanelsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
      <PromisePanel driver={driver} extras={extras} isAdmin={isAdmin} today={today} />
      <PlanPanel driver={driver} extras={extras} isAdmin={isAdmin} today={today} now={now} />
      <div className="lg:col-span-2"><ContactLogPanel driver={driver} extras={extras} isAdmin={isAdmin} now={now} /></div>
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

const KIND_LABEL = Object.fromEntries(CONTACT_KINDS.map(({ kind, label }) => [kind, label])) as Record<ContactKind, string>;
const contactTime = (at: string) =>
  new Date(at).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

/**
 * The driver's last 10 contacts (statements, asks, replies, disputes and so on) and a form to log one. The message text
 * is read here, for this driver only, when the panel is shown, and again whenever the driver's entries in the shared
 * contact list change (something logged or removed here or from the statement window).
 */
function ContactLogPanel({ driver, extras, isAdmin, now }: { driver: Driver; extras: CollectionsExtras; isAdmin: boolean; now: Date }) {
  const [kind, setKind] = useState<ContactKind>('ASK');
  const [slot, setSlot] = useState<string>(() => runSlotAt(now) ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<string | null>(null);
  const [entries, setEntries] = useState<CollectionContact[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The driver's latest entries (without text) from the shared list: when they change, the texts are read again
  const entryKey = extras.contacts === null ? null : contactsForDriver(extras.contacts, driver.id).map(entry => entry.id).join(',');
  useEffect(() => {
    if (entryKey === null) return;
    if (entryKey === '') { setEntries([]); setLoadError(null); return; }
    let live = true;
    const since = new Date(Date.now() - CONTACT_DAYS * 86_400_000).toISOString();
    loadDriverContacts(driver.id, since)
      .then(rows => { if (live) { setEntries(rows); setLoadError(null); } })
      .catch(err => { if (live) setLoadError(err instanceof Error ? err.message : 'try again'); });
    return () => { live = false; };
  }, [driver.id, entryKey]);
  const icon = <MessagesSquare className="w-4 h-4 text-teal-600" aria-hidden="true" />;

  if (!extras.loaded) return <Card title="Contact log" icon={icon}><p className="text-gray-500">Loading…</p></Card>;
  if (extras.contacts === null) return <Card title="Contact log" icon={icon}><p className="text-gray-600">The contact log needs the database update, which has not been run yet.</p></Card>;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim()) { setError('Write what was sent or said.'); return; }
    setBusy(true);
    setError(null);
    try {
      await logContact({ driverId: driver.id, kind, runSlot: slot || null, message });
      setMessage('');
      await extras.reload();
    } catch (err) {
      setError(`Not saved: ${err instanceof Error ? err.message : 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const id = toRemove;
    setToRemove(null);
    if (!id) return;
    try {
      await removeContact(id);
      await extras.reload();
    } catch (err) {
      setError(`Not removed: ${err instanceof Error ? err.message : 'try again'}`);
    }
  };

  return (
    <Card title="Contact log" icon={icon}>
      {loadError && entries === null ? (
        <p className="text-rose-700">The contact log could not be read: {loadError}</p>
      ) : entries === null ? (
        <p className="text-gray-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-600">Nothing logged in the last 45 days.</p>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1" aria-label="Last 10 contacts, newest first">
          {entries.map(entry => (
            <li key={entry.id} className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-gray-600">
                <span className="font-bold text-gray-900">{KIND_LABEL[entry.kind] ?? entry.kind}</span>
                <span>{contactTime(entry.contacted_at)}{entry.run_slot ? ` · ${entry.run_slot} run` : ''}</span>
                <span>· {whoLabel(entry.logged_by_role, entry.logged_by_name)}</span>
                {isAdmin && <button type="button" onClick={() => setToRemove(entry.id)} className="ml-auto font-semibold text-rose-700 underline">Remove</button>}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-gray-800">{entry.message}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="grid grid-cols-2 gap-2" aria-label="Log a contact">
        <div>
          <label htmlFor={`contact-kind-${driver.id}`} className={label}>Kind</label>
          <select id={`contact-kind-${driver.id}`} value={kind} onChange={e => setKind(e.target.value as ContactKind)} className={input}>
            {CONTACT_KINDS.map(option => <option key={option.kind} value={option.kind}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`contact-slot-${driver.id}`} className={label}>Run <span className="normal-case font-medium">(optional)</span></label>
          <select id={`contact-slot-${driver.id}`} value={slot} onChange={e => setSlot(e.target.value)} className={input}>
            <option value="">None</option>
            <option value="1PM">1PM</option>
            <option value="9PM">9PM</option>
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor={`contact-message-${driver.id}`} className={label}>Message</label>
          <textarea id={`contact-message-${driver.id}`} rows={2} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} className={input} />
        </div>
        {error && <p role="alert" className="col-span-2 text-xs font-medium text-rose-700">{error}</p>}
        <button type="submit" disabled={busy} className="col-span-2 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg">{busy ? 'Saving…' : 'Log contact'}</button>
      </form>
      {toRemove && (
        <ConfirmDialog title="Remove contact" confirmLabel="Remove" onConfirm={() => void remove()} onCancel={() => setToRemove(null)}>
          <p>Remove this contact log entry? Only do this for an entry logged by mistake.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
