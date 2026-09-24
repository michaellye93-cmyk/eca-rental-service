import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Keyboard and focus behaviour shared by every pop-up: focus starts on `initialFocus`, Tab stays inside,
 * Escape closes, the page behind does not scroll, and focus returns to where it was when the pop-up closes.
 */
export function useModalBehavior(
  dialog: React.RefObject<HTMLElement | null>,
  initialFocus: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    initialFocus.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        latestClose.current();
      }
      if (event.key !== 'Tab') return;
      const controls = (
        Array.from(
          dialog.current?.querySelectorAll(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
          ) ?? [],
        ) as HTMLElement[]
      ).filter((el) => el.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('keydown', keyboard);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
}

const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-4xl' } as const;

interface DialogProps {
  title: string;
  /** A short line under the title, e.g. who the pop-up is about. */
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  size?: keyof typeof widths;
}

/** A pop-up window for the fleet screens. Clicking outside does not close it, so typed entries are never lost. */
export default function Dialog({ title, description, onClose, children, size = 'md' }: DialogProps) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useModalBehavior(dialog, close, onClose);
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50" role="presentation">
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`bg-white rounded-2xl shadow-xl w-full ${widths[size]} max-h-[90vh] flex flex-col overflow-hidden`}
      >
        <header className="px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-4 bg-gray-50">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-gray-900">{title}</h2>
            {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
          </div>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="p-2 -m-1 hover:bg-gray-200 rounded-full transition-colors shrink-0"
          >
            <X className="w-5 h-5 text-gray-500" aria-hidden="true" />
          </button>
        </header>
        <div className="overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Red confirm button for actions that remove or end something. */
  destructive?: boolean;
}

/** Asks before an action that is hard to undo; says what will happen in `children`. */
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, destructive = true }: ConfirmDialogProps) {
  return (
    <Dialog title={title} onClose={onCancel} size="sm">
      <div className="p-6 space-y-6">
        <div className="text-sm text-gray-600 space-y-2">{children}</div>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-5 py-2 text-white text-sm font-bold rounded-lg transition-colors shadow-sm ${destructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
