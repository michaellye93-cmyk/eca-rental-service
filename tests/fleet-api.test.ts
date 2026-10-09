import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_GONE, fleetApi } from '../services/fleet/api.ts';
import type { Car } from '../services/fleet/rules.ts';

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: { message: string } | null };

/** Stands in for supabase.from('cars'): records each call in the chain and answers with `result` once awaited. */
function fakeClient(result: Result) {
  const calls: Call[] = [];
  const builder: any = new Proxy({}, {
    get(_target, method: string) {
      if (method === 'then') return (resolve: (value: Result) => void) => resolve(result);
      return (...args: unknown[]) => { calls.push({ method, args }); return builder; };
    },
  });
  return { client: { from: (table: string) => { calls.push({ method: 'from', args: [table] }); return builder; } }, calls };
}

const sample: Car = { id: 'car-1', make: 'PERODUA', model: 'BEZZA', plateNumber: 'TST 1001', roadtaxExpiry: '2026-10-01',
  insuranceExpiry: '2026-10-02', inspectionExpiry: '', notes: 'fixture', ownership: 'Own Fleet' };

test('the list is read from the cars table and each row becomes a car', async () => {
  const { client, calls } = fakeClient({ data: [{ id: 'r1', make: 'PERODUA', model: 'BEZZA', plateNumber: 'TST 1001',
    roadtaxExpiry: '2026-10-01', insuranceExpiry: '2026-10-02', inspectionExpiry: '', notes: 'fixture note', label: 'older label', ownership: 'Others' }], error: null });
  const cars = await fleetApi(client).listCars();
  assert.deepEqual(calls, [{ method: 'from', args: ['cars'] }, { method: 'select', args: ['*'] }]);
  assert.deepEqual([cars[0].plateNumber, cars[0].notes, cars[0].ownership], ['TST 1001', 'fixture note', 'Others']);
});

test('adding a car inserts its columns, without the older label column', async () => {
  const { client, calls } = fakeClient({ data: null, error: null });
  await fleetApi(client).addCar(sample);
  assert.equal(calls[1].method, 'insert');
  const row = calls[1].args[0] as Record<string, unknown>;
  assert.deepEqual([row.id, row.plateNumber, 'label' in row], ['car-1', 'TST 1001', false]);
});

test('editing changes that one car by id, and says so plainly when the car is gone', async () => {
  const saved = fakeClient({ data: [{ id: 'car-1' }], error: null });
  await fleetApi(saved.client).updateCar(sample);
  assert.deepEqual(saved.calls.map(c => c.method), ['from', 'update', 'eq', 'select']);
  assert.equal('id' in (saved.calls[1].args[0] as object), false);
  assert.deepEqual(saved.calls[2].args, ['id', 'car-1']);
  const gone = fakeClient({ data: [], error: null });
  await assert.rejects(fleetApi(gone.client).updateCar(sample), { message: CAR_GONE });
});

test('deleting removes that one car by id; a refusal from the database is reported in its own words', async () => {
  const deleted = fakeClient({ data: [{ id: 'car-1' }], error: null });
  await fleetApi(deleted.client).deleteCar('car-1');
  assert.deepEqual(deleted.calls.map(c => c.method), ['from', 'delete', 'eq', 'select']);
  assert.deepEqual(deleted.calls[2].args, ['id', 'car-1']);
  await assert.rejects(fleetApi(fakeClient({ data: [], error: null }).client).deleteCar('car-1'), { message: CAR_GONE });
  const refused = fakeClient({ data: null, error: { message: 'permission denied for table cars' } });
  await assert.rejects(fleetApi(refused.client).deleteCar('car-1'), { message: 'permission denied for table cars' });
});

test('details are read from car_details and saved by car, chassis and colour in capitals', async () => {
  const read = fakeClient({ data: [{ car_id: 'car-1', chassis_no: 'FIXTURECHASSIS1', registered_date: '2024-01-15', colour: 'WHITE', owner_name: 'Fixture Owner', owner_id: null }], error: null });
  const details = await fleetApi(read.client).listDetails();
  assert.deepEqual(read.calls, [{ method: 'from', args: ['car_details'] }, { method: 'select', args: ['*'] }]);
  assert.deepEqual(details, [{ carId: 'car-1', chassisNo: 'FIXTURECHASSIS1', registeredDate: '2024-01-15', colour: 'WHITE', ownerName: 'Fixture Owner', ownerId: '' }]);
  const saved = fakeClient({ data: null, error: null });
  await fleetApi(saved.client).saveDetails({ carId: 'car-1', chassisNo: ' fixturechassis1 ', registeredDate: '', colour: 'white', ownerName: 'Fixture Owner', ownerId: '000000-00-0000' });
  assert.deepEqual(saved.calls.map(c => c.method), ['from', 'upsert']);
  const row = saved.calls[1].args[0] as Record<string, unknown>;
  assert.deepEqual([row.car_id, row.chassis_no, row.registered_date, row.colour], ['car-1', 'FIXTURECHASSIS1', null, 'WHITE']);
  assert.deepEqual(saved.calls[1].args[1], { onConflict: 'car_id' });
});
