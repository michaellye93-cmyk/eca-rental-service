import { useCallback, useEffect, useRef, useState } from 'react';
import Notice, { type NoticeMessage } from '../Notice';
import { ConfirmDialog } from '../Dialog';
import FleetList, { type FleetFilter } from './FleetList';
import CarFormDialog from './CarFormDialog';
import VehicleInfoCard from './VehicleInfoCard';
import { fleet } from '../../services/fleet/client';
import { detailsChanged, emptyDetails, type Car, type VehicleDetails } from '../../services/fleet/rules';

interface FleetViewProps {
  /** Kuala Lumpur's date, YYYY-MM-DD. */
  today: string;
  /** Called with the car list after every load, so the Fleet tab's count stays current. */
  onCarsChange?: (cars: Car[]) => void;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The Fleet page: loads the car list, and lets staff and admins add, edit and delete cars. */
export default function FleetView({ today, onCarsChange }: FleetViewProps) {
  const [cars, setCars] = useState<Car[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FleetFilter>('ALL');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Car | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Car | null>(null);
  const [viewing, setViewing] = useState<Car | null>(null);
  // Each car's details by car id, and why they can't be read (e.g. the database file isn't run yet)
  const [details, setDetails] = useState<Map<string, VehicleDetails>>(new Map());
  const [detailsProblem, setDetailsProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  // The latest callback, so a new function from the dashboard doesn't reload the list
  const carsChanged = useRef(onCarsChange);
  useEffect(() => { carsChanged.current = onCarsChange; });

  const reload = useCallback(async () => {
    try {
      const loaded = await fleet.listCars();
      setCars(loaded);
      setLoadError(null);
      carsChanged.current?.(loaded);
    } catch (err) {
      setLoadError(reason(err));
    }
    try {
      setDetails(new Map((await fleet.listDetails()).map(item => [item.carId, item])));
      setDetailsProblem(null);
    } catch (err) {
      setDetailsProblem(`Vehicle details can't be read yet: ${reason(err)}`);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // A failed save keeps the form open with the reason (CarFormDialog shows it); the list reloads either way.
  const saveCar = async (car: Car, carDetails: VehicleDetails) => {
    try {
      if (editing === 'new') await fleet.addCar(car);
      else await fleet.updateCar(car);
      if (!detailsProblem && detailsChanged(details.get(car.id) ?? emptyDetails(car.id), carDetails)) await fleet.saveDetails(carDetails);
    } finally {
      void reload();
    }
    setEditing(null);
    setNotice({ type: 'success', text: `${car.plateNumber} saved.` });
  };

  const confirmDelete = async () => {
    const car = deleting;
    if (!car) return;
    setDeleting(null);
    try {
      await fleet.deleteCar(car.id);
      setNotice({ type: 'success', text: `${car.plateNumber} deleted.` });
    } catch (err) {
      setNotice({ type: 'error', text: `Car not deleted: ${reason(err)}` });
    }
    await reload();
  };

  if (!cars) {
    return loadError ? (
      <div role="alert" className="p-6 text-sm text-gray-700">
        Couldn't load the car list: {loadError}{' '}
        <button type="button" onClick={() => void reload()} className="font-semibold text-blue-600 underline">Try again</button>
      </div>
    ) : (
      <div role="status" className="p-6 text-sm text-gray-500">Loading cars…</div>
    );
  }

  return (
    <>
      {loadError && <p role="alert" className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">Couldn't refresh the car list: {loadError}</p>}
      <FleetList
        cars={cars}
        today={today}
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        onAdd={() => setEditing('new')}
        onEdit={setEditing}
        onOpen={setViewing}
        onDelete={setDeleting}
      />
      {viewing && (
        <VehicleInfoCard car={viewing} details={details.get(viewing.id) ?? null} detailsProblem={detailsProblem}
          onEdit={() => { setEditing(viewing); setViewing(null); }} onClose={() => setViewing(null)} />
      )}
      {editing && (
        <CarFormDialog car={editing === 'new' ? null : editing} cars={cars} details={editing === 'new' ? null : details.get(editing.id) ?? null}
          detailsAvailable={!detailsProblem} onSave={saveCar} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog title="Delete car" confirmLabel="Delete car" onConfirm={() => void confirmDelete()} onCancel={() => setDeleting(null)}>
          <p>Delete <strong>{deleting.make} {deleting.model} ({deleting.plateNumber})</strong> from the Fleet list?</p>
          <p>It can't be undone.</p>
        </ConfirmDialog>
      )}
      <Notice notice={notice} onDismiss={dismissNotice} />
    </>
  );
}
