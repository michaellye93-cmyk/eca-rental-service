import { carFromRow, carToRow, type Car, type CarRow } from './rules.ts';

/** The part of the Supabase client the Fleet page uses. */
export interface FleetClient {
  from(table: 'cars'): any;
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
  };
}
