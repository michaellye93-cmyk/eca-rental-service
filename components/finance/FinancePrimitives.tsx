import React, { useRef } from "react";
import { FileTextIcon } from "@radix-ui/react-icons";

// Small building blocks shared by the Finance pages (Overview, Vehicles, Records and their dialogs).

export function FileButton({
  label,
  disabled,
  onFile,
}: {
  label: string;
  disabled?: boolean;
  onFile: (file?: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        className="finance-file-input"
        type="file"
        accept=".xlsx"
        disabled={disabled}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="finance-secondary"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        <FileTextIcon /> {label}
      </button>
    </>
  );
}

export function DataTable({
  headers,
  children,
}: {
  headers: Array<string | {
    key: string;
    content: React.ReactNode;
    ariaSort?: "ascending" | "descending" | "none";
  }>;
  children: React.ReactNode;
}) {
  return (
    <div className="finance-table-wrap">
      <table className="finance-table">
        <thead>
          <tr>
            {headers.map((header, index) => typeof header === "string" ? (
              <th key={`${header}-${index}`}>{header}</th>
            ) : (
              <th key={header.key} aria-sort={header.ariaSort}>{header.content}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function SectionHeading({
  title,
  detail,
  summary,
  action,
}: {
  title: string;
  detail?: string;
  summary?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="finance-section-heading">
      <div>
        <h3>{title}</h3>
        {detail && <p>{detail}</p>}
        {summary}
      </div>
      {action}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="finance-empty">{text}</p>;
}

export function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="finance-skeleton" aria-label="Loading finance data">
      {Array.from({ length: lines }).map((_, i) => (
        <i key={i} style={{ width: `${92 - (i % 3) * 18}%` }} />
      ))}
    </div>
  );
}
