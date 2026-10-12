import { useCallback, useEffect, useState } from 'react';
import type { Driver } from '../types';
import { formatCurrency, kualaLumpurNow, kualaLumpurToday } from '../utils';
import { defaultRunSlot, RUN_SLOTS, runStartAt, runSummaryPrefill, type CategoryCounts, type RunSlot } from '../services/collectionRuns';
import { loadDailyStatus, loadPaymentChangesSince, loadPromises, loadRecentContacts, saveRun } from '../services/collectionsApi';

const SLOT_TIME: Record<RunSlot, string> = { '1PM': '13:00', '9PM': '21:00' };
const CATEGORIES: (keyof CategoryCounts)[] = ['good', 'mid', 'bad'];
type Counts = Record<keyof CategoryCounts, string>;
const EMPTY_COUNTS: Counts = { good: '', mid: '', bad: '' };
const asText = (counts: CategoryCounts | null): Counts => (counts ? { good: String(counts.good), mid: String(counts.mid), bad: String(counts.bad) } : EMPTY_COUNTS);

/** A whole number of 0 or more typed in a box, or null. */
const wholeNumber = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
/** The three category counts, all typed (whole numbers) or all empty (null); undefined when only some are. */
const countsOf = (counts: Counts): CategoryCounts | null | undefined => {
  const values = CATEGORIES.map(key => counts[key].trim());
  if (values.every(value => value === '')) return null;
  const numbers = values.map(wholeNumber);
  return numbers.every(value => value !== null) ? { good: numbers[0]!, mid: numbers[1]!, bad: numbers[2]! } : undefined;
};
const isMissingTable = (error: unknown) => {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  return code === '42P01' || code === 'PGRST205' || /could not find the table|does not exist/i.test(message ?? '');
};

/**
 * "Record run summary" on the worklist: what the daily run did, pre-filled from what the system recorded since the run
 * started (payments, asks, promises, cash, GOOD / MID / BAD now against the day's snapshot). The person adjusts it, adds
 * what blocked the run and a summary, and saves. Summaries cannot be edited afterwards (an admin can delete one).
 */
