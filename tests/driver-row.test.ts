import test from 'node:test';
import assert from 'node:assert/strict';
import { fromDriverRow, toDriverRow } from '../utils.ts';
import type { Driver } from '../types.ts';

const driver: Driver = {
  id: 'd1',
  nric: '900101-01-1234',
  name: 'Test Driver',
  email: '',
  address: '',
  carPlate: 'XAA1001',
  contractStartDate: '2026-01-05',
  contractEndDate: '',
  rentalCycle: 'WEEKLY',
  contractDuration: 52,
  rentalRate: 400,
  tags: ['SUN'],
  totalAmountPaid: 0,
  paymentHistory: [],
};

test('toDriverRow writes the profile and contract columns of the drivers table', () => {
  assert.deepEqual(toDriverRow(driver), {
    nric: '900101-01-1234',
    email: null,
    name: 'Test Driver',
    address: null,
    car_plate: 'XAA1001',
    contract_start_date: '2026-01-05',
    contract_end_date: null,
    category: 'SEWABELI',
    rental_cycle: 'WEEKLY',
    contract_duration_weeks: 52,
    rental_rate: 400,
    tags: ['SUN'],
  });
});

test('toDriverRow keeps a chosen category, monthly cycle, end date and contact details', () => {
  const row = toDriverRow({ ...driver, email: 'driver@example.com', address: '1 Jalan Contoh', category: 'SEWA_BIASA', rentalCycle: 'MONTHLY', contractEndDate: '2026-12-05' });
  assert.equal(row.email, 'driver@example.com');
  assert.equal(row.address, '1 Jalan Contoh');
  assert.equal(row.category, 'SEWA_BIASA');
  assert.equal(row.rental_cycle, 'MONTHLY');
  assert.equal(row.contract_end_date, '2026-12-05');
});

test('fromDriverRow reads a drivers row back into the same profile and contract', () => {
  const back = fromDriverRow({ id: 'd1', ...toDriverRow({ ...driver, email: 'driver@example.com', contractEndDate: '2026-12-05' }), is_delisted: true, delist_date: '2026-09-01' });
  assert.deepEqual(back, {
    id: 'd1',
    nric: '900101-01-1234',
    email: 'driver@example.com',
    name: 'Test Driver',
    address: undefined,
    carPlate: 'XAA1001',
    contractStartDate: '2026-01-05',
    contractEndDate: '2026-12-05',
    category: 'SEWABELI',
    rentalCycle: 'WEEKLY',
    contractDuration: 52,
    rentalRate: 400,
    isDelisted: true,
    delistDate: '2026-09-01',
    tags: ['SUN'],
  });
});

test('fromDriverRow defaults a missing cycle to weekly and missing tags to none', () => {
  const back = fromDriverRow({ id: 'd2', nric: '900101-01-5678', name: 'Other', car_plate: 'XAB2001', contract_start_date: '2026-02-02', contract_duration_weeks: 10, rental_rate: 300, rental_cycle: null, tags: null });
  assert.equal(back.rentalCycle, 'WEEKLY');
  assert.deepEqual(back.tags, []);
});

test('a phone number is written when set and cleared to null when removed; untouched rows leave the column alone', () => {
  assert.equal(toDriverRow({ ...driver, phone: '60123456789' }).phone, '60123456789');
  assert.equal(toDriverRow({ ...driver, phone: '' }).phone, null);
  assert.equal('phone' in toDriverRow(driver), false);
});

test('fromDriverRow reads a phone number back, and leaves it out when there is none', () => {
  const row = { id: 'd3', nric: '900101-01-5678', name: 'Other', car_plate: 'XAB2001', contract_start_date: '2026-02-02', contract_duration_weeks: 10, rental_rate: 300 };
  assert.equal(fromDriverRow({ ...row, phone: '60123456789' }).phone, '60123456789');
  assert.equal('phone' in fromDriverRow({ ...row, phone: null }), false);
});

test('a plate is saved in capitals without spaces, however it was typed', () => {
  assert.equal(toDriverRow({ ...driver, carPlate: 'xaa 1001' }).car_plate, 'XAA1001');
  assert.equal(toDriverRow({ ...driver, carPlate: ' XAA  1001 ' }).car_plate, 'XAA1001');
});

test('a WhatsApp group name is written when set and cleared to null when removed; untouched rows leave the column alone', () => {
  assert.equal(toDriverRow({ ...driver, whatsappGroup: '  FIXTURE XAA1001 SAT ' }).whatsapp_group, 'FIXTURE XAA1001 SAT');
  assert.equal(toDriverRow({ ...driver, whatsappGroup: '' }).whatsapp_group, null);
  assert.equal('whatsapp_group' in toDriverRow(driver), false);
});

test('fromDriverRow reads the WhatsApp group name back, and leaves it out when there is none', () => {
  const row = { id: 'd4', nric: '900101-01-5678', name: 'Other', car_plate: 'XAB2001', contract_start_date: '2026-02-02', contract_duration_weeks: 10, rental_rate: 300 };
  assert.equal(fromDriverRow({ ...row, whatsapp_group: 'OTHER XAB2001 MON' }).whatsappGroup, 'OTHER XAB2001 MON');
  assert.equal('whatsappGroup' in fromDriverRow({ ...row, whatsapp_group: null }), false);
});

test('the collection arrangement, tone, language, contact window and note are written only when set or being cleared', () => {
  const row = toDriverRow({ ...driver, collectionArrangement: ' Monthly RM1,000 by the 5th ', collectionTone: 'FIRM', collectionLanguage: 'BM', contactWindow: 'weekday mornings', collectionNote: 'Fixture note' });
  assert.deepEqual([row.collection_arrangement, row.collection_tone, row.collection_language, row.contact_window, row.collection_note],
    ['Monthly RM1,000 by the 5th', 'FIRM', 'BM', 'weekday mornings', 'Fixture note']);
  const cleared = toDriverRow({ ...driver, collectionArrangement: '', collectionTone: '', collectionLanguage: '', contactWindow: ' ', collectionNote: '' });
  assert.deepEqual([cleared.collection_arrangement, cleared.collection_tone, cleared.collection_language, cleared.contact_window, cleared.collection_note],
    [null, null, null, null, null]);
  // Untouched: saving a driver never depends on these columns before the database update is run
  for (const column of ['collection_arrangement', 'collection_tone', 'collection_language', 'contact_window', 'collection_note']) {
    assert.equal(column in toDriverRow(driver), false, column);
  }
});

test('fromDriverRow reads the collection fields back, and leaves them out when empty', () => {
  const back = fromDriverRow({ id: 'd1', ...toDriverRow({ ...driver, collectionArrangement: 'Weekly', collectionTone: 'SOFT', collectionLanguage: 'EN', contactWindow: 'weekday mornings', collectionNote: 'Note' }) });
  assert.deepEqual([back.collectionArrangement, back.collectionTone, back.collectionLanguage, back.contactWindow, back.collectionNote], ['Weekly', 'SOFT', 'EN', 'weekday mornings', 'Note']);
  const empty = fromDriverRow({ id: 'd1', ...toDriverRow(driver), collection_arrangement: null, collection_tone: null });
  assert.equal('collectionArrangement' in empty || 'collectionTone' in empty, false);
});
