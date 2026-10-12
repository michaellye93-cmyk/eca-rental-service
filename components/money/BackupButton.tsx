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
        read: async (table, order, noId) => {
          if (noId) {
            const { data, error } = await supabase.from(table).select('*').order(order);
            if (error) throw error;
            return data ?? [];
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
        The database plan keeps no restore point. Download every record (drivers, payments, deposits, collections, agreements,
        cars and every Finance month) as one file weekly and after each close, and keep it somewhere private.
      </p>
      <button type="button" className="finance-secondary" disabled={state === 'busy'} onClick={() => void download()}>
        {state === 'busy' ? 'Preparing…' : 'Download backup'}
      </button>
      {note && <p role={state === 'failed' ? 'alert' : 'status'} className="finance-strip-note">{state === 'failed' ? `Not saved: ${note}` : note}</p>}
    </section>
  );
}
