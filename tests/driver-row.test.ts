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
