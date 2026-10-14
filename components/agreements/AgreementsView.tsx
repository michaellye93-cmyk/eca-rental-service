import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FileText, Pencil, Settings2 } from 'lucide-react';
import type { Driver } from '../../types';
import { supabase } from '../../supabaseClient';
import { fleet } from '../../services/fleet/client';
import { emptyDetails, type Car, type VehicleDetails } from '../../services/fleet/rules';
import { loadDeposits } from '../../services/depositsApi';
import { receivedByKind } from '../../services/depositTotals';
import { agreementApi, type AgreementSettings } from '../../services/agreements/api';
import { blankInput, carForPlate, fromDriver, withDeposits } from '../../services/agreements/prefill';
import { agreementFileName, downloadAgreementPdf, downloadLetterPdf } from '../../services/agreements/pdf';
import { LETTER_KINDS, LETTER_LABELS, letterFileName, letterValues, type LetterKind } from '../../services/agreements/letters';
import { downloadGrabLetterPdf, grabLetterFileName, grabLetterValues, otherLetterFileName } from '../../services/agreements/grabLetter';
import {
  KIND_LABELS, agreementValues, extraPlaceholders, fieldLabel, longDate, missingFields, type AgreementInput,
} from '../../services/agreements/template';
import { formatCurrency } from '../../utils';
import AgreementPreview from './AgreementPreview';
import TemplateEditor from './TemplateEditor';
import GrabLetterPreview from './GrabLetterPreview';
import SearchPick from './SearchPick';
import LetterPreview from './LetterPreview';

interface AgreementsViewProps {
  drivers: Driver[];
  isAdmin: boolean;
  /** Kuala Lumpur's date, YYYY-MM-DD. */
  today: string;
  /** A driver to start with (from a driver card's Agreement button). */
  initialDriverId?: string;
  /** Opens the driver's Edit Driver form: the one place their details are changed. */
  onEditDriver?: (driver: Driver) => void;
}

const api = agreementApi(supabase);
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));
const labelLook = 'block text-sm font-bold text-gray-700 mb-1';
const inputLook = 'w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white';
const card = 'bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 space-y-4';

