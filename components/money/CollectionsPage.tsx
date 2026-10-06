import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DriverWithMetrics } from '../../types';
import { formatCurrency, kualaLumpurNow, kualaLumpurToday, overdueRent } from '../../utils';
import { balanceTrend } from '../../services/collections';
import { arrearsAgeing, driverMonthlyLedger, monthCollection, type DriverMonth } from '../../services/driverLedger';
import SegmentTrend from './SegmentTrend';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (n: number) => formatCurrency(n || 0);
const percent = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
const signed = (amount: number) => (amount > 0.005 ? `+${money(amount)}` : amount < -0.005 ? `−${money(-amount)}` : money(0));
const label = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;

/** The last `count` calendar months, oldest first, ending with the current Kuala Lumpur month. */
export function lastMonths(today: string, count: number): string[] {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(year, month - 1 - (count - 1 - i), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
}

type Sort = 'attention' | 'owes' | 'rate';
interface Row {
  driver: DriverWithMetrics;
  outstanding: number;
  change7: number;
  change28: number;
  trend: 'IMPROVING' | 'NOT_IMPROVING' | 'UP_TO_DATE';
  months: DriverMonth[];
  billed: number;
  collected: number;
  rate: number | null;
}

/**
 * Money → Collections: who owes rent and whether it is getting better. A summary strip, the 12-week segment trend, one
 * driver table (expand a row for its month-by-month figures) and the arrears owed at each month end.
 */
export default function CollectionsPage({ drivers }: { drivers: DriverWithMetrics[] }) {
  const [sort, setSort] = useState<Sort>('attention');
  const [showAll, setShowAll] = useState(false);
  const [showDelisted, setShowDelisted] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const today = kualaLumpurToday();
  const months = useMemo(() => lastMonths(today, 6), [today]);

  const { rows, strip, arrears, ageing } = useMemo(() => {
    const now = kualaLumpurNow();
    const all: Row[] = drivers.map((driver) => {
      const trend = balanceTrend(driver, now);
      const ledger = driverMonthlyLedger(driver, months, now);
      const billed = ledger.reduce((sum, m) => sum + m.billed, 0);
      const collected = ledger.reduce((sum, m) => sum + m.collected, 0);
      return { driver, ...trend, months: ledger, billed, collected, rate: billed ? collected / billed : null };
    });
    const active = all.filter((row) => !row.driver.isDelisted);
    const thisMonth = monthCollection(drivers, months[months.length - 1], now);
    return {
      // Active drivers only, so the total matches "Overdue rent" above.
      ageing: arrearsAgeing(active.map((row) => row.driver), now),
      rows: all,
      strip: {
        billed: thisMonth.billed,
        collected: thisMonth.collected,
        rate: thisMonth.rate,
        overdue: active.reduce((sum, row) => sum + overdueRent(row.driver, now), 0),
        good: active.filter((row) => row.driver.metrics.status === 'GOOD').length,
        mid: active.filter((row) => row.driver.metrics.status === 'MID').length,
        bad: active.filter((row) => row.driver.metrics.status === 'BAD').length,
        notImproving: active.filter((row) => row.trend === 'NOT_IMPROVING').length,
      },
      // Rent owed at each month end, every driver (delisted too, while they still owed).
      arrears: months.map((month, index) => ({
        month: label(month),
        owed: Math.round(all.reduce((sum, row) => sum + Math.max(0, row.months[index]?.balance ?? 0), 0)),
      })),
    };
  }, [drivers, months]);

  const visible = useMemo(() => rows
    .filter((row) => showDelisted || !row.driver.isDelisted)
    .filter((row) => showAll || row.outstanding > 0.005)
    .sort((a, b) => sort === 'owes' ? b.outstanding - a.outstanding
      : sort === 'rate' ? (a.rate ?? 1) - (b.rate ?? 1)
        : Number(a.trend === 'IMPROVING') - Number(b.trend === 'IMPROVING') || b.outstanding - a.outstanding),
  [rows, showAll, showDelisted, sort]);

  return (
    <div className="finance-content">
      <section className="finance-panel">
        <div className="finance-summary-grid is-four">
          <div className="finance-total is-emphasis">
            <span>Collected this month</span>
            <strong>{percent(strip.rate)}</strong>
            <small>{money(strip.collected)} of {money(strip.billed)} billed so far</small>
          </div>
          <div className="finance-total">
            <span>Overdue rent</span>
            <strong className="finance-negative">{money(strip.overdue)}</strong>
            <small>Rent due before today, still unpaid</small>
          </div>
          <div className="finance-total">
            <span>Good · Mid · Bad</span>
            <strong>{strip.good} · {strip.mid} · {strip.bad}</strong>
            <small>Active drivers by risk</small>
          </div>
          <div className="finance-total">
            <span>Not improving</span>
            <strong>{strip.notImproving}</strong>
            <small>Owe rent and the balance is not falling</small>
          </div>
        </div>
      </section>

      <section className="finance-panel" aria-labelledby="collections-ageing-heading">
        <div className="finance-section-heading">
          <div>
            <h3 id="collections-ageing-heading">Overdue rent by age</h3>
            <p>Active drivers' unpaid rent, by days past its due date. Payments clear the oldest rent first, so older buckets mean long-running arrears.</p>
          </div>
        </div>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead><tr><th scope="col">Days overdue</th><th scope="col">Amount</th><th scope="col">Share</th><th scope="col">Drivers</th></tr></thead>
            <tbody>
              {ageing.map((bucket) => (
                <tr key={bucket.label}>
                  <td className="finance-strong">{bucket.label}</td>
                  <td className={bucket.amount > 0 ? 'finance-negative' : ''}>{money(bucket.amount)}</td>
                  <td>{percent(strip.overdue ? bucket.amount / strip.overdue : null)}</td>
                  <td>{bucket.drivers}</td>
                </tr>
              ))}
              <tr><td className="finance-strong">Total</td><td className="finance-strong">{money(strip.overdue)}</td><td></td><td></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <SegmentTrend drivers={drivers} />

      <section className="finance-panel" aria-labelledby="collections-drivers-heading">
        <div className="finance-section-heading">
          <div>
            <h3 id="collections-drivers-heading">Drivers</h3>
            <p>Who owes now, how it moved, and how much of the last six months' rent was collected (cash and claims). Click a driver for each month.</p>
          </div>
          <div className="finance-dialog-actions">
            <label>
              Sort{' '}
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="attention">Not improving first</option>
                <option value="owes">Owes most</option>
                <option value="rate">Lowest collection rate</option>
              </select>
            </label>
            <label><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /> Include up to date</label>
            <label><input type="checkbox" checked={showDelisted} onChange={(event) => setShowDelisted(event.target.checked)} /> Include delisted</label>
          </div>
        </div>
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th scope="col">Driver</th>
                <th scope="col">Risk</th>
                <th scope="col">Owes now</th>
                <th scope="col">7 days</th>
                <th scope="col">28 days</th>
                <th scope="col">Trend</th>
                <th scope="col">6 months collected</th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? visible.map((row) => (
                <React.Fragment key={row.driver.id}>
                  <tr className="finance-click-row" tabIndex={0} aria-expanded={open === row.driver.id}
                    onClick={() => setOpen(open === row.driver.id ? null : row.driver.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter') setOpen(open === row.driver.id ? null : row.driver.id); }}>
                    <td className="finance-strong">
                      {row.driver.name}
                      <br /><small>{row.driver.carPlate}{row.driver.isDelisted ? ' · delisted' : ''}</small>
                    </td>
                    <td>{row.driver.isDelisted ? '—' : row.driver.metrics.status}</td>
                    <td className={row.outstanding > 0.005 ? 'finance-negative finance-strong' : 'finance-strong'}>{money(row.outstanding)}</td>
                    <td>{signed(row.change7)}</td>
                    <td>{signed(row.change28)}</td>
                    <td>
                      {row.trend === 'UP_TO_DATE' ? <span className="finance-tag is-good">Up to date</span>
                        : row.trend === 'IMPROVING' ? <span className="finance-tag is-good">Improving</span>
                          : <span className="finance-tag is-warn">Not improving</span>}
                    </td>
                    <td>{percent(row.rate)} <small>({money(row.collected)} of {money(row.billed)})</small></td>
                  </tr>
                  {open === row.driver.id && (
                    <tr>
                      <td colSpan={7}>
                        <table className="finance-table">
                          <thead><tr><th scope="col">Month</th><th scope="col">Rent billed</th><th scope="col">Collected</th><th scope="col">Rate</th><th scope="col">Owed at month end</th></tr></thead>
                          <tbody>
                            {row.months.map((m) => (
                              <tr key={m.month}>
                                <td>{label(m.month)}</td>
                                <td>{money(m.billed)}</td>
                                <td>{money(m.collected)}</td>
                                <td>{percent(m.rate)}</td>
                                <td>{m.balance < -0.005 ? `Ahead ${money(-m.balance)}` : money(m.balance)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )) : (
                <tr><td colSpan={7}><p className="finance-empty">No driver owes rent.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="finance-strip-note">Improving: the balance fell over 28 days and did not rise over the last 7. The current month counts only rent already due.</p>
      </section>

      <section className="finance-panel" aria-labelledby="collections-arrears-heading">
        <div className="finance-section-heading">
          <div>
            <h3 id="collections-arrears-heading">Rent owed at each month end</h3>
            <p>All drivers, including delisted ones while they still owed. This month: owed today.</p>
          </div>
        </div>
        <div className="h-64" role="img" aria-label={`Rent owed at the end of each of the last six months: ${arrears.map((a) => `${a.month} ${money(a.owed)}`).join(', ')}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={arrears} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} />
              <YAxis tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} formatter={(value) => [money(Number(value)), 'Owed']} />
              <Bar dataKey="owed" name="Owed" fill="#b45309" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
