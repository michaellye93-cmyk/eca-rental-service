import { useEffect, useState } from 'react';
import type { Driver } from '../types';
import { formatCurrency, kualaLumpurToday } from '../utils';
import { receivedByKind } from '../services/depositTotals';
import { addDeposit, deleteDeposit, depositHeld, depositKindFor, depositKindLabel, loadDeposits, type DepositEntry, type DepositKind, type DriverDeposit } from '../services/depositsApi';

const ENTRY_LABEL: Record<DepositEntry, string> = { RECEIVED: 'Received', REFUNDED: 'Refunded', FORFEITED: 'Forfeited (no rent owed)', CONTRA: 'Deposit forfeit (against rent)' };

/**
 * The driver's deposit (Sewa Biasa), or downpayment and security deposit (Sewa Beli, either or both): what was
 * received, refunded or forfeited, and what is still held. Kept apart from rent; every change is logged with who made it. "Deposit forfeit" is for termination:
 * the deposit is set against rent owed, so a matching rent payment (method Deposit contra) is recorded with it.
 */
export default function DriverDeposits({ driver, onContraPayment }: { driver: Pick<Driver, 'id' | 'category'>; onContraPayment?: (amount: number, date: string) => unknown }) {
  // Sewa Beli may take a downpayment, a security deposit, or both; Sewa Biasa a deposit
  const isBeli = depositKindFor(driver.category) === 'DOWNPAYMENT';
  const label = isBeli ? 'Downpayment and security deposit' : 'Deposit';
  const kindLabel = (kind: DepositKind) => (isBeli && kind === 'DEPOSIT' ? 'Security deposit' : depositKindLabel(kind));
  const [kind, setKind] = useState<DepositKind>(() => depositKindFor(driver.category));
  const [rows, setRows] = useState<DriverDeposit[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [adding, setAdding] = useState(false);
  const [entry, setEntry] = useState<DepositEntry>('RECEIVED');
  const [date, setDate] = useState(() => kualaLumpurToday());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    loadDeposits(driver.id).then((list) => { if (live) setRows(list); }).catch(() => { if (live) setUnavailable(true); });
    return () => { live = false; };
  }, [driver.id]);

  if (unavailable) return null;
  const held = depositHeld((rows ?? []).filter(r => r.kind === 'DEPOSIT'));
  const received = receivedByKind(rows ?? []);
  const save = async () => {
    const value = Math.round(parseFloat(amount) * 100) / 100;
    if (!(value > 0) || !date) { setError('Enter a date and an amount above zero.'); return; }
    setBusy(true);
    setError('');
    try {
      if (entry === 'CONTRA' && value > held + 0.001) { setError(`Only ${formatCurrency(held)} is held.`); return; }
      const saved = await addDeposit({ driver_id: driver.id, kind, entry, entry_date: date, amount: value, note: note.trim() || null });
      if (entry === 'CONTRA') await onContraPayment?.(value, date);
      setRows((list) => [saved, ...(list ?? [])].sort((a, b) => b.entry_date.localeCompare(a.entry_date)));
      setAdding(false);
      setAmount('');
      setNote('');
      setEntry('RECEIVED');
      setKind(depositKindFor(driver.category));
    } catch (e: any) {
      setError(`Not saved: ${e?.message ?? 'please try again'}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (row: DriverDeposit) => {
    if (!window.confirm(`Delete the ${ENTRY_LABEL[row.entry].toLowerCase()} ${kindLabel(row.kind).toLowerCase()} of ${formatCurrency(row.amount)} on ${row.entry_date}? The change is logged.`)) return;
    setBusy(true);
    try {
      await deleteDeposit(row.id);
      setRows((list) => (list ?? []).filter((r) => r.id !== row.id));
    } catch (e: any) {
      setError(`Not deleted: ${e?.message ?? 'please try again'}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3 text-xs" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-bold text-gray-900">{label}</h5>
        <span className="text-gray-600">
          {isBeli && <>Downpayment received: <b className="font-mono text-gray-900">{formatCurrency(received.DOWNPAYMENT)}</b> · Security deposit held: </>}
          {!isBeli && 'Held: '}<b className="font-mono text-gray-900">{formatCurrency(held)}</b>
        </span>
        {!adding && <button type="button" onClick={() => setAdding(true)} className="rounded border border-gray-300 px-2 py-1 font-semibold hover:bg-gray-50">Record {isBeli ? 'money' : 'deposit'}</button>}
      </div>
      {rows === null ? <p className="mt-2 text-gray-500">Loading…</p> : rows.length === 0 && !adding ? (
        <p className="mt-2 text-gray-500">No {label.toLowerCase()} recorded yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="font-mono text-gray-600">{row.entry_date}</span>
              {isBeli && <span className="font-semibold text-gray-700">{kindLabel(row.kind)}</span>}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${row.entry === 'RECEIVED' ? 'bg-emerald-50 text-emerald-800' : row.entry === 'REFUNDED' ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-800'}`}>{ENTRY_LABEL[row.entry]}</span>
              <b className="font-mono">{formatCurrency(row.amount)}</b>
              {row.note && <span className="text-gray-500">{row.note}</span>}
              <button type="button" onClick={() => void remove(row)} disabled={busy} className="ml-auto text-red-600 hover:underline">Delete</button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          {isBeli && (
            <label className="block sm:col-span-4">For
              <select value={kind} onChange={(e) => { setKind(e.target.value as DepositKind); setEntry('RECEIVED'); }} className="mt-0.5 w-full rounded border border-gray-300 p-1">
                <option value="DOWNPAYMENT">Downpayment (not refundable)</option>
                <option value="DEPOSIT">Security deposit (refundable)</option>
              </select>
            </label>
          )}
          <label className="block">Type
            <select value={entry} onChange={(e) => setEntry(e.target.value as DepositEntry)} className="mt-0.5 w-full rounded border border-gray-300 p-1">
              <option value="RECEIVED">Received</option>
              {kind === 'DEPOSIT' && <option value="REFUNDED">Refunded</option>}
              {kind === 'DEPOSIT' && <option value="FORFEITED">Forfeited (no rent owed)</option>}
              {kind === 'DEPOSIT' && onContraPayment && <option value="CONTRA">Deposit forfeit (set against rent owed)</option>}
            </select>
          </label>
          <label className="block">Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 w-full rounded border border-gray-300 p-1" />
          </label>
          <label className="block">Amount (RM)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-0.5 w-full rounded border border-gray-300 p-1" />
          </label>
          <label className="block">Note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="mt-0.5 w-full rounded border border-gray-300 p-1" />
          </label>
          {entry === 'CONTRA' && <p className="text-gray-600 sm:col-span-4">Used on termination: this also records a rent payment of the same amount (Deposit forfeit), so the driver's outstanding goes down.</p>}
          <div className="flex gap-2 sm:col-span-4">
            <button type="button" onClick={() => void save()} disabled={busy} className="rounded bg-blue-700 px-3 py-1 font-semibold text-white disabled:opacity-50">Save</button>
            <button type="button" onClick={() => { setAdding(false); setError(''); }} className="rounded border border-gray-300 px-3 py-1">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-red-700">{error}</p>}
    </section>
  );
}
