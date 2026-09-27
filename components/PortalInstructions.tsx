import React, { useEffect, useState } from 'react';
import { loadPortalInstructions, savePortalInstructions } from '../services/finance/api';

/** Admins write the "How to pay" text drivers see in their portal. Kept in the database, not in the code. */
export default function PortalInstructions() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    loadPortalInstructions()
      .then(value => {
        if (!live) return;
        setText(value ?? '');
        setSaved(value ?? '');
        setState('ready');
      })
      .catch(() => live && setState('unavailable'));
    return () => { live = false; };
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const value = await savePortalInstructions(text);
      setText(value ?? '');
      setSaved(value ?? '');
      setMessage({ type: 'success', text: value ? 'Saved. Drivers see this the next time they sign in.' : 'Cleared. Drivers are told to ask the ECA office how to pay.' });
    } catch (cause) {
      setMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'The text could not be saved.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold text-gray-900">
        Driver portal: how to pay{' '}
        <span className="font-normal text-gray-600">
          {state === 'loading' ? '(loading…)' : state === 'unavailable' ? '(needs the driver portal database update)' : saved ? '(written)' : '(not written yet)'}
        </span>
      </summary>
      {state === 'ready' && (
        <form onSubmit={save} className="mt-3 space-y-2">
          <label htmlFor="portal-instructions" className="block text-gray-700">
            Drivers see this under "How to pay" after they sign in, for example your bank account and where to send the receipt. Leave it empty to tell them to ask the office.
          </label>
          <textarea
            id="portal-instructions"
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={2000}
            rows={4}
            className="w-full rounded border border-gray-300 bg-white p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || text.trim() === saved.trim()} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <span className="text-xs text-gray-600">{text.length} / 2,000 characters</span>
          </div>
          {message && <p role={message.type === 'error' ? 'alert' : 'status'} className={message.type === 'error' ? 'text-rose-700' : 'text-emerald-800'}>{message.text}</p>}
        </form>
      )}
    </details>
  );
}
