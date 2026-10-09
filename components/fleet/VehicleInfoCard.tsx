import { Pencil } from 'lucide-react';
import Dialog from '../Dialog';
import { formatDate } from '../../utils';
import type { Car, VehicleDetails } from '../../services/fleet/rules';

interface VehicleInfoCardProps {
  car: Car;
  /** The car's details, or null when none are saved yet. */
  details: VehicleDetails | null;
  /** Why the details couldn't load (e.g. the database file isn't run yet), or null. */
  detailsProblem: string | null;
  onEdit: () => void;
  onClose: () => void;
}

/** Opens from a car's plate on Fleet: the registration details agreements are filled from. */
export default function VehicleInfoCard({ car, details, detailsProblem, onEdit, onClose }: VehicleInfoCardProps) {
  const rows: [string, string][] = [
    ['Plate', car.plateNumber],
    ['Make and model', `${car.make} ${car.model}`.trim()],
    ['Colour', details?.colour ?? ''],
    ['Chassis no.', details?.chassisNo ?? ''],
    ['Registration date', details?.registeredDate ? formatDate(details.registeredDate, details.registeredDate) : ''],
    ['Registered owner', details?.ownerName ?? ''],
    ["Owner's ID", details?.ownerId ?? ''],
    ['Ownership', car.ownership],
  ];
  return (
    <Dialog title="Vehicle details" description={`${car.make} ${car.model} · ${car.plateNumber}`} onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        {detailsProblem && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">{detailsProblem}</p>}
        <dl className="divide-y divide-gray-100 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-2">
              <dt className="text-gray-500 shrink-0">{label}</dt>
              <dd className={`text-right break-words min-w-0 ${value ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{value || 'Not set'}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end">
          <button type="button" onClick={onEdit} className="px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 rounded-lg flex items-center gap-2">
            <Pencil className="w-4 h-4" aria-hidden="true" /> Edit car
          </button>
        </div>
      </div>
    </Dialog>
  );
}
