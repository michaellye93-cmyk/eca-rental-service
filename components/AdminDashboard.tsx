
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Driver, DriverStatus } from '../types';
import { buildLateAlerts, overdueRent, formatCurrency, kualaLumpurNow, kualaLumpurToday, mondayToSunday, normalizePlate, parseDate, plateMatches, rentDueAndPaid } from '../utils';
const FinanceView = React.lazy(() => import('./finance/FinanceView'));
const FleetView = React.lazy(() => import('./fleet/FleetView'));
const AgreementsView = React.lazy(() => import('./agreements/AgreementsView'));
const TerminationReport = React.lazy(() => import('./TerminationReport'));
import type { Page as MoneyPage } from './finance/FinanceView';
import CashLine from './money/CashLine';
import { cashLine, type CashBalanceEntry, type CashOutlookData } from '../services/cashOutlook';
import { loadCashOutlook } from '../services/finance/api';
import { buildTerminationReport } from '../terminationReport';
import { fleet } from '../services/fleet/client';
import { attentionCount, type Car as FleetCar, type InsuranceCover } from '../services/fleet/rules';
import {
  LogOut,
  DollarSign,
  CarFront,
  UserPlus,
  Users,
  Shield,
  ChevronUp,
  ChevronDown,
  FileSignature,
  ListChecks,
} from 'lucide-react';
import { useScreening } from './drivers/useScreening';
import { compareForList, DEFAULT_LIST_SORT, useDriverListData, type ListSort } from './drivers/useDriverListData';
import { ConfirmDialog } from './Dialog';
import PaymentDialog from './drivers/PaymentDialog';
import DriverFormDialog from './drivers/DriverFormDialog';
import FleetOverviewCards from './drivers/FleetOverviewCards';
import DriverListControls from './drivers/DriverListControls';
import ContactDetailsTable, { type DetailsSort } from './drivers/ContactDetailsTable';
import DriverRow, { type CollectionChips } from './drivers/DriverRow';
import { catchUpStatus, latestPromise, promiseStatus, runningPlan } from '../services/collections';
import { useCollectionsExtras } from './useCollectionsExtras';
import { planLabel } from './CollectionsPanels';
import StatementDialog from './StatementDialog';
import { buildAdminPath, linkedWindowLeft, storedFinancePage, type AdminRoute, type DriverAction } from '../services/routes';
import { logContact } from '../services/collectionsApi';
import { loadDepositsHeld } from '../services/depositsApi';
import type { UpfrontReceived } from '../services/depositTotals';

interface AdminDashboardProps {
  drivers: Driver[];
  userRole: 'admin' | 'staff'; // Role passed from parent
  onUpdatePayment: (driverId: string, amount: number, date: string, serviceClaim?: number, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CASH' | 'DEPOSIT CONTRA' | 'CLAIM', reference?: string, receivedInto?: string) => void;
  onEditPayment?: (paymentId: string, amount: number, serviceClaim: number, date: string, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CASH' | 'DEPOSIT CONTRA' | 'CLAIM', reference?: string, receivedInto?: string | null) => void | Promise<void>;
  /** Creates the driver; with `upfront`, also records the money received at signing once the driver exists. */
  onCreateDriver: (driver: Driver, upfront?: UpfrontReceived) => Promise<void>;
  /** Saves the driver; with `upfront`, also records extra deposit/downpayment received (Deposits panel). */
  onUpdateDriver: (driver: Driver, upfront?: UpfrontReceived) => Promise<void>;
  onDelistDriver: (driverId: string) => void;
  onDeleteDriver: (driverId: string) => void;
  onLogout: () => void;
  /** The page at the current address (drivers, fleet, agreements or a Finance page; see services/routes.ts). */
  route: AdminRoute;
  /** Goes to an address (a new history entry, or with `replace` the current one changed). */
  onNavigate: (path: string, options?: { replace?: boolean }) => void;
}

/**
 * A text setting remembered in this browser under `key`; falls back when storage is empty or unavailable.
 * `parse` maps a stored value to a current one (or null to use the fallback), e.g. to translate old tab names.
 */
function usePersistedState<T extends string>(key: string, fallback: T, parse?: (stored: string) => T | null): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return fallback;
      return (parse ? parse(stored) : (stored as T)) || fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  }, [key, value]);
  return [value, setValue];
}

/**
 * Wraps a screen that loads on demand. If its code can't be fetched (for example the app was updated while
 * this page was open), show a reload prompt instead of letting React clear the whole page.
 */
class ScreenLoadBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="p-6 text-sm text-gray-700">
        This section couldn't load, possibly because the app was just updated.{' '}
        <button type="button" onClick={() => window.location.reload()} className="font-semibold text-blue-600 underline">
          Reload the page
        </button>
      </div>
    );
  }
}

type Section = 'DRIVERS' | 'FLEET' | 'AGREEMENTS' | 'MONEY';

