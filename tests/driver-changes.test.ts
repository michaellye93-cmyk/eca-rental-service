import test from 'node:test';
import assert from 'node:assert/strict';
import { driverChangeLines, type DriverChange } from '../services/driverChanges.ts';

const change = (over: Partial<DriverChange>): DriverChange => ({
  id: 1, driver_id: 'd1', action: 'UPDATE', changed_at: '2026-10-12T04:05:00Z', changed_by_name: 'Staff', changed_by_role: 'staff',
  fields: [], before: null, after: null, ...over,
});

test('an edit reads as who, when and each changed field from old to new, newest first', () => {
  const lines = driverChangeLines([
    change({ id: 1, action: 'INSERT', changed_by_role: 'admin', changed_at: '2026-10-01T02:00:00Z' }),
    change({ id: 2, fields: ['contract_start_date', 'rental_rate'], before: { rental_rate: 400, contract_start_date: '2026-08-01' }, after: { rental_rate: 450, contract_start_date: '2026-08-02' } }),
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Staff · 12 Oct 2026, 12:05 pm: /);
  assert.match(lines[0], /rent RM\s400\.00 → RM\s450\.00/);
  assert.match(lines[0], /start date 01 Aug 2026 → 02 Aug 2026/);
  assert.match(lines[1], /^Admin · .*: driver added$/);
});

test('delist, plate and unknown fields read plainly; bookkeeping columns are left out', () => {
  const [line] = driverChangeLines([change({
    fields: ['car_plate', 'is_delisted', 'delist_date', 'updated_at', 'whatsapp_group'],
    before: { car_plate: 'XAA1001', is_delisted: false, delist_date: null, updated_at: 'x', whatsapp_group: null },
    after: { car_plate: 'XAA1002', is_delisted: true, delist_date: '2026-10-12', updated_at: 'y', whatsapp_group: 'XAA1002 FIXTURE SAT' },
  })]);
  assert.match(line, /plate XAA1001 → XAA1002/);
  assert.match(line, /delisted no → yes/);
  assert.match(line, /delist date — → 12 Oct 2026/);
  assert.match(line, /WhatsApp group — → XAA1002 FIXTURE SAT/);
  assert.doesNotMatch(line, /updated_at/);
});

test('an edit that only touched bookkeeping columns is not listed', () => {
  assert.deepEqual(driverChangeLines([change({ fields: ['updated_at'], before: { updated_at: 'x' }, after: { updated_at: 'y' } })]), []);
});

test('collection arrangement edits read with plain labels', () => {
  const [line] = driverChangeLines([change({
    fields: ['collection_arrangement', 'collection_tone', 'contact_window'],
    before: { collection_arrangement: null, collection_tone: 'SOFT', contact_window: null },
    after: { collection_arrangement: 'Monthly by the 5th', collection_tone: 'FIRM', contact_window: 'weekday mornings' },
  })]);
  assert.match(line, /collection arrangement — → Monthly by the 5th/);
  assert.match(line, /collection tone SOFT → FIRM/);
  assert.match(line, /contact window — → weekday mornings/);
});