export default function RunSummaryPanel({ drivers }: { drivers: Driver[] }) {
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<RunSlot>(() => defaultRunSlot(kualaLumpurNow()));
  const [startTime, setStartTime] = useState(() => SLOT_TIME[defaultRunSlot(kualaLumpurNow())]);
  const [counting, setCounting] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [payments, setPayments] = useState('');
  const [asks, setAsks] = useState('');
  const [promises, setPromises] = useState('');
  const [collected, setCollected] = useState('');
  const [before, setBefore] = useState<Counts>(EMPTY_COUNTS);
  const [after, setAfter] = useState<Counts>(EMPTY_COUNTS);
  const [blocks, setBlocks] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'saved'; text: string } | null>(null);

  const count = useCallback(async (runSlot: RunSlot, time: string) => {
    setCounting(true);
    const today = kualaLumpurToday();
    const start = runStartAt(today, runSlot, time).toISOString();
    const [changes, contacts, promiseRows, snapshot] = await Promise.allSettled([
      loadPaymentChangesSince(start), loadRecentContacts(start), loadPromises(), loadDailyStatus(today),
    ]);
    const value = <T,>(result: PromiseSettledResult<T>) => (result.status === 'fulfilled' ? result.value : null);
    const prefill = runSummaryPrefill({
      startedAt: new Date(start), now: kualaLumpurNow(), drivers,
      changes: value(changes), contacts: value(contacts), promises: value(promiseRows),
      snapshot: value(snapshot)?.filter(row => row.day === today) ?? null,
    });
    const missing = [
      changes.status === 'rejected' && 'payments recorded (the payment log could not be read)',
      contacts.status === 'rejected' && 'asks (the contact log is not available yet)',
      promiseRows.status === 'rejected' && 'promises (not available yet)',
      prefill.categories_before === null && "GOOD / MID / BAD before the run (no status snapshot for today)",
    ].filter((note): note is string => Boolean(note));
    setNotes(missing);
    setPayments(String(prefill.payments_recorded));
    setAsks(String(prefill.asks_sent));
    setPromises(String(prefill.promises_logged));
    setCollected(String(prefill.collected));
    setBefore(asText(prefill.categories_before));
    setAfter(asText(prefill.categories_after));
    setCounting(false);
  }, [drivers]);

  // Counted once when the form opens; changing the run or start time, or "Count again", counts again
  useEffect(() => { if (open) void count(slot, startTime); }, [open]);

  const chooseSlot = (next: RunSlot) => {
    setSlot(next);
    setStartTime(SLOT_TIME[next]);
    void count(next, SLOT_TIME[next]);
  };

  const save = async () => {
    setMessage(null);
    const today = kualaLumpurToday();
    const start = runStartAt(today, slot, startTime);
    const finished = new Date();
    const numbers = [wholeNumber(payments), wholeNumber(asks), wholeNumber(promises)];
    const cash = Number(collected);
    const categoriesBefore = countsOf(before);
    const categoriesAfter = countsOf(after);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return setMessage({ kind: 'error', text: 'Enter the start time as HH:MM.' });
    if (start.getTime() > finished.getTime()) return setMessage({ kind: 'error', text: 'The start time is later than now.' });
    if (numbers.some(value => value === null)) return setMessage({ kind: 'error', text: 'Payments, asks and promises must be whole numbers of 0 or more.' });
    if (collected.trim() === '' || !Number.isFinite(cash) || cash < 0) return setMessage({ kind: 'error', text: 'Enter the cash collected (RM 0 or more).' });
    if (categoriesBefore === undefined || categoriesAfter === undefined) return setMessage({ kind: 'error', text: 'Fill in all three of GOOD, MID and BAD, or leave all three empty.' });
    setSaving(true);
    try {
      await saveRun({
        run_date: today, run_slot: slot, started_at: start.toISOString(), finished_at: finished.toISOString(),
        payments_recorded: numbers[0]!, asks_sent: numbers[1]!, promises_logged: numbers[2]!, collected: Math.round(cash * 100) / 100,
        categories_before: categoriesBefore, categories_after: categoriesAfter, blocks: blocks.trim() || null, summary: summary.trim() || null,
      });
      setMessage({ kind: 'saved', text: `The ${slot} run summary is saved. The owner sees it in Finance → Collections.` });
      setBlocks('');
      setSummary('');
    } catch (error) {
      setMessage({ kind: 'error', text: isMissingTable(error)
        ? 'Run summaries are not available yet: the database update (collection runs) has not been run.'
        : `Not saved: ${(error as { message?: string })?.message ?? 'unknown error'}` });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="mb-3">
        <button type="button" onClick={() => { setMessage(null); setOpen(true); }} className="px-3 py-1.5 text-sm font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg">Record run summary</button>
      </div>
    );
  }

  const field = 'w-full p-2 border border-gray-300 rounded-lg text-sm';
  const countsBox = (label: string, counts: Counts, change: (next: Counts) => void) => (
    <fieldset className="space-y-1">
      <legend className="text-xs font-bold uppercase tracking-wider text-gray-600">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {CATEGORIES.map(key => (
          <label key={key} className="text-xs font-semibold text-gray-700">{key.toUpperCase()}
            <input inputMode="numeric" value={counts[key]} onChange={event => change({ ...counts, [key]: event.target.value })} className={field} />
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <section aria-labelledby="run-summary-heading" className="mb-4 rounded-xl border border-blue-200 bg-blue-50/40 p-3 sm:p-4 text-sm space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="run-summary-heading" className="font-bold">Record run summary</h2>
        <button type="button" onClick={() => void count(slot, startTime)} disabled={counting} className="text-sm font-semibold text-blue-700 underline disabled:opacity-60">{counting ? 'Counting…' : 'Count again'}</button>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-sm font-semibold text-gray-600 underline">Close</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="font-semibold text-gray-700">Run
          <select value={slot} onChange={event => chooseSlot(event.target.value as RunSlot)} className={field}>
            {RUN_SLOTS.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="font-semibold text-gray-700">Started (Kuala Lumpur)
          <input type="time" value={startTime} onChange={event => setStartTime(event.target.value)} onBlur={() => void count(slot, startTime)} className={field} />
        </label>
      </div>
      <p className="text-gray-600">Counted from what the system recorded today since the run started. Check and adjust before saving.</p>
      {notes.length > 0 && <p className="text-amber-900">Not counted: {notes.join('; ')}.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="font-semibold text-gray-700">Payments recorded<input inputMode="numeric" value={payments} onChange={event => setPayments(event.target.value)} className={field} /></label>
        <label className="font-semibold text-gray-700">Asks sent<input inputMode="numeric" value={asks} onChange={event => setAsks(event.target.value)} className={field} /></label>
        <label className="font-semibold text-gray-700">Promises logged<input inputMode="numeric" value={promises} onChange={event => setPromises(event.target.value)} className={field} /></label>
        <label className="font-semibold text-gray-700">Cash collected (RM)<input inputMode="decimal" value={collected} onChange={event => setCollected(event.target.value)} className={field} /></label>
      </div>
      <p className="text-xs text-gray-600">Asks: statements, asks and follow-ups logged. Cash: bank transfers, cash deposits and cash in hand recorded{collected && Number.isFinite(Number(collected)) ? ` (${formatCurrency(Number(collected))})` : ''}; service claims are not cash.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {countsBox('Before the run (today’s snapshot)', before, setBefore)}
        {countsBox('After the run (now)', after, setAfter)}
      </div>
      <label className="block font-semibold text-gray-700">What blocked the run (optional)
        <textarea value={blocks} maxLength={4000} rows={2} onChange={event => setBlocks(event.target.value)} className={field} />
      </label>
      <label className="block font-semibold text-gray-700">Summary for the owner (optional)
        <textarea value={summary} maxLength={4000} rows={3} onChange={event => setSummary(event.target.value)} className={field} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving || counting} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg">{saving ? 'Saving…' : 'Save summary'}</button>
        {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-rose-700' : 'text-emerald-800'}>{message.text}</p>}
      </div>
    </section>
  );
}
