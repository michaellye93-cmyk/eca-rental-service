import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface NoticeMessage {
  type: 'error' | 'success';
  text: string;
}

/** A message bar at the bottom of the screen: errors stay until dismissed, confirmations fade after a few seconds. */
export default function Notice({ notice, onDismiss }: { notice: NoticeMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (notice?.type !== 'success') return;
    const timer = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) return null;
  const isError = notice.type === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:max-w-md z-[70] flex items-start gap-3 rounded-xl border p-4 shadow-lg text-sm ${
        isError ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'
      }`}
    >
      {isError ? <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" aria-hidden="true" /> : <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" aria-hidden="true" />}
      <p className="flex-1">{notice.text}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="p-1 -m-1 rounded hover:bg-black/5 shrink-0">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
