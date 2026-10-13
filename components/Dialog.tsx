import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Open pop-ups, newest last: only the top one answers Escape and keeps Tab, so a question over a pop-up closes alone. */
const openModals: object[] = [];

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
    const self = {};
    openModals.push(self);
    const keyboard = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== self) return;
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
      openModals.splice(openModals.indexOf(self), 1);
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
  /** Where the keyboard starts (default: the close button). */
  initialFocus?: React.RefObject<HTMLElement | null>;
}

/** A pop-up window for the fleet screens. A stray click outside does not close it (Escape and the close buttons do). */
export default function Dialog({ title, description, onClose, children, size = 'md', initialFocus }: DialogProps) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useModalBehavior(dialog, initialFocus ?? close, onClose);
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

interface TextDialogProps {
  /** The question, shown as the title and read out for the text box. */
  title: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Asks for one line of text (e.g. a reason). The text box has the keyboard; Enter or OK sends what was typed. */
export function TextDialog({ title, onSubmit, onCancel }: TextDialogProps) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  return (
    <Dialog title={title} onClose={onCancel} size="sm" initialFocus={input}>
      <form
        className="p-6 space-y-6"
        onSubmit={(event) => {
          // Never let this reach a form the dialog sits in (React passes submit events up the component tree).
          event.preventDefault();
          event.stopPropagation();
          onSubmit(value);
        }}
      >
        <input
          ref={input}
          type="text"
          aria-label={title}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button type="submit" className="px-5 py-2 text-white text-sm font-bold rounded-lg transition-colors shadow-sm bg-blue-600 hover:bg-blue-700">
            OK
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type Asking =
  | { kind: 'confirm'; key: number; message: React.ReactNode; destructive: boolean; resolve: (yes: boolean) => void }
  | { kind: 'text'; key: number; title: string; resolve: (value: string | null) => void };

/**
 * The in-app stand-in for window.confirm and window.prompt. `ask(message)` resolves true on OK and false on Cancel or
 * Escape; `askText(question)` resolves the typed text, or null when cancelled. Render `dialog` once in the component.
 */
export function useConfirm() {
  const [asking, setAsking] = useState<Asking | null>(null);
  const count = useRef(0);
  const open = useRef<Asking | null>(null);
  /** A new question while one is open first answers the open one as cancelled (false, or null for text). */
  const replace = useCallback((next: Asking) => {
    const previous = open.current;
    open.current = next;
    setAsking(next);
    if (previous?.kind === 'confirm') previous.resolve(false);
    else if (previous?.kind === 'text') previous.resolve(null);
  }, []);
  const ask = useCallback(
    (message: React.ReactNode, options: { destructive?: boolean } = {}) =>
      new Promise<boolean>((resolve) => {
        count.current += 1;
        replace({ kind: 'confirm', key: count.current, message, destructive: options.destructive ?? true, resolve });
      }),
    [],
  );
  const askText = useCallback(
    (title: string) =>
      new Promise<string | null>((resolve) => {
        count.current += 1;
        replace({ kind: 'text', key: count.current, title, resolve });
      }),
    [],
  );
  let dialog: React.ReactNode = null;
  if (asking?.kind === 'confirm') {
    const answer = (yes: boolean) => {
      if (open.current === asking) open.current = null;
      setAsking(null);
      asking.resolve(yes);
    };
    dialog = (
      <ConfirmDialog key={asking.key} title="Please confirm" confirmLabel="OK" destructive={asking.destructive} onConfirm={() => answer(true)} onCancel={() => answer(false)}>
        <p>{asking.message}</p>
      </ConfirmDialog>
    );
  } else if (asking?.kind === 'text') {
    const answer = (value: string | null) => {
      if (open.current === asking) open.current = null;
      setAsking(null);
      asking.resolve(value);
    };
    dialog = <TextDialog key={asking.key} title={asking.title} onSubmit={(value) => answer(value)} onCancel={() => answer(null)} />;
  }
  // Drawn at the end of the page so it sits above any open pop-up and takes none of the screen's own styles.
  return { ask, askText, dialog: dialog && typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog };
}
