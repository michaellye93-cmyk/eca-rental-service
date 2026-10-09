import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileText, Settings2 } from 'lucide-react';
import type { Driver } from '../../types';
import { supabase } from '../../supabaseClient';
import { fleet } from '../../services/fleet/client';
import { detailsChanged, detailsFromRow, emptyDetails, type Car, type VehicleDetails } from '../../services/fleet/rules';
import { agreementApi, type AgreementSettings } from '../../services/agreements/api';
import { blankInput, carForPlate, fromDriver } from '../../services/agreements/prefill';
import { agreementFileName, downloadAgreementPdf } from '../../services/agreements/pdf';
import {
  KIND_LABELS, agreementValues, contractEndDate, extraPlaceholders, fieldLabel, longDate, missingFields, type AgreementInput, type AgreementKind,
} from '../../services/agreements/template';
import AgreementPreview from './AgreementPreview';
import TemplateEditor from './TemplateEditor';
import SearchPick from './SearchPick';

interface AgreementsViewProps {
  drivers: Driver[];
  isAdmin: boolean;
  /** Kuala Lumpur's date, YYYY-MM-DD. */
  today: string;
}

const api = agreementApi(supabase);
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));
const labelLook = 'block text-sm font-bold text-gray-700 mb-1';
const inputLook = 'w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white';
const card = 'bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 space-y-4';

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className={card} aria-labelledby={`agreement-step-${number}`}>
      <h3 id={`agreement-step-${number}`} className="font-bold text-gray-900 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center" aria-hidden="true">{number}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelLook}>{label}</label>
      {children}
    </div>
  );
}

/**
 * The agreement generator: choose the type, fill in the customer, choose the car, check the preview and download the
 * PDF. The PDF is made in this browser; nothing about the agreement is stored. Admins also edit the templates here.
 */
