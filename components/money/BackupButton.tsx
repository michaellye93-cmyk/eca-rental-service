import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { readAllRows } from '../../services/pagedRead';
import { loadMonth } from '../../services/finance/api';
import { backupFileName, buildBackup } from '../../services/backup';
import { kualaLumpurToday } from '../../utils';

/** Month close: download every record as one file, to keep somewhere private (weekly, and at every close). */
export default function BackupButton() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [note, setNote] = useState('');
  const download = async () => {
    setState('busy');
    setNote('');
    try {
      const today = kualaLumpurToday();
      const backup = await buildBackup({
        read: async (table, order, noId, thenBy) => {
          if (noId) {
            // 1,000 rows a page (the most Supabase returns at once), in a fixed order: the order column, then `thenBy`
            const rows: unknown[] = [];
            for (let from = 0; ; from += 1000) {
              let query = supabase.from(table).select('*').order(order);
              if (thenBy) query = query.order(thenBy);
              const { data, error } = await query.range(from, from + 999);
              if (error) throw error;
              rows.push(...(data ?? []));
              if (!data || data.length < 1000) return rows;
            }
          }
          return readAllRows(() => supabase.from(table).select('*') as never, order, true);
        },
        month: loadMonth,
        today,
        now: new Date().toISOString(),
      });
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFileName(today);
      link.click();
      URL.revokeObjectURL(url);
      setState('done');
      setNote(backup.unreadable.length ? `Saved, but these could not be read: ${backup.unreadable.map(u => u.table).join(', ')}.` : 'Saved to your Downloads folder.');
    } catch (error) {
      setState('failed');
      setNote(error instanceof Error ? error.message : 'Please try again.');
    }
  };
  return (
    <section className="finance-panel" aria-labelledby="backup-title">
      <h3 id="backup-title">Backup</h3>
      <p className="finance-strip-note">
        The database plan keeps no restore point. Download the office's records (drivers, payments, deposits, collections,
        agreements, cars, and each Finance month's figures as Finance shows them) as one file weekly and after each close,
        and keep it somewhere private. Finance's own working tables, such as posted bank statements, are not included.
      </p>
      <button type="button" className="finance-secondary" disabled={state === 'busy'} onClick={() => void download()}>
        {state === 'busy' ? 'Preparing…' : 'Download backup'}
      </button>
      {note && <p role={state === 'failed' ? 'alert' : 'status'} className="finance-strip-note">{state === 'failed' ? `Not saved: ${note}` : note}</p>}
    </section>
  );
}
