import { AlertTriangle, Building2, CarFront, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { formatDate } from '../../utils';
import { attentionCount, byUrgency, carStatuses, EXPIRY_LABELS, matchesSearch, needsAttention, type Car, type ExpiryTone } from '../../services/fleet/rules';

export type FleetFilter = 'ALL' | 'ATTENTION' | 'OWN' | 'OTHERS';

const TONE_LOOK: Record<ExpiryTone, string> = {
  expired: 'bg-rose-100 text-rose-800',
  due: 'bg-amber-100 text-amber-800',
  missing: 'bg-amber-100 text-amber-800',
  ok: 'bg-emerald-100 text-emerald-800',
  none: 'bg-gray-100 text-gray-600',
};

interface FleetListProps {
  cars: Car[];
  /** Kuala Lumpur's date, YYYY-MM-DD. */
  today: string;
  filter: FleetFilter;
  onFilterChange: (filter: FleetFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onAdd: () => void;
  onEdit: (car: Car) => void;
  onDelete: (car: Car) => void;
}

/** The Fleet page's tiles, search and car cards; FleetView loads and saves around it. */
export default function FleetList({ cars, today, filter, onFilterChange, query, onQueryChange, onAdd, onEdit, onDelete }: FleetListProps) {
  const tiles: { id: FleetFilter; label: string; count: number; Icon: typeof CarFront; look: string }[] = [
    { id: 'ALL', label: 'All cars', count: cars.length, Icon: CarFront, look: 'text-gray-900' },
    { id: 'ATTENTION', label: 'Needs attention', count: attentionCount(cars, today), Icon: AlertTriangle, look: 'text-rose-600' },
    { id: 'OWN', label: 'Own Fleet', count: cars.filter(car => car.ownership === 'Own Fleet').length, Icon: Building2, look: 'text-blue-700' },
    { id: 'OTHERS', label: 'Others', count: cars.filter(car => car.ownership === 'Others').length, Icon: Users, look: 'text-purple-700' },
  ];
  const inFilter = (car: Car) =>
    filter === 'ALL'
    || (filter === 'ATTENTION' && needsAttention(car, today))
    || (filter === 'OWN' && car.ownership === 'Own Fleet')
    || (filter === 'OTHERS' && car.ownership === 'Others');
  const shown = byUrgency(cars.filter(car => inFilter(car) && matchesSearch(car, query)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Fleet</h2>
          <p className="text-sm text-gray-500">Road tax, insurance and inspection reminders</p>
        </div>
        <button type="button" onClick={onAdd} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm">
          <Plus className="w-4 h-4" aria-hidden="true" /> Add car
        </button>
      </div>

      <div role="group" aria-label="Filter cars" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tiles.map(({ id, label, count, Icon, look }) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => onFilterChange(filter === id ? 'ALL' : id)}
            className={`text-left px-3 py-2.5 rounded-xl border bg-white transition-colors ${filter === id ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200 hover:border-gray-300'}`}
          >
            <span className="flex items-center justify-between gap-2 text-sm font-medium text-gray-500">{label}<Icon className="w-4 h-4 shrink-0" aria-hidden="true" /></span>
            <span className={`block text-xl font-bold mt-0.5 ${look}`}>{count}</span>
          </button>
        ))}
      </div>

      <label className="relative block">
        <span className="sr-only">Search cars</span>
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder="Search plate, make, model or notes"
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </label>

      {shown.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 space-y-3">
          <p>{cars.length === 0 ? 'No cars yet.' : 'No cars match this filter or search.'}</p>
          {cars.length === 0 ? (
            <button type="button" onClick={onAdd} className="font-semibold text-blue-600 hover:underline">Add the first car</button>
          ) : (
            <button type="button" onClick={() => { onFilterChange('ALL'); onQueryChange(''); }} className="font-semibold text-blue-600 hover:underline">Show all cars</button>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {shown.map(car => (
            <li key={car.id} className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-3 py-2 border-b border-gray-100 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 truncate">{car.make} {car.model}</h3>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
                    <span className="font-mono font-semibold bg-gray-100 text-gray-800 px-2 py-0.5 rounded">{car.plateNumber}</span>
                    <span className={`px-2 py-0.5 rounded border font-medium ${car.ownership === 'Others' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>{car.ownership}</span>
                    {car.notes && <span className="bg-gray-50 text-gray-700 border border-gray-200 px-2 py-0.5 rounded max-w-[16rem] truncate" title={car.notes}>{car.notes}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => onEdit(car)} aria-label={`Edit ${car.plateNumber}`} title="Edit" className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => onDelete(car)} aria-label={`Delete ${car.plateNumber}`} title="Delete" className="p-2 text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg">
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <dl className="px-3 py-2 space-y-1.5 text-sm">
                {carStatuses(car, today).map(status => (
                  <div key={status.kind} className="flex items-center justify-between gap-3">
                    <dt className="text-gray-600 font-medium shrink-0">{EXPIRY_LABELS[status.kind]}</dt>
                    <dd className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-right">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${TONE_LOOK[status.tone]}`}>{status.text}</span>
                      {status.date && <span className="text-xs text-gray-400">{formatDate(status.date, status.date)}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
