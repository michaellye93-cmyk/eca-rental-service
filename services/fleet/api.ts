import { normalizePlate } from '../../utils.ts';
import { carFromRow, carToRow, detailsFromRow, detailsToRow, type Car, type CarRow, type InsuranceCover, type VehicleDetails, type VehicleDetailsRow } from './rules.ts';

/** The part of the Supabase client the Fleet page uses. */
export interface FleetClient {
  from(table: 'cars' | 'car_details'): any;
  rpc?(name: 'finance_insurance_cover'): PromiseLike<Result<unknown>>;
}

/** Shown when a save or delete finds no car with that id: someone else deleted it meanwhile. */
export const CAR_GONE = 'This car is no longer in the list. Someone may have deleted it.';

type Result<T> = { data: T | null; error: { message: string } | null };
const check = <T>(result: Result<T>): T | null => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

/** Reads and saves public.cars as the signed-in user; the database's row-level security decides who may. */
export function fleetApi(client: FleetClient) {
  const cars = () => client.from('cars');
  return {
    async listCars(): Promise<Car[]> {
      return (check<CarRow[]>(await cars().select('*')) ?? []).map(carFromRow);
    },
    async addCar(car: Car): Promise<void> {
      check(await cars().insert(carToRow(car)));
    },
    async updateCar(car: Car): Promise<void> {
      const { id, ...changes } = carToRow(car);
      const rows = check<{ id: string }[]>(await cars().update(changes).eq('id', id).select('id'));
      if (!rows?.length) throw new Error(CAR_GONE);
    },
    async deleteCar(id: string): Promise<void> {
      const rows = check<{ id: string }[]>(await cars().delete().eq('id', id).select('id'));
      if (!rows?.length) throw new Error(CAR_GONE);
    },
    /** Every car's details (chassis, registration, owner) for the info card and agreements. */
    async listDetails(): Promise<VehicleDetails[]> {
      return (check<VehicleDetailsRow[]>(await client.from('car_details').select('*')) ?? []).map(detailsFromRow);
    },
    /** Adds or replaces one car's details. */
    async saveDetails(details: VehicleDetails): Promise<void> {
      check(await client.from('car_details').upsert({ ...detailsToRow(details), updated_at: new Date().toISOString() }, { onConflict: 'car_id' }));
    },
    /**
     * Finance's latest insurance end date per plate (supabase/migrations/20261012240000_one_vehicle.sql). Admins only:
     * it rejects for staff, and for everyone until that file is run.
     */
    async insuranceCover(): Promise<InsuranceCover> {
      if (!client.rpc) return new Map();
      const rows = check(await client.rpc('finance_insurance_cover')) as { plate_key?: string | null; coverage_end?: string | null }[] | null;
      const cover = new Map<string, string>();
      for (const row of rows ?? []) {
        const plate = normalizePlate(row.plate_key ?? '');
        const end = (row.coverage_end ?? '').slice(0, 10);
        if (plate && end && end > (cover.get(plate) ?? '')) cover.set(plate, end);
      }
      return cover;
    },
  };
}