/** The section a page belongs to (the old saved tab values are read in services/routes.ts). */
const SECTION_OF_ROUTE: Partial<Record<AdminRoute['kind'], Section>> = { drivers: 'DRIVERS', fleet: 'FLEET', agreements: 'AGREEMENTS', finance: 'MONEY' };

const SECTIONS: { id: Section; label: string; Icon: typeof Users }[] = [
  { id: 'DRIVERS', label: 'Drivers', Icon: Users },
  { id: 'FLEET', label: 'Fleet', Icon: CarFront },
  { id: 'AGREEMENTS', label: 'Agreements', Icon: FileSignature },
  { id: 'MONEY', label: 'Finance', Icon: DollarSign },
];


/** A calendar day as YYYY-MM-DD. */
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
/** A day as a short label, e.g. "1 Oct". */
const shortDay = (isoDate: string) => parseDate(isoDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Smooth scrolling, unless the viewer prefers reduced motion. */
const scrollBehavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');


const AdminDashboard: React.FC<AdminDashboardProps> = ({
  drivers,
  userRole,
  onUpdatePayment,
  onEditPayment,
  onCreateDriver,
  onUpdateDriver,
  onDelistDriver,
  onDeleteDriver,
  onLogout,
  route,
  onNavigate,
}) => {
  // The section and Finance page come from the address (services/routes.ts); they are still remembered in this browser
  // so "/" opens where you left off. The list view is remembered too. Search and filters start empty on every visit,
  // so an old search never hides drivers (the values older versions saved are removed below).
  const [searchTerm, setSearchTerm] = useState('');
  // The tab saved before the Drivers section (ACTIVE, DELISTED, DRIVER_LIST, ...) is read once to carry it over and
  // never written again, so an older version of the app still finds a value it understands.
  const [legacyView] = useState<string | null>(() => {
    try { return localStorage.getItem('eca_admin_view_mode'); } catch { return null; }
  });
  const section: Section = SECTION_OF_ROUTE[route.kind] ?? 'DRIVERS';
  // The Finance page last opened, for the Finance tab
  const [lastMoneyPage, setLastMoneyPage] = useState<MoneyPage>(() => {
    const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
    return storedFinancePage({ section: read('eca_admin_section'), moneyPage: read('eca_admin_money_page'), legacyView });
  });
  const moneyPage: MoneyPage = route.kind === 'finance' && route.page ? route.page : lastMoneyPage;
  useEffect(() => {
    if (!SECTION_OF_ROUTE[route.kind]) return;
    if (route.kind === 'finance' && route.page) setLastMoneyPage(route.page);
    try {
      localStorage.setItem('eca_admin_section', section);
      if (route.kind === 'finance' && route.page) localStorage.setItem('eca_admin_money_page', route.page);
    } catch { /* storage unavailable: the address still works */ }
  }, [route, section]);
  // Changing tab or Finance page adds a history entry, so Back returns to the previous one
  const setSection = (next: Section) => onNavigate(buildAdminPath(
    next === 'MONEY' ? { kind: 'finance', page: lastMoneyPage } : { kind: next === 'FLEET' ? 'fleet' : next === 'AGREEMENTS' ? 'agreements' : 'drivers' },
  ));
  const setMoneyPage = (page: MoneyPage) => onNavigate(buildAdminPath({ kind: 'finance', page }));
  const [storedScope, setDriverScope] = usePersistedState<'ACTIVE' | 'DELISTED' | 'TERMINATION'>('eca_admin_driver_scope', legacyView === 'DELISTED' ? 'DELISTED' : 'ACTIVE', stored => stored === 'ACTIVE' || stored === 'DELISTED' || stored === 'TERMINATION' ? stored : null);
  // The termination review is for admins; staff always see Active or Delisted
  const driverScope = storedScope === 'TERMINATION' && userRole !== 'admin' ? 'ACTIVE' : storedScope;
  const [listView, setListView] = usePersistedState<'COLLECTIONS' | 'DETAILS'>('eca_admin_driver_list_view', legacyView === 'DRIVER_LIST' ? 'DETAILS' : 'COLLECTIONS', stored => stored === 'COLLECTIONS' || stored === 'DETAILS' ? stored : null);
  // Staff see Drivers and Fleet (Money is for admins), and contact details are for admins
  const activeSection: Section = userRole === 'admin' || section !== 'MONEY' ? section : 'DRIVERS';
  const showDetails = userRole === 'admin' && listView === 'DETAILS';
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'GOOD' | 'MID' | 'BAD'>('ALL');
  const [selectedTagFilter, setSelectedTagFilter] = useState('ALL');
  useEffect(() => {
    try {
      for (const key of ['eca_admin_search_term', 'eca_admin_status_filter', 'eca_admin_selected_tag_filter']) localStorage.removeItem(key);
    } catch { /* storage unavailable: nothing was kept */ }
  }, []);

  // A driver row briefly highlighted after choosing it from the late alerts
  const [highlight, setHighlight] = useState<{ driverId: string } | null>(null);
  const driversSectionRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [expandedDriverIds, setExpandedDriverIds] = useState<string[]>([]);

  const [sortConfig, setSortConfig] = useState<ListSort>(DEFAULT_LIST_SORT);
  const [driverListSortConfig, setDriverListSortConfig] = useState<DetailsSort>({ key: null, direction: null });

  const handleSort = (key: 'RISK_STATUS' | 'OUTSTANDING') => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const toggleRowExpand = (driverId: string) => {
    setExpandedDriverIds(prev => 
      prev.includes(driverId) 
        ? prev.filter(id => id !== driverId) 
        : [...prev, driverId]
    );
  };
  
  // The Add / Edit Driver form: the driver being edited (null to add one); `opening` gives each opening a fresh form
  const [driverForm, setDriverForm] = useState<{ driver: Driver | null; opening: number } | null>(null);
  const driverFormOpenings = useRef(0);

  // The driver whose WhatsApp statement is open
  const [statementDriver, setStatementDriver] = useState<Driver | null>(null);
  // Bank-in lines for statements, promises to pay and catch-up plans
  const extras = useCollectionsExtras();

  // Confirmation Modal State
  const [driverToDelist, setDriverToDelist] = useState<Driver | null>(null);
  const [driverToDelete, setDriverToDelete] = useState<Driver | null>(null);

  // The driver whose payment window is open
  const [selectedDriverForPayment, setSelectedDriverForPayment] = useState<Driver | null>(null);
  // The payment window's Claim box, kept until a payment is recorded (the rest of the form starts afresh each time)
  const [serviceClaimAmount, setServiceClaimAmount] = useState('0');
  const [paymentWindowOpening, setPaymentWindowOpening] = useState(0);

  const liveDriverForPayment = selectedDriverForPayment ? (drivers.find(d => d.id === selectedDriverForPayment.id) || selectedDriverForPayment) : null;

  


  // --- Daily screening, shared between staff (Kuala Lumpur calendar day) ---
  const { screenedDriverIds, screeningDate, screeningShared, handleScreenDriver } = useScreening();



  // Each driver with the list's figures; worked out again when the Kuala Lumpur day rolls over (screeningDate)
  const driverData = useDriverListData(drivers, screeningDate);

  // Each active driver's open or recently missed promise, and running catch-up plan, for the row's chips
  const collectionChips = useMemo(() => {
    const now = kualaLumpurNow();
    const today = kualaLumpurToday();
    const fortnightAgo = parseDate(today);
    fortnightAgo.setDate(fortnightAgo.getDate() - 14);
    const chips = new Map<string, CollectionChips>();
    for (const d of driverData) {
      if (d.isDelisted) continue;
      const entry: CollectionChips = {};
      const promise = extras.promises ? latestPromise(extras.promises, d.id) : null;
      if (promise) {
        const { state } = promiseStatus(promise, d, today);
        if (state === 'OPEN') entry.promise = { text: `Promise ${formatCurrency(promise.amount)} by ${shortDay(promise.promised_date)}`, missed: false };
        else if (state === 'MISSED' && promise.promised_date >= isoDay(fortnightAgo)) entry.promise = { text: `Promise missed (${shortDay(promise.promised_date)})`, missed: true };
      }
      const plan = extras.plans ? runningPlan(extras.plans, d.id, today) : null;
      if (plan) {
        const status = catchUpStatus(plan, d, now);
        entry.plan = { text: `Plan: ${planLabel(status, plan.start_date)}`, state: status.state };
      }
      if (entry.promise || entry.plan) chips.set(d.id, entry);
    }
    return chips;
  }, [driverData, extras.promises, extras.plans]);

  // Extract all unique tags for filter dropdown
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    driverData.forEach(d => d.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [driverData]);

  // --- Rent targets and late alerts ---
  // Re-read when the screening day rolls over at Kuala Lumpur midnight.
  const todayStr = useMemo(() => kualaLumpurToday(), [screeningDate]);
  // The Fleet tab's red count: loaded once here, then kept current by the Fleet page. No count if the list can't
  // load (the Fleet page itself reports errors).
  const [fleetCars, setFleetCars] = useState<FleetCar[] | null>(null);
  // Admins: Finance's insurance dates, read once here and passed to the Fleet page, so the count and its cards agree.
  const [fleetCover, setFleetCover] = useState<InsuranceCover | undefined>(undefined);
  useEffect(() => {
    let active = true;
    fleet.listCars().then(cars => { if (active) setFleetCars(cars); }).catch(() => {});
    if (userRole === 'admin') fleet.insuranceCover().then(cover => { if (active) setFleetCover(cover); }).catch(() => {});
    return () => { active = false; };
  }, [userRole]);
  const fleetAttention = useMemo(() => (fleetCars ? attentionCount(fleetCars, todayStr, fleetCover) : 0), [fleetCars, todayStr, fleetCover]);
  const todayNormalized = useMemo(() => parseDate(todayStr), [todayStr]);
  // The recovery bar on each row measures from the 1st of this month, e.g. "since 1 Sep"
  const recoverySinceLabel = `1 ${todayNormalized.toLocaleDateString('en-GB', { month: 'short' })}`;

  // Monday to Sunday of this week (the collections data view uses the same week)
  const { start: startOfWeek, end: endOfWeek } = useMemo(() => mondayToSunday(todayNormalized), [todayNormalized]);

  const startOfMonth = useMemo(() => {
    return new Date(todayNormalized.getFullYear(), todayNormalized.getMonth(), 1);
  }, [todayNormalized]);

  const endOfMonth = useMemo(() => {
    return new Date(todayNormalized.getFullYear(), todayNormalized.getMonth() + 1, 0);
  }, [todayNormalized]);

  // This week's / month's rent from the shared rent schedule, and the late alerts (see buildLateAlerts); active drivers
  const weekTotals = useMemo(() => rentDueAndPaid(drivers, startOfWeek, endOfWeek, todayNormalized), [drivers, startOfWeek, endOfWeek, todayNormalized]);
  const monthTotals = useMemo(() => rentDueAndPaid(drivers, startOfMonth, endOfMonth, todayNormalized), [drivers, startOfMonth, endOfMonth, todayNormalized]);
  // Late alerts: weekly drivers 8+ days without a payment, monthly drivers 8+ days past an unpaid due date
  const lateAlerts = useMemo(() => buildLateAlerts(driverData, todayNormalized), [driverData, todayNormalized]);
  const lateAlertsOwed = lateAlerts.reduce((sum, { driver }) => sum + driver.activeBalance.baseValue, 0);

  // --- Cash position (admins): finance_cash_outlook plus the driver ledger ---
  const [outlook, setOutlook] = useState<CashOutlookData | null>(null);
  const [outlookState, setOutlookState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const reloadOutlook = useCallback(async () => {
    if (userRole !== 'admin') return;
    try {
      // Deposits held come from the deposit ledger, read once with the outlook; without it no deposit figures show.
      const [data, depositsHeld] = await Promise.all([loadCashOutlook(kualaLumpurToday()), loadDepositsHeld().catch(() => undefined)]);
      setOutlook({ ...data, deposits_held: depositsHeld });
      setOutlookState('ready');
    } catch {
      setOutlookState('unavailable');
    }
  }, [userRole]);
  useEffect(() => { void reloadOutlook(); }, [reloadOutlook, todayStr]);
  const setBalances = (rows: CashBalanceEntry[]) => setOutlook(current => (current ? { ...current, balances: rows } : current));
  const cashSummary = useMemo(() => {
    if (!outlook) return null;
    // Overdue = rent that fell due before today and is unpaid; compared with the same day last week
    const active = driverData.filter(d => !d.isDelisted);
    const weekAgo = new Date(todayNormalized);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const overdue = active.reduce((sum, d) => sum + overdueRent(d, todayNormalized), 0);
    const overdueWeekAgo = active.reduce((sum, d) => sum + overdueRent(d, weekAgo), 0);
    return cashLine({ today: todayStr, outlook, drivers: driverData, overdue, overdueChange: overdue - overdueWeekAgo });
  }, [outlook, driverData, todayStr, todayNormalized]);
  const openCashPage = () => setMoneyPage('cash');

  // Termination review count (admins); the review itself loads its own snapshot when opened
  const terminationCount = useMemo(
    () => (userRole === 'admin' ? buildTerminationReport(driverData.filter(d => !d.isDelisted)).recommendations.length : 0),
    [driverData, userRole],
  );

  // Money (Collections and the cash forecast) receives all drivers in the list's default order.
  const driversInDefaultOrder = useMemo(() => [...driverData].sort((a, b) => compareForList(a, b, DEFAULT_LIST_SORT)), [driverData]);

  // Drivers in the chosen scope, before the other filters
  const scopeDrivers = useMemo(() => driverData.filter(d => driverScope === 'DELISTED' ? d.isDelisted : !d.isDelisted), [driverData, driverScope]);

  // Filter by risk, search and staff group, then sort
  const filteredDrivers = useMemo(() => {
    let result = scopeDrivers;

    if (statusFilter !== 'ALL') {
      result = result.filter(d => d.metrics.status === statusFilter);
    }

    // 2. Search (plates match with or without spaces)
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(d =>
        d.name.toLowerCase().includes(lower) ||
        plateMatches(d.carPlate, searchTerm) ||
        d.nric.includes(lower)
      );
    }

    // 3. Tag Filter
    if (selectedTagFilter !== 'ALL') {
      result = result.filter(d => d.tags?.includes(selectedTagFilter));
    }

    // 4. Sorting (on a copy, so the shared driver list keeps its order)
    return [...result].sort((a, b) => compareForList(a, b, sortConfig));
  }, [scopeDrivers, searchTerm, selectedTagFilter, sortConfig, statusFilter]);

  // Fleet overview counts (active fleet)
  const activeDrivers = driverData.filter(d => !d.isDelisted);
  const activeFleetCount = activeDrivers.length;
  const delistedCount = driverData.length - activeFleetCount;
  const riskCounts = {
    GOOD: activeDrivers.filter(d => d.metrics.status === DriverStatus.GOOD).length,
    MID: activeDrivers.filter(d => d.metrics.status === DriverStatus.MID).length,
    BAD: activeDrivers.filter(d => d.metrics.status === DriverStatus.BAD).length,
  };
  const screenedCount = screenedDriverIds.length;
  const filtersActive = statusFilter !== 'ALL' || selectedTagFilter !== 'ALL' || searchTerm !== '';
  const resetFilters = () => {
    setStatusFilter('ALL');
    setSelectedTagFilter('ALL');
    setSearchTerm('');
  };

  // Bring the driver list into view once this click's changes have rendered
  const scrollToDrivers = () => {
    requestAnimationFrame(() => driversSectionRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }));
  };
  // A risk tile toggles its filter; turning one on shows the matching active drivers
  const chooseRisk = (status: 'GOOD' | 'MID' | 'BAD') => {
    const next = statusFilter === status ? 'ALL' : status;
    setStatusFilter(next);
    if (next !== 'ALL') {
      setDriverScope('ACTIVE');
      scrollToDrivers();
    }
  };
  // Total active fleet: the active list, ready to search
  const searchActiveFleet = () => {
    setDriverScope('ACTIVE');
    scrollToDrivers();
    searchInputRef.current?.focus({ preventScroll: true });
  };
  // A late alert shows that driver's row, clearing any filter that could hide it
  const showDriverRow = (driverId: string) => {
    setDriverScope('ACTIVE');
    setListView('COLLECTIONS');
    resetFilters();
    setHighlight({ driverId });
  };
  useEffect(() => {
    if (!highlight) return;
    const row = document.getElementById(`driver-row-${highlight.driverId}`);
    row?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    // Keyboard and screen-reader users carry on from the driver's row
    row?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus({ preventScroll: true });
    const timer = setTimeout(() => setHighlight(null), 4500);
    return () => clearTimeout(timer);
  }, [highlight]);

  // --- Handlers ---

  // Opening a driver's payment window or Edit form does not mark them screened: only the "mark screened" button does
  const handleOpenPaymentModal = (driver: Driver) => {
    setSelectedDriverForPayment(driver);
    setPaymentWindowOpening(n => n + 1); // a fresh form each time it opens, even over an open window
  };

  /** Cancel, close or a recorded payment: the window closes and a linked address goes back to the driver. */
  const closePaymentModal = () => {
    setSelectedDriverForPayment(null);
    leaveDriverAction();
  };

  // Links to a driver (/drivers/<PLATE>, .../pay, .../statement): the active driver with that plate is shown in the
  // list, opened and scrolled into view, and the payment or statement window opens. Each address is handled once, so
  // a reload of the list does not open the window again; an unknown plate shows the list with a notice.
  const handledLink = useRef<string | null>(null);
  const [unknownPlate, setUnknownPlate] = useState<string | null>(null);
  // The payment or statement window an address opened: Back (the address no longer names it) closes it
  const linkedWindow = useRef<{ plate: string; action: DriverAction } | null>(null);
  useEffect(() => {
    const opened = linkedWindow.current;
    if (!opened || !linkedWindowLeft(opened, route)) return;
    linkedWindow.current = null;
    if (opened.action === 'pay') {
      setSelectedDriverForPayment(null);
    } else {
      setStatementDriver(null);
    }
  }, [route]);
  useEffect(() => {
    if (route.kind !== 'drivers' || !route.plate) {
      handledLink.current = null;
      setUnknownPlate(null);
      return;
    }
    const link = buildAdminPath(route);
    if (handledLink.current === link) return;
    handledLink.current = link;
    const driver = driverData.find(d => !d.isDelisted && normalizePlate(d.carPlate) === route.plate);
    if (!driver) {
      setUnknownPlate(route.plate);
      return;
    }
    setUnknownPlate(null);
    showDriverRow(driver.id);
    setExpandedDriverIds(prev => (prev.includes(driver.id) ? prev : [...prev, driver.id]));
    if (route.action) linkedWindow.current = { plate: route.plate, action: route.action };
    if (route.action === 'pay') handleOpenPaymentModal(driver);
    if (route.action === 'statement') setStatementDriver(driver);
    // Only a new address is handled; the driver list reloading must not reopen a window
  }, [route, driverData]);
  /** After a linked payment or statement window closes, the address goes back to the driver (so a reload does not reopen it). */
  function leaveDriverAction() {
    linkedWindow.current = null;
    if (route.kind !== 'drivers' || !route.plate || !route.action) return;
    const back = buildAdminPath({ kind: 'drivers', plate: route.plate });
    handledLink.current = back;
    onNavigate(back, { replace: true });
  }

  const handleDelistClick = (driver: Driver) => { setDriverToDelist(driver); };
  const confirmDelist = () => { if (driverToDelist) { onDelistDriver(driverToDelist.id); setDriverToDelist(null); } };
  const confirmDelete = () => { if (driverToDelete) { onDeleteDriver(driverToDelete.id); setDriverToDelete(null); } };
  
  const handleOpenCreateModal = () => { driverFormOpenings.current += 1; setDriverForm({ driver: null, opening: driverFormOpenings.current }); };

  const handleOpenEditModal = (driver: Driver) => { driverFormOpenings.current += 1; setDriverForm({ driver, opening: driverFormOpenings.current }); };



  const riskSortIcon = (key: 'RISK_STATUS' | 'OUTSTANDING') => sortConfig.key === key && (
    sortConfig.direction === 'asc' ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
  );

  return (
    <div className="min-h-screen bg-gray-100 font-sans print:bg-white">
      {/* Top bar: sections (admins), add driver, log out */}
      <header className="bg-gray-900 text-white shadow-md print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 min-h-14 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight shrink-0">Admin<span className="text-blue-400">Control</span></h1>

          <nav aria-label="Sections" className="order-last basis-full md:order-none md:basis-auto flex gap-1 overflow-x-auto">
            {SECTIONS.filter(({ id }) => userRole === 'admin' || id !== 'MONEY').map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={activeSection === id ? 'page' : undefined}
                onClick={() => setSection(id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeSection === id ? 'bg-white/15 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'}`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" /> {label}
                {id === 'FLEET' && fleetAttention > 0 && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-600 text-white text-xs font-bold flex items-center justify-center">
                    <span aria-hidden="true">{fleetAttention}</span>
                    <span className="sr-only">, {fleetAttention} {fleetAttention === 1 ? 'car needs' : 'cars need'} attention</span>
                  </span>
                )}
              </button>
            ))}
            {/* The day's collection worklist (staff and admins), on its own page */}
            <a
              href={buildAdminPath({ kind: 'worklist' })}
              onClick={event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onNavigate(buildAdminPath({ kind: 'worklist' }));
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors text-gray-300 hover:text-white hover:bg-white/10"
            >
              <ListChecks className="w-4 h-4" aria-hidden="true" /> Worklist
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            {/* Current role (hidden on phones so Add Driver and Log out stay on screen) */}
            <div className="hidden sm:flex bg-gray-800 rounded-lg p-1.5 px-3 items-center gap-2 border border-gray-700">
              {userRole === 'admin' ? <Shield className="w-3 h-3 text-blue-400" aria-hidden="true" /> : <UserPlus className="w-3 h-3 text-indigo-400" aria-hidden="true" />}
              <span className="text-xs font-bold uppercase tracking-wide text-gray-300">
                {userRole === 'admin' ? 'Administrator' : 'Staff View'}
              </span>
            </div>

            <div className="hidden sm:block h-6 w-px bg-gray-700"></div>

            <button type="button" onClick={handleOpenCreateModal} aria-label="Add driver" title="Add driver" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-blue-900/50">
              <UserPlus className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Add Driver</span>
            </button>

            <button type="button" onClick={onLogout} aria-label="Log out" title="Log out" className="text-gray-400 hover:text-white flex items-center gap-2 text-sm transition-colors p-2 sm:p-0">
              <LogOut className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>
      {userRole === 'admin' && <CashLine summary={cashSummary} state={outlookState} onOpen={openCashPage} />}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3 print:p-0 print:m-0 print:w-full print:max-w-none">
        {activeSection === 'DRIVERS' ? (
          <>
            {unknownPlate && (
              <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden">
                No active driver with plate {unknownPlate}.
              </p>
            )}
            {/* Fleet overview, rent targets and late alerts (active fleet). Wide screens: one row. Tablets: fleet
                health and late alerts side by side, the two targets below. Phones: stacked. */}
            <FleetOverviewCards
              activeFleetCount={activeFleetCount}
              riskCounts={riskCounts}
              statusFilter={statusFilter}
              onChooseRisk={chooseRisk}
              onSearchActiveFleet={searchActiveFleet}
              screenedCount={screenedCount}
              screeningShared={screeningShared}
              weekTotals={weekTotals}
              monthTotals={monthTotals}
              startOfWeek={startOfWeek}
              endOfWeek={endOfWeek}
              startOfMonth={startOfMonth}
              lateAlerts={lateAlerts}
              lateAlertsOwed={lateAlertsOwed}
              onShowDriver={showDriverRow}
            />

            {/* Driver list */}
            <section ref={driversSectionRef} aria-labelledby="drivers-heading" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-clip print:shadow-none print:border-none">
              <h2 id="drivers-heading" className="sr-only">Drivers</h2>
              {/* Controls stay in view while scrolling the list */}
              <DriverListControls
                userRole={userRole}
                driverScope={driverScope}
                onDriverScopeChange={setDriverScope}
                counts={{ active: activeFleetCount, delisted: delistedCount, termination: terminationCount }}
                searchInputRef={searchInputRef}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                selectedTagFilter={selectedTagFilter}
                onTagFilterChange={setSelectedTagFilter}
                allTags={allTags}
                showDetails={showDetails}
                onListViewChange={setListView}
                filtersActive={filtersActive}
                shownCount={filteredDrivers.length}
                scopeCount={scopeDrivers.length}
                statusFilter={statusFilter}
                onResetFilters={resetFilters}
              />

              {driverScope === 'TERMINATION' ? (
                /* Termination review (admins): drivers the 8-week evidence recommends ending, from its own snapshot */
                <div className="p-3 sm:p-6">
                  <ScreenLoadBoundary><React.Suspense fallback={<p className="p-6 text-sm text-gray-600">Loading the termination review…</p>}><TerminationReport /></React.Suspense></ScreenLoadBoundary>
                </div>
              ) : showDetails ? (
                /* Contact details (admins) */
                <ContactDetailsTable
                  rows={filteredDrivers}
                  sortConfig={driverListSortConfig}
                  onSortConfigChange={setDriverListSortConfig}
                  onEdit={handleOpenEditModal}
                />
              ) : (
                /* Collections list */
                <div className="p-2 sm:p-3">
                  {/* Column headings and sorting (on phones, just the sort buttons) */}
                  <div className="flex items-center gap-2 px-1 pb-2 text-xs font-bold uppercase tracking-wider text-gray-500 lg:grid lg:grid-cols-[minmax(0,1fr)_13rem_17rem_14.5rem] xl:grid-cols-[minmax(0,1fr)_14rem_18.5rem_14.5rem] lg:gap-0 lg:px-3 lg:pl-4 lg:border lg:border-transparent">
                    <span className="hidden lg:block lg:pl-10">Driver</span>
                    <span className="lg:hidden">Sort</span>
                    <button type="button" aria-pressed={sortConfig.key === 'RISK_STATUS'} onClick={() => handleSort('RISK_STATUS')} className="flex items-center justify-center gap-1 rounded px-2 py-1 border border-gray-200 lg:border-0 lg:px-3 uppercase font-bold tracking-wider hover:text-gray-800 transition-colors">
                      Risk Status {riskSortIcon('RISK_STATUS')}
                    </button>
                    <button type="button" aria-pressed={sortConfig.key === 'OUTSTANDING'} onClick={() => handleSort('OUTSTANDING')} className="flex items-center justify-center lg:justify-end gap-1 rounded px-2 py-1 border border-gray-200 lg:border-0 lg:px-4 uppercase font-bold tracking-wider hover:text-gray-800 transition-colors">
                      Outstanding (Base) {riskSortIcon('OUTSTANDING')}
                    </button>
                    <span className="hidden lg:block text-center">Actions</span>
                  </div>

                  <ul role="list" className="space-y-2">
                    {filteredDrivers.map(driver => (
                      <DriverRow
                        key={driver.id}
                        driver={driver}
                        expanded={expandedDriverIds.includes(driver.id)}
                        onToggleExpand={() => toggleRowExpand(driver.id)}
                        highlighted={highlight?.driverId === driver.id}
                        screened={screenedDriverIds.includes(driver.id)}
                        onScreen={() => handleScreenDriver(driver.id)}
                        chips={collectionChips.get(driver.id)}
                        recoverySinceLabel={recoverySinceLabel}
                        driverScope={driverScope}
                        userRole={userRole}
                        extras={extras}
                        today={todayStr}
                        onPayment={() => handleOpenPaymentModal(driver)}
                        onStatement={() => setStatementDriver(driver)}
                        onEdit={() => handleOpenEditModal(driver)}
                        onDelist={() => handleDelistClick(driver)}
                        onDelete={() => setDriverToDelete(driver)}
                        onContraPayment={(amount, date) => onUpdatePayment(driver.id, amount, date, 0, 'DEPOSIT CONTRA', 'Deposit contra')}
                      />
                    ))}
                  </ul>

                  {filteredDrivers.length === 0 && (
                    <p className="px-6 py-10 text-center text-sm text-gray-500">
                      No drivers match these filters.{' '}
                      {filtersActive && <button type="button" onClick={resetFilters} className="font-semibold text-blue-700 underline">Reset filters</button>}
                    </p>
                  )}
                </div>
              )}
            </section>
          </>
        ) : activeSection === 'AGREEMENTS' ? (
          <section aria-label="Agreements" className="min-h-[500px]">
            <ScreenLoadBoundary>
              <React.Suspense fallback={<div className="p-6">Loading Agreements…</div>}>
                <AgreementsView drivers={drivers} isAdmin={userRole === 'admin'} today={todayStr} onEditDriver={handleOpenEditModal} />
              </React.Suspense>
            </ScreenLoadBoundary>
          </section>
        ) : activeSection === 'FLEET' ? (
          <section aria-label="Fleet" className="min-h-[500px]">
            <ScreenLoadBoundary>
              <React.Suspense fallback={<div className="p-6">Loading Fleet…</div>}>
                <FleetView today={todayStr} insuranceCover={fleetCover} onCarsChange={setFleetCars} />
              </React.Suspense>
            </ScreenLoadBoundary>
          </section>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[500px] print:shadow-none print:border-none print:bg-transparent">
            <ScreenLoadBoundary>
              <React.Suspense fallback={<div className="p-6">Loading Finance…</div>}>
                <FinanceView
                  page={moneyPage}
                  onPageChange={setMoneyPage}
                  drivers={driversInDefaultOrder}
                  today={todayStr}
                  outlook={outlook}
                  outlookState={outlookState}
                  cashSummary={cashSummary}
                  onBalancesChange={setBalances}
                  onReloadOutlook={() => void reloadOutlook()}
                  onMarkPaymentCash={async (paymentId) => {
                    // Reconcile's "Paid in cash": same edit as the payment window, method changed to Cash (in hand).
                    const tx = driverData.flatMap((d) => d.paymentHistory).find((p) => p.id === paymentId);
                    if (!tx || !onEditPayment) throw new Error('That payment was not found. Reload the page and try again.');
                    await onEditPayment(paymentId, tx.amount, tx.serviceClaim || 0, tx.date, 'CASH', tx.reference ?? '', null);
                  }}
                />
              </React.Suspense>
            </ScreenLoadBoundary>
          </div>
        )}
      </main>

      {/* Driver form */}
      {driverForm && (
        <DriverFormDialog
          key={driverForm.opening}
          driver={driverForm.driver}
          drivers={drivers}
          onCreateDriver={onCreateDriver}
          onUpdateDriver={onUpdateDriver}
          onClose={() => setDriverForm(null)}
        />
      )}

      {/* WhatsApp statement, ready to paste */}
      {statementDriver && (
        <StatementDialog
          driver={drivers.find(d => d.id === statementDriver.id) ?? statementDriver}
          bankIn={extras.bankIn}
          isAdmin={userRole === 'admin'}
          onClose={() => { setStatementDriver(null); leaveDriverAction(); }}
          onBankInSaved={extras.reload}
          onLogSent={extras.contacts === null ? undefined : async (text, runSlot) => {
            await logContact({ driverId: statementDriver.id, kind: 'STATEMENT', runSlot, message: text });
            await extras.reload();
          }}
        />
      )}

      {/* Delist confirmation */}
      {driverToDelist && (
        <ConfirmDialog title="Delist Driver" confirmLabel="Confirm Delist" onConfirm={confirmDelist} onCancel={() => setDriverToDelist(null)}>
          <p>Are you sure you want to delist <strong>{driverToDelist.name}</strong>? This will mark them as inactive and freeze their active balance.</p>
        </ConfirmDialog>
      )}

      {/* Delete confirmation */}
      {driverToDelete && (
        <ConfirmDialog title="Delete Driver" confirmLabel="Delete Driver" onConfirm={confirmDelete} onCancel={() => setDriverToDelete(null)}>
          <p>Permanently delete <strong>{driverToDelete.name}</strong> ({driverToDelete.carPlate})?</p>
          <p>{driverToDelete.paymentHistory.length === 0 ? 'They have no payment records.' : `This also deletes ${driverToDelete.paymentHistory.length === 1 ? 'their 1 payment record' : `all ${driverToDelete.paymentHistory.length} of their payment records`}.`} It can't be undone.</p>
        </ConfirmDialog>
      )}

      {/* Payment window: record a payment (first on phones), the rent schedule and recent payments */}
      {liveDriverForPayment && (
        <PaymentDialog
          key={paymentWindowOpening}
          driver={liveDriverForPayment}
          drivers={drivers}
          serviceClaim={serviceClaimAmount}
          onServiceClaimChange={setServiceClaimAmount}
          onUpdatePayment={onUpdatePayment}
          onEditPayment={onEditPayment}
          onClose={closePaymentModal}
        />
      )}
    </div>
  );
};

export default AdminDashboard;
