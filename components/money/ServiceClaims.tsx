import { useMemo } from 'react';
import type { Driver } from '../../types';
import { formatCurrency } from '../../utils';

/**
 * Records → Service claims: repairs drivers paid themselves and deducted from rent in the selected month. Read only;
 * a claim is recorded with the driver's payment (Claim field). Claims settle rent but are not cash.
 */
export default function ServiceClaims({ drivers, month }: { drivers: Driver[]; month: string }) {
  const rows = useMemo(() => drivers
    .flatMap((driver) => (driver.paymentHistory ?? [])
      .filter((payment) => (payment.serviceClaim ?? 0) > 0 && payment.date.slice(0, 7) === month.slice(0, 7))
      .map((payment) => ({ id: payment.id, name: driver.name, plate: driver.carPlate, date: payment.date, claim: payment.serviceClaim ?? 0, cash: payment.amount, reference: payment.reference })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.plate.localeCompare(b.plate)), [drivers, month]);
  const total = rows.reduce((sum, row) => sum + row.claim, 0);
  return (
    <section className="finance-panel" aria-labelledby="service-claims-heading">
      <div className="finance-section-heading">
        <div>
          <h3 id="service-claims-heading">Service claims</h3>
          <p>Repairs drivers paid themselves and deducted from rent this month. They count in Service & maintenance but are not cash. To add or change one, edit the driver's payment.</p>
        </div>
        <strong>{formatCurrency(total)}</strong>
      </div>
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead><tr><th scope="col">Date</th><th scope="col">Driver</th><th scope="col">Car</th><th scope="col">Cash paid</th><th scope="col">Claim</th><th scope="col">Reference</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id}>
                <td>{row.date}</td>
                <td>{row.name}</td>
                <td>{row.plate}</td>
                <td>{formatCurrency(row.cash)}</td>
                <td className="finance-strong">{formatCurrency(row.claim)}</td>
                <td>{row.reference ?? '—'}</td>
              </tr>
            )) : (
              <tr><td colSpan={6}><p className="finance-empty">No service claims this month.</p></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
