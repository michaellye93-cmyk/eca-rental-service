import { useMemo, useState } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';
import Dialog from './Dialog';
import type { Driver } from '../types';
import { categoryLabel, isSewaBiasa, kualaLumpurNow } from '../utils';
import { whatsappStatement } from '../services/collections';
import { saveBankIn, type BankIn } from '../services/collectionsApi';

interface StatementDialogProps {
  driver: Driver;
  /** Null when the bank-in lines could not be read (the database update has not been run). */
  bankIn: BankIn | null;
  isAdmin: boolean;
  onClose: () => void;
  /** Called after an Admin saves a bank-in line, to reload them. */
  onBankInSaved: () => Promise<void> | void;
}

/**
 * The driver's WhatsApp statement, ready to paste into their group. It is built from the rent schedule, so weeks,
 * dates and amounts always match the system. It can be copied only once the bank-in line for the driver's category
 * is set, so a statement never goes out with a missing or wrong account.
 */
export default function StatementDialog({ driver, bankIn, isAdmin, onClose, onBankInSaved }: StatementDialogProps) {
  const category: keyof BankIn = isSewaBiasa(driver) ? 'SEWA_BIASA' : 'SEWABELI';
  const bank = bankIn?.[category] ?? null;
  const text = useMemo(() => whatsappStatement(driver, kualaLumpurNow(), bank ?? '(not set yet)'), [driver, bank]);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bank ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailed(true);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveBankIn(category, draft);
      await onBankInSaved();
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Not saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title="WhatsApp statement" description={`${driver.name} · ${driver.carPlate}`} onClose={onClose}>
      <div className="p-5 space-y-4 text-sm">
        <p className="text-gray-700">
          {driver.whatsappGroup
            ? <>Paste into the group <strong className="font-bold text-gray-900">{driver.whatsappGroup}</strong>.</>
            : <>No WhatsApp group name yet: add it with Edit so the right group is used.</>}
        </p>
        <pre aria-label="Statement text" className="whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 p-4 font-mono text-sm text-gray-900 select-all">{text}</pre>

        {!bank && (
          <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
            {bankIn === null
              ? 'Bank-in details are not available yet (the database update has not been run), so this statement cannot be copied.'
              : `The bank-in line for ${categoryLabel(driver)} is not set yet, so this statement cannot be copied.${isAdmin ? '' : ' Ask an admin to add it.'}`}
          </p>
        )}
        {copyFailed && <p role="alert" className="text-rose-700">This browser did not allow copying. Select the text above and copy it instead.</p>}

        {isAdmin && bankIn !== null && (editing ? (
          <div className="space-y-2 rounded-xl border border-gray-200 p-3">
            <label htmlFor="bank-in-text" className="block text-xs font-bold uppercase text-gray-500">Bank-in line for {categoryLabel(driver)} drivers</label>
            <textarea id="bank-in-text" rows={2} maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} placeholder="e.g. Bank name 1234-5678-90 (Account name)" className="w-full rounded-lg border border-gray-300 p-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-500">Shown after "Bank in:" on every {categoryLabel(driver)} statement. Check the account digits carefully.</p>
            {saveError && <p role="alert" className="text-xs font-medium text-rose-700">Not saved: {saveError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setEditing(false); setDraft(bank ?? ''); }} className="px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button type="button" onClick={() => void save()} disabled={saving} className="px-3 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg">{saving ? 'Saving…' : 'Save bank-in line'}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => { setDraft(bank ?? ''); setEditing(true); }} className="text-sm font-semibold text-blue-700 underline">
            {bank ? `Change the bank-in line for ${categoryLabel(driver)}` : `Add the bank-in line for ${categoryLabel(driver)}`}
          </button>
        ))}

        <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
          <button type="button" onClick={() => void copy()} disabled={!bank} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:text-gray-600 rounded-lg">
            {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <ClipboardCopy className="w-4 h-4" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy statement'}
          </button>
        </div>
        <p aria-live="polite" className="sr-only">{copied ? 'Statement copied' : ''}</p>
      </div>
    </Dialog>
  );
}
