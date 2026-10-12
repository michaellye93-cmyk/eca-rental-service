import { useMemo, useState } from 'react';
import type { Driver } from '../types';
import { kualaLumpurNow, kualaLumpurToday } from '../utils';
import { buildCollectionsData, collectionsHygiene, collectionsJson, type HygieneDriver } from '../services/collections';
import { useCollectionsExtras } from './useCollectionsExtras';

/**
 * The read-only collections data view at /admin/collections, for the daily collections run: every active driver as
 * JSON in one block (see buildCollectionsData). Admins only, behind the normal sign-in; nothing can be changed here.
 */
export default function CollectionsDataPage({ drivers, userRole }: { drivers: Driver[]; userRole: 'admin' | 'staff' }) {
  const extras = useCollectionsExtras();
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => (extras.loaded
    ? collectionsJson(buildCollectionsData({ drivers, now: kualaLumpurNow(), today: kualaLumpurToday(), bankIn: extras.bankIn, promises: extras.promises, plans: extras.plans, contacts: extras.contacts }))
    : ''), [drivers, extras.loaded, extras.bankIn, extras.promises, extras.plans, extras.contacts]);

  const hygiene = useMemo(() => (extras.loaded ? collectionsHygiene(drivers, extras.bankIn) : null), [drivers, extras.loaded, extras.bankIn]);

  if (userRole !== 'admin') {
    return (
      <main className="min-h-screen bg-white p-6 font-sans text-gray-900 space-y-3">
        <h1 className="text-lg font-bold">Collections data</h1>
        <p>This page is for admins.</p>
        <a href="/" className="font-semibold text-blue-700 underline">Back to the admin site</a>
      </main>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch { /* the text can still be selected and copied by hand */ }
  };

  return (
    <main className="min-h-screen bg-white p-4 sm:p-6 font-sans text-gray-900">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <h1 className="text-lg font-bold">Collections data (read-only)</h1>
        <button type="button" onClick={() => void copy()} disabled={!json} className="px-3 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg">{copied ? 'Copied' : 'Copy JSON'}</button>
        <button type="button" onClick={() => window.location.reload()} className="text-sm font-semibold text-blue-700 underline">Reload</button>
        <a href="/" className="text-sm font-semibold text-blue-700 underline">Back to the admin site</a>
      </header>
      {hygiene && <HygienePanel hygiene={hygiene} />}
      {json
        ? <pre id="collections-data" aria-label="Collections data as JSON" className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">{json}</pre>
        : <p role="status">Loading promises, plans and bank-in details…</p>}
    </main>
  );
}

const CATEGORY_NAME = { SEWABELI: 'Sewa Beli', SEWA_BIASA: 'Sewa Biasa' } as const;

/** What is missing for the daily run, fixed in Edit Driver (or, for bank-in lines, in a driver's WhatsApp statement window). */
function HygienePanel({ hygiene }: { hygiene: ReturnType<typeof collectionsHygiene> }) {
  const groups: { title: string; list: HygieneDriver[] }[] = [
    { title: 'No WhatsApp group name', list: hygiene.noGroup },
    { title: 'No phone number', list: hygiene.noPhone },
    { title: 'Monthly rent, no collection arrangement', list: hygiene.noArrangement },
  ];
  const clean = groups.every(group => group.list.length === 0) && hygiene.bankInMissing.length === 0 && !hygiene.bankInUnknown;
  return (
    <section aria-label="Collections checks" className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm space-y-2">
      <h2 className="font-bold">Before the run</h2>
      {clean ? <p className="text-emerald-800">Every active driver has a WhatsApp group, a phone and (monthly rent) an arrangement; both bank-in lines are set.</p> : (
        <ul className="space-y-1.5">
          {hygiene.bankInUnknown && <li className="text-amber-900">Bank-in lines could not be read (the database update has not been run): no statement can be copied.</li>}
          {hygiene.bankInMissing.map(category => (
            <li key={category} className="text-amber-900">The {CATEGORY_NAME[category]} bank-in line is not set, so "Copy statement" stays off for {CATEGORY_NAME[category]} drivers. An admin adds it in any of their WhatsApp statement windows.</li>
          ))}
          {groups.filter(group => group.list.length > 0).map(group => (
            <li key={group.title}>
              <span className="font-semibold">{group.title} ({group.list.length}):</span>{' '}
              <span className="font-mono">{group.list.map(driver => `${driver.plate} ${driver.name}`).join(', ')}</span>
              <span className="text-gray-600"> · fix with Edit Driver</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
