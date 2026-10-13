import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CollectionTone, Driver } from '../../types';
import { calculateDriverMetrics, contractCyclesBetween, dayTagCheck, driverWithNric, formatCurrency, formatNric, formatPhone, kualaLumpurToday, normalizeMalaysianPhone, normalizePlate, rentDayTag, withDayTag } from '../../utils';
import Dialog from '../Dialog';
import { loadDeposits } from '../../services/depositsApi';
import { receivedByKind, upfrontToRecord, type UpfrontReceived } from '../../services/depositTotals';

interface DriverFormDialogProps {
  /** The driver being edited, or null for Add Driver. */
  driver: Driver | null;
  /** Every driver: the live record being edited, the one-active-driver-per-NRIC check, returning drivers and tags. */
  drivers: Driver[];
  /** Creates the driver; with `upfront`, also records the money received at signing once the driver exists. */
  onCreateDriver: (driver: Driver, upfront?: UpfrontReceived) => Promise<void>;
  /** Saves the driver; with `upfront`, also records extra deposit/downpayment received (Deposits panel). */
  onUpdateDriver: (driver: Driver, upfront?: UpfrontReceived) => Promise<void>;
  /** Called on Cancel, the close button, Escape and after a save. */
  onClose: () => void;
}

/** The form's fields for a new driver. */
const newDriverForm = () => ({
  name: '',
  email: '',
  phone: '',
  whatsappGroup: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  // How collections are made with this driver (this form is the only place they are typed)
  collectionArrangement: '',
  collectionTone: '' as CollectionTone | '',
  collectionLanguage: '',
  contactWindow: '',
  collectionNote: '',
  // Money received at signing: entered only in this form (the Deposits panel records refunds and forfeits later)
  upfrontDeposit: '',
  upfrontDownpayment: '',
  /** The day the deposit/downpayment was received; empty means today (Kuala Lumpur). */
  upfrontDate: '',
  nric: '',
  // contactNumber removed
  carPlate: '',
  contractStartDate: kualaLumpurToday(),
  contractEndDate: '',
  category: 'SEWABELI' as 'SEWABELI' | 'SEWA_BIASA',
  rentalCycle: 'WEEKLY' as 'WEEKLY' | 'MONTHLY',
  contractDuration: 52,
  rentalRate: 400,
  tags: [] as string[]
});
type DriverForm = ReturnType<typeof newDriverForm>;

/** The form's fields for a driver being edited. */
const editDriverForm = (driver: Driver): DriverForm => ({
  name: driver.name,
  email: driver.email || '',
  phone: driver.phone ? formatPhone(driver.phone) : '',
  whatsappGroup: driver.whatsappGroup || '',
  address: driver.address || '',
  emergencyContactName: driver.emergencyContactName || '',
  emergencyContactPhone: driver.emergencyContactPhone || '',
  collectionArrangement: driver.collectionArrangement || '',
  collectionTone: driver.collectionTone || '',
  collectionLanguage: driver.collectionLanguage || '',
  contactWindow: driver.contactWindow || '',
  collectionNote: driver.collectionNote || '',
  upfrontDeposit: '',
  upfrontDownpayment: '',
  upfrontDate: '',
  nric: driver.nric,
  // contactNumber removed
  carPlate: driver.carPlate,
  contractStartDate: driver.contractStartDate,
  contractEndDate: driver.contractEndDate || '',
  category: driver.category || 'SEWABELI', // Default to Sewabeli
  rentalCycle: driver.rentalCycle || 'WEEKLY',
  contractDuration: driver.contractDuration,
  rentalRate: driver.rentalRate,
  tags: driver.tags || []
});

