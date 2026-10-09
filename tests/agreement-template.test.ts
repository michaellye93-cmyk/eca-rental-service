import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLANK, defaultTemplate, fieldLabel, fillText, placeholdersIn, sectionHeading, missingFields, agreementValues, extraPlaceholders,
  parseRows, templateFromStored, type AgreementInput,
} from '../services/agreements/template.ts';

const input: AgreementInput = {
  kind: 'SEWA_BIASA',
  company: { company_name: 'Fixture Rentals Sdn Bhd', company_reg_no: '000000-X', company_address: '1 Fixture Road', company_phone: '60300000000',
    company_email: 'fixture@example.test', company_bank_account: 'Fixture Bank 0000000000', company_rep_name: 'Fixture Director', company_rep_id: '700101-00-0001' },
  customer: { name: 'Fixture Driver One', nric: '900101-00-0001', phone: '60120000001', address: '2 Fixture Lane' },
  terms: { agreementDate: '2026-10-09', startDate: '2026-10-10', cycle: 'WEEKLY', duration: '52', rent: '350', deposit: '1000', endDate: '' },
  car: { plateNumber: 'XAA1001', make: 'PERODUA', model: 'BEZZA' },
  details: { chassisNo: 'FIXTURECHASSIS1', registeredDate: '2024-01-15', colour: 'WHITE', ownerName: 'Fixture Owner', ownerId: '000000-00-0000' },
  extra: { agreement_ref: 'FIX-001', emergency_contact_name: 'Fixture Contact', emergency_contact_phone: '60120000009', approved_driver: 'None',
    witness_name: 'Fixture Witness', witness_id: '800101-00-0001', vehicle_location: 'Fixture Town', odometer_km: '12000', fuel_level: 'Half' },
};
const DRAFT_EXTRAS = ['agreement_ref', 'emergency_contact_name', 'emergency_contact_phone', 'approved_driver', 'witness_name', 'witness_id', 'vehicle_location', 'odometer_km', 'fuel_level'];

test('placeholders are replaced with formatted values; unknown or empty ones become a blank line', () => {
  const values = agreementValues(input);
  assert.equal(values.rent_amount, 'RM 350.00');
  assert.equal(values.start_date, '10 October 2026');
  assert.equal(values.rental_cycle, 'week');
  assert.equal(values.vehicle_registered_date, '15 January 2024');
  assert.equal(fillText('Hirer {{customer_name}} pays {{ rent_amount }} per {{rental_cycle}}. {{nothing}}', values),
    `Hirer Fixture Driver One pays RM 350.00 per week. ${BLANK}`);
});

test('the end date is worked out from the start and the number of cycles unless one is typed', () => {
  assert.equal(agreementValues(input).end_date, '8 October 2027');
  const monthly = { ...input, terms: { ...input.terms, cycle: 'MONTHLY' as const, duration: '12', startDate: '2026-01-31' } };
  assert.equal(agreementValues(monthly).end_date, '30 January 2027');
  assert.equal(agreementValues({ ...input, terms: { ...input.terms, endDate: '2027-01-01' } }).end_date, '1 January 2027');
});

test('the total rent, due day and on-time count follow the terms', () => {
  const values = agreementValues({ ...input, terms: { ...input.terms, duration: '10', rent: '300' } });
  assert.equal(values.aggregate_rental, 'RM 3,000.00');
  assert.equal(values.min_on_time_rentals, '8', '80% of 10, rounded up');
  assert.equal(values.payment_due, 'Every Saturday', '10 October 2026 is a Saturday');
  assert.equal(agreementValues({ ...input, terms: { ...input.terms, cycle: 'MONTHLY', startDate: '2026-10-02' } }).payment_due, 'The 2nd of every month');
  assert.equal(agreementValues({ ...input, terms: { ...input.terms, duration: '156' } }).min_on_time_rentals, '125');
});

