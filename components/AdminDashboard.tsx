
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Driver, DriverStatus, type CollectionTone } from '../types';
import { driverWithNric, buildLateAlerts, calculateDriverMetrics, overdueRent, LATE_ALERT_DAYS, contractCyclesBetween, dayTagCheck, formatCurrency, formatDate, formatNric, formatPhone, kualaLumpurNow, kualaLumpurToday, mondayToSunday, normalizeMalaysianPhone, normalizePlate, parseDate, plateMatches, rentDayTag, rentDueAndPaid, whatsappLink, withDayTag } from '../utils';
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
  TrendingUp,
  Search,
  DollarSign,
  CarFront,
  X,
  UserPlus,
  Pencil,
  CalendarCheck,
  UserMinus,
  Trash2,
  Calendar,
  AlertTriangle,
  Filter,
  Users,
  TrendingDown,
  Shield,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Activity,
  Clock,
  MessageCircle,
  MessageSquareText,
  FileSignature,
  ListChecks,
} from 'lucide-react';
import { ExpandedDriverDetails } from './ExpandedDriverDetails';
import { useScreening } from './drivers/useScreening';
import { compareForList, DEFAULT_LIST_SORT, useDriverListData, type ListSort } from './drivers/useDriverListData';
import Dialog, { ConfirmDialog } from './Dialog';
import PaymentDialog from './drivers/PaymentDialog';
import { catchUpStatus, collectionSummary, latestPromise, promiseStatus, runningPlan, type CatchUpStatus } from '../services/collections';
import { useCollectionsExtras } from './useCollectionsExtras';
import CollectionsPanels, { planLabel } from './CollectionsPanels';
import StatementDialog from './StatementDialog';
import { buildAdminPath, linkedWindowLeft, storedFinancePage, type AdminRoute, type DriverAction } from '../services/routes';
import { logContact } from '../services/collectionsApi';
import { loadDeposits, loadDepositsHeld } from '../services/depositsApi';
import { receivedByKind, upfrontToRecord, type UpfrontReceived } from '../services/depositTotals';

