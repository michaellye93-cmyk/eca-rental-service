import React, { useMemo, useState } from 'react';
import type { Driver } from '../types';
import { displayPlate, formatCurrency, kualaLumpurNow, kualaLumpurToday, LATE_ALERT_DAYS } from '../utils';
import { CONTACT_KINDS } from '../services/collections';
import { buildWorklist, worklistJson, type WorklistRow } from '../services/worklist';
import { buildAdminPath } from '../services/routes';
import { useCollectionsExtras } from './useCollectionsExtras';
import RunSummaryPanel from './RunSummaryPanel';

const STATUS_LOOK: Record<string, string> = {
  GOOD: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  MID: 'bg-amber-50 text-amber-900 border-amber-200',
  BAD: 'bg-rose-50 text-rose-800 border-rose-200',
};
const KIND_LABEL = Object.fromEntries(CONTACT_KINDS.map(({ kind, label }) => [kind, label]));
const TONE_LABEL: Record<string, string> = { SOFT: 'Soft', POLITE: 'Polite', FIRM: 'Firm' };
const PROMISE_LABEL: Record<string, string> = { OPEN: 'open', KEPT: 'kept', MISSED: 'missed' };

/** A day as "12 Oct". */
const shortDay = (isoDay: string) => new Date(`${isoDay}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** A logged time in Kuala Lumpur, e.g. "12 Oct, 13:05". */
const klTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** A link that changes the address without reloading the page (a new tab still works with Ctrl or middle click). */
function PageLink({ to, onNavigate, className, children }: { to: string; onNavigate: (path: string) => void; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={to}
      className={className}
      onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

/**
 * The day's collection work in one read at /admin/worklist (staff and admins, behind the normal sign-in): every active
 * driver with the next step (see nextCollectionStep). Nothing is sent from here; "Copy as JSON" gives the same rows.
 * After a run, "Record run summary" saves what it did (see RunSummaryPanel).
 */
export default function WorklistPage({ drivers, onNavigate }: {
  drivers: Driver[];
  onNavigate: (path: string, options?: { replace?: boolean }) => void;
}) {
  const extras = useCollectionsExtras();
  const [copied, setCopied] = useState(false);
  const data = useMemo(() => (extras.loaded
    ? buildWorklist({
      drivers, now: kualaLumpurNow(), today: kualaLumpurToday(), instant: new Date(),
      bankIn: extras.bankIn, promises: extras.promises, plans: extras.plans, contacts: extras.contacts,
    })
    : null), [drivers, extras.loaded, extras.bankIn, extras.promises, extras.plans, extras.contacts]);
  const json = useMemo(() => (data ? worklistJson(data) : ''), [data]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch { /* the rows can still be read on screen */ }
  };

  return (
    <main className="min-h-screen bg-white p-4 sm:p-6 font-sans text-gray-900">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <h1 className="text-lg font-bold">Collection worklist{data ? ` · ${shortDay(data.today)}` : ''}</h1>
        <button type="button" onClick={() => void copy()} disabled={!json} className="px-3 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg">{copied ? 'Copied' : 'Copy as JSON'}</button>
        <button type="button" onClick={() => void extras.reload()} className="text-sm font-semibold text-blue-700 underline">Refresh</button>
        <PageLink to={buildAdminPath({ kind: 'drivers' })} onNavigate={onNavigate} className="text-sm font-semibold text-blue-700 underline">Back to the admin site</PageLink>
      </header>
      <p className="mb-3 text-sm text-gray-600">Rent due today first, then late alerts (longest first), then by amount owed. Nothing is sent from this page.</p>
      <RunSummaryPanel drivers={drivers} />
      {data && data.warnings.length > 0 && (
        <ul aria-label="Warnings" className="mb-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {data.warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      {!data ? <p role="status">Loading promises, plans and the contact log…</p> : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Active drivers and the next collection step</caption>
            <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wider text-gray-600">
              <tr>
                {['Plate', 'Name', 'WhatsApp group', 'Status', 'Owed', 'Due today', 'Last payment', 'Promise', 'Last contact', 'Arrangement', 'Next step'].map(heading => (
                  <th key={heading} scope="col" className="px-3 py-2 whitespace-nowrap">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.drivers.map(row => <Row key={row.id} row={row} onNavigate={onNavigate} />)}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Row({ row, onNavigate }: { row: WorklistRow; onNavigate: (path: string) => void }) {
  const settings = [row.collection.arrangement, row.collection.tone ? TONE_LABEL[row.collection.tone] ?? row.collection.tone : null,
    row.collection.language, row.collection.contact_window].filter(Boolean).join(' · ');
  return (
    <tr className="align-top">
      <td className="px-3 py-2 whitespace-nowrap font-mono font-semibold">
        <PageLink to={buildAdminPath({ kind: 'drivers', plate: row.plate })} onNavigate={onNavigate} className="text-blue-700 underline">{displayPlate(row.plate)}</PageLink>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{row.name}</td>
      <td className="px-3 py-2">{row.whatsapp_group ?? <span className="text-gray-500">—</span>}</td>
      <td className="px-3 py-2"><span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-bold ${STATUS_LOOK[row.status] ?? ''}`}>{row.status}</span></td>
      <td className="px-3 py-2 whitespace-nowrap text-right font-mono">
        {formatCurrency(row.owed)}
        {row.late_days !== null && row.late_days >= LATE_ALERT_DAYS && <div className="text-xs text-rose-700">{row.late_days} days late</div>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{row.due_today ? (row.due_today.unpaid > 0.005 ? `Yes, ${formatCurrency(row.due_today.unpaid)} unpaid` : 'Yes, paid') : 'No'}</td>
      <td className="px-3 py-2 whitespace-nowrap">{row.last_payment_date ? shortDay(row.last_payment_date) : 'None'}</td>
      <td className="px-3 py-2 whitespace-nowrap">{row.promise ? `${formatCurrency(row.promise.amount)} by ${shortDay(row.promise.date)} (${PROMISE_LABEL[row.promise.status]})` : '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap">{row.last_contact ? `${klTime(row.last_contact.at)} · ${KIND_LABEL[row.last_contact.kind] ?? row.last_contact.kind}` : '—'}</td>
      <td className="px-3 py-2 min-w-48">{settings || <span className="text-gray-500">—</span>}</td>
      <td className="px-3 py-2 min-w-56 font-semibold">{row.next_step}</td>
    </tr>
  );
}
