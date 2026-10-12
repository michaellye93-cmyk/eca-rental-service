import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_TABLES, buildBackup, backupFileName, financeMonthsSince } from '../services/backup.ts';

test('the backup lists every table the office keeps, drivers and payments first', () => {
  assert.deepEqual(BACKUP_TABLES.slice(0, 2).map(t => t.table), ['drivers', 'payments']);
  for (const table of ['payment_changes', 'driver_changes', 'driver_deposits', 'deposit_changes', 'payment_promises', 'catch_up_plans',
    'collection_settings', 'driver_agreements', 'agreement_settings', 'cars', 'car_details']) {
    assert.ok(BACKUP_TABLES.some(t => t.table === table), `${table} is backed up`);
  }
});

test('the collections tools tables are backed up too (each reported as "could not be read" until its SQL has run)', () => {
  const entry = (table: string) => BACKUP_TABLES.find(t => t.table === table);
  assert.deepEqual(entry('collection_contacts'), { table: 'collection_contacts', order: 'contacted_at' });
  assert.deepEqual(entry('collection_runs'), { table: 'collection_runs', order: 'started_at' });
  // No id column: read a page at a time in order of day, then driver (the table's key), so no row is missed past 1,000
  assert.deepEqual(entry('driver_daily_status'), { table: 'driver_daily_status', order: 'day', noId: true, thenBy: 'driver_id' });
});

test('Finance months run from August 2026 (the start of kept Finance) to the current month', () => {
  assert.deepEqual(financeMonthsSince('2026-08', '2026-10-12'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(financeMonthsSince('2026-08', '2027-01-03'), ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
});

test('a backup carries when it was made, each table and each month, and records what could not be read', async () => {
  const read = async (table: string) => {
    if (table === 'cars') throw new Error('permission denied');
    return [{ id: table }];
  };
  const month = async (m: string) => ({ month: m });
  const backup = await buildBackup({ read, month, today: '2026-10-12', now: '2026-10-12T04:00:00Z' });
  assert.equal(backup.made_at, '2026-10-12T04:00:00Z');
  assert.deepEqual(backup.tables.drivers, [{ id: 'drivers' }]);
  assert.equal(backup.tables.cars, undefined);
  assert.deepEqual(backup.unreadable, [{ table: 'cars', error: 'permission denied' }]);
  assert.deepEqual(Object.keys(backup.finance_months), ['2026-08', '2026-09', '2026-10']);
  assert.equal(backupFileName('2026-10-12'), 'eca-backup-2026-10-12.json');
});
