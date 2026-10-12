import React from 'react';

/**
 * One figure with its label, as on the Cash page and the Finance totals: `negative` shows the figure in red, `emphasis`
 * makes the tile stand out and `hint` adds a short line under the figure.
 */
export default function StatTile({ label, value, hint, negative = false, emphasis = false }: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  negative?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? 'finance-total is-emphasis' : 'finance-total'}>
      <span>{label}</span>
      <strong className={negative ? 'finance-negative' : undefined}>{value}</strong>
      {hint && <small className="cash-hint">{hint}</small>}
    </div>
  );
}