function Step({ number, title, note, children }: { number: number; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={card} aria-labelledby={`agreement-step-${number}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`agreement-step-${number}`} className="font-bold text-gray-900 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center" aria-hidden="true">{number}</span>
          {title}
        </h3>
        {note}
      </div>
      {children}
    </section>
  );
}

/** Read-only facts that come from another page, with an empty one flagged. */
function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 border-b border-gray-100 py-1">
          <dt className="text-gray-500 shrink-0">{label}</dt>
          <dd className={`text-right break-words min-w-0 ${value ? 'font-medium text-gray-900' : 'text-amber-700'}`}>{value || 'Not set'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The signing-day details typed here: they belong to this agreement only and are kept only in its saved copy. */
const SIGNING_FIELDS = ['agreement_ref', 'witness_name', 'witness_id', 'odometer_km', 'fuel_level'];

/**
 * The agreement generator. Every detail comes from where it is kept: the driver's profile (Add / Edit Driver), their
 * Deposits panel, Fleet and the company details; only the signing-day details are typed here. Download makes the PDF
 * in this browser and keeps a copy of the agreement's text for the driver's own page. Admins also edit the templates.
 */
export default function AgreementsView({ drivers, isAdmin, today, initialDriverId = '', onEditDriver }: AgreementsViewProps) {
  const [settings, setSettings] = useState<AgreementSettings | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [details, setDetails] = useState<Map<string, VehicleDetails>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [driverId, setDriverId] = useState(initialDriverId);
  const [agreementDate, setAgreementDate] = useState(today);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [deposits, setDeposits] = useState<{ driverId: string; received: { DEPOSIT: number; DOWNPAYMENT: number } | null; problem?: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = useRef(false);
  // Which paper this page makes: the rental agreement, the Grab or other e-hailing operator's authorization letter, or a
  // letter to the driver (cancellation, rent demand, CTOS letter of demand)
  const [paper, setPaper] = useState<'agreement' | 'grab' | 'other' | LetterKind>('agreement');
  const [letterDate, setLetterDate] = useState(today);
  // Typed for a letter to the driver; the reference starts as the driver's NRIC digits, as on the owner's own letters
  const [letterRef, setLetterRef] = useState('');
  const [payWithin, setPayWithin] = useState('7');
  const [repairCost, setRepairCost] = useState('');
  const [paintDentCost, setPaintDentCost] = useState('');
  const demand = (LETTER_KINDS as string[]).includes(paper) ? paper as LetterKind : null;

  const load = useCallback(async () => {
    try {
      const [loadedSettings, loadedCars, loadedDetails] = await Promise.all([api.load(), fleet.listCars(), fleet.listDetails()]);
      setSettings(loadedSettings);
      setCars(loadedCars);
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
  useEffect(() => {
    if (initialDriverId) setDriverId(initialDriverId);
  }, [initialDriverId]);

  // Choosing a driver starts the signing-day details afresh, then fills them from the agreement last saved for them
  const [lastSaved, setLastSaved] = useState('');
  const chosenNric = drivers.find(d => d.id === driverId)?.nric ?? '';
  useEffect(() => {
    setLetterRef(chosenNric.replace(/\D/g, ''));
    setRepairCost('');
    setPaintDentCost('');
  }, [driverId, chosenNric]);
  useEffect(() => {
    setExtra({});
    setAgreementDate(today);
    setLastSaved('');
    if (!driverId) return;
    let live = true;
    api.latestCopy(driverId).then(copy => {
      if (!live || !copy) return;
      const extraKeys = (keys: Record<string, string>) => Object.fromEntries(Object.entries(keys).filter(([key]) => SIGNING_FIELDS.includes(key)));
      setExtra(copy.signing?.extra ?? extraKeys(copy.values));
      if (copy.signing?.agreementDate) setAgreementDate(copy.signing.agreementDate);
      setLastSaved(copy.createdAt);
    }).catch(() => { /* no copy readable: start blank */ });
    return () => { live = false; };
  }, [driverId, today]);

  // The chosen driver's deposit and downpayment, from their Deposits panel; read again whenever the driver list reloads
  // (it does after Add / Edit Driver saves, which may have recorded a deposit)
  useEffect(() => {
    if (!driverId) return;
    let live = true;
    loadDeposits(driverId)
      .then(rows => { if (live) setDeposits({ driverId, received: receivedByKind(rows) }); })
      .catch(err => { if (live) setDeposits({ driverId, received: null, problem: reason(err) }); });
    return () => { live = false; };
  }, [driverId, drivers]);

  const activeDrivers = useMemo(() => drivers.filter(d => !d.isDelisted).sort((a, b) => a.name.localeCompare(b.name)), [drivers]);
  // Letters to a driver go to delisted drivers too: a cancelled or repossessed driver usually is
  const allDrivers = useMemo(() => [...drivers].sort((a, b) => Number(!!a.isDelisted) - Number(!!b.isDelisted) || a.name.localeCompare(b.name)), [drivers]);
  const driver = drivers.find(d => d.id === driverId) ?? null;

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
        letters={settings.letters}
        company={settings.company}
        onSaveTemplate={async (kind, template) => {
          await api.saveTemplate(kind, template);
          setSettings(current => current && { ...current, templates: { ...current.templates, [kind]: template }, builtIn: { ...current.builtIn, [kind]: false } });
        }}
        onResetTemplate={async kind => {
          await api.resetTemplate(kind);
          await load();
        }}
        onSaveLetter={async (kind, letter) => {
          try {
            await api.saveLetter(kind, letter);
          } catch (err) {
            throw new Error(/check constraint/.test(reason(err)) ? 'run the agreement letters SQL file in Supabase first' : reason(err));
          }
          setSettings(current => current && { ...current, letters: { ...current.letters, [kind]: letter }, letterBuiltIn: { ...current.letterBuiltIn, [kind]: false } });
        }}
        onResetLetter={async kind => {
          await api.resetLetter(kind);
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

  // Everything is worked out from the driver, Fleet and the company on every render, so edits elsewhere show at once
  const car = driver ? carForPlate(cars, driver.carPlate) : undefined;
  const carDetails = car ? details.get(car.id) ?? emptyDetails(car.id) : null;
  const base = driver ? fromDriver(driver, blankInput('SEWABELI', today)) : blankInput('SEWABELI', today);
  const depositsReady = !!deposits && deposits.driverId === driverId && !!deposits.received;
  const depositsProblem = deposits && deposits.driverId === driverId ? deposits.problem : undefined;
  const received = (depositsReady && deposits?.received) || { DEPOSIT: 0, DOWNPAYMENT: 0 };
  const input: AgreementInput = {
    ...withDeposits(base, received),
    terms: { ...withDeposits(base, received).terms, agreementDate },
    car: car ? { plateNumber: car.plateNumber, make: car.make, model: car.model } : { plateNumber: driver?.carPlate ?? '', make: '', model: '' },
    details: carDetails
      ? { chassisNo: carDetails.chassisNo, registeredDate: carDetails.registeredDate, colour: carDetails.colour, ownerName: carDetails.ownerName, ownerId: carDetails.ownerId }
      : base.details,
    extra,
    company: settings.company,
  };
  const template = settings.templates[input.kind];
  const values = agreementValues(input);
  const missing = driver ? missingFields(template, input) : [];
  const signingFields = extraPlaceholders(template);
  const typeLabel = KIND_LABELS[input.kind];

  const letter = grabLetterValues({ driver: driver ?? {}, car: car ?? null, details: carDetails, letterDate });
  const letterMissing = ([
    ["the driver's name", letter.driver_name], ["the driver's NRIC", letter.driver_ic_no], ['the vehicle model', letter.vehicle_model],
    ['the plate', letter.vehicle_plate], ['the registered owner (Fleet)', letter.owner_name], ["the owner's ID (Fleet)", letter.owner_ic_no],
    ['the date', letter.letter_date],
  ] as const).filter(([, value]) => !value).map(([label]) => label);
  const days = Math.max(1, Math.min(90, Math.round(Number(payWithin)) || 7));
  const demandValues = driver && demand ? letterValues({
    driver, car: car ?? null, company: settings.company, letterDate, today, payWithinDays: days, reference: letterRef.trim(), repairCost, paintDentCost,
  }) : null;
  const demandMissing = demandValues ? ([
    ["the driver's name", demandValues.customer_name], ["the driver's NRIC", demandValues.customer_nric], ['the plate', demandValues.vehicle_plate],
    ['the date', demandValues.letter_date], ['the company name (Edit templates)', demandValues.company_name],
    ...(demand && settings.letters[demand].body.includes('{{company_bank_account}}') ? [['the payment account (Edit templates)', demandValues.company_bank_account] as const] : []),
    ...(demand && settings.letters[demand].body.includes('{{company_phone}}') ? [['the company phone (Edit templates)', demandValues.company_phone] as const] : []),
  ] as const).filter(([, value]) => !value).map(([label]) => label) : [];
  const nothingOwed = !!demandValues && demandValues.total_debt === 'RM 0.00';
  const datedAhead = !!demand && letterDate > today;
  const downloadDemand = async () => {
    if (!driver || !demand || !demandValues) return;
    setResult(null);
    try {
      await downloadLetterPdf(settings.letters[demand], demandValues, letterFileName(demand, demandValues.vehicle_plate, demandValues.customer_name));
      setResult({ ok: true, text: 'Downloaded. Nothing was saved.' });
    } catch (err) {
      setResult({ ok: false, text: `The PDF couldn't be made: ${reason(err)}.` });
    }
  };
  const downloadLetter = async () => {
    if (!driver) return;
    setResult(null);
    try {
      await downloadGrabLetterPdf(letter, (paper === 'other' ? otherLetterFileName : grabLetterFileName)(letter.vehicle_plate, letter.driver_name), paper === 'other' ? 'other' : 'grab');
      setResult({ ok: true, text: 'Downloaded. Print it for the owner to sign; nothing was saved.' });
    } catch (err) {
      setResult({ ok: false, text: `The PDF couldn't be made: ${reason(err)}.` });
    }
  };

  const download = async () => {
    if (!driver || !depositsReady || busy.current) return;
    busy.current = true;
    setDownloading(true);
    setResult(null);
    let saveProblem = '';
    try {
      // The copy for the driver's page first; the PDF downloads even if the copy can't be kept
      await api.saveCopy(driver.id, { kind: input.kind, template, values, signing: { agreementDate, extra } });
      setLastSaved(new Date().toISOString());
    } catch (err) {
      saveProblem = reason(err);
    }
    const savedText = saveProblem ? `It was NOT saved to the driver's page (${saveProblem}); press again to retry.` : "Saved to the driver's page.";
    try {
      await downloadAgreementPdf(template, values, agreementFileName(typeLabel, input.car.plateNumber, input.customer.name));
      setResult({ ok: !saveProblem, text: `Downloaded. ${savedText}` });
    } catch (err) {
      setResult({ ok: false, text: `The PDF couldn't be made: ${reason(err)}. ${savedText}` });
    } finally {
      busy.current = false;
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Agreements</h2>
          <p className="text-sm text-gray-500">Choose the driver, check and download. Details come from the driver's profile, Deposits and Fleet.</p>
          <div role="group" aria-label="Paper to make" className="mt-2 inline-flex flex-wrap rounded-lg border border-gray-300 bg-white p-0.5 text-sm font-semibold">
            {([['agreement', 'Rental agreement'], ['grab', 'Grab authorization letter'], ['other', 'Other EHO authorize letter'], ...LETTER_KINDS.map(kind => [kind, LETTER_LABELS[kind]] as const)] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={paper === key} onClick={() => {
                  setPaper(key);
                  setResult(null);
                  // The rent demand's discount table runs to 14 days, so its deadline does too
                  if ((LETTER_KINDS as string[]).includes(key)) setPayWithin(key === 'TUNTUT_SEWA' ? '14' : '7');
                  // Agreements and authorization letters are only for current drivers
                  else if (driver?.isDelisted) setDriverId('');
                }}
                className={`px-3 py-1.5 rounded-md ${paper === key ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>{label}</button>
            ))}
          </div>
        </div>
        {isAdmin && (
          <button type="button" onClick={() => setEditing(true)} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg flex items-center gap-2">
            <Settings2 className="w-4 h-4" aria-hidden="true" /> Edit templates
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <Step
            number={1}
            title="Driver"
            note={driver && onEditDriver && (
              <button type="button" onClick={() => onEditDriver(driver)} className="text-sm font-semibold text-blue-700 hover:underline flex items-center gap-1">
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit driver
              </button>
            )}
          >
            <SearchPick id="agreement-driver" value={driverId} onChange={id => { setDriverId(id); setResult(null); }}
              placeholder="Search a driver's name or plate" options={(demand ? allDrivers : activeDrivers).map(d => ({ id: d.id, label: `${d.name} · ${d.carPlate}${d.isDelisted ? ' · delisted' : ''}` }))} />
            {!driver ? (
              <p className="text-sm text-gray-500">New customer? Add them first with <b>Add Driver</b> and record their deposit or downpayment, then choose them here.</p>
            ) : demand && demandValues ? (
              <>
                <Facts rows={[
                  ['Name', demandValues.customer_name], ['NRIC', demandValues.customer_nric], ['Phone', demandValues.customer_phone],
                  ['Agreement type', demandValues.agreement_type], ['Rent', demandValues.rent_amount && `${demandValues.rent_amount} per ${demandValues.rental_cycle}`],
                  [`Rent owed at ${demandValues.arrears_as_of || 'the letter date'}`, demandValues.rent_arrears], ['Total owed', demandValues.total_debt],
                ]} />
                {driver.isDelisted && <p className="text-xs text-gray-500">Delisted{driver.delistDate ? ` on ${longDate(driver.delistDate)}` : ''}: no rent is charged after that day; payments since then are counted.</p>}
                {demand === 'BATAL_SEWABELI' && demandValues.agreement_type !== 'Sewa Beli' && (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">This driver is on Sewa Biasa; this letter cancels a Sewa Beli agreement.</p>
                )}
                <p className="text-xs text-gray-500">Rent owed comes from their payments (no late charge). To change the driver's details, use <b>Edit driver</b>.</p>
              </>
            ) : paper !== 'agreement' ? (
              <>
                <Facts rows={[['Name', letter.driver_name], ['NRIC', letter.driver_ic_no]]} />
                <p className="text-xs text-gray-500">To change these, use <b>Edit driver</b>.</p>
              </>
            ) : (
              <>
                <Facts rows={[
                  ['Agreement type', typeLabel],
                  ['NRIC', input.customer.nric],
                  ['Phone', input.customer.phone],
                  ['Address', input.customer.address],
                  ['Emergency contact', [input.customer.emergencyName, input.customer.emergencyPhone].filter(Boolean).join(', ')],
                  ['Start date', longDate(input.terms.startDate)],
                  ['End date', values.end_date],
                  ['Rent', values.rent_amount ? `${values.rent_amount} per ${values.rental_cycle}` : ''],
                  ['Length', values.duration_text],
                  ...(input.kind === 'SEWABELI' ? [['Downpayment', received.DOWNPAYMENT ? formatCurrency(received.DOWNPAYMENT) : 'None'] as [string, string]] : []),
                  [input.kind === 'SEWABELI' ? 'Security deposit' : 'Deposit', received.DEPOSIT ? formatCurrency(received.DEPOSIT) : input.kind === 'SEWABELI' ? 'None' : ''],
                ]} />
                <p className="text-xs text-gray-500">To change any of these, use <b>Edit driver</b>; amounts come from the driver's Deposits panel.</p>
              </>
            )}
          </Step>

          {driver && (
            <Step number={2} title="Vehicle (from Fleet)">
              {car && carDetails ? (
                <>
                  <Facts rows={[
                    ['Plate', car.plateNumber],
                    ['Make and model', `${car.make} ${car.model}`.trim()],
                    ['Chassis no.', carDetails.chassisNo],
                    ['Registration date', longDate(carDetails.registeredDate)],
                    ['Colour', carDetails.colour],
                    ['Registered owner', carDetails.ownerName],
                    ["Owner's ID", carDetails.ownerId],
                  ]} />
                  <p className="text-xs text-gray-500">To change these, open Fleet and tap the plate.</p>
                </>
              ) : (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                  The driver's plate {driver.carPlate || '(none)'} isn't on Fleet yet. Add the car on Fleet with its registration details, then come back.
                </p>
              )}
            </Step>
          )}

          {driver && demand && (
            <Step number={3} title="Letter details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="demand-letter-date" className={labelLook}>Date</label>
                  <input id="demand-letter-date" type="date" className={inputLook} value={letterDate} onChange={event => setLetterDate(event.target.value)} />
                </div>
                <div>
                  <label htmlFor="demand-letter-ref" className={labelLook}>Reference no.</label>
                  <input id="demand-letter-ref" className={inputLook} value={letterRef} onChange={event => setLetterRef(event.target.value)} />
                </div>
                <div>
                  <label htmlFor="demand-letter-days" className={labelLook}>Days to pay</label>
                  <input id="demand-letter-days" type="number" min={1} max={90} className={inputLook} value={payWithin} onChange={event => setPayWithin(event.target.value)} />
                </div>
                <div>
                  <label htmlFor="demand-letter-repair" className={labelLook}>Repair cost (RM, optional)</label>
                  <input id="demand-letter-repair" inputMode="decimal" className={inputLook} value={repairCost} onChange={event => setRepairCost(event.target.value)} />
                </div>
                <div>
                  <label htmlFor="demand-letter-paint" className={labelLook}>Paint and dent cost (RM, optional)</label>
                  <input id="demand-letter-paint" inputMode="decimal" className={inputLook} value={paintDentCost} onChange={event => setPaintDentCost(event.target.value)} />
                </div>
              </div>
              <p className="text-xs text-gray-500">Costs typed here are added to the rent owed. Pay by: {demandValues?.pay_by_date || 'the letter date plus the days to pay'}.</p>
            </Step>
          )}

          {driver && (paper === 'grab' || paper === 'other') && (
            <Step number={3} title="Letter details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="grab-letter-date" className={labelLook}>Date</label>
                  <input id="grab-letter-date" type="date" className={inputLook} value={letterDate} onChange={event => setLetterDate(event.target.value)} />
                </div>
              </div>
              <p className="text-xs text-gray-500">The vehicle owner's name under the signature is the registered owner from Fleet.</p>
            </Step>
          )}

          {driver && paper === 'agreement' && (
            <Step number={3} title="Signing-day details">
              <p className="text-xs text-gray-500 -mt-2">
                {lastSaved
                  ? `Filled from the agreement saved on ${longDate(lastSaved.slice(0, 10))}. Change anything and press Save & download PDF again.`
                  : "Only for this agreement; kept with it when you press Save & download PDF."}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="agreement-date" className={labelLook}>Agreement date</label>
                  <input id="agreement-date" type="date" className={inputLook} value={agreementDate} onChange={event => setAgreementDate(event.target.value)} />
                </div>
                {[...SIGNING_FIELDS.filter(key => signingFields.includes(key)), ...signingFields.filter(key => !SIGNING_FIELDS.includes(key))].map(key => (
                  <div key={key}>
                    <label htmlFor={`agreement-extra-${key}`} className={labelLook}>{fieldLabel(key)}</label>
                    <input id={`agreement-extra-${key}`} className={inputLook} value={extra[key] ?? ''}
                      onChange={event => setExtra(current => ({ ...current, [key]: event.target.value }))} />
                  </div>
                ))}
              </div>
            </Step>
          )}
        </div>

        {demand ? (
        <div className="space-y-3 xl:sticky xl:top-4">
          <div className={card}>
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><FileText className="w-4 h-4" aria-hidden="true" /> Check and download</h3>
            {!driver ? (
              <p className="text-sm text-gray-500">Choose a driver to see their letter.</p>
            ) : demandMissing.length > 0 ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Still empty (they print as a blank line to write in): {demandMissing.join(', ')}.</span>
              </p>
            ) : (
              <p className="text-sm text-emerald-700">Every box is filled in.</p>
            )}
            {nothingOwed && <p className="text-sm text-amber-800">This driver owes nothing at the letter date.</p>}
            {datedAhead && <p className="text-sm text-amber-800">The letter is dated ahead: rent is counted only up to today.</p>}
            {result && <p role={result.ok ? 'status' : 'alert'} className={`text-sm ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{result.text}</p>}
            <button type="button" onClick={() => void downloadDemand()} disabled={!driver}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold py-2.5 rounded-lg shadow-sm flex items-center justify-center gap-2">
              <Download className="w-4 h-4" aria-hidden="true" /> Download PDF
            </button>
            <p className="text-xs text-gray-500">The PDF is made on this computer and is not saved anywhere.{isAdmin ? ' Change the wording under Edit templates.' : ''}</p>
          </div>
          {driver && demandValues && (
            <div className="max-h-[75vh] overflow-y-auto rounded-xl">
              <LetterPreview letter={settings.letters[demand]} values={demandValues} />
            </div>
          )}
        </div>
        ) : paper !== 'agreement' ? (
        <div className="space-y-3 xl:sticky xl:top-4">
          <div className={card}>
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><FileText className="w-4 h-4" aria-hidden="true" /> Check and download</h3>
            {!driver ? (
              <p className="text-sm text-gray-500">Choose a driver to see their letter.</p>
            ) : letterMissing.length > 0 ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Still empty (they print as a blank line to write in): {letterMissing.join(', ')}.</span>
              </p>
            ) : (
              <p className="text-sm text-emerald-700">Every box is filled in.</p>
            )}
            {result && <p role={result.ok ? 'status' : 'alert'} className={`text-sm ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{result.text}</p>}
            <button type="button" onClick={() => void downloadLetter()} disabled={!driver}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold py-2.5 rounded-lg shadow-sm flex items-center justify-center gap-2">
              <Download className="w-4 h-4" aria-hidden="true" /> Download PDF
            </button>
            <p className="text-xs text-gray-500">The PDF is made on this computer and is not saved anywhere.</p>
          </div>
          {driver && <GrabLetterPreview values={letter} kind={paper === 'other' ? 'other' : 'grab'} />}
        </div>
        ) : (
        <div className="space-y-3 xl:sticky xl:top-4">
          <div className={card}>
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><FileText className="w-4 h-4" aria-hidden="true" /> Check and download</h3>
            {!driver ? (
              <p className="text-sm text-gray-500">Choose a driver to see their agreement.</p>
            ) : missing.length > 0 ? (
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
            {driver && depositsProblem && <p role="alert" className="text-sm text-rose-700">The deposit and downpayment couldn't be read ({depositsProblem}), so the agreement can't be made yet. Try again shortly.</p>}
            {driver && !depositsReady && !depositsProblem && <p role="status" className="text-sm text-gray-500">Reading the deposit and downpayment…</p>}
            {result && <p role={result.ok ? 'status' : 'alert'} className={`text-sm ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{result.text}</p>}
            <button type="button" onClick={() => void download()} disabled={downloading || !driver || !depositsReady}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold py-2.5 rounded-lg shadow-sm flex items-center justify-center gap-2">
              <Download className="w-4 h-4" aria-hidden="true" /> {downloading ? 'Saving and making the PDF…' : 'Save & download PDF'}
            </button>
            <p className="text-xs text-gray-500">The PDF is made on this computer. A copy of the agreement's text is kept so the driver can see it on their phone.</p>
          </div>
          {driver && (
            <div className="max-h-[75vh] overflow-y-auto rounded-xl">
              <AgreementPreview template={template} values={values} />
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
