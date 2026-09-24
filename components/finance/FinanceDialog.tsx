import React, { useRef } from "react";
import { useModalBehavior } from "../Dialog";

export default function FinanceDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useModalBehavior(dialog, close, onClose);
  return (
    <div
      className="finance-dialog-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        ref={dialog}
        className="finance-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button ref={close} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
