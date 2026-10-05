import { useMemo, useState } from 'react';
import type { Driver } from '../../types';
import { formatCurrency, kualaLumpurToday } from '../../utils';
import { driverMonthlyLedger, type DriverMonth } from '../../services/driverLedger';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (n: number) => formatCurrency(n || 0);
const percent = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);

/** The last `count` calendar months, oldest first, ending with the current Kuala Lumpur month. */
function lastMonths(today: string, count: number): string[] {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(year, month - 1 - (count - 1 - i), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
}
const label = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;

type Sort = 'balance' | 'rate' | 'collected';
interface Row { driver: Driver; months: DriverMonth[]; billed: number; collected: number; rate: number | null; balance: number }

/**
 * Money → Collections: each driver's rent billed against money collected (cash and claims) month by month, and what they
 * owe at the end of each month. Built from the shared rent schedule.
 */
export default function DriverProfitability({ drivers }: { drivers: Driver[] }) {
  const [showDelisted, setShowDelisted] = useState(false);
  const [sort, setSort] = useState<Sort>('balance');
  const today = kualaLumpurToday();
  const months = useMemo(() => lastMonths(today, 6), [today]);
  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    return drivers
      .filter((driver) => showDelisted || !driver.isDelisted)
      .map((driver) => {
        const ledger = driverMonthlyLedger(driver, months, now);
        const billed = ledger.reduce((sum, m) => sum + m.billed, 0);
        const collected = ledger.reduce((sum, m) => sum + m.collected, 0);
        return { driver, months: ledger, billed, collected, rate: billed ? collected / billed : null, balance: ledger.at(-1)?.balance ?? 0 };
      })
      .filter((row) => row.billed > 0 || row.collected > 0);
  }, [drivers, months, showDelisted]);
  const sorted = useMemo(() => [...rows].sort((a, b) =>
    sort === 'balance' ? b.balance - a.balance
      : sort === 'rate' ? (a.rate ?? 1) - (b.rate ?? 1)
        : b.collected - a.collected), [rows, sort]);
  const totalBilled = rows.reduce((sum, row) => sum + row.billed, 0);
  const totalCollected = rows.reduce((sum, row) => sum + row.collected, 0);

  return (
    <section className="finance-panel" aria-labelledby="driver-profitability-heading">
      <div className="finance-section-heading">
        <div>
          <h3 id="driver-profitability-heading">Driver profitability over time</h3>
          <p>
            Each month: money collected (cash and claims) of rent billed, then what the driver owes at month end. Six months:
            {' '}{money(totalCollected)} collected of {money(totalBilled)} billed ({percent(totalBilled ? totalCollected / totalBilled : null)}).
          </p>
        </div>
        <div className="finance-dialog-actions">
          <label>
            Sort by{' '}
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="balance">Owes most</option>
              <option value="rate">Lowest collection rate</option>
              <option value="collected">Collected most</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={showDelisted} onChange={(event) => setShowDelisted(event.target.checked)} /> Include delisted
          </label>
        </div>
      </div>
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead>
            <tr>
              <th scope="col">Driver</th>
              {months.map((month) => <th scope="col" key={month}>{label(month)}</th>)}
              <th scope="col">6 months</th>
              <th scope="col">Owes now</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length ? sorted.map((row) => (
              <tr key={row.driver.id}>
                <td className="finance-strong">
                  {row.driver.name}
                  <br /><small>{row.driver.carPlate}{row.driver.isDelisted ? ' · delisted' : ''}</small>
                </td>
                {row.months.map((m) => (
                  <td key={m.month}>
                    {m.billed || m.collected ? <>
                      {money(m.collected)} / {money(m.billed)}
                      <br /><small className={m.rate !== null && m.rate < 0.8 ? 'finance-negative' : ''}>{percent(m.rate)} · owes {money(Math.max(0, m.balance))}</small>
                    </> : '—'}
                  </td>
                ))}
                <td>{money(row.collected)} / {money(row.billed)}<br /><small>{percent(row.rate)}</small></td>
                <td className={row.balance > 0 ? 'finance-negative finance-strong' : 'finance-strong'}>{row.balance > 0 ? money(row.balance) : row.balance < 0 ? `Ahead ${money(-row.balance)}` : 'Up to date'}</td>
              </tr>
            )) : (
              <tr><td colSpan={months.length + 3}><p className="finance-empty">No rent billed or collected in the last six months.</p></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