interface AdminDashboardProps {
  drivers: Driver[];
  userRole: 'admin' | 'staff'; // Role passed from parent
  onUpdatePayment: (driverId: string, amount: number, date: string, serviceClaim?: number, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CASH' | 'DEPOSIT CONTRA' | 'CLAIM', reference?: string) => void;
  onEditPayment?: (paymentId: string, amount: number, serviceClaim: number, date: string, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CASH' | 'DEPOSIT CONTRA' | 'CLAIM', reference?: string) => void | Promise<void>;
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

/** The fleet overview's risk tiles; each one filters the driver list. */
const RISK_TILES: { status: 'GOOD' | 'MID' | 'BAD'; label: string; figure: string; pressedLook: string }[] = [
  { status: 'GOOD', label: 'Good', figure: 'text-emerald-600', pressedLook: 'ring-emerald-500 bg-emerald-50/40' },
  { status: 'MID', label: 'Mid', figure: 'text-amber-600', pressedLook: 'ring-amber-500 bg-amber-50/40' },
  { status: 'BAD', label: 'Bad', figure: 'text-rose-600', pressedLook: 'ring-rose-500 bg-rose-50/40' },
];

const TARGET_LOOK = {
  week: { glow: 'bg-blue-500/5', amount: 'text-blue-950', bar: 'from-blue-500 to-indigo-600' },
  month: { glow: 'bg-indigo-500/5', amount: 'text-indigo-950', bar: 'from-indigo-500 to-purple-600' },
};

/** Rent falling due in a period (the target) and how much of it has been settled (cash and repair credits). */
function TargetCard({ title, period, icon, look, totals }: { title: string; period: string; icon: React.ReactNode; look: keyof typeof TARGET_LOOK; totals: { due: number; paid: number } }) {
  const { glow, amount, bar } = TARGET_LOOK[look];
  const share = totals.due > 0 ? Math.min(100, (totals.paid / totals.due) * 100) : 0;
  return (
    <div title="Rent settled (cash and repair credits) of the rent due in this period" className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/75 backdrop-blur-md shadow-lg px-4 py-2.5">
      <div aria-hidden="true" className={`absolute top-0 right-0 w-36 h-36 rounded-full blur-2xl pointer-events-none ${glow}`} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-gray-950">{icon}{title}</h2>
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{period}</p>
      </div>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className={`text-xl xl:text-2xl font-black tracking-tight font-mono ${amount}`}>{formatCurrency(totals.paid)}</span>
        <span className="sr-only">settled</span>
        <span className="text-sm font-bold text-gray-500">of <span className="font-mono font-extrabold">{formatCurrency(totals.due)}</span></span>
        <span className="sr-only">target,</span>
        <span className="ml-auto text-xs font-bold text-gray-600">{Math.round(share)}%</span>
      </p>
      <div aria-hidden="true" className="w-full h-2.5 mt-2 p-0.5 bg-gray-200/60 rounded-full border border-white/40 shadow-inner overflow-hidden">
        <div className={`h-1.5 rounded-full bg-gradient-to-r transition-all duration-1000 ${bar}`} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

/** A calendar day as YYYY-MM-DD. */
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
/** A day as a short label, e.g. "1 Oct". */
const shortDay = (isoDate: string) => parseDate(isoDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const PLAN_CHIP: Record<CatchUpStatus['state'], string> = {
  ON_TRACK: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BEHIND: 'bg-rose-50 text-rose-800 border-rose-200',
  NOT_STARTED: 'bg-slate-50 text-slate-700 border-slate-200',
  ENDED: 'bg-slate-50 text-slate-700 border-slate-200',
  STOPPED: 'bg-slate-50 text-slate-700 border-slate-200',
};

/** Smooth scrolling, unless the viewer prefers reduced motion. */
const scrollBehavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/** Contact-details order: by name or category when chosen, otherwise the list's own order. */
function sortForDetails<T extends Driver>(rows: T[], config: { key: 'CATEGORY' | 'NAME' | null; direction: 'asc' | 'desc' | null }): T[] {
  if (!config.key || !config.direction) return rows;
  const value = (d: T) => (config.key === 'CATEGORY' ? d.category || '' : (d.name || '').toLowerCase());
  return [...rows].sort((a, b) => {
    const A = value(a);
    const B = value(b);
    if (A < B) return config.direction === 'asc' ? -1 : 1;
    if (A > B) return config.direction === 'asc' ? 1 : -1;
    return 0;
  });
}

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
  const [driverListSortConfig, setDriverListSortConfig] = useState<{ key: 'CATEGORY' | 'NAME' | null, direction: 'asc' | 'desc' | null }>({ key: null, direction: null });

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
  
  // Modal States
  const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);

  // The driver whose WhatsApp statement is open
  const [statementDriver, setStatementDriver] = useState<Driver | null>(null);
  // Bank-in lines for statements, promises to pay and catch-up plans
  const extras = useCollectionsExtras();

  // Confirmation Modal State
  const [driverToDelist, setDriverToDelist] = useState<Driver | null>(null);
  const [driverToDelete, setDriverToDelete] = useState<Driver | null>(null);

  // Messages shown inside the forms when an entry needs fixing
  const [driverFormError, setDriverFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  // The driver whose payment window is open
  const [selectedDriverForPayment, setSelectedDriverForPayment] = useState<Driver | null>(null);
  // The payment window's Claim box, kept until a payment is recorded (the rest of the form starts afresh each time)
  const [serviceClaimAmount, setServiceClaimAmount] = useState('0');
  const [paymentWindowOpening, setPaymentWindowOpening] = useState(0);

  const liveDriverForPayment = selectedDriverForPayment ? (drivers.find(d => d.id === selectedDriverForPayment.id) || selectedDriverForPayment) : null;

  // New Driver Form State
  const initialFormState = {
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
  };

  const [formData, setFormData] = useState(initialFormState);
  // A delisted driver with the NRIC being typed: a returning driver, whose old record and balance stay where they are
  const returningFrom = useMemo(() => (driverWithNric(drivers.filter(d => !d.isDelisted), formData.nric) ? undefined
    : driverWithNric(drivers.filter(d => d.isDelisted), formData.nric)), [drivers, formData.nric]);
  const returningOwed = returningFrom ? Math.max(0, calculateDriverMetrics(returningFrom).totalOutstanding) : 0;
  const [tagInput, setTagInput] = useState('');
  


  // --- Daily screening, shared between staff (Kuala Lumpur calendar day) ---
  const { screenedDriverIds, screeningDate, screeningShared, handleScreenDriver } = useScreening();

  // --- Auto-Calculate Duration when Dates Change ---
  useEffect(() => {
    const cycles = contractCyclesBetween(formData.contractStartDate, formData.contractEndDate, formData.rentalCycle);
    if (cycles !== null) setFormData(prev => ({ ...prev, contractDuration: cycles }));
  }, [formData.contractStartDate, formData.contractEndDate, formData.rentalCycle]);

  // A new driver's day tag follows the start date and cycle, until someone chooses a different day tag
  const autoDayTag = useRef<string | null>(null);
  useEffect(() => {
    if (!isDriverModalOpen || editingId) return;
    const expected = rentDayTag(formData);
    if (!expected) return;
    setFormData(prev => {
      const tagged = dayTagCheck(prev)?.tagged ?? [];
      const followsStart = tagged.length === 0 || (tagged.length === 1 && tagged[0] === autoDayTag.current);
      if (!followsStart || (tagged.length === 1 && tagged[0] === expected)) return prev;
      autoDayTag.current = expected;
      return { ...prev, tags: withDayTag(prev.tags, expected) };
    });
  }, [isDriverModalOpen, editingId, formData.contractStartDate, formData.rentalCycle]);


  // Each driver with the list's figures; worked out again when the Kuala Lumpur day rolls over (screeningDate)
  const driverData = useDriverListData(drivers, screeningDate);

  // Each active driver's open or recently missed promise, and running catch-up plan, for the row's chips
  const collectionChips = useMemo(() => {
    const now = kualaLumpurNow();
    const today = kualaLumpurToday();
    const fortnightAgo = parseDate(today);
    fortnightAgo.setDate(fortnightAgo.getDate() - 14);
    const chips = new Map<string, { promise?: { text: string; missed: boolean }; plan?: { text: string; state: CatchUpStatus['state'] } }>();
    for (const d of driverData) {
      if (d.isDelisted) continue;
      const entry: { promise?: { text: string; missed: boolean }; plan?: { text: string; state: CatchUpStatus['state'] } } = {};
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
  // Admins: Finance's insurance dates, so the count agrees with the Fleet page's cards.
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
  
  // What the driver's Deposits panel already has, for the deposit/downpayment boxes: zero for a new driver; null while
  // reading it for an edit; 'unavailable' when it can't be read (the boxes are then hidden and nothing is recorded).
  const [depositBaseline, setDepositBaseline] = useState<{ DEPOSIT: number; DOWNPAYMENT: number } | null | 'unavailable'>(null);
  const depositFor = useRef('');
  const handleOpenCreateModal = () => { autoDayTag.current = null; setEditingId(null); setFormData(initialFormState); setTagInput(''); setDriverFormError(null); depositFor.current = ''; setDepositBaseline({ DEPOSIT: 0, DOWNPAYMENT: 0 }); setIsDriverModalOpen(true); };
  
  const handleOpenEditModal = (driver: Driver) => {
    setEditingId(driver.id);
    setFormData({
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
    setTagInput('');
    setDriverFormError(null);
    // Show what is already recorded, so a missing deposit or downpayment can be added here
    depositFor.current = driver.id;
    setDepositBaseline(null);
    loadDeposits(driver.id).then(rows => {
      if (depositFor.current !== driver.id) return;
      const received = receivedByKind(rows);
      setDepositBaseline(received);
      setFormData(current => ({
        ...current,
        upfrontDeposit: received.DEPOSIT ? String(received.DEPOSIT) : '',
        upfrontDownpayment: received.DOWNPAYMENT ? String(received.DOWNPAYMENT) : '',
      }));
    }).catch(() => { if (depositFor.current === driver.id) setDepositBaseline('unavailable'); });
    setIsDriverModalOpen(true);
  };

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
      setIsDriverModalOpen(false); setFormData(initialFormState);
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
  const detailsRows = sortForDetails(filteredDrivers, driverListSortConfig);
  const sortArrow = (key: 'NAME' | 'CATEGORY') =>
    driverListSortConfig.key === key && driverListSortConfig.direction === 'asc' ? '▲' : driverListSortConfig.key === key && driverListSortConfig.direction === 'desc' ? '▼' : '↕';
  const cycleDetailsSort = (key: 'NAME' | 'CATEGORY') => setDriverListSortConfig(prev => ({
    key,
    direction: prev.key === key ? (prev.direction === 'asc' ? 'desc' : prev.direction === 'desc' ? null : 'asc') : 'asc'
  }));
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
            <section aria-label="Fleet overview" className="grid grid-cols-1 md:grid-cols-12 md:grid-flow-row-dense gap-3 print:hidden">
              {/* Fleet health: risk tiles (filters), fleet size (jumps to search) and today's screening */}
              <div className="md:col-span-7 xl:col-span-5 bg-white rounded-2xl border border-gray-200 shadow-md p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 tracking-tight">
                    <Activity className="w-5 h-5 text-blue-600 shrink-0" aria-hidden="true" />
                    Fleet Overview & Health Status
                  </h2>
                  <button
                    type="button"
                    onClick={searchActiveFleet}
                    aria-label={`${activeFleetCount} active vehicles. Search the active fleet`}
                    title="Search the active fleet"
                    className="flex items-baseline gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-0.5 hover:bg-gray-100 transition-colors"
                  >
                    <span className="text-base font-black text-gray-900">{activeFleetCount}</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-600">active vehicles</span>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {RISK_TILES.map(({ status, label, figure, pressedLook }) => {
                    const pressed = statusFilter === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        aria-pressed={pressed}
                        onClick={() => chooseRisk(status)}
                        title={pressed ? 'Click to show all drivers' : `Click to show only ${label} drivers`}
                        className={`rounded-xl px-2 py-2.5 border text-center flex flex-col items-center transition-colors ${pressed ? `ring-2 border-transparent ${pressedLook}` : 'bg-gray-50/40 border-gray-200/60 hover:bg-gray-100/60'}`}
                      >
                        <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500">{label}</span>
                        <span className={`my-0.5 text-3xl font-black leading-none ${figure}`}>{activeFleetCount ? Math.round((riskCounts[status] / activeFleetCount) * 100) : 0}%</span>
                        <span className="text-sm font-bold text-gray-500">{riskCounts[status]} drivers</span>
                      </button>
                    );
                  })}
                </div>

                {/* Daily screening progress (resets at midnight, Malaysia time) */}
                <div className="rounded-xl border border-black px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2" title={screeningShared ? 'Shared by all staff. Resets at midnight, Malaysia time (GMT+8)' : 'Not shared yet: the screening database update has not been installed, so marks last only while this page is open'}>
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-[#E11D48] shrink-0" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#991B1B]">Screened today</span>
                  </span>
                  <span className="ml-auto sm:ml-0 sm:order-2 text-xs font-bold uppercase whitespace-nowrap">
                    <span className="text-sm font-mono font-black text-gray-950">{screenedCount} / {activeFleetCount}</span>
                    <span className="text-[#E11D48]"> · {Math.max(0, activeFleetCount - screenedCount)} pending</span>
                    <span className="sr-only"> (resets at midnight, Malaysia time)</span>
                  </span>
                  <div aria-hidden="true" className="basis-full sm:basis-auto sm:flex-1 sm:min-w-24 sm:order-1 h-2.5 p-0.5 bg-gray-100 rounded-full border border-gray-200/40 shadow-inner overflow-hidden">
                    <div className="h-full bg-[#E11D48] rounded-full transition-all duration-700" style={{ width: `${activeFleetCount > 0 ? Math.min(100, (screenedCount / activeFleetCount) * 100) : 0}%` }} />
                  </div>
                </div>
              </div>

              {/* This week's and this month's rent, and how much of it has been paid */}
              <div className="md:col-span-12 xl:col-span-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                <TargetCard
                  title="Weekly Target"
                  period={`${startOfWeek.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${formatDate(endOfWeek)}`}
                  icon={<CalendarCheck className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />}
                  look="week"
                  totals={weekTotals}
                />
                <TargetCard
                  title="Monthly Target"
                  period={startOfMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                  icon={<Calendar className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden="true" />}
                  look="month"
                  totals={monthTotals}
                />
              </div>

              {/* Late alerts: weekly drivers 8+ days without a payment, monthly drivers 8+ days overdue.
                  Beside the targets it takes their height and scrolls, rather than stretching the row. */}
              <div className="md:col-span-5 xl:col-span-3 md:relative">
                <div className="bg-white rounded-2xl border border-gray-200 shadow-md p-4 flex flex-col max-h-[220px] md:max-h-none md:absolute md:inset-0">
                  <div className="flex items-center justify-between gap-3 mb-2 pb-2 border-b border-gray-200">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                      <Clock className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
                      Late Alerts ({LATE_ALERT_DAYS}d+)
                    </h2>
                    <span className="whitespace-nowrap bg-red-50 text-red-700 text-xs font-black px-2 py-0.5 rounded-full uppercase border border-red-200 tracking-wider">{lateAlerts.length} drivers</span>
                  </div>
                  {lateAlerts.length > 0 && (
                    <p className="-mt-1 mb-2 text-xs text-gray-600">Owed by these drivers: <span className="font-mono font-bold text-rose-700">{formatCurrency(lateAlertsOwed)}</span></p>
                  )}
                  {lateAlerts.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4 bg-gray-50/25 rounded-xl border border-dashed border-gray-200">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" aria-hidden="true" />
                      <p className="text-xs font-bold text-gray-500">All accounts are safe and active.</p>
                    </div>
                  ) : (
                    <ul className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
                      {lateAlerts.map(({ driver, days }) => {
                        const lateness = `${days} days ${driver.rentalCycle === 'MONTHLY' ? 'overdue' : 'without payment'}`;
                        const owed = driver.activeBalance.baseValue;
                        return (
                          <li key={driver.id} className="flex items-stretch gap-1">
                            <button
                              type="button"
                              onClick={() => showDriverRow(driver.id)}
                              aria-label={`${driver.name}, ${driver.carPlate}: ${lateness}, ${formatCurrency(owed)} owed. Show in the list`}
                              className="group flex-1 min-w-0 text-left flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-gray-100 bg-gray-50/55 hover:bg-orange-50/60 hover:border-orange-200 transition-colors text-xs"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                                <span className="min-w-0 leading-tight">
                                  <span title={driver.name} className="block truncate font-bold text-gray-800 group-hover:text-orange-950">{driver.name}</span>
                                  <span className="block font-mono text-gray-500">{driver.carPlate}</span>
                                </span>
                              </span>
                              <span className="shrink-0 flex flex-col items-end gap-0.5">
                                <span title={lateness} className="px-2 py-1 rounded-lg leading-none bg-orange-100/90 text-orange-950 font-mono font-extrabold">{days}d</span>
                                <span className="font-mono font-semibold text-gray-700 whitespace-nowrap">{formatCurrency(owed)}</span>
                              </span>
                            </button>
                            {driver.phone && (
                              <a
                                href={whatsappLink(driver.phone, `Hi ${driver.name}, this is ECA. Your rent for ${driver.carPlate} is ${lateness} and ${formatCurrency(owed)} is owed. Please pay as soon as possible.`)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`WhatsApp ${driver.name}`}
                                title={`WhatsApp ${driver.name} (${formatPhone(driver.phone)})`}
                                className="shrink-0 w-9 flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                              >
                                <MessageCircle className="w-4 h-4" aria-hidden="true" />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            {/* Driver list */}
            <section ref={driversSectionRef} aria-labelledby="drivers-heading" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-clip print:shadow-none print:border-none">
              <h2 id="drivers-heading" className="sr-only">Drivers</h2>
              {/* Controls stay in view while scrolling the list */}
              <div className="lg:sticky lg:top-0 lg:z-10 bg-white border-b border-gray-200 print:hidden">
                <div className="px-3 sm:px-4 py-3 flex flex-col lg:flex-row gap-3 lg:items-center">
                  <div role="group" aria-label="Which drivers" className="flex flex-wrap bg-gray-100 p-1 rounded-lg shrink-0">
                    {([['ACTIVE', 'Active', activeFleetCount], ['DELISTED', 'Delisted / Returned', delistedCount], ...(userRole === 'admin' ? [['TERMINATION', 'Termination review', terminationCount] as const] : [])] as const).map(([id, label, count]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={driverScope === id}
                        onClick={() => setDriverScope(id)}
                        className={`flex-1 lg:flex-none px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${driverScope === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                      >
                        {label} <span className="text-gray-500">{count}</span>
                      </button>
                    ))}
                  </div>

                  {driverScope !== 'TERMINATION' && <>
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                    <input
                      ref={searchInputRef}
                      type="search"
                      aria-label="Search drivers by name, car plate or NRIC"
                      placeholder="Search driver, car plate, NRIC..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm focus:outline-none placeholder-gray-400"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>

                  <div className="relative lg:w-52 shrink-0">
                    <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                    <select
                      aria-label="Staff group"
                      className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white appearance-none cursor-pointer font-medium text-gray-700"
                      value={selectedTagFilter}
                      onChange={(e) => setSelectedTagFilter(e.target.value)}
                    >
                      <option value="ALL">All Staff Groups</option>
                      {allTags.map(tag => (
                        <option key={tag} value={tag}>{tag}</option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                  </div>

                  {userRole === 'admin' && (
                    <div role="group" aria-label="List view" className="flex bg-gray-100 p-1 rounded-lg shrink-0">
                      <button type="button" aria-pressed={!showDetails} onClick={() => setListView('COLLECTIONS')} className={`flex-1 lg:flex-none px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${!showDetails ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Collections</button>
                      <button type="button" aria-pressed={showDetails} onClick={() => setListView('DETAILS')} className={`flex-1 lg:flex-none px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${showDetails ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Contact details</button>
                    </div>
                  )}
                  </>}
                </div>

                {filtersActive && driverScope !== 'TERMINATION' && (
                  <div className="px-3 sm:px-4 py-2 bg-blue-50 border-t border-blue-100 flex flex-wrap items-center gap-2 text-xs text-blue-900">
                    <span className="font-semibold">Showing {filteredDrivers.length} of {scopeDrivers.length}:</span>
                    {statusFilter !== 'ALL' && <span className="bg-white border border-blue-200 px-2 py-0.5 rounded-full font-bold">Risk: {statusFilter}</span>}
                    {selectedTagFilter !== 'ALL' && <span className="bg-white border border-blue-200 px-2 py-0.5 rounded-full font-bold">Staff: {selectedTagFilter}</span>}
                    {searchTerm !== '' && <span className="bg-white border border-blue-200 px-2 py-0.5 rounded-full font-bold">Search: “{searchTerm}”</span>}
                    <button type="button" onClick={resetFilters} className="ml-auto bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg">Reset filters</button>
                  </div>
                )}
              </div>

              {driverScope === 'TERMINATION' ? (
                /* Termination review (admins): drivers the 8-week evidence recommends ending, from its own snapshot */
                <div className="p-3 sm:p-6">
                  <ScreenLoadBoundary><React.Suspense fallback={<p className="p-6 text-sm text-gray-600">Loading the termination review…</p>}><TerminationReport /></React.Suspense></ScreenLoadBoundary>
                </div>
              ) : showDetails ? (
                /* Contact details (admins) */
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-500">
                      <tr>
                        <th className="px-6 py-3 group select-none">
                          <button type="button" className="flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-gray-800" onClick={() => cycleDetailsSort('NAME')}>
                            Full Name <span aria-hidden="true" className={driverListSortConfig.key === 'NAME' && driverListSortConfig.direction ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'}>{sortArrow('NAME')}</span>
                          </button>
                        </th>
                        <th className="px-6 py-3">Email Address</th>
                        <th className="px-6 py-3">Phone</th>
                        <th className="px-6 py-3">WhatsApp group</th>
                        <th className="px-6 py-3">Address</th>
                        <th className="px-6 py-3">NRIC</th>
                        <th className="px-6 py-3">Plate Number</th>
                        <th className="px-6 py-3 group select-none">
                          <button type="button" className="flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-gray-800" onClick={() => cycleDetailsSort('CATEGORY')}>
                            Category <span aria-hidden="true" className={driverListSortConfig.key === 'CATEGORY' && driverListSortConfig.direction ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'}>{sortArrow('CATEGORY')}</span>
                          </button>
                        </th>
                        <th className="px-6 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {detailsRows.map(driver => {
                        let isNew = false;
                        if (driver.contractStartDate) {
                          const start = new Date(driver.contractStartDate + 'T00:00:00');
                          const diffDays = Math.ceil(Math.abs(kualaLumpurNow().getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                          isNew = diffDays <= 30;
                        }
                        return (
                          <tr key={driver.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 font-bold text-gray-900">
                              <span className="flex items-center gap-2">
                                {driver.name}
                                {isNew && <span className="text-xs text-red-700 font-black tracking-widest border border-red-500/30 px-1.5 py-0.5 rounded-sm bg-red-50">NEW</span>}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-gray-600 truncate max-w-[150px]" title={driver.email || ''}>{driver.email || '-'}</td>
                            <td className="px-6 py-4 text-gray-600 whitespace-nowrap font-mono">{driver.phone ? formatPhone(driver.phone) : '-'}</td>
                            <td className="px-6 py-4 text-gray-600 whitespace-nowrap">{driver.whatsappGroup || '-'}</td>
                            <td className="px-6 py-4 text-gray-600 truncate max-w-[200px]" title={driver.address || ''}>{driver.address || '-'}</td>
                            <td className="px-6 py-4 text-gray-600">{driver.nric}</td>
                            <td className="px-6 py-4 text-gray-700 font-mono">{driver.carPlate}</td>
                            <td className="px-6 py-4 text-gray-600">
                              <span className={`px-2 py-1 rounded text-xs font-bold ${
                                driver.category === 'SEWABELI' ? 'bg-blue-100 text-blue-800' :
                                driver.category === 'SEWA_BIASA' ? 'bg-purple-100 text-purple-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {driver.category}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button type="button" onClick={() => handleOpenEditModal(driver)} className="text-xs text-blue-700 font-semibold hover:bg-blue-50 px-3 py-1.5 rounded transition-colors border border-blue-100 bg-white shadow-sm">
                                Edit Details
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {detailsRows.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-6 py-8 text-center text-gray-500">No drivers match these filters.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
                    {filteredDrivers.map(driver => {
                      // The row's figures are the driver's account facts, the same ones the driver's phone page reads
                      const m = driver.account;
                      const expanded = expandedDriverIds.includes(driver.id);
                      const cycleLabel = driver.rentalCycle === 'MONTHLY' ? 'Months' : 'Weeks';
                      // The latest payment and the row's warning: weekly rent 8+ days without a payment; monthly rent the late-alert
                      // rule (oldest unpaid rent 8+ days past its due date), so in the active list a monthly row is red exactly when it
                      // is a late alert (a delisted row still shows rent left unpaid)
                      const lastPaid = m.lastPayment;
                      const payWarning = m.payWarning;
                      const payWarningText = payWarning ? (payWarning.kind === 'overdue' ? `Rent ${payWarning.days} days overdue` : `${payWarning.days} days without payment`) : undefined;
                      const nextDueStr = formatDate(m.dueDate, 'N/A');
                      // Active drivers whose day tag disagrees with their rent day (or who have none)
                      const tagCheck = driver.isDelisted ? null : dayTagCheck(driver);
                      const currentOutstanding = driver.activeBalance.baseValue;
                      const baselineOutstanding = driver.recoveryBaseline;
                      let labelText = 'Restored';
                      let valueText = '';
                      let progressPercent = 0;
                      let barColorClass = 'bg-gray-300';
                      if (baselineOutstanding > 0) {
                        if (currentOutstanding < baselineOutstanding) {
                          const restoredAmount = baselineOutstanding - currentOutstanding;
                          progressPercent = (restoredAmount / baselineOutstanding) * 100;
                          labelText = 'Restored';
                          valueText = `${formatCurrency(restoredAmount)} / ${formatCurrency(baselineOutstanding)}`;
                          barColorClass = progressPercent > 75 ? 'bg-emerald-500' : progressPercent > 35 ? 'bg-teal-500' : 'bg-indigo-500';
                        } else if (currentOutstanding > baselineOutstanding) {
                          const addedDebt = currentOutstanding - baselineOutstanding;
                          progressPercent = (addedDebt / baselineOutstanding) * 105; // allow some visibility scale
                          labelText = 'Slipped';
                          valueText = `+${formatCurrency(addedDebt)} / ${formatCurrency(baselineOutstanding)}`;
                          barColorClass = 'bg-rose-500';
                        } else {
                          labelText = 'Restored';
                          valueText = `${formatCurrency(0)} / ${formatCurrency(baselineOutstanding)}`;
                          progressPercent = 0;
                          barColorClass = 'bg-gray-200';
                        }
                      } else if (currentOutstanding > 0) {
                        progressPercent = 100;
                        labelText = 'Slipped';
                        valueText = `+${formatCurrency(currentOutstanding)} / ${formatCurrency(driver.rentalRate)}`;
                        barColorClass = 'bg-rose-500';
                      }

                      return (
                        <li key={driver.id} id={`driver-row-${driver.id}`}>
                          <div className={`relative bg-white rounded-lg border border-slate-200 shadow-sm hover:border-slate-300 transition-colors ${highlight?.driverId === driver.id ? 'ring-2 ring-orange-500' : ''}`}>
                            <span aria-hidden="true" className={`absolute left-0 inset-y-0 w-1.5 rounded-l-lg ${m.status === 'GOOD' ? 'bg-emerald-500' : m.status === 'MID' ? 'bg-amber-500' : 'bg-rose-500'}`}></span>
                            <div className="grid gap-3 px-3 py-2.5 pl-4 lg:grid-cols-[minmax(0,1fr)_13rem_17rem_14.5rem] xl:grid-cols-[minmax(0,1fr)_14rem_18.5rem_14.5rem] lg:items-center lg:gap-0">
                              {/* Driver */}
                              <div className="flex items-start gap-2 min-w-0 lg:pr-4">
                                <button
                                  type="button"
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? 'Hide' : 'Show'} details for ${driver.name}`}
                                  onClick={() => toggleRowExpand(driver.id)}
                                  className="w-11 h-11 lg:w-8 lg:h-8 -ml-1 shrink-0 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                                >
                                  <ChevronRight className={`w-4 h-4 transform transition-transform duration-300 ${expanded ? 'rotate-90 text-blue-600' : ''}`} aria-hidden="true" />
                                </button>
                                <div className="min-w-0 flex-1 pt-1 lg:pt-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="font-bold text-slate-900 text-base truncate">{driver.name}</h3>
                                    {!screenedDriverIds.includes(driver.id) && !driver.isDelisted && (
                                      <button type="button" onClick={() => handleScreenDriver(driver.id)} className="relative flex h-6 w-6 -m-1.5 items-center justify-center cursor-pointer shrink-0" title="Not screened today (click to mark screened)" aria-label={`Mark ${driver.name} as screened today`}>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600 border border-white hover:bg-rose-700 shadow-sm"></span>
                                      </button>
                                    )}
                                    {screenedDriverIds.includes(driver.id) && !driver.isDelisted && (
                                      <span title="Screened today" role="img" aria-label="Screened today" className="inline-flex"><CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" /></span>
                                    )}
                                    {driver.debtTrend.isStreak && (
                                      <span title="Outstanding has gone up three weeks in a row" className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">Debt up 3 weeks</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-1 text-xs flex-wrap">
                                    <span className="font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{driver.carPlate}</span>
                                    <span className="flex items-center gap-1 font-bold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100"><Calendar className="w-3 h-3" aria-hidden="true" /> Due {nextDueStr}</span>
                                    {driver.category && <span className={`font-bold px-1.5 py-0.5 uppercase tracking-wider rounded border ${driver.category === 'SEWABELI' ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-orange-50 text-orange-800 border-orange-200'}`}>{driver.category === 'SEWABELI' ? 'Sewabeli' : 'Sewa Biasa'}</span>}
                                    {driver.tags?.map((tag, i) => <span key={i} className="bg-slate-50 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-medium">{tag}</span>)}
                                    {driver.collectionArrangement && (
                                      <span title={collectionSummary(driver) ?? undefined} className="max-w-[16rem] truncate font-semibold px-1.5 py-0.5 rounded border bg-teal-50 text-teal-900 border-teal-200">{driver.collectionArrangement}</span>
                                    )}
                                    {collectionChips.get(driver.id)?.promise && (
                                      <span className={`font-bold px-1.5 py-0.5 rounded border ${collectionChips.get(driver.id)!.promise!.missed ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-blue-50 text-blue-800 border-blue-200'}`}>{collectionChips.get(driver.id)!.promise!.text}</span>
                                    )}
                                    {collectionChips.get(driver.id)?.plan && (
                                      <span className={`font-bold px-1.5 py-0.5 rounded border ${PLAN_CHIP[collectionChips.get(driver.id)!.plan!.state]}`}>{collectionChips.get(driver.id)!.plan!.text}</span>
                                    )}
                                    {tagCheck && !tagCheck.ok && (
                                      <span title={`Rent falls due ${tagCheck.expected === 'MONTHLY' ? 'monthly' : `every ${tagCheck.expected}`}, so the day tag should be ${tagCheck.expected}. Fix it with Edit.`} className="flex items-center gap-1 font-bold text-amber-900 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded">
                                        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                                        {tagCheck.tagged.length ? `Tag ${tagCheck.tagged.join('/')}` : 'No day tag'} · rent {tagCheck.expected === 'MONTHLY' ? 'monthly' : tagCheck.expected}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Risk status and payment timing */}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs lg:flex-col lg:justify-center lg:gap-1 lg:border-l lg:border-slate-100 lg:px-3 lg:text-center">
                                <span className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${m.status === 'GOOD' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : m.status === 'MID' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>{m.status}</span>
                                  <span className="font-bold text-slate-600">{m.cyclesOwed > 0 ? `${m.cyclesOwed.toFixed(1)} ${cycleLabel} Owed` : 'Up to date'}</span>
                                </span>
                                <span title={payWarningText} className={`flex items-center gap-1 ${payWarning ? 'font-semibold text-rose-700' : lastPaid ? 'font-semibold text-slate-500' : 'text-slate-500'}`}>
                                  {payWarning && <AlertTriangle className="w-3 h-3" aria-hidden="true" />}
                                  {lastPaid ? `Last pay: ${formatDate(lastPaid.date)}` : 'No payment yet'}
                                  {/* A recent payment can still be red on monthly rent, so the reason is shown, not only on hover */}
                                  {payWarning?.kind === 'overdue' && <span aria-hidden="true" className="whitespace-nowrap">· {payWarning.days}d overdue</span>}
                                  {payWarningText && <span className="sr-only"> ({payWarningText})</span>}
                                </span>
                              </div>

                              {/* Outstanding */}
                              <div className="flex flex-col gap-1 lg:items-end lg:border-l lg:border-slate-100 lg:px-4">
                                <div className="flex flex-wrap items-baseline justify-between gap-x-3 lg:justify-end lg:gap-x-2">
                                  <span className="font-bold text-lg">
                                    {currentOutstanding > 0 ? <span className="text-rose-700">{formatCurrency(currentOutstanding)}</span> : <span className="text-emerald-700">PAID</span>}
                                  </span>
                                  {driver.debtTrend.direction !== 'FLAT' && (
                                    <span title="Change in outstanding over the last 7 days" className={`text-xs font-bold flex items-center gap-1 ${driver.debtTrend.direction === 'UP' ? 'text-rose-700' : 'text-emerald-700'}`}>
                                      {driver.debtTrend.direction === 'UP' ? <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" /> : <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />}
                                      {driver.debtTrend.direction === 'UP' ? '+' : '−'}{formatCurrency(driver.debtTrend.value)} in 7 days
                                    </span>
                                  )}
                                </div>
                                {(currentOutstanding > 0 || baselineOutstanding > 0) && (
                                  <div className="w-full text-left">
                                    <div className="flex flex-wrap justify-between items-center gap-x-2 text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                                      <span>{labelText} since {recoverySinceLabel}</span>
                                      <span className="font-mono normal-case tracking-normal">{valueText}</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div className={`h-full ${barColorClass} transition-all duration-500`} style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}></div>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-2 lg:justify-center lg:border-l lg:border-slate-100 lg:pl-3">
                                <button type="button" onClick={() => handleOpenPaymentModal(driver)} aria-label={`Record payment for ${driver.name}`} className="flex-1 lg:flex-none min-h-11 lg:min-h-0 px-3 lg:px-2.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1 transition-colors">
                                  <span className="font-bold text-xs">RM</span> Payment
                                </button>
                                <button type="button" onClick={() => setStatementDriver(driver)} aria-label={`WhatsApp statement for ${driver.name}`} title="WhatsApp statement" className="shrink-0 w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center text-emerald-800 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"><MessageSquareText className="w-5 h-5 shrink-0" aria-hidden="true" /></button>
                                <button type="button" onClick={() => handleOpenEditModal(driver)} aria-label={`Edit ${driver.name}`} title="Edit driver" className="shrink-0 w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"><Pencil className="w-5 h-5 shrink-0" aria-hidden="true" /></button>
                                {driverScope === 'ACTIVE'
                                  ? <button type="button" onClick={() => handleDelistClick(driver)} aria-label={`Delist ${driver.name}`} title="Delist driver" className="shrink-0 w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"><UserMinus className="w-5 h-5 shrink-0" aria-hidden="true" /></button>
                                  : userRole === 'admin' && <button type="button" onClick={() => setDriverToDelete(driver)} aria-label={`Delete ${driver.name}`} title="Delete driver" className="shrink-0 w-11 h-11 lg:w-10 lg:h-10 flex items-center justify-center text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"><Trash2 className="w-5 h-5 shrink-0" aria-hidden="true" /></button>}
                              </div>
                            </div>
                          </div>
                          {expanded && (
                            <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-2 sm:p-4">
                              <ExpandedDriverDetails driver={driver} isAdmin={userRole === 'admin'} onLogPaymentClick={() => handleOpenPaymentModal(driver)} onContraPayment={(amount, date) => onUpdatePayment(driver.id, amount, date, 0, 'DEPOSIT CONTRA', 'Deposit contra')} onEditDriver={() => handleOpenEditModal(driver)} />
                              {!driver.isDelisted && <CollectionsPanels driver={driver} extras={extras} isAdmin={userRole === 'admin'} today={todayStr} now={kualaLumpurNow()} />}
                            </div>
                          )}
                        </li>
                      );
                    })}
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
                <FleetView today={todayStr} isAdmin={userRole === 'admin'} onCarsChange={setFleetCars} />
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
                    await onEditPayment(paymentId, tx.amount, tx.serviceClaim || 0, tx.date, 'CASH', tx.reference ?? '');
                  }}
                />
              </React.Suspense>
            </ScreenLoadBoundary>
          </div>
        )}
      </main>

      {/* Driver form */}
      {isDriverModalOpen && (
        <Dialog title={editingId ? 'Edit Driver Profile' : 'Add Driver Profile'} onClose={() => setIsDriverModalOpen(false)}>
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
              <button type="button" onClick={() => setIsDriverModalOpen(false)} className="px-5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button type="submit" className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">{editingId ? "Save Changes" : "Create Driver"}</button>
            </div>
          </form>
        </Dialog>
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
