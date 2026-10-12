/**
 * A download of every record the office keeps, for the owner to save somewhere private (the Supabase free plan keeps no
 * restore point). Read with the signed-in admin's own access, so it holds exactly what the admin can see. Restoring is
 * done by hand from the file; nothing here writes.
 */

/** The tables in the backup, the column each is read in order of, and whether it has an id column to page by. */
export const BACKUP_TABLES: { table: string; order: string; noId?: true }[] = [
  { table: 'drivers', order: 'created_at' },
  { table: 'payments', order: 'date' },
  { table: 'payment_changes', order: 'changed_at' },
  { table: 'driver_changes', order: 'changed_at' },
  { table: 'driver_deposits', order: 'entry_date' },
  { table: 'deposit_changes', order: 'changed_at' },
  { table: 'driver_car_assignments', order: 'id' },
  { table: 'payment_promises', order: 'logged_at' },
  { table: 'catch_up_plans', order: 'start_date' },
  { table: 'collection_settings', order: 'key', noId: true },
  { table: 'driver_agreements', order: 'created_at' },
  { table: 'agreement_settings', order: 'key', noId: true },
  { table: 'cars', order: 'id' },
  { table: 'car_details', order: 'car_id', noId: true },
];

/** Finance is kept from August 2026; every month from `first` (YYYY-MM) to the month of `today` (YYYY-MM-DD). */
export function financeMonthsSince(first: string, today: string): string[] {
  const months: string[] = [];
  let [year, month] = first.split('-').map(Number);
  const [endYear, endMonth] = today.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

export interface Backup {
  made_at: string;
  tables: Record<string, unknown[]>;
  finance_months: Record<string, unknown>;
  unreadable: { table: string; error: string }[];
}

export async function buildBackup(deps: {
  read: (table: string, order: string, noId: boolean) => Promise<unknown[]>;
  month: (month: string) => Promise<unknown>;
  today: string;
  now: string;
}): Promise<Backup> {
  const backup: Backup = { made_at: deps.now, tables: {}, finance_months: {}, unreadable: [] };
  for (const { table, order, noId } of BACKUP_TABLES) {
    try {
      backup.tables[table] = await deps.read(table, order, Boolean(noId));
    } catch (error) {
      backup.unreadable.push({ table, error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error) });
    }
  }
  for (const month of financeMonthsSince('2026-08', deps.today)) {
    try {
      backup.finance_months[month] = await deps.month(month);
    } catch (error) {
      backup.unreadable.push({ table: `finance ${month}`, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return backup;
}

export const backupFileName = (today: string) => `eca-backup-${today}.json`;
