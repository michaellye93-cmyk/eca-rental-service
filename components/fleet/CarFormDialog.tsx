import { useState, type ChangeEvent, type FormEvent } from 'react';
import Dialog from '../Dialog';
import { carFormError, detailsError, emptyDetails, newCar, type Car, type Ownership, type VehicleDetails } from '../../services/fleet/rules';

interface CarFormDialogProps {
  /** The car to edit, or null to add a new one. */
  car: Car | null;
  /** Every car, for the duplicate-plate check. */
  cars: Car[];
  /** The car's saved details (chassis, registration, owner), or null when none are saved. */
  details: VehicleDetails | null;
  /** False when the details can't be saved yet (the database file isn't run): the fields are hidden. */
  detailsAvailable: boolean;
  /** Saves the car and its details; a rejected promise keeps the form open and shows why. */
  onSave: (car: Car, details: VehicleDetails) => Promise<void>;
  onClose: () => void;
}

type TextField = 'make' | 'model' | 'plateNumber' | 'roadtaxExpiry' | 'insuranceExpiry' | 'inspectionExpiry' | 'notes';
type DetailField = 'chassisNo' | 'registeredDate' | 'colour' | 'ownerName' | 'ownerId';
const DETAIL_INPUTS: { field: DetailField; label: string; type?: string; placeholder?: string }[] = [
  { field: 'chassisNo', label: 'Chassis no.' },
  { field: 'registeredDate', label: 'Registration date', type: 'date' },
  { field: 'colour', label: 'Colour', placeholder: 'e.g. White' },
  { field: 'ownerName', label: 'Registered owner' },
  { field: 'ownerId', label: "Owner's NRIC or company no." },
];
const labelLook = 'block text-sm font-bold text-gray-700 mb-1';
const inputLook = 'w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none';

/** Add or edit one car. Road tax and insurance dates are required; inspection may stay empty. */
export default function CarFormDialog({ car, cars, details, detailsAvailable, onSave, onClose }: CarFormDialogProps) {
  const [form, setForm] = useState<Car>(() => car ?? newCar());
  const [extra, setExtra] = useState<VehicleDetails>(() => details ?? emptyDetails(form.id));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const change = (field: TextField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(current => ({ ...current, [field]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = carFormError(form, cars) ?? (detailsAvailable ? detailsError(extra) : null);
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    try {
      await onSave(form, { ...extra, carId: form.id });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setError(text.startsWith('The car is saved,') ? `${text} Press Save to try again.` : `Car not saved: ${text}`);
      setSaving(false);
    }
  };

  return (
    <Dialog title={car ? 'Edit car' : 'Add car'} description={car ? `${car.make} ${car.model} · ${car.plateNumber}` : undefined} onClose={onClose}>
      <form onSubmit={submit} noValidate className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="fleet-make" className={labelLook}>Make</label>
            <input id="fleet-make" required className={inputLook} value={form.make} onChange={change('make')} placeholder="e.g. Perodua" />
          </div>
          <div>
            <label htmlFor="fleet-model" className={labelLook}>Model</label>
            <input id="fleet-model" required className={inputLook} value={form.model} onChange={change('model')} placeholder="e.g. Bezza" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="fleet-plate" className={labelLook}>Plate</label>
            <input id="fleet-plate" required className={inputLook} value={form.plateNumber} onChange={change('plateNumber')} placeholder="e.g. ABC 1234" />
          </div>
          <div>
            <label htmlFor="fleet-ownership" className={labelLook}>Ownership</label>
            <select id="fleet-ownership" className={inputLook} value={form.ownership} onChange={event => setForm(current => ({ ...current, ownership: event.target.value as Ownership }))}>
              <option value="Own Fleet">Own Fleet</option>
              <option value="Others">Others</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="fleet-roadtax" className={labelLook}>Road tax expiry</label>
            <input id="fleet-roadtax" type="date" required className={inputLook} value={form.roadtaxExpiry} onChange={change('roadtaxExpiry')} />
          </div>
          <div>
            <label htmlFor="fleet-insurance" className={labelLook}>Insurance expiry</label>
            <input id="fleet-insurance" type="date" required className={inputLook} value={form.insuranceExpiry} onChange={change('insuranceExpiry')} />
          </div>
          <div>
            <label htmlFor="fleet-inspection" className={labelLook}>Inspection expiry <span className="font-normal text-gray-500">(optional)</span></label>
            <input id="fleet-inspection" type="date" aria-describedby="fleet-inspection-hint" className={inputLook} value={form.inspectionExpiry} onChange={change('inspectionExpiry')} />
            <p id="fleet-inspection-hint" className="text-xs text-gray-500 mt-1">Leave empty if this car doesn't need inspection.</p>
          </div>
        </div>
        {detailsAvailable && (
          <fieldset className="border border-gray-200 rounded-lg p-4">
            <legend className="px-1 text-sm font-bold text-gray-700">Registration details <span className="font-normal text-gray-500">(for agreements, optional)</span></legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {DETAIL_INPUTS.map(({ field, label, type, placeholder }) => (
                <div key={field}>
                  <label htmlFor={`fleet-${field}`} className={labelLook}>{label}</label>
                  <input id={`fleet-${field}`} type={type ?? 'text'} className={inputLook} value={extra[field]} placeholder={placeholder}
                    onChange={event => setExtra(current => ({ ...current, [field]: event.target.value }))} />
                </div>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <label htmlFor="fleet-notes" className={labelLook}>Notes</label>
          <textarea id="fleet-notes" rows={2} className={inputLook} value={form.notes} onChange={change('notes')} />
        </div>
        {error && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg shadow-sm">
            {saving ? 'Saving…' : 'Save car'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