test('sections are lettered in order', () => {
  assert.equal(sectionHeading(0, 'Schedule'), 'SECTION A - SCHEDULE');
  assert.equal(sectionHeading(3, 'Vehicle details'), 'SECTION D - VEHICLE DETAILS');
});

test('the built-in drafts have sections A to D and ask only for the known extra details, each with a friendly label', () => {
  for (const kind of ['SEWA_BIASA', 'SEWABELI'] as const) {
    const template = defaultTemplate(kind);
    assert.deepEqual(template.sections.map(s => s.layout), ['table', 'clauses', 'signature', 'table'], kind);
    assert.deepEqual([...extraPlaceholders(template)].sort(), [...DRAFT_EXTRAS].sort(), kind);
    for (const key of DRAFT_EXTRAS) assert.notEqual(fieldLabel(key), key, key);
  }
});

test('missing details are listed by name so the user can fill them before downloading', () => {
  const template = defaultTemplate('SEWA_BIASA');
  assert.deepEqual(missingFields(template, input), []);
  const gaps = missingFields(template, { ...input, details: { ...input.details, chassisNo: '' }, customer: { ...input.customer, nric: '' } });
  assert.ok(gaps.includes('Chassis number') && gaps.includes('Customer NRIC'), gaps.join(', '));
});

test('a placeholder the form does not know becomes an extra field for this agreement', () => {
  const template = { ...defaultTemplate('SEWA_BIASA') };
  template.sections = [{ id: 'x', title: 'Extra', layout: 'clauses' as const, body: 'Guarantor: {{guarantor_name}} and {{customer_name}}' }];
  assert.deepEqual(extraPlaceholders(template), ['guarantor_name']);
  assert.equal(fieldLabel('guarantor_name'), 'Guarantor name');
  assert.deepEqual(placeholdersIn('{{a}} {{ b }} {{a}}'), ['a', 'b']);
  assert.equal(agreementValues({ ...input, extra: { guarantor_name: 'Fixture Guarantor' } }).guarantor_name, 'Fixture Guarantor');
});

test('table and signature rows split on the bar', () => {
  assert.deepEqual(parseRows('Plate | {{vehicle_plate}}\n\nColour|WHITE\nNo bar here'), [['Plate', '{{vehicle_plate}}'], ['Colour', 'WHITE'], ['No bar here']]);
});

test('a saved template is used when it is sound, else the built-in draft', () => {
  const saved = { title: 'Saved', sections: [{ id: 's1', title: 'Only', layout: 'clauses', body: 'Text' }] };
  assert.equal(templateFromStored('SEWA_BIASA', saved).title, 'Saved');
  assert.equal(templateFromStored('SEWA_BIASA', { sections: 'broken' }).title, defaultTemplate('SEWA_BIASA').title);
  assert.equal(templateFromStored('SEWABELI', null).title, defaultTemplate('SEWABELI').title);
});

test('an existing driver fills the customer and rent terms, and the car is found by plate', async () => {
  const { blankInput, fromDriver, carForPlate } = await import('../services/agreements/prefill.ts');
  const driver = { id: 'd1', nric: '900101-00-0001', name: 'Fixture Driver One', phone: '60120000001', address: '2 Fixture Lane', carPlate: 'XAA1001',
    contractStartDate: '2026-01-05', category: 'SEWA_BIASA' as const, rentalCycle: 'MONTHLY' as const, contractDuration: 12, rentalRate: 1400,
    totalAmountPaid: 0, paymentHistory: [] };
  const filled = fromDriver(driver, blankInput('SEWABELI', '2026-10-09'));
  assert.equal(filled.kind, 'SEWA_BIASA');
  assert.deepEqual([filled.customer.name, filled.terms.cycle, filled.terms.duration, filled.terms.rent, filled.terms.agreementDate],
    ['Fixture Driver One', 'MONTHLY', '12', '1400', '2026-10-09']);
  assert.equal(carForPlate([{ plateNumber: 'XAA 1002' }, { plateNumber: 'xaa 1001' }], 'XAA1001')?.plateNumber, 'xaa 1001');
});
