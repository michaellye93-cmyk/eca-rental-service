import type { PaymentTransaction } from '../types.ts';

/**
 * The one place that says what a payment counts as (owner's decision, 12 Oct 2026). Every figure on screen is one of two:
 *
 * - **Collected**: everything that settled rent. Cash, plus service claims (rent includes servicing, so a driver who pays
 *   the workshop pays on the company's behalf; the bill is booked as an expense of the same amount), plus a deposit
 *   forfeited against rent ("Deposit contra"). Collection rates, the Collections page and P&L revenue use this.
 * - **Cash**: money that reached the business: bank transfer, cash deposit or cash in hand. The cash line, the cash
 *   outlook and the cash flow use this.
 *
 * A screen that shows one of them says which.
 */

const CASH_METHODS = new Set(['BANK TRANSFER', 'CASH DEPOSIT', 'CASH']);

/** Whether a payment method brings money in (a missing method reads as bank transfer, as everywhere in the app). */
export const isCashMethod = (method?: string | null): boolean => CASH_METHODS.has((method || 'BANK TRANSFER').trim().toUpperCase());

type Money = Pick<PaymentTransaction, 'amount' | 'serviceClaim' | 'paymentMethod'>;

/** The cash part of a payment: its amount when the method brings money in, else nothing. Claims are never cash. */
export const cashOf = (payment: Money): number => (isCashMethod(payment.paymentMethod) ? payment.amount : 0);

/** Everything the payment settled: amount plus service claim, whatever the method. */
export const collectedOf = (payment: Money): number => payment.amount + (payment.serviceClaim || 0);

/** How a screen showing collected money names what it includes. */
export const COLLECTED_INCLUDES = 'cash, service claims and deposit forfeits';

/** What settled rent without bringing in cash: service claims and deposit forfeits. */
export const notCashOf = (payment: Money): number => collectedOf(payment) - cashOf(payment);
