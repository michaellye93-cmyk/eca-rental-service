/** The Money tab's pages: Cash and Collections, then the month-based Finance pages. */
export type Page = 'cash' | 'collections' | 'overview' | 'vehicles' | 'close' | 'expenses' | 'reconcile';

/**
 * Pages that read the chosen Finance month (finance_read_month, which may also create the month's fixed-cost lines):
 * every month-based page, and Cash for its bank check. Collections works from the driver ledger only.
 */
export const usesFinanceMonth = (page: Page) => page !== 'collections';

/**
 * Whether opening `page` should read `month`: only when the page uses the month and it has not already been read (or
 * asked for) for that month, so switching between pages stays quick.
 */
export const monthLoadNeeded = (page: Page, month: string, requestedMonth: string | null) =>
  usesFinanceMonth(page) && requestedMonth !== month;

/**
 * The tab bar in two groups: Reports (what happened: Overview for the CEO, then cash, rent and cars) and Work (where
 * the month is entered and checked: Records, then Reconcile, and Month close last because the bank is reconciled before
 * closing). Page ids stay the same so saved pages and links keep working.
 */
export const MONEY_PAGE_GROUPS: ReadonlyArray<{ label: 'Reports' | 'Work'; pages: ReadonlyArray<readonly [Page, string]> }> = [
  { label: 'Reports', pages: [['overview', 'Overview'], ['cash', 'Cash'], ['collections', 'Collections'], ['vehicles', 'Vehicles']] },
  { label: 'Work', pages: [['expenses', 'Records'], ['reconcile', 'Reconcile'], ['close', 'Month close']] },
];
