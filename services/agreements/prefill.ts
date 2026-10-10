import type { Driver } from '../../types.ts';
import type { DepositKind } from '../depositsApi.ts';
import { normalizePlate } from '../../utils.ts';
import type { AgreementInput, AgreementKind } from './template.ts';

/** A blank agreement of this type, dated `today` (YYYY-MM-DD). */
export const blankInput = (kind: AgreementKind, today: string): Omit<AgreementInput, 'company'> => ({
  kind,
  customer: { name: '', nric: '', phone: '', address: '', emergencyName: '', emergencyPhone: '' },
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
  customer: {
    name: driver.name || '', nric: driver.nric || '', phone: driver.phone || '', address: driver.address || '',
    emergencyName: driver.emergencyContactName || '', emergencyPhone: driver.emergencyContactPhone || '',
  },
  terms: {
    ...current.terms,
    startDate: driver.contractStartDate || '',
    endDate: driver.contractEndDate || '',
    cycle: driver.rentalCycle === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY',
    duration: driver.contractDuration ? String(driver.contractDuration) : '',
    rent: driver.rentalRate ? String(driver.rentalRate) : '',
  },
});

/** The deposit and downpayment received, as recorded in the driver's Deposits panel; nothing recorded leaves them empty. */
export const withDeposits = <T extends Pick<AgreementInput, 'terms'>>(input: T, received: Record<DepositKind, number>): T => ({
  ...input,
  terms: {
    ...input.terms,
    deposit: received.DEPOSIT > 0 ? String(received.DEPOSIT) : '',
    downpayment: received.DOWNPAYMENT > 0 ? String(received.DOWNPAYMENT) : '',
  },
});

/** The Fleet car with this plate (ignoring spaces and letter case), if any. */
export const carForPlate = <T extends { plateNumber: string }>(cars: T[], plate: string): T | undefined => {
  const key = normalizePlate(plate);
  return key ? cars.find(car => normalizePlate(car.plateNumber) === key) : undefined;
};
