import { useMemo, useState } from 'react';
import type { Driver } from '../types';
import { kualaLumpurNow, kualaLumpurToday } from '../utils';
import { buildCollectionsData, collectionsJson } from '../services/collections';
import { useCollectionsExtras } from './useCollectionsExtras';

/**
 * The read-only collections data view at /admin/collections, for the daily collections run: every active driver as
 * JSON in one block (see buildCollectionsData). Admins only, behind the normal sign-in; nothing can be changed here.
 */
export default function CollectionsDataPage({ drivers, userRole }: { drivers: Driver[]; userRole: 'admin' | 'staff' }) {
  const extras = useCollectionsExtras();
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => (extras.loaded
    ? collectionsJson(buildCollectionsData({ drivers, now: kualaLumpurNow(), today: kualaLumpurToday(), bankIn: extras.bankIn, promises: extras.promises, plans: extras.plans }))
    : ''), [drivers, extras.loaded, extras.bankIn, extras.promises, extras.plans]);

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
      {json
        ? <pre id="collections-data" aria-label="Collections data as JSON" className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">{json}</pre>
        : <p role="status">Loading promises, plans and bank-in details…</p>}
    </main>
  );
}