/** Add / Edit Driver: the one master input for a driver's profile, collections details and money received at signing. */
export default function DriverFormDialog({ driver, drivers, onCreateDriver, onUpdateDriver, onClose }: DriverFormDialogProps) {
  const editingId = driver?.id ?? null;
  const [formData, setFormData] = useState<DriverForm>(() => (driver ? editDriverForm(driver) : newDriverForm()));
  // A message shown inside the form when an entry needs fixing
  const [driverFormError, setDriverFormError] = useState<string | null>(null);
  // A delisted driver with the NRIC being typed: a returning driver, whose old record and balance stay where they are
  const returningFrom = useMemo(() => (driverWithNric(drivers.filter(d => !d.isDelisted), formData.nric) ? undefined
    : driverWithNric(drivers.filter(d => d.isDelisted), formData.nric)), [drivers, formData.nric]);
  const returningOwed = returningFrom ? Math.max(0, calculateDriverMetrics(returningFrom).totalOutstanding) : 0;
  const [tagInput, setTagInput] = useState('');

  // --- Auto-Calculate Duration when Dates Change ---
  useEffect(() => {
    const cycles = contractCyclesBetween(formData.contractStartDate, formData.contractEndDate, formData.rentalCycle);
    if (cycles !== null) setFormData(prev => ({ ...prev, contractDuration: cycles }));
  }, [formData.contractStartDate, formData.contractEndDate, formData.rentalCycle]);

  // A new driver's day tag follows the start date and cycle, until someone chooses a different day tag
  const autoDayTag = useRef<string | null>(null);
  useEffect(() => {
    if (editingId) return;
    const expected = rentDayTag(formData);
    if (!expected) return;
    setFormData(prev => {
      const tagged = dayTagCheck(prev)?.tagged ?? [];
      const followsStart = tagged.length === 0 || (tagged.length === 1 && tagged[0] === autoDayTag.current);
      if (!followsStart || (tagged.length === 1 && tagged[0] === expected)) return prev;
      autoDayTag.current = expected;
      return { ...prev, tags: withDayTag(prev.tags, expected) };
    });
  }, [editingId, formData.contractStartDate, formData.rentalCycle]);

  // What the driver's Deposits panel already has, for the deposit/downpayment boxes: zero for a new driver; null while
  // reading it for an edit; 'unavailable' when it can't be read (the boxes are then hidden and nothing is recorded).
  const [depositBaseline, setDepositBaseline] = useState<{ DEPOSIT: number; DOWNPAYMENT: number } | null | 'unavailable'>(() => (driver ? null : { DEPOSIT: 0, DOWNPAYMENT: 0 }));
  useEffect(() => {
    if (!editingId) return;
    let live = true;
    // Show what is already recorded, so a missing deposit or downpayment can be added here
    loadDeposits(editingId).then(rows => {
      if (!live) return;
      const received = receivedByKind(rows);
      setDepositBaseline(received);
      setFormData(current => ({
        ...current,
        upfrontDeposit: received.DEPOSIT ? String(received.DEPOSIT) : '',
        upfrontDownpayment: received.DOWNPAYMENT ? String(received.DOWNPAYMENT) : '',
      }));
    }).catch(() => { if (live) setDepositBaseline('unavailable'); });
    return () => { live = false; };
  }, [editingId]);

  const handleAddTag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
      setTagInput('');
    }
  };
  const handleRemoveTag = (tagToRemove: string) => { setFormData({ ...formData, tags: formData.tags.filter(t => t !== tagToRemove) }); };

  const handleDriverFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.nric || !formData.carPlate) { setDriverFormError('Fill in the full name, NRIC and plate number.'); return; }
    
    // Phone numbers are stored as 60 followed by the number, for WhatsApp; clearing one removes it
    const typedPhone = formData.phone.trim();
    const phone = typedPhone ? normalizeMalaysianPhone(typedPhone) : null;
    if (typedPhone && !phone) { setDriverFormError('Enter a Malaysian phone number, for example 012-345 6789, or leave it empty.'); return; }
    const originalPhone = editingId ? drivers.find(d => d.id === editingId)?.phone : undefined;
    // The WhatsApp group name is written when typed, and cleared only when one was set before
    const whatsappGroup = formData.whatsappGroup.trim();
    const originalGroup = editingId ? drivers.find(d => d.id === editingId)?.whatsappGroup : undefined;

    // AUTOMATED LOGIC: Sync Duration if End Date is set
    const finalDuration = contractCyclesBetween(formData.contractStartDate, formData.contractEndDate, formData.rentalCycle) ?? formData.contractDuration;

    // The agreement details are written when typed, and cleared only when one was set before
    const original = editingId ? drivers.find(d => d.id === editingId) : undefined;
    const keepOrClear = (typed: string, before: string | undefined) => typed.trim() || (before ? '' : undefined);
    const submissionData = {
      ...formData, contractDuration: finalDuration, phone: phone ?? (originalPhone ? '' : undefined), whatsappGroup: whatsappGroup || (originalGroup ? '' : undefined),
      emergencyContactName: keepOrClear(formData.emergencyContactName, original?.emergencyContactName),
      emergencyContactPhone: keepOrClear(formData.emergencyContactPhone, original?.emergencyContactPhone),
      collectionArrangement: keepOrClear(formData.collectionArrangement, original?.collectionArrangement),
      collectionTone: (keepOrClear(formData.collectionTone, original?.collectionTone) as CollectionTone | '' | undefined),
      collectionLanguage: keepOrClear(formData.collectionLanguage, original?.collectionLanguage),
      contactWindow: keepOrClear(formData.contactWindow, original?.contactWindow),
      collectionNote: keepOrClear(formData.collectionNote, original?.collectionNote),
    };

    try {
      if (editingId) {
        const originalDriver = drivers.find(d => d.id === editingId);
        if (!originalDriver) return;
        const upfront = depositChanges();
        if (typeof upfront === 'string') { setDriverFormError(upfront); return; }
        const { upfrontDeposit: _deposit, upfrontDownpayment: _downpayment, upfrontDate: _date, ...profile } = submissionData;
        await onUpdateDriver({ ...originalDriver, ...profile }, upfront);
      } else {
        // One active driver per NRIC; a returning driver (old record delisted) gets a new record for the new car
        const existing = driverWithNric(drivers.filter(d => !d.isDelisted), formData.nric);
        if (existing) {
          setDriverFormError(`This NRIC already belongs to ${existing.name} (${existing.carPlate}), who is still active. Edit that driver, or delist the old contract first.`);
          return;
        }
        const upfront = depositChanges();
        if (typeof upfront === 'string') { setDriverFormError(upfront); return; }
        const { upfrontDeposit: _deposit, upfrontDownpayment: _downpayment, upfrontDate: _date, ...profile } = submissionData;
        await onCreateDriver({ id: Date.now().toString(), ...profile, totalAmountPaid: 0, paymentHistory: [] }, upfront);
      }
      // The save handlers reload the list themselves
      setDriverFormError(null);
      onClose();
    } catch (e) {
      // Error handled by parent, keep modal open
    }
  };

  /** The deposit/downpayment to record from the form (only the rise over what is recorded), or why it can't be saved. */
  function depositChanges(): UpfrontReceived | undefined | string {
    if (!depositBaseline || depositBaseline === 'unavailable') return undefined;
    // Sewa Biasa has no downpayment box: leave the downpayment as it is
    const today = kualaLumpurToday();
    return upfrontToRecord({
      deposit: formData.upfrontDeposit, downpayment: formData.category === 'SEWABELI' ? formData.upfrontDownpayment : '', date: formData.upfrontDate || today,
    }, depositBaseline, today);
  }

  // The driver form's day tag against the rent day it calls for
  const formTagCheck = dayTagCheck(formData);

  return (
    <Dialog title={editingId ? 'Edit Driver Profile' : 'Add Driver Profile'} onClose={onClose}>
      <form onSubmit={handleDriverFormSubmit} className="p-6 space-y-4">
        <div>
          <label htmlFor="driver-name" className="block text-sm font-bold text-gray-700 mb-1">Full Name</label>
          <input id="driver-name" required type="text" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Driver Full Name" />
        </div>
        <div>
          <label htmlFor="driver-email" className="block text-sm font-bold text-gray-700 mb-1">Email Address</label>
          <input id="driver-email" type="email" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="Email (Optional)" />
        </div>
        <div>
          <label htmlFor="driver-phone" className="block text-sm font-bold text-gray-700 mb-1">Phone (WhatsApp)</label>
          <input id="driver-phone" type="tel" inputMode="tel" autoComplete="off" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="e.g. 012-345 6789 (optional)" />
        </div>
        <div>
          <label htmlFor="driver-group" className="block text-sm font-bold text-gray-700 mb-1">WhatsApp group name</label>
          <input id="driver-group" type="text" maxLength={100} autoComplete="off" aria-describedby="driver-group-note" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.whatsappGroup} onChange={e => setFormData({...formData, whatsappGroup: e.target.value})} placeholder="e.g. ALI XAA1001 TUE (optional)" />
          <p id="driver-group-note" className="text-xs text-gray-500 mt-1">Exactly as the group is named in WhatsApp</p>
        </div>
        <div>
          <label htmlFor="driver-address" className="block text-sm font-bold text-gray-700 mb-1">Address</label>
          <textarea id="driver-address" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Driver Address"></textarea>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="driver-emergency-name" className="block text-sm font-bold text-gray-700 mb-1">Emergency contact</label>
            <input id="driver-emergency-name" type="text" autoComplete="off" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.emergencyContactName} onChange={e => setFormData({...formData, emergencyContactName: e.target.value})} placeholder="Name (for the agreement)" />
          </div>
          <div>
            <label htmlFor="driver-emergency-phone" className="block text-sm font-bold text-gray-700 mb-1">Emergency phone</label>
            <input id="driver-emergency-phone" type="tel" inputMode="tel" autoComplete="off" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.emergencyContactPhone} onChange={e => setFormData({...formData, emergencyContactPhone: e.target.value})} placeholder="e.g. 012-345 6789" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="driver-nric" className="block text-sm font-bold text-gray-700 mb-1">NRIC</label>
            <input id="driver-nric" required type="text" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.nric} onChange={e => setFormData({...formData, nric: formatNric(e.target.value)})} placeholder="NRIC Number" />
            {!editingId && returningFrom && (
              <p role="status" className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded p-2 mt-1">
                Returning driver: the old record ({returningFrom.carPlate}) stays under Delisted / Returned
                {returningOwed > 0 ? <>, with <b>{formatCurrency(returningOwed)}</b> still owed there</> : ', fully settled'}. This creates a new record for the new contract.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="driver-plate" className="block text-sm font-bold text-gray-700 mb-1">Plate Number</label>
            <input id="driver-plate" required type="text" aria-describedby={formData.carPlate !== normalizePlate(formData.carPlate) ? 'driver-plate-note' : undefined} className="w-full border border-gray-300 rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" value={formData.carPlate} onChange={e => setFormData({...formData, carPlate: e.target.value})} placeholder="ABC1234" />
            {formData.carPlate !== normalizePlate(formData.carPlate) && <p id="driver-plate-note" className="text-xs text-gray-500 mt-1">Saved as <span className="font-mono font-bold">{normalizePlate(formData.carPlate)}</span></p>}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="driver-category" className="block text-sm font-bold text-gray-700 mb-1">Category</label>
            <select id="driver-category" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value as 'SEWABELI' | 'SEWA_BIASA'})}>
              <option value="SEWABELI">SEWABELI</option>
              <option value="SEWA_BIASA">SEWA BIASA</option>
            </select>
          </div>
          <div>
            <label htmlFor="driver-cycle" className="block text-sm font-bold text-gray-700 mb-1">Rental cycle</label>
            <select id="driver-cycle" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.rentalCycle} onChange={e => setFormData({...formData, rentalCycle: e.target.value as 'WEEKLY' | 'MONTHLY'})}>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>
          <div>
            <label htmlFor="driver-rate" className="block text-sm font-bold text-gray-700 mb-1">Rent per {formData.rentalCycle === 'MONTHLY' ? 'month' : 'week'} (RM)</label>
            <input id="driver-rate" required type="number" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.rentalRate} onChange={e => setFormData({...formData, rentalRate: Number(e.target.value)})} min="0" step="0.01" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="driver-start" className="block text-sm font-bold text-gray-700 mb-1">Start Date</label>
            <input id="driver-start" required type="date" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.contractStartDate} onChange={e => setFormData({...formData, contractStartDate: e.target.value})} />
          </div>
          <div>
            <label htmlFor="driver-duration" className="block text-sm font-bold text-gray-700 mb-1">Duration ({formData.rentalCycle === 'MONTHLY' ? 'months' : 'weeks'})</label>
            <input id="driver-duration" required type="number" readOnly={!!formData.contractEndDate} aria-describedby={formData.contractEndDate ? 'driver-duration-note' : undefined} className={`w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none ${formData.contractEndDate ? 'bg-gray-100 text-gray-600' : ''}`} value={formData.contractDuration} onChange={e => setFormData({...formData, contractDuration: Number(e.target.value)})} min="1" />
            {formData.contractEndDate && <p id="driver-duration-note" className="text-xs text-gray-500 mt-1">Calculated from the end date</p>}
          </div>
          <div>
            <label htmlFor="driver-end" className="block text-sm font-bold text-gray-700 mb-1">End Date</label>
            <input id="driver-end" type="date" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.contractEndDate} onChange={e => setFormData({...formData, contractEndDate: e.target.value})} />
          </div>
        </div>
        <fieldset className="rounded-lg border border-gray-200 p-3 space-y-3" aria-describedby="driver-collections-note">
          <legend className="px-1 text-sm font-bold text-gray-700">Collections</legend>
          <p id="driver-collections-note" className="text-xs text-gray-500 -mt-1">How rent is collected from this driver. Shown on the driver row, the WhatsApp statement window and the collections data; never to the driver.</p>
          <div>
            <label htmlFor="driver-arrangement" className="block text-xs font-bold text-gray-600 uppercase mb-1">Arrangement</label>
            <input id="driver-arrangement" type="text" maxLength={300} autoComplete="off" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.collectionArrangement} onChange={e => setFormData({...formData, collectionArrangement: e.target.value})} placeholder="e.g. Monthly RM1,000 by the 5th (optional)" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="driver-tone" className="block text-xs font-bold text-gray-600 uppercase mb-1">Tone</label>
              <select id="driver-tone" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.collectionTone} onChange={e => setFormData({...formData, collectionTone: e.target.value as CollectionTone | ''})}>
                <option value="">Not set</option>
                <option value="SOFT">Soft</option>
                <option value="POLITE">Polite</option>
                <option value="FIRM">Firm</option>
              </select>
            </div>
            <div>
              <label htmlFor="driver-language" className="block text-xs font-bold text-gray-600 uppercase mb-1">Language</label>
              <select id="driver-language" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.collectionLanguage} onChange={e => setFormData({...formData, collectionLanguage: e.target.value})}>
                <option value="">Not set</option>
                <option value="BM">BM</option>
                <option value="EN">EN</option>
                <option value="ZH">ZH</option>
                <option value="MIXED">Mixed</option>
                {formData.collectionLanguage && !['BM', 'EN', 'ZH', 'MIXED'].includes(formData.collectionLanguage) && <option value={formData.collectionLanguage}>{formData.collectionLanguage}</option>}
              </select>
            </div>
            <div>
              <label htmlFor="driver-window" className="block text-xs font-bold text-gray-600 uppercase mb-1">Contact window</label>
              <input id="driver-window" type="text" maxLength={100} autoComplete="off" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.contactWindow} onChange={e => setFormData({...formData, contactWindow: e.target.value})} placeholder="e.g. weekday mornings" />
            </div>
          </div>
          <div>
            <label htmlFor="driver-collection-note" className="block text-xs font-bold text-gray-600 uppercase mb-1">Collection note</label>
            <textarea id="driver-collection-note" rows={2} maxLength={1000} className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.collectionNote} onChange={e => setFormData({...formData, collectionNote: e.target.value})} placeholder="Optional" />
          </div>
        </fieldset>
        {depositBaseline === null && editingId && <p role="status" className="text-xs text-gray-500">Reading the deposit and downpayment…</p>}
        {depositBaseline && depositBaseline !== 'unavailable' && (
          <div className={`grid grid-cols-1 ${formData.category === 'SEWABELI' ? 'sm:grid-cols-2' : ''} gap-4`}>
            {formData.category === 'SEWABELI' && (
              <div>
                <label htmlFor="driver-downpayment" className="block text-sm font-bold text-gray-700 mb-1">Downpayment received (RM)</label>
                <input id="driver-downpayment" type="number" min="0" step="0.01" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.upfrontDownpayment} onChange={e => setFormData({...formData, upfrontDownpayment: e.target.value})} placeholder="0 if none" />
              </div>
            )}
            <div>
              <label htmlFor="driver-deposit" className="block text-sm font-bold text-gray-700 mb-1">{formData.category === 'SEWABELI' ? 'Security deposit received (RM)' : 'Deposit received (RM)'}</label>
              <input id="driver-deposit" type="number" min="0" step="0.01" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.upfrontDeposit} onChange={e => setFormData({...formData, upfrontDeposit: e.target.value})} placeholder="0 if none" />
            </div>
            <div>
              <label htmlFor="driver-upfront-date" className="block text-sm font-bold text-gray-700 mb-1">Date received</label>
              <input id="driver-upfront-date" type="date" max={kualaLumpurToday()} className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.upfrontDate || kualaLumpurToday()} onChange={e => setFormData({...formData, upfrontDate: e.target.value})} aria-describedby="driver-upfront-help" />
            </div>
            <p id="driver-upfront-help" className="text-xs text-gray-500 sm:col-span-2 -mt-2">
              {editingId
                ? 'Money received at signing is entered only here. This shows what is already recorded; raise it to add money not yet entered, on the day it was received (Finance and Reconcile use that date). Refunds and forfeits go in the driver\'s Deposits panel, where an admin can also delete a wrong entry.'
                : 'Money received at signing is entered only here, on the day it was received (Finance and Reconcile use that date). Refunds and forfeits later go in the driver\'s Deposits panel.'}
            </p>
          </div>
        )}
        <div>
          <label htmlFor="driver-tag" className="block text-sm font-bold text-gray-700 mb-1">Tags (Press Enter)</label>
          <div className="flex gap-2">
            <input id="driver-tag" type="text" list="existing-tags" className="flex-1 min-w-0 border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. SUN" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(e); } }} />
            <datalist id="existing-tags">
              {Array.from(new Set(drivers.flatMap(d => d.tags || []))).sort().map(tag => <option key={tag} value={tag} />)}
            </datalist>
            <button type="button" onClick={handleAddTag} className="bg-slate-800 text-white px-3 py-2 rounded text-sm font-bold hover:bg-slate-700 shrink-0">Add Tag</button>
          </div>
          {formData.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {formData.tags.map(tag => (
                <span key={tag} className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 flex items-center gap-1">
                  {tag} <button type="button" onClick={() => handleRemoveTag(tag)} aria-label={`Remove tag ${tag}`} className="hover:text-red-500"><X className="w-3 h-3" aria-hidden="true" /></button>
                </span>
              ))}
            </div>
          )}
        </div>
        {formTagCheck && !formTagCheck.ok && (
          <div role="note" className="flex flex-wrap items-center gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <span className="flex-1 min-w-48">
              Rent falls due {formTagCheck.expected === 'MONTHLY' ? 'monthly' : `every ${formTagCheck.expected}`}, but the day tag {formTagCheck.tagged.length ? `is ${formTagCheck.tagged.join(' and ')}` : 'is missing'}.
            </span>
            <button type="button" onClick={() => setFormData({ ...formData, tags: withDayTag(formData.tags, formTagCheck.expected) })} className="shrink-0 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
              Use {formTagCheck.expected}
            </button>
          </div>
        )}
        {editingId && drivers.find(d => d.id === editingId)?.rentalCycle !== formData.rentalCycle && (
          <p role="note" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Changing the rental cycle moves every due date for this driver and recalculates their balance from the contract start. Check that the rent above is per {formData.rentalCycle === 'MONTHLY' ? 'month' : 'week'} and the duration is in {formData.rentalCycle === 'MONTHLY' ? 'months' : 'weeks'}.
          </p>
        )}
        {driverFormError && <p role="alert" className="text-sm font-medium text-rose-600">{driverFormError}</p>}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
          <button type="submit" className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">{editingId ? "Save Changes" : "Create Driver"}</button>
        </div>
      </form>
    </Dialog>
  );
}
