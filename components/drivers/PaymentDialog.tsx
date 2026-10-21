import React, { useEffect, useState } from 'react';
import { CalendarCheck, DollarSign, History } from 'lucide-react';
import type { Driver, PaymentTransaction } from '../../types';
import { formatCurrency, formatDate, generateDriverInvoices, kualaLumpurNow, kualaLumpurToday } from '../../utils';
import Dialog from '../Dialog';
import { InvoiceRow, PaymentAmount, PaymentMethodBadge } from '../RentDisplay';
import { BankBadge, PaymentNoteLines, ReceivedIntoBadge, useBankStatus, usePaymentAccounts, usePaymentLog } from '../PaymentNotes';
import { findPossibleDuplicates, isBankReceipt, savedPaymentMethod, type PossibleDuplicate } from '../../services/paymentLog';
import { ENTITY_NAMES, needsReceivedInto, type PaymentAccount, type PaymentEntity } from '../../services/paymentAccounts';

type PaymentMethod = NonNullable<PaymentTransaction['paymentMethod']>;

interface PaymentDialogProps {
  /** The driver as the list has them now (so a payment just saved shows in the schedule). */
  driver: Driver;
  /** Every driver, for the possible-duplicate check. */
  drivers: Driver[];
  /** The Claim box. The dashboard keeps it, so a typed claim is still there when the window opens again, until a payment is recorded. */
  serviceClaim: string;
  onServiceClaimChange: (value: string) => void;
  onUpdatePayment: (driverId: string, amount: number, date: string, serviceClaim?: number, paymentMethod?: PaymentMethod, reference?: string, receivedInto?: string) => void;
  onEditPayment?: (paymentId: string, amount: number, serviceClaim: number, date: string, paymentMethod?: PaymentMethod, reference?: string, receivedInto?: string | null) => void | Promise<void>;
  /** Called on Cancel, the close button, Escape and after a payment is recorded. */
  onClose: () => void;
}

