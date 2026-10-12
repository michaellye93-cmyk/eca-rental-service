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
