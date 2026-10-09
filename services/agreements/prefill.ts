import type { Driver } from '../../types.ts';
import { normalizePlate } from '../../utils.ts';
import type { AgreementInput, AgreementKind } from './template.ts';

/** A blank agreement of this type, dated `today` (YYYY-MM-DD). */
export const blankInput = (kind: AgreementKind, today: string): Omit<AgreementInput, 'company'> => ({
  kind,
  customer: { name: '', nric: '', phone: '', address: '' },
  terms: { agreementDate: today, startDate: '', endDate: '', cycle: 'WEEKLY', duration: '', rent: '', deposit: '', downpayment: '' },
  car: { plateNumber: '', make: '', model: '' },
  details: { chassisNo: '', registeredDate: '', colour: '', ownerName: '', ownerId: '' },
  extra: {},
});

/**
 * The customer and rent terms from an existing driver, to save retyping (the form stays editable). The type follows the
 * driver's category; the car is matched by plate later. Deposits are not on the driver record.
 */
export const fromDriver = (driver: Driver, current: Omit<AgreementInput, 'company'>): Omit<AgreementInput, 'company'> => ({
  ...current,
  kind: (driver.category || '').toUpperCase().replace(/\s+/g, '_') === 'SEWA_BIASA' ? 'SEWA_BIASA' : 'SEWABELI',
  customer: { name: driver.name || '', nric: driver.nric || '', phone: driver.phone || '', address: driver.address || '' },
  terms: {
    ...current.terms,
    startDate: driver.contractStartDate || '',
    endDate: driver.contractEndDate || '',
    cycle: driver.rentalCycle === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY',
    duration: driver.contractDuration ? String(driver.contractDuration) : '',
    rent: driver.rentalRate ? String(driver.rentalRate) : '',
  },
});

/** The Fleet car with this plate (ignoring spaces and letter case), if any. */
export const carForPlate = <T extends { plateNumber: string }>(cars: T[], plate: string): T | undefined => {
  const key = normalizePlate(plate);
  return key ? cars.find(car => normalizePlate(car.plateNumber) === key) : undefined;
};
