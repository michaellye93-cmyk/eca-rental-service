import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, MessageCircle } from 'lucide-react';
import Notice, { type NoticeMessage } from '../Notice';
import { ConfirmDialog } from '../Dialog';
import FleetList, { type FleetFilter } from './FleetList';
import CarFormDialog from './CarFormDialog';
import VehicleInfoCard from './VehicleInfoCard';
import { fleet } from '../../services/fleet/client';
import { fleetReminderText } from '../../services/fleet/reminder';
import { detailsChanged, emptyDetails, type Car, type InsuranceCover, type VehicleDetails } from '../../services/fleet/rules';

interface FleetViewProps {
  /** Kuala Lumpur's date, YYYY-MM-DD. */
  today: string;
  /** Admins also see Finance's insurance dates (staff cannot read Finance). */
  isAdmin?: boolean;
  /** Called with the car list after every load, so the Fleet tab's count stays current. */
  onCarsChange?: (cars: Car[]) => void;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** Starts the message when the car itself was saved and only its registration details failed. */
const CAR_SAVED = 'The car is saved,';

/** The Fleet page: loads the car list, and lets staff and admins add, edit and delete cars. */
export default function FleetView({ today, isAdmin = false, onCarsChange }: FleetViewProps) {
  const [cars, setCars] = useState<Car[] | null>(null);
  // Finance's insurance end date per plate; none for staff, or when it can't be read (Fleet then uses its own dates)
  const [cover, setCover] = useState<InsuranceCover | undefined>(undefined);
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
    if (isAdmin) setCover(await fleet.insuranceCover().catch(() => undefined));
  }, [isAdmin]);

  useEffect(() => { void reload(); }, [reload]);

  // A failed save keeps the form open with the reason (CarFormDialog shows it); the list reloads either way.
  const saveCar = async (car: Car, carDetails: VehicleDetails) => {
    try {
      if (editing === 'new') {
        await fleet.addCar(car);
        setEditing(car); // a retry now edits the saved car instead of adding it twice
      } else {
        await fleet.updateCar(car);
      }
      if (!detailsProblem && detailsChanged(details.get(car.id) ?? emptyDetails(car.id), carDetails)) {
        try {
          await fleet.saveDetails(carDetails);
        } catch (err) {
          throw new Error(`${CAR_SAVED} but its registration details are not: ${reason(err)}`);
        }
      }
    } finally {
      void reload();
    }
    setEditing(null);
    setNotice({ type: 'success', text: `${car.plateNumber} saved.` });
  };

  // "Use this date": the car takes Finance's later insurance date, so Fleet has one master date again.
  const acceptFinanceInsurance = async (car: Car, date: string) => {
    try {
      await fleet.updateCar({ ...car, insuranceExpiry: date });
      setNotice({ type: 'success', text: `${car.plateNumber}: insurance date updated from Finance.` });
    } catch (err) {
      setNotice({ type: 'error', text: `Insurance date not updated: ${reason(err)}` });
    }
    await reload();
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

  // This week's reminder (staff and admins): cars due in the next 30 days, expired or missing, shared on WhatsApp
  const shareReminder = () => {
    if (!cars) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(fleetReminderText(cars, today, cover))}`, '_blank', 'noopener,noreferrer');
  };
  const copyReminder = async () => {
    if (!cars) return;
    try {
      await navigator.clipboard.writeText(fleetReminderText(cars, today, cover));
      setNotice({ type: 'success', text: "This week's list is copied. Paste it into WhatsApp." });
    } catch {
      setNotice({ type: 'error', text: "Couldn't copy the list. Use Send this week's list instead." });
    }
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
        cover={cover}
        onUseFinanceInsurance={(car, date) => void acceptFinanceInsurance(car, date)}
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        onAdd={() => setEditing('new')}
        onEdit={setEditing}
        onOpen={setViewing}
        onDelete={setDeleting}
        actions={<>
          <button type="button" onClick={shareReminder} title="Opens WhatsApp with the cars due in the next 30 days, expired or missing" className="bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm">
            <MessageCircle className="w-4 h-4" aria-hidden="true" /> Send this week's list
          </button>
          <button type="button" onClick={() => void copyReminder()} aria-label="Copy this week's list" title="Copy this week's list" className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 text-sm font-semibold px-3 py-2 rounded-lg flex items-center gap-2 shadow-sm">
            <Copy className="w-4 h-4" aria-hidden="true" /> Copy
          </button>
        </>}
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