export default function AgreementsView({ drivers, isAdmin, today }: AgreementsViewProps) {
  const [settings, setSettings] = useState<AgreementSettings | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [details, setDetails] = useState<Map<string, VehicleDetails>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => blankInput('SEWABELI', today));
  const [carId, setCarId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState<'idle' | 'saving' | 'saved' | string>('idle');

  const load = useCallback(async () => {
    try {
      const [loadedSettings, loadedCars, loadedDetails] = await Promise.all([api.load(), fleet.listCars(), fleet.listDetails()]);
      setSettings(loadedSettings);
      setCars([...loadedCars].sort((a, b) => a.plateNumber.localeCompare(b.plateNumber)));
      setDetails(new Map(loadedDetails.map(item => [item.carId, item])));
      setProblem(null);
    } catch (err) {
      const text = reason(err);
      setProblem(/agreement_settings|car_details/.test(text)
        ? 'The agreement tables are not in the database yet. Run the agreement SQL file in Supabase first.'
        : `Couldn't load the agreement page: ${text}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const activeDrivers = useMemo(() => drivers.filter(d => !d.isDelisted).sort((a, b) => a.name.localeCompare(b.name)), [drivers]);

  const chooseCar = (id: string) => {
    setCarId(id);
    setSavingDetails('idle');
    const car = cars.find(c => c.id === id);
    const saved = (car && details.get(car.id)) ?? emptyDetails(id);
    setForm(current => ({
      ...current,
      car: car ? { plateNumber: car.plateNumber, make: car.make, model: car.model } : { plateNumber: '', make: '', model: '' },
      details: { chassisNo: saved.chassisNo, registeredDate: saved.registeredDate, colour: saved.colour, ownerName: saved.ownerName, ownerId: saved.ownerId },
    }));
  };
  const chooseDriver = (id: string) => {
    setDriverId(id); // clearing keeps what was typed; only picking a driver fills the form
    const driver = activeDrivers.find(d => d.id === id);
    if (!driver) return;
    setForm(current => fromDriver(driver, current));
    const car = carForPlate(cars, driver.carPlate);
    if (car) chooseCar(car.id);
  };

  if (problem) {
    return (
      <div role="alert" className="p-6 text-sm text-gray-700 bg-white rounded-xl border border-gray-200">
        {problem}{' '}
        <button type="button" onClick={() => void load()} className="font-semibold text-blue-600 underline">Try again</button>
      </div>
    );
  }
  if (!settings) return <div role="status" className="p-6 text-sm text-gray-500">Loading agreements…</div>;

  if (editing && isAdmin) {
    return (
      <TemplateEditor
        templates={settings.templates}
        company={settings.company}
        onSaveTemplate={async (kind, template) => {
          await api.saveTemplate(kind, template);
          setSettings(current => current && { ...current, templates: { ...current.templates, [kind]: template }, builtIn: { ...current.builtIn, [kind]: false } });
        }}
        onResetTemplate={async kind => {
          await api.resetTemplate(kind);
          await load();
        }}
        onSaveCompany={async company => {
          await api.saveCompany(company);
          setSettings(current => current && { ...current, company });
        }}
        onDone={() => setEditing(false)}
      />
    );
  }

  const template = settings.templates[form.kind];
  const input: AgreementInput = { ...form, company: settings.company };
  const values = agreementValues(input);
  const missing = missingFields(template, input);
  const extras = extraPlaceholders(template);
  const setCustomer = (field: keyof AgreementInput['customer']) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(current => ({ ...current, customer: { ...current.customer, [field]: event.target.value } }));
  const setTerm = (field: keyof AgreementInput['terms']) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(current => ({ ...current, terms: { ...current.terms, [field]: event.target.value } }));
  const setDetail = (field: keyof AgreementInput['details']) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setSavingDetails('idle');
    setForm(current => ({ ...current, details: { ...current.details, [field]: event.target.value } }));
  };
  const autoEnd = longDate(contractEndDate(form.terms.startDate, form.terms.cycle, Number(form.terms.duration)));
  const savedDetails = details.get(carId);
  const detailsEdited = !!carId && detailsChanged(savedDetails ?? emptyDetails(carId), { carId, ...form.details });

  const saveDetailsToFleet = async () => {
    setSavingDetails('saving');
    try {
      const next = { carId, ...form.details };
      await fleet.saveDetails(next);
      setDetails(current => new Map(current).set(carId, detailsFromRow({ car_id: carId, chassis_no: next.chassisNo.toUpperCase(), registered_date: next.registeredDate, colour: next.colour.toUpperCase(), owner_name: next.ownerName, owner_id: next.ownerId })));
      setSavingDetails('saved');
    } catch (err) {
      setSavingDetails(`Not saved: ${reason(err)}`);
    }
  };

  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadAgreementPdf(template, values, agreementFileName(KIND_LABELS[form.kind], form.car.plateNumber, form.customer.name));
    } catch (err) {
      setDownloadError(`The PDF couldn't be made: ${reason(err)}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Agreements</h2>
          <p className="text-sm text-gray-500">Fill in, check and download an agreement as a PDF. Nothing is stored.</p>
        </div>
        {isAdmin && (
          <button type="button" onClick={() => setEditing(true)} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg flex items-center gap-2">
            <Settings2 className="w-4 h-4" aria-hidden="true" /> Edit templates
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <Step number={1} title="Agreement type">
            <div role="group" aria-label="Agreement type" className="grid grid-cols-2 gap-2">
              {(['SEWABELI', 'SEWA_BIASA'] as AgreementKind[]).map(kind => (
                <button key={kind} type="button" aria-pressed={form.kind === kind} onClick={() => setForm(current => ({ ...current, kind }))}
                  className={`px-3 py-3 rounded-lg border text-sm font-semibold text-left ${form.kind === kind ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50 text-blue-800' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
                  {KIND_LABELS[kind]}
                  <span className="block text-xs font-normal text-gray-500">{kind === 'SEWABELI' ? 'Lease with ownership reward' : 'Rental, with refundable deposit'}</span>
                </button>
              ))}
            </div>
          </Step>

          <Step number={2} title="Customer and terms">
            <Field id="agreement-driver" label="Fill from an existing driver (optional)">
              <SearchPick id="agreement-driver" value={driverId} onChange={chooseDriver} placeholder="Search a driver's name or plate, or leave empty for a new customer"
                options={activeDrivers.map(d => ({ id: d.id, label: `${d.name} · ${d.carPlate}` }))} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field id="agreement-name" label="Full name (as in NRIC)"><input id="agreement-name" className={inputLook} value={form.customer.name} onChange={setCustomer('name')} /></Field>
              <Field id="agreement-nric" label="NRIC"><input id="agreement-nric" className={inputLook} value={form.customer.nric} onChange={setCustomer('nric')} /></Field>
              <Field id="agreement-phone" label="Phone"><input id="agreement-phone" className={inputLook} value={form.customer.phone} onChange={setCustomer('phone')} /></Field>
              <Field id="agreement-date" label="Agreement date"><input id="agreement-date" type="date" className={inputLook} value={form.terms.agreementDate} onChange={setTerm('agreementDate')} /></Field>
            </div>
            <Field id="agreement-address" label="Address">
              <textarea id="agreement-address" rows={2} className={inputLook} value={form.customer.address} onChange={setCustomer('address')} />
            </Field>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Field id="agreement-start" label="Start date"><input id="agreement-start" type="date" className={inputLook} value={form.terms.startDate} onChange={setTerm('startDate')} /></Field>
              <Field id="agreement-cycle" label="Pays every">
                <select id="agreement-cycle" className={inputLook} value={form.terms.cycle} onChange={setTerm('cycle')}>
                  <option value="WEEKLY">Week</option>
                  <option value="MONTHLY">Month</option>
                </select>
              </Field>
              <Field id="agreement-duration" label={form.terms.cycle === 'WEEKLY' ? 'Number of weeks' : 'Number of months'}>
                <input id="agreement-duration" inputMode="numeric" className={inputLook} value={form.terms.duration} onChange={setTerm('duration')} />
              </Field>
              <Field id="agreement-rent" label="Rent (RM)">
                <input id="agreement-rent" inputMode="decimal" className={inputLook} value={form.terms.rent} onChange={setTerm('rent')} />
              </Field>
              {form.kind === 'SEWABELI' && (
                <Field id="agreement-down" label="Downpayment (RM, if any)">
                  <input id="agreement-down" inputMode="decimal" className={inputLook} value={form.terms.downpayment} onChange={setTerm('downpayment')} />
                </Field>
              )}
              <Field id="agreement-deposit" label={form.kind === 'SEWABELI' ? 'Security deposit (RM, if any)' : 'Deposit (RM)'}>
                <input id="agreement-deposit" inputMode="decimal" className={inputLook} value={form.terms.deposit} onChange={setTerm('deposit')} />
              </Field>
              <Field id="agreement-end" label="End date">
                <input id="agreement-end" type="date" className={inputLook} value={form.terms.endDate} onChange={setTerm('endDate')} aria-describedby="agreement-end-hint" />
              </Field>
            </div>
            <p id="agreement-end-hint" className="text-xs text-gray-500 -mt-2">
              {form.terms.endDate ? 'Clear the end date to work it out from the start date and length.' : autoEnd ? `End date worked out: ${autoEnd}.` : 'Leave the end date empty to work it out from the start date and length.'}
            </p>
          </Step>

          <Step number={3} title="Vehicle">
            <Field id="agreement-car" label="Car (from Fleet)">
              <SearchPick id="agreement-car" value={carId} onChange={chooseCar} placeholder="Search plate, make or model"
                options={cars.map(car => ({ id: car.id, label: `${car.plateNumber} · ${car.make} ${car.model}` }))} />
            </Field>
            {carId && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field id="agreement-chassis" label="Chassis no."><input id="agreement-chassis" className={inputLook} value={form.details.chassisNo} onChange={setDetail('chassisNo')} /></Field>
                  <Field id="agreement-registered" label="Registration date"><input id="agreement-registered" type="date" className={inputLook} value={form.details.registeredDate} onChange={setDetail('registeredDate')} /></Field>
                  <Field id="agreement-colour" label="Colour"><input id="agreement-colour" className={inputLook} value={form.details.colour} onChange={setDetail('colour')} /></Field>
                  <Field id="agreement-owner" label="Registered owner"><input id="agreement-owner" className={inputLook} value={form.details.ownerName} onChange={setDetail('ownerName')} /></Field>
                  <Field id="agreement-owner-id" label="Owner's NRIC or company no."><input id="agreement-owner-id" className={inputLook} value={form.details.ownerId} onChange={setDetail('ownerId')} /></Field>
                </div>
                {(detailsEdited || savingDetails !== 'idle') && (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {detailsEdited && savingDetails !== 'saved' && (
                      <button type="button" onClick={() => void saveDetailsToFleet()} disabled={savingDetails === 'saving'} className="font-semibold text-blue-700 hover:underline disabled:opacity-60">
                        {savingDetails === 'saving' ? 'Saving…' : `Save these details to ${form.car.plateNumber} on Fleet`}
                      </button>
                    )}
                    {savingDetails === 'saved' && <span role="status" className="text-emerald-700">Saved to Fleet.</span>}
                    {savingDetails.startsWith('Not saved') && <span role="alert" className="text-rose-700">{savingDetails}</span>}
                  </div>
                )}
              </>
            )}
          </Step>

          {extras.length > 0 && (
            <Step number={4} title="Other details for this agreement">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {extras.map(key => (
                  <Field key={key} id={`agreement-extra-${key}`} label={fieldLabel(key)}>
                    <input id={`agreement-extra-${key}`} className={inputLook} value={form.extra[key] ?? ''}
                      onChange={event => setForm(current => ({ ...current, extra: { ...current.extra, [key]: event.target.value } }))} />
                  </Field>
                ))}
              </div>
            </Step>
          )}
        </div>

        <div className="space-y-3 xl:sticky xl:top-4">
          <div className={card}>
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><FileText className="w-4 h-4" aria-hidden="true" /> Check and download</h3>
            {missing.length > 0 ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Still empty (they print as a blank line to write in): {missing.join(', ')}.</span>
              </p>
            ) : (
              <p className="text-sm text-emerald-700">Every field is filled in.</p>
            )}
            {!settings.company.company_name && isAdmin && (
              <p className="text-sm text-gray-600">Company details are empty: add them under <button type="button" className="font-semibold text-blue-700 underline" onClick={() => setEditing(true)}>Edit templates</button>.</p>
            )}
            {downloadError && <p role="alert" className="text-sm text-rose-700">{downloadError}</p>}
            <button type="button" onClick={() => void download()} disabled={downloading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold py-2.5 rounded-lg shadow-sm flex items-center justify-center gap-2">
              <Download className="w-4 h-4" aria-hidden="true" /> {downloading ? 'Making the PDF…' : 'Download PDF'}
            </button>
          </div>
          <div className="max-h-[75vh] overflow-y-auto rounded-xl">
            <AgreementPreview template={template} values={values} />
          </div>
        </div>
      </div>
    </div>
  );
}
