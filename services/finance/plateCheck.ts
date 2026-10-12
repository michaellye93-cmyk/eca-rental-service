import { normalizePlate } from '../../utils.ts';

/** One plate to check: its key (capitals, no spaces), how it is written where it was found, and what is there. */
export interface PlateToCheck {
  plate: string;
  label: string;
  detail: string;
}

export interface PlatesToCheck {
  /** In Finance's Vehicle Master (not deleted) with no car on the Fleet page; detail: Finance's status. */
  financeOnly: PlateToCheck[];
  /** On the Fleet page with no vehicle in Finance's Vehicle Master; detail: make and model. */
  fleetOnly: PlateToCheck[];
  /** Active drivers whose plate is neither on Fleet nor in Finance; detail: the drivers' names. */
  driversOnNeither: PlateToCheck[];
}

interface FinanceVehicleLike { plate_key: string; display_plate: string; status?: string | null; deleted_at?: string | null }
interface FleetCarLike { plateNumber: string; make: string; model: string }
interface DriverLike { name: string; carPlate: string; isDelisted?: boolean }

/** Groups items by normalised plate (empty plates left out), keeping the first spelling found; sorted by plate. */
const byPlate = <T>(items: T[], plateOf: (item: T) => string): Map<string, { label: string; items: T[] }> => {
  const groups = new Map<string, { label: string; items: T[] }>();
  for (const item of items) {
    const typed = (plateOf(item) || '').trim();
    const plate = normalizePlate(typed);
    if (!plate) continue;
    const group = groups.get(plate) ?? { label: typed, items: [] };
    group.items.push(item);
    groups.set(plate, group);
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
};

/**
 * Plates that do not line up across Finance's Vehicle Master, the Fleet page and the active drivers, compared in the
 * drivers format (capitals, no spaces). Read only: it lists what to check and changes nothing.
 */
export function platesToCheck(vehicles: FinanceVehicleLike[], cars: FleetCarLike[], drivers: DriverLike[]): PlatesToCheck {
  const finance = byPlate(vehicles.filter(vehicle => !vehicle.deleted_at), vehicle => vehicle.display_plate || vehicle.plate_key);
  const fleet = byPlate(cars, car => car.plateNumber);
  const active = byPlate(drivers.filter(driver => !driver.isDelisted), driver => driver.carPlate);
  return {
    financeOnly: [...finance].filter(([plate]) => !fleet.has(plate))
      .map(([plate, { label, items }]) => ({ plate, label, detail: items[0].status ?? '' })),
    fleetOnly: [...fleet].filter(([plate]) => !finance.has(plate))
      .map(([plate, { label, items }]) => ({ plate, label, detail: `${items[0].make} ${items[0].model}`.trim() })),
    driversOnNeither: [...active].filter(([plate]) => !fleet.has(plate) && !finance.has(plate))
      .map(([plate, { label, items }]) => ({ plate, label, detail: items.map(driver => driver.name).join(', ') })),
  };
}