/** The payment window: record a payment (first on phones), the rent schedule and the last 10 payments with inline edit. */
export default function PaymentDialog({ driver, drivers, serviceClaim, onServiceClaimChange, onUpdatePayment, onEditPayment, onClose }: PaymentDialogProps) {
  const liveDriverForPayment = driver;
  const serviceClaimAmount = serviceClaim;
  const setServiceClaimAmount = onServiceClaimChange;

  // Payment Form State (the amount starts at the driver's rent, the date at today, the method empty)
  const [paymentAmount, setPaymentAmount] = useState(() => driver.rentalRate.toString());
  const [paymentDate, setPaymentDate] = useState(() => kualaLumpurToday());
  const [paymentMethod, setPaymentMethod] = useState<'BANK TRANSFER' | 'CASH DEPOSIT' | 'CASH' | 'DEPOSIT CONTRA' | 'CLAIM' | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  // The account a bank transfer or cash deposit went into (required for those once the account list exists)
  const [receivedInto, setReceivedInto] = useState('');
  const accounts = usePaymentAccounts();
  const activeAccounts = accounts.filter(account => account.active);
  // Messages shown inside the forms when an entry needs fixing
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [editTxError, setEditTxError] = useState<string | null>(null);
  // Payments that look like the one being recorded; saving then needs a second confirmation
  const [duplicateWarning, setDuplicateWarning] = useState<PossibleDuplicate[] | null>(null);
  useEffect(() => { setDuplicateWarning(null); }, [paymentAmount, serviceClaimAmount, paymentDate, paymentMethod, paymentReference, receivedInto, driver.id]);
  // Who recorded and edited each payment listed in the payment window
  const { notes: paymentWindowNotes, recorders: paymentWindowRecorders } = usePaymentLog(liveDriverForPayment);
  const paymentWindowBank = useBankStatus(liveDriverForPayment);

  // Past Payment Edit State
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');
  const [editServiceClaim, setEditServiceClaim] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<'BANK TRANSFER' | 'CASH DEPOSIT' | 'CASH' | 'DEPOSIT CONTRA' | null>(null);
  const [editReference, setEditReference] = useState<string>('');
  const [editReceivedInto, setEditReceivedInto] = useState<string>('');

  useEffect(() => {
    setTimeout(() => {
      // Scroll only the schedule list, so the payment form (first on phones) stays in view
      const anchor = document.getElementById('current-payment-anchor');
      const list = anchor?.parentElement;
      if (anchor && list) {
        const offset = anchor.getBoundingClientRect().top - list.getBoundingClientRect().top;
        list.scrollTo({ top: list.scrollTop + offset - (list.clientHeight - anchor.clientHeight) / 2, behavior: 'smooth' });
      }
    }, 150);
  }, [liveDriverForPayment.id]);

  const closePaymentModal = onClose;

  const handleSubmitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    submitPayment(false);
  };

  /** Records the payment; a possible duplicate stops it until `confirmDuplicates` (the "Save anyway" button). */
  const submitPayment = (confirmDuplicates: boolean) => {
    const amount = parseFloat(paymentAmount) || 0;
    const serviceClaim = parseFloat(serviceClaimAmount) || 0;
    if (isNaN(amount) || amount < 0) { setPaymentError('Enter an amount of RM 0 or more.'); return; }
    if (!paymentDate) { setPaymentError('Choose the payment date.'); return; }

    // What the form shows is what is saved: no amount with a claim is a CLAIM even if a method was clicked earlier
    const finalMethod = savedPaymentMethod(amount, serviceClaim, paymentMethod);
    if (!finalMethod) { setPaymentError('Choose Bank Transfer or Cash Deposit.'); return; }

    const askAccount = activeAccounts.length > 0 && needsReceivedInto(amount, finalMethod);
    if (askAccount && !receivedInto) { setPaymentError('Choose which account the money went into.'); return; }

    setPaymentError(null);
    const reference = paymentReference.trim();
    const duplicates = findPossibleDuplicates(drivers, driver.id, { amount, serviceClaim, date: paymentDate, reference });
    // The same bank reference on a cash payment is never saved twice (the database refuses it too)
    const referenceTaken = isBankReceipt(amount, finalMethod) && duplicates.some(found => found.reason === 'SAME_REFERENCE' && found.driver.id === driver.id && isBankReceipt(found.payment.amount, found.payment.paymentMethod));
    if (duplicates.length > 0 && (!confirmDuplicates || referenceTaken)) { setDuplicateWarning(duplicates); return; }
    onUpdatePayment(driver.id, amount, paymentDate, serviceClaim, finalMethod, reference || undefined, askAccount ? receivedInto : undefined);
    setServiceClaimAmount('0');
    onClose();
  };

  const handleStartEditTx = (tx: any) => {
    setEditTxError(null);
    setEditingTxId(tx.id);
    setEditAmount(tx.amount.toString());
    setEditServiceClaim((tx.serviceClaim || 0).toString());
    setEditDate(tx.date);
    // A claim-only payment has no money method: the select starts on Bank Transfer, as it shows
    setEditPaymentMethod(tx.paymentMethod && tx.paymentMethod !== 'CLAIM' ? tx.paymentMethod : 'BANK TRANSFER');
    setEditReference(tx.reference || '');
    setEditReceivedInto(tx.receivedInto || '');
  };

  const handleCancelEditTx = () => {
    setEditingTxId(null);
    setEditAmount('');
    setEditServiceClaim('');
    setEditDate('');
    setEditPaymentMethod(null);
    setEditReference('');
    setEditReceivedInto('');
  };

  const handleSaveEditTx = async (txId: string) => {
    const amountNum = parseFloat(editAmount);
    const serviceClaimNum = parseFloat(editServiceClaim) || 0;
    if (isNaN(amountNum) || amountNum < 0) {
      setEditTxError('Enter an amount of RM 0 or more.');
      return;
    }
    if (!editDate) {
      setEditTxError('Choose the payment date.');
      return;
    }
    setEditTxError(null);
    if (onEditPayment) {
      // Only bank money keeps an account; switching to cash or a claim clears it. Untouched while the list is unavailable.
      const method = savedPaymentMethod(amountNum, serviceClaimNum, editPaymentMethod || 'BANK TRANSFER');
      const account = accounts.length ? (needsReceivedInto(amountNum, method) ? editReceivedInto || null : null) : undefined;
      onEditPayment(txId, amountNum, serviceClaimNum, editDate, method, editReference.trim(), account);
    }
    setEditingTxId(null);
    setEditPaymentMethod(null);
  };

  const renderPaymentSchedule = (driver: Driver) => {
    const invoices = generateDriverInvoices(driver, kualaLumpurNow());
    // The first cycle still owed is highlighted and scrolled into view
    const currentId = invoices.find(inv => inv.status === 'PARTIAL' || inv.status === 'UNPAID')?.id;
    return (
      <div className="space-y-1.5 max-h-[22rem] overflow-y-auto pr-2 scroll-smooth">
        {invoices.map(inv => (
          <InvoiceRow key={inv.id} invoice={inv} current={inv.id === currentId} id={inv.id === currentId ? 'current-payment-anchor' : undefined} />
        ))}
      </div>
    );
  };

  return (
    <Dialog title="Driver Payment Panel" description={`For ${liveDriverForPayment.name}`} size="lg" onClose={closePaymentModal}>
      <div className="p-4 sm:p-6 flex flex-col lg:flex-row-reverse gap-6">
        <div className="lg:w-96 lg:shrink-0">
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm lg:sticky lg:top-0">
            <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2 border-b border-gray-100 pb-2">
              <DollarSign className="w-4 h-4 text-blue-600" aria-hidden="true" /> Record New Payment
            </h3>
            <form onSubmit={handleSubmitPayment} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="payment-amount" className="text-xs font-bold text-gray-500 uppercase">Amount (RM)</label>
                  <input id="payment-amount" type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm mt-1" />
                </div>
                <div>
                  <label htmlFor="payment-claim" className="text-xs font-bold text-gray-500 uppercase">Claim (RM)</label>
                  <input id="payment-claim" type="number" value={serviceClaimAmount} onChange={(e) => setServiceClaimAmount(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm mt-1" />
                </div>
              </div>

              <div>
                <label htmlFor="payment-date" className="text-xs font-bold text-gray-500 uppercase">Payment Date</label>
                <input id="payment-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm mt-1" />
              </div>

              <div>
                <label htmlFor="payment-reference" className="text-xs font-bold text-gray-500 uppercase">Reference <span className="normal-case font-medium">(optional)</span></label>
                <input id="payment-reference" type="text" maxLength={100} autoComplete="off" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Receipt or DuitNow reference" className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm mt-1 font-mono" />
              </div>

              <div role="group" aria-labelledby="payment-method-label">
                <span id="payment-method-label" className="text-xs font-bold text-gray-500 uppercase block mb-2">Payment Method</span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {(parseFloat(paymentAmount || '0') === 0 && parseFloat(serviceClaimAmount || '0') > 0) ? (
                    <div className="col-span-2 p-2 rounded border bg-amber-50 border-amber-200 text-amber-700 font-bold text-center">
                      Claim Only (Auto)
                    </div>
                  ) : (
                    <>
                      <button type="button" aria-pressed={paymentMethod === 'BANK TRANSFER'} onClick={() => setPaymentMethod('BANK TRANSFER')} className={`p-2 rounded border ${paymentMethod === 'BANK TRANSFER' ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold' : 'border-gray-300'}`}>Bank Transfer</button>
                      <button type="button" aria-pressed={paymentMethod === 'CASH DEPOSIT'} onClick={() => setPaymentMethod('CASH DEPOSIT')} className={`p-2 rounded border ${paymentMethod === 'CASH DEPOSIT' ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold' : 'border-gray-300'}`}>Cash Deposit</button>
                      <button type="button" aria-pressed={paymentMethod === 'CASH'} onClick={() => setPaymentMethod('CASH')} className={`col-span-2 p-2 rounded border ${paymentMethod === 'CASH' ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold' : 'border-gray-300'}`}>Cash (in hand, not banked)</button>
                    </>
                  )}
                </div>
              </div>

              {activeAccounts.length > 0 && paymentMethod !== null && needsReceivedInto(parseFloat(paymentAmount) || 0, paymentMethod) && (
                <div>
                  <label htmlFor="payment-received-into" className="text-xs font-bold text-gray-500 uppercase">Received into</label>
                  <select id="payment-received-into" required value={receivedInto} onChange={(e) => setReceivedInto(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm mt-1 bg-white">
                    <option value="" disabled>Choose the account</option>
                    <AccountOptions accounts={activeAccounts} />
                  </select>
                </div>
              )}

              {paymentError && <p role="alert" className="text-sm font-medium text-rose-600">{paymentError}</p>}

              {duplicateWarning ? (
                <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 space-y-2">
                  <p className="font-bold">This may already be recorded. Check before saving:</p>
                  <ul className="list-disc pl-5 space-y-1 text-xs">
                    {duplicateWarning.map(({ driver, payment, reason }) => (
                      <li key={payment.id}>
                        {reason === 'SAME_AMOUNT_AND_DATE'
                          ? <>{formatCurrency(payment.amount > 0 ? payment.amount : payment.serviceClaim || 0)}{payment.amount > 0 ? '' : ' claim'} on {formatDate(payment.date)} is already recorded for this driver</>
                          : <>Reference <span className="font-mono font-bold">{payment.reference}</span> is already on {driver.id === liveDriverForPayment.id ? 'this driver' : `${driver.name} (${driver.carPlate})`}: {formatCurrency(payment.amount)} on {formatDate(payment.date)}</>}
                        {' '}<span className="font-mono text-amber-800">(ID {payment.id.slice(-6)})</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={() => setDuplicateWarning(null)} className="flex-1 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg">Go back</button>
                    {duplicateWarning.some(found => found.reason === 'SAME_REFERENCE' && found.driver.id === liveDriverForPayment.id && isBankReceipt(found.payment.amount, found.payment.paymentMethod)) && isBankReceipt(parseFloat(paymentAmount) || 0, paymentMethod)
                      ? <p className="flex-1 self-center text-xs font-semibold">This reference is already recorded for this driver. Check the receipt, or fix the reference.</p>
                      : <button type="button" onClick={() => submitPayment(true)} className="flex-1 py-2 text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg">Save anyway</button>}
                  </div>
                </div>
              ) : (
                <div className="flex gap-3 pt-4 border-t border-gray-100">
                  <button type="button" onClick={closePaymentModal} className="flex-1 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                  <button type="submit" className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">Confirm</button>
                </div>
              )}
            </form>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6">
            <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" /> Invoice Schedule
            </h3>
            {renderPaymentSchedule(liveDriverForPayment)}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6">
            <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <History className="w-4 h-4 text-blue-600" aria-hidden="true" /> Recent 10 Transactions
              </span>
              <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Staff Log</span>
            </h3>
            <div className="space-y-1.5 max-h-[22rem] overflow-y-auto pr-2 scroll-smooth">
              {(liveDriverForPayment?.paymentHistory || []).slice(0,10).map((tx: any) => (
                <div key={tx.id} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg border border-gray-100">
                  {editingTxId === tx.id ? (
                    <div className="w-full space-y-1">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label htmlFor={`edit-amount-${tx.id}`} className="text-xs font-bold text-gray-500 uppercase">Amount</label>
                          <input id={`edit-amount-${tx.id}`} type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="w-full p-1 border border-gray-300 rounded text-xs" />
                        </div>
                        <div className="flex-1">
                          <label htmlFor={`edit-claim-${tx.id}`} className="text-xs font-bold text-gray-500 uppercase">Claim</label>
                          <input id={`edit-claim-${tx.id}`} type="number" value={editServiceClaim} onChange={e => setEditServiceClaim(e.target.value)} className="w-full p-1 border border-gray-300 rounded text-xs" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label htmlFor={`edit-date-${tx.id}`} className="text-xs font-bold text-gray-500 uppercase">Date</label>
                          <input id={`edit-date-${tx.id}`} type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="w-full p-1 border border-gray-300 rounded text-xs" />
                        </div>
                        <div className="flex-1">
                          <label htmlFor={`edit-method-${tx.id}`} className="text-xs font-bold text-gray-500 uppercase block mb-0.5">Method</label>
                          {(parseFloat(editAmount || '0') === 0 && parseFloat(editServiceClaim || '0') > 0) ? (
                            <div id={`edit-method-${tx.id}`} className="w-full p-1 border border-amber-200 bg-amber-50 text-amber-700 rounded text-xs font-bold text-center">CLAIM</div>
                          ) : (
                            <select id={`edit-method-${tx.id}`} value={editPaymentMethod || 'BANK TRANSFER'} onChange={e => setEditPaymentMethod(e.target.value as any)} className="w-full p-1 border border-gray-300 rounded text-xs">
                              <option value="BANK TRANSFER">Bank Transfer</option>
                              <option value="CASH DEPOSIT">Cash Deposit</option>
                              <option value="CASH">Cash (in hand)</option>
                              <option value="DEPOSIT CONTRA">Deposit forfeit</option>
                            </select>
                          )}
                        </div>
                      </div>
                      {accounts.length > 0 && needsReceivedInto(parseFloat(editAmount) || 0, parseFloat(editAmount || '0') === 0 && parseFloat(editServiceClaim || '0') > 0 ? 'CLAIM' : editPaymentMethod) && (
                        <div>
                          <label htmlFor={`edit-received-into-${tx.id}`} className="text-xs font-bold text-gray-500 uppercase">Received into</label>
                          <select id={`edit-received-into-${tx.id}`} value={editReceivedInto} onChange={e => setEditReceivedInto(e.target.value)} className="w-full p-1 border border-gray-300 rounded text-xs bg-white">
                            <option value="">Untagged</option>
                            <AccountOptions accounts={accounts.filter(account => account.active || account.id === editReceivedInto)} />
                          </select>
                        </div>
                      )}
                      <div>
                        <label htmlFor={`edit-reference-${tx.id}`} className="text-xs font-bold text-gray-500 uppercase">Reference</label>
                        <input id={`edit-reference-${tx.id}`} type="text" maxLength={100} autoComplete="off" value={editReference} onChange={e => setEditReference(e.target.value)} placeholder="Optional" className="w-full p-1 border border-gray-300 rounded text-xs font-mono" />
                      </div>
                      {editTxError && <p role="alert" className="text-xs font-medium text-rose-600">{editTxError}</p>}
                      <div className="flex gap-2 justify-end pt-1">
                        <button type="button" onClick={handleCancelEditTx} className="text-xs text-gray-600 bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded transition-colors">Cancel</button>
                        <button type="button" onClick={() => handleSaveEditTx(tx.id)} className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded transition-colors">Save</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <div className="text-xs text-gray-500">{formatDate(tx.date)}{paymentWindowRecorders.has(tx.id) && <span className="text-xs font-semibold text-gray-700 bg-gray-200 px-1.5 rounded ml-1">{paymentWindowRecorders.get(tx.id)}</span>}</div>
                        <div className="text-xs font-bold text-gray-900 mt-0.5 mb-1">Paid: <PaymentAmount payment={tx} /></div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PaymentMethodBadge method={tx.paymentMethod} />
                          <ReceivedIntoBadge payment={tx} accounts={accounts} />
                          {tx.reference && <span className="text-xs font-mono text-gray-700 bg-white border border-gray-200 px-1.5 py-0.5 rounded">Ref: {tx.reference}</span>}
                          <BankBadge payment={tx} status={paymentWindowBank} />
                        </div>
                        <PaymentNoteLines lines={paymentWindowNotes.get(tx.id)} />
                      </div>
                      <button type="button" onClick={() => handleStartEditTx(tx)} className="text-xs text-blue-600 font-semibold hover:bg-blue-50 px-2 py-1.5 rounded transition-colors bg-white border border-blue-100">Edit payment</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** The accounts as options, grouped under SDN BHD and Enterprise. */
function AccountOptions({ accounts }: { accounts: PaymentAccount[] }) {
  return (
    <>
      {(Object.keys(ENTITY_NAMES) as PaymentEntity[]).map(entity => {
        const list = accounts.filter(account => account.entity === entity);
        return list.length > 0 && (
          <optgroup key={entity} label={ENTITY_NAMES[entity]}>
            {list.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
          </optgroup>
        );
      })}
    </>
  );
}
