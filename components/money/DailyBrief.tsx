import { useEffect, useState } from 'react';
import { formatCurrency } from '../../utils';
import { whoLabel } from '../../services/paymentLog';
import { loadRecentRuns } from '../../services/collectionsApi';
import type { CategoryCounts, CollectionRun } from '../../services/collectionRuns';

/** "Mon 12 Oct" for a YYYY-MM-DD day. */
const dayLabel = (isoDay: string) => new Date(`${isoDay}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/** A time in Kuala Lumpur, "13:05". */
const klClock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const movement = (before: CategoryCounts | null, after: CategoryCounts | null) => {
  if (!after) return null;
  return (['good', 'mid', 'bad'] as const)
    .map(key => `${key.toUpperCase()} ${before ? `${before[key]}→` : ''}${after[key]}`)
    .join(' · ');
};

/**
 * Finance → Collections: the last seven collection run summaries, newest first, recorded from the worklist after each
 * run. Shows a quiet line until the database update has been run.
 */
export default function DailyBrief() {
  const [runs, setRuns] = useState<CollectionRun[] | null | 'unavailable'>(null);
  useEffect(() => {
    let active = true;
    loadRecentRuns(7).then(rows => { if (active) setRuns(rows); }).catch(() => { if (active) setRuns('unavailable'); });
    return () => { active = false; };
  }, []);

  return (
    <section className="finance-panel" aria-labelledby="collections-brief-heading">
      <div className="finance-section-heading">
        <div>
          <h3 id="collections-brief-heading">Daily brief</h3>
          <p>The last seven collection runs, newest first, as recorded on the worklist after each run.</p>
        </div>
      </div>
      {runs === null ? <p className="finance-empty" role="status">Loading run summaries…</p>
        : runs === 'unavailable' ? <p className="finance-empty">Run summaries appear here once the database update (collection runs) has been run.</p>
          : runs.length === 0 ? <p className="finance-empty">No run summary recorded yet.</p>
            : (
              <ul className="space-y-2">
                {runs.map(run => (
                  <li key={run.id} className="border-b border-gray-100 pb-2 last:border-b-0 text-sm">
                    <p>
                      <strong>{dayLabel(run.run_date)} · {run.run_slot} run</strong>{' '}
                      <small>({klClock(run.started_at)}–{klClock(run.finished_at)}, recorded by {whoLabel(run.logged_by_role, run.logged_by_name)})</small>
                    </p>
                    <p>
                      {plural(run.payments_recorded, 'payment')} · {formatCurrency(run.collected)} cash · {plural(run.asks_sent, 'ask')} · {plural(run.promises_logged, 'promise')}
                      {movement(run.categories_before, run.categories_after) && <> · {movement(run.categories_before, run.categories_after)}</>}
                    </p>
                    {run.blocks && <p className="finance-negative">Blocked: {run.blocks}</p>}
                    {run.summary && <p className="whitespace-pre-line">{run.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
    </section>
  );
}
