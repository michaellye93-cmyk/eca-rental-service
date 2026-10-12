import { normalizePlate } from '../utils.ts';

/**
 * The signed-in admin site's addresses (no router library: the History API, with vercel.json sending every path to the
 * app). The driver's phone page and the login stay on "/". These pure functions turn an address into a page and back.
 */

/** Finance pages, as FinanceView names them. */
export type FinancePage = 'cash' | 'collections' | 'overview' | 'vehicles' | 'close' | 'expenses' | 'reconcile';
export const FINANCE_PAGES: FinancePage[] = ['cash', 'collections', 'overview', 'vehicles', 'close', 'expenses', 'reconcile'];

export type DriverAction = 'pay' | 'statement';

export type AdminRoute =
  /** "/", "/admin" or an address the site does not know: the saved tab decides. */
  | { kind: 'home' }
  /** The driver list; with a plate, that driver's row opened (and with an action, its payment or statement window). */
  | { kind: 'drivers'; plate?: string; action?: DriverAction }
  | { kind: 'fleet' }
  | { kind: 'agreements' }
  /** A Finance page; null when the address names none (the last one used opens). */
  | { kind: 'finance'; page: FinancePage | null }
  /** The read-only collections data view. */
  | { kind: 'collections' }
  /** The day's collection worklist. */
  | { kind: 'worklist' };

/** The Finance page's name in the address, where it differs ("Records" is the expenses page). */
const FINANCE_SLUG: Record<FinancePage, string> = {
  cash: 'cash', collections: 'collections', overview: 'overview', vehicles: 'vehicles', close: 'close', expenses: 'records', reconcile: 'reconcile',
};
const FINANCE_FROM_SLUG: Record<string, FinancePage> = {
  ...Object.fromEntries(FINANCE_PAGES.map(page => [FINANCE_SLUG[page], page])),
  expenses: 'expenses',
};

const decode = (part: string): string | null => {
  try { return decodeURIComponent(part); } catch { return null; }
};

/** The page an address names (see AdminRoute). Plates are matched with normalizePlate. */
export function parseAdminPath(pathname: string): AdminRoute {
  const parts = (pathname || '').split('/').filter(Boolean);
  const [head, second, third] = parts.map(part => part.toLowerCase());
  if (head === 'drivers') {
    const plate = second === undefined ? null : normalizePlate(decode(parts[1]) ?? '');
    if (!plate) return { kind: 'drivers' };
    return third === 'pay' || third === 'statement' ? { kind: 'drivers', plate, action: third } : { kind: 'drivers', plate };
  }
  if (head === 'fleet') return { kind: 'fleet' };
  if (head === 'agreements') return { kind: 'agreements' };
  if (head === 'finance') return { kind: 'finance', page: second !== undefined && Object.hasOwn(FINANCE_FROM_SLUG, second) ? FINANCE_FROM_SLUG[second] : null };
  if (head === 'admin' && second === 'collections') return { kind: 'collections' };
  if (head === 'admin' && second === 'worklist') return { kind: 'worklist' };
  return { kind: 'home' };
}

/** The address of a page. */
export function buildAdminPath(route: AdminRoute): string {
  switch (route.kind) {
    case 'home': return '/';
    case 'drivers': {
      const plate = route.plate ? normalizePlate(route.plate) : '';
      if (!plate) return '/drivers';
      return `/drivers/${encodeURIComponent(plate)}${route.action ? `/${route.action}` : ''}`;
    }
    case 'fleet': return '/fleet';
    case 'agreements': return '/agreements';
    case 'finance': return route.page ? `/finance/${FINANCE_SLUG[route.page]}` : '/finance';
    case 'collections': return '/admin/collections';
    case 'worklist': return '/admin/worklist';
  }
}

/**
 * Whether a payment or statement window that an address opened (/drivers/<PLATE>/pay or /statement) should close
 * because the address no longer names it (Back, or another page). `opened` is null for a window opened by a button.
 */
export function linkedWindowLeft(opened: { plate: string; action: DriverAction } | null, route: AdminRoute): boolean {
  if (!opened) return false;
  return !(route.kind === 'drivers' && route.action === opened.action && route.plate === normalizePlate(opened.plate));
}

/** What this browser saved before addresses existed: the tab (eca_admin_section), the Money page and the older view key. */
export interface StoredViews {
  section: string | null;
  moneyPage: string | null;
  legacyView: string | null;
}

/** Saved tab values, including the ones used before the Drivers section existed. */
const SECTION_FROM_STORED: Record<string, 'drivers' | 'fleet' | 'agreements' | 'finance'> = {
  DRIVERS: 'drivers', FLEET: 'fleet', AGREEMENTS: 'agreements', ACTIVE: 'drivers', DELISTED: 'drivers', DRIVER_LIST: 'drivers',
  ANALYTICS: 'finance', RECONCILE: 'finance', FINANCE: 'finance', MONEY: 'finance',
};
/** The Finance page to open when an older saved tab is carried over (Analytics, Bank Recon, Finance). */
const MONEY_PAGE_FROM_STORED: Record<string, FinancePage> = { ANALYTICS: 'collections', RECONCILE: 'reconcile', FINANCE: 'overview' };

const sectionOf = (stored: string | null) => (stored !== null && Object.hasOwn(SECTION_FROM_STORED, stored) ? SECTION_FROM_STORED[stored] : null);

/** The Finance page last used in this browser (an older saved tab carried over), else Cash. */
export function storedFinancePage(stored: StoredViews): FinancePage {
  if (stored.moneyPage && (FINANCE_PAGES as string[]).includes(stored.moneyPage)) return stored.moneyPage as FinancePage;
  return MONEY_PAGE_FROM_STORED[stored.section ?? ''] ?? MONEY_PAGE_FROM_STORED[stored.legacyView ?? ''] ?? 'cash';
}

/** The first page for "/" or "/admin": the tab saved in this browser (as before addresses existed), else Drivers. */
export function routeFromStored(stored: StoredViews): AdminRoute {
  const section = sectionOf(stored.section) ?? sectionOf(stored.legacyView) ?? 'drivers';
  return section === 'finance' ? { kind: 'finance', page: storedFinancePage(stored) } : { kind: section };
}

/**
 * The page a signed-in person actually sees at an address: "/" opens the saved tab, "/finance" the last Finance page,
 * and staff opening Finance (admins only) land on the driver list.
 */
export function resolveAdminRoute(route: AdminRoute, isAdmin: boolean, stored: StoredViews): AdminRoute {
  const resolved = route.kind === 'home' ? routeFromStored(stored)
    : route.kind === 'finance' && !route.page ? { kind: 'finance' as const, page: storedFinancePage(stored) }
      : route;
  return resolved.kind === 'finance' && !isAdmin ? { kind: 'drivers' } : resolved;
}
