import React from 'react';
import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { Invoice, PaymentTransaction } from '../types';
import { formatCurrency, formatDate } from '../utils';

/** How each rent status looks wherever a schedule is listed. */
const STATUS_LOOK: Record<Invoice['status'], { row: string; text: string; icon: React.ReactNode }> = {
  PAID: { row: 'bg-emerald-50', text: 'text-emerald-800', icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" /> },
  PARTIAL: { row: 'bg-amber-50', text: 'text-amber-800', icon: <AlertCircle className="w-4 h-4 text-amber-600" aria-hidden="true" /> },
  UNPAID: { row: 'bg-red-50', text: 'text-red-800', icon: <AlertCircle className="w-4 h-4 text-red-600" aria-hidden="true" /> },
  FUTURE: { row: 'bg-gray-50', text: 'text-gray-600', icon: <Clock className="w-4 h-4 text-gray-500" aria-hidden="true" /> },
  CANCELLED: { row: 'bg-gray-100', text: 'text-gray-500', icon: <XCircle className="w-4 h-4 text-gray-500" aria-hidden="true" /> },
};

/** One rent cycle: cycle number, due date, amount and paid status. `current` highlights the first unpaid cycle. */
export function InvoiceRow({ invoice, current = false, id }: { invoice: Invoice; current?: boolean; id?: string }) {
  const look = STATUS_LOOK[invoice.status];
  const label = invoice.status === 'PARTIAL' ? `PARTIAL (${formatCurrency(invoice.amountPaid)} paid)` : invoice.status;
  return (
    <div
      id={id}
      className={`relative overflow-hidden flex flex-wrap justify-between items-center gap-x-4 gap-y-1 p-2.5 rounded-lg border border-gray-100 transition-all duration-300 ${look.row} ${current ? 'animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.4)] ring-2 ring-red-400' : ''}`}
    >
      {current && <span aria-hidden="true" className="absolute top-0 left-0 w-1 h-full bg-red-500 animate-pulse" />}
      <div className="flex flex-col">
        <span className={`text-xs font-bold uppercase tracking-wider ${look.text}`}>Cycle {invoice.cycleIndex + 1}</span>
        <span className="text-sm font-medium text-gray-900">{formatDate(invoice.dueDate)}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-bold text-gray-900">{formatCurrency(invoice.amount)}</span>
        <span className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${look.text}`}>
          {look.icon}
          {label}
        </span>
      </div>
    </div>
  );
}

/** What a payment brought in: the cash, with any service claim shown separately rather than added in. */
export function PaymentAmount({ payment, className = '' }: { payment: Pick<PaymentTransaction, 'amount' | 'serviceClaim'>; className?: string }) {
  const claim = payment.serviceClaim || 0;
  if (payment.amount === 0 && claim > 0) return <span className={className}>{formatCurrency(claim)} claim</span>;
  return (
    <span className={className}>
      {formatCurrency(payment.amount)}
      {claim > 0 && <span className="font-medium text-gray-600"> + {formatCurrency(claim)} claim</span>}
    </span>
  );
}

/** The payment method as a small label. */
export function PaymentMethodBadge({ method }: { method?: PaymentTransaction['paymentMethod'] }) {
  return <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">{method || 'BANK TRANSFER'}</span>;
}
