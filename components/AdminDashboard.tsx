
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Driver, DriverMetrics, DriverStatus } from '../types';
import { buildLateAlerts, calculateDriverMetrics, contractCyclesBetween, formatCurrency, formatDate, formatNric, generateDriverInvoices, getNextDueDate, kualaLumpurNow, kualaLumpurToday, lastPayment, parseDate, rentDueAndPaid } from '../utils';
const AnalyticsView = React.lazy(() => import('./AnalyticsView'));
const BankReconciliation = React.lazy(() => import('./BankReconciliation'));
const FinanceView = React.lazy(() => import('./finance/FinanceView'));
import {
  LogOut,
  TrendingUp,
  Search,
  DollarSign,
  X,
  UserPlus,
  Pencil,
  CalendarCheck,
  History,
  UserMinus,
  Trash2,
  Calendar,
  PieChart,
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
} from 'lucide-react';
import { ExpandedDriverDetails } from './ExpandedDriverDetails';
import Dialog, { ConfirmDialog } from './Dialog';
import { InvoiceRow, PaymentAmount, PaymentMethodBadge } from './RentDisplay';

interface AdminDashboardProps {
  drivers: Driver[];
  userRole: 'admin' | 'staff'; // Role passed from parent
  onUpdatePayment: (driverId: string, amount: number, date: string, serviceClaim?: number, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM') => void;
  onEditPayment?: (paymentId: string, amount: number, serviceClaim: number, date: string, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM') => void;
  onCreateDriver: (driver: Driver) => Promise<void>;
  onUpdateDriver: (driver: Driver) => Promise<void>;
  onDelistDriver: (driverId: string) => void;
  onDeleteDriver: (driverId: string) => void;
  onLogout: () => void;
  onRefresh: () => Promise<void>;
}

// Fixed baseline for the "Restored / Slipped" recovery bar on each driver row.
const RECOVERY_BASELINE_DATE = new Date('2026-05-27T00:00:00Z');

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

type Section = 'DRIVERS' | 'ANALYTICS' | 'RECONCILE' | 'FINANCE';

/** Saved tab values, including the ones used before the Drivers section existed. */
const SECTION_FROM_STORED: Record<string, Section> = {
  DRIVERS: 'DRIVERS',
  ACTIVE: 'DRIVERS',
  DELISTED: 'DRIVERS',
  DRIVER_LIST: 'DRIVERS',
  ANALYTICS: 'ANALYTICS',
  RECONCILE: 'RECONCILE',
  FINANCE: 'FINANCE',
};
const sectionFromStored = (stored: string | null): Section | null =>
  stored !== null && Object.hasOwn(SECTION_FROM_STORED, stored) ? SECTION_FROM_STORED[stored] : null;

const SECTIONS: { id: Section; label: string; Icon: typeof Users }[] = [
  { id: 'DRIVERS', label: 'Drivers', Icon: Users },
  { id: 'ANALYTICS', label: 'Analytics', Icon: PieChart },
  { id: 'RECONCILE', label: 'Bank Recon', Icon: CheckCircle2 },
  { id: 'FINANCE', label: 'Finance', Icon: DollarSign },
];

/** The fleet overview's risk tiles; each one filters the driver list. */
const RISK_TILES: { status: 'GOOD' | 'MID' | 'BAD'; label: string; figure: string; pressedLook: string }[] = [
  { status: 'GOOD', label: 'Good status', figure: 'text-emerald-600', pressedLook: 'ring-emerald-500 bg-emerald-50/40' },
  { status: 'MID', label: 'Mid status', figure: 'text-amber-600', pressedLook: 'ring-amber-500 bg-amber-50/40' },
  { status: 'BAD', label: 'Bad status', figure: 'text-rose-600', pressedLook: 'ring-rose-500 bg-rose-50/40' },
];

const TARGET_LOOK = {
  week: { glow: 'bg-blue-500/5', amount: 'text-blue-950', bar: 'from-blue-500 to-indigo-600' },
  month: { glow: 'bg-indigo-500/5', amount: 'text-indigo-950', bar: 'from-indigo-500 to-purple-600' },
};

/** Rent falling due in a period (the target) and how much of it has been paid (collected). */
function TargetCard({ title, period, icon, look, totals }: { title: string; period: string; icon: React.ReactNode; look: keyof typeof TARGET_LOOK; totals: { due: number; paid: number } }) {
  const { glow, amount, bar } = TARGET_LOOK[look];
  const share = totals.due > 0 ? Math.min(100, (totals.paid / totals.due) * 100) : 0;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/75 backdrop-blur-md shadow-lg p-4 sm:p-6 flex flex-col justify-between min-h-[175px]">
      <div aria-hidden="true" className={`absolute top-0 right-0 w-36 h-36 rounded-full blur-2xl pointer-events-none ${glow}`} />
      <div>
        <h2 className="flex items-center gap-2 font-bold tracking-tight text-gray-950">{icon}{title}</h2>
        <p className="mt-1 text-xs font-medium uppercase tracking-wider text-gray-500">{period}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Collected</span>
          <div className={`mt-1 text-3xl font-black tracking-tight font-mono ${amount}`}>{formatCurrency(totals.paid)}</div>
        </div>
        <div className="text-right font-mono">
          <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Target</span>
          <span className="text-base font-extrabold text-gray-500">/ {formatCurrency(totals.due)}</span>
        </div>
      </div>
      <div aria-hidden="true" className="w-full h-3.5 mt-4 p-0.5 bg-gray-200/60 rounded-full border border-white/40 shadow-inner overflow-hidden">
        <div className={`h-2.5 rounded-full bg-gradient-to-r transition-all duration-1000 ${bar}`} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

/** Smooth scrolling, unless the viewer prefers reduced motion. */
const scrollBehavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

type ListSort = { key: 'RISK_STATUS' | 'OUTSTANDING' | 'DEFAULT'; direction: 'asc' | 'desc' };
const DEFAULT_LIST_SORT: ListSort = { key: 'DEFAULT', direction: 'desc' };
const STATUS_PRIORITY = { [DriverStatus.BAD]: 3, [DriverStatus.MID]: 2, [DriverStatus.GOOD]: 1 };

/** The driver list's order: by risk, by outstanding, or by default (worsening payers first, then risk and cycles owed). */
function compareForList(
  a: { metrics: DriverMetrics; activeBalance: { baseValue: number }; velocityData: { isSlipping: boolean; velocity: number } },
  b: { metrics: DriverMetrics; activeBalance: { baseValue: number }; velocityData: { isSlipping: boolean; velocity: number } },
  sort: ListSort,
): number {
  if (sort.key === 'RISK_STATUS') {
    const diff = STATUS_PRIORITY[b.metrics.status] - STATUS_PRIORITY[a.metrics.status];
    if (diff !== 0) return sort.direction === 'desc' ? diff : -diff;
    return b.metrics.cyclesOwed - a.metrics.cyclesOwed;
  }
  if (sort.key === 'OUTSTANDING') {
    const diff = b.activeBalance.baseValue - a.activeBalance.baseValue;
    if (diff !== 0) return sort.direction === 'desc' ? diff : -diff;
    return b.metrics.cyclesOwed - a.metrics.cyclesOwed;
  }
  // Default: worsening payers first, then by how much worse, then risk, then cycles owed
  if (a.velocityData.isSlipping && !b.velocityData.isSlipping) return -1;
  if (!a.velocityData.isSlipping && b.velocityData.isSlipping) return 1;
  if (b.velocityData.velocity !== a.velocityData.velocity) return b.velocityData.velocity - a.velocityData.velocity;
  if (STATUS_PRIORITY[a.metrics.status] !== STATUS_PRIORITY[b.metrics.status]) return STATUS_PRIORITY[b.metrics.status] - STATUS_PRIORITY[a.metrics.status];
  return b.metrics.cyclesOwed - a.metrics.cyclesOwed;
}

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
  onRefresh
}) => {
  // Search, tab and filters are remembered in this browser between visits.
  const [searchTerm, setSearchTerm] = usePersistedState<string>('eca_admin_search_term', '');
  // The tab saved before the Drivers section (ACTIVE, DELISTED, DRIVER_LIST, ...) is read once to carry it over and
  // never written again, so an older version of the app still finds a value it understands.
  const [legacyView] = useState<string | null>(() => {
    try { return localStorage.getItem('eca_admin_view_mode'); } catch { return null; }
  });
  const [section, setSection] = usePersistedState<Section>('eca_admin_section', sectionFromStored(legacyView) ?? 'DRIVERS', sectionFromStored);
  const [driverScope, setDriverScope] = usePersistedState<'ACTIVE' | 'DELISTED'>('eca_admin_driver_scope', legacyView === 'DELISTED' ? 'DELISTED' : 'ACTIVE', stored => stored === 'ACTIVE' || stored === 'DELISTED' ? stored : null);
  const [listView, setListView] = usePersistedState<'COLLECTIONS' | 'DETAILS'>('eca_admin_driver_list_view', legacyView === 'DRIVER_LIST' ? 'DETAILS' : 'COLLECTIONS', stored => stored === 'COLLECTIONS' || stored === 'DETAILS' ? stored : null);
  // Staff see the Drivers section only, and contact details are for admins
  const activeSection: Section = userRole === 'admin' ? section : 'DRIVERS';
  const showDetails = userRole === 'admin' && listView === 'DETAILS';
  const [statusFilter, setStatusFilter] = usePersistedState<'ALL' | 'GOOD' | 'MID' | 'BAD'>('eca_admin_status_filter', 'ALL');
  const [selectedTagFilter, setSelectedTagFilter] = usePersistedState<string>('eca_admin_selected_tag_filter', 'ALL');

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
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  // Confirmation Modal State
  const [driverToDelist, setDriverToDelist] = useState<Driver | null>(null);
  const [driverToDelete, setDriverToDelete] = useState<Driver | null>(null);

  // Messages shown inside the forms when an entry needs fixing
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [editTxError, setEditTxError] = useState<string | null>(null);
  const [driverFormError, setDriverFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedDriverForPayment, setSelectedDriverForPayment] = useState<Driver | null>(null);

  // Past Payment Edit State
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');
  const [editServiceClaim, setEditServiceClaim] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<'BANK TRANSFER' | 'CASH DEPOSIT' | null>(null);

  const liveDriverForPayment = selectedDriverForPayment ? (drivers.find(d => d.id === selectedDriverForPayment.id) || selectedDriverForPayment) : null;

  useEffect(() => {
    if (isPaymentModalOpen && liveDriverForPayment) {
      setTimeout(() => {
        // Scroll only the schedule list, so the payment form (first on phones) stays in view
        const anchor = document.getElementById('current-payment-anchor');
        const list = anchor?.parentElement;
        if (anchor && list) {
          const offset = anchor.getBoundingClientRect().top - list.getBoundingClientRect().top;
          list.scrollTo({ top: list.scrollTop + offset - (list.clientHeight - anchor.clientHeight) / 2, behavior: 'smooth' });
        }
      }, 150);
    }
  }, [isPaymentModalOpen, liveDriverForPayment?.id]);

  // New Driver Form State
  const initialFormState = {
    name: '',
    email: '',
    address: '',
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
  const [tagInput, setTagInput] = useState('');
  
  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState('');
  const [serviceClaimAmount, setServiceClaimAmount] = useState('0');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM' | null>(null);

  // --- Red Dot Notification & Screening States (Kuala Lumpur Timezone sensitive) ---
  const [screenedDriverIds, setScreenedDriverIds] = useState<string[]>([]);
  const [screeningDate, setScreeningDate] = useState<string>('');

  // Load screened status today
  useEffect(() => {
    const todayStr = kualaLumpurToday();
    setScreeningDate(todayStr);
    
    try {
      const stored = localStorage.getItem('eca_rental_screening_status');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.date === todayStr && Array.isArray(parsed.screenedIds)) {
          setScreenedDriverIds(parsed.screenedIds);
        } else {
          localStorage.setItem('eca_rental_screening_status', JSON.stringify({ date: todayStr, screenedIds: [] }));
          setScreenedDriverIds([]);
        }
      } else {
        localStorage.setItem('eca_rental_screening_status', JSON.stringify({ date: todayStr, screenedIds: [] }));
        setScreenedDriverIds([]);
      }
    } catch (e) {
      console.error("Error reading screening status from localStorage:", e);
    }
  }, []);

  // Periodic timezone date change checking & refresh
  useEffect(() => {
    const interval = setInterval(() => {
      const todayStr = kualaLumpurToday();
      if (screeningDate && todayStr !== screeningDate) {
        setScreeningDate(todayStr);
        setScreenedDriverIds([]);
        try {
          localStorage.setItem('eca_rental_screening_status', JSON.stringify({ date: todayStr, screenedIds: [] }));
        } catch (e) {
          console.error("Error writing reset state to localStorage:", e);
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [screeningDate]);

  const handleScreenDriver = (driverId: string) => {
    const todayStr = kualaLumpurToday();
    setScreenedDriverIds(prev => {
      if (prev.includes(driverId)) return prev;
      const next = [...prev, driverId];
      try {
        localStorage.setItem('eca_rental_screening_status', JSON.stringify({ date: todayStr, screenedIds: next }));
      } catch (e) {
        console.error("Error writing screening status to localStorage:", e);
      }
      return next;
    });
  };


  // --- Auto-Calculate Duration when Dates Change ---
  useEffect(() => {
    const cycles = contractCyclesBetween(formData.contractStartDate, formData.contractEndDate, formData.rentalCycle);
    if (cycles !== null) setFormData(prev => ({ ...prev, contractDuration: cycles }));
  }, [formData.contractStartDate, formData.contractEndDate, formData.rentalCycle]);


  // Enhance drivers with metrics for sorting
  const driverData = useMemo(() => drivers.map(d => {
    // Basic financial metrics
    const metrics = calculateDriverMetrics(d);
    const activeBalance = { baseValue: metrics.principalOutstanding, accruedInterest: metrics.penaltyAmount };
    const recoveryBaseline = calculateDriverMetrics(d, RECOVERY_BASELINE_DATE).principalOutstanding;

    
    // Performance Velocity from SQL View
    const velocity = d.performanceVelocity || 0;
    
    // Velocity Logic (Immediate Capture)
    const isSlipping = velocity > 3;
    const isRecovering = velocity < -2;

    // --- DEBT TREND INDICATOR (VIRTUAL SNAPSHOT LOGIC) ---
    // Role: Senior Database Engineer
    // Action: Simulating a "Snapshot Table" by calculating historical state on-the-fly.
    // This ensures immediate trend availability without waiting for a cron job.

    // 1. Current Snapshot (Base Only)
    const currentDebt = metrics.principalOutstanding;

    // 2. Historical Snapshot (7 Days Ago)
    // Script: Scan unpaid invoices from 7 days ago
    const sevenDaysAgo = kualaLumpurNow();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(23, 59, 59, 999); // End of day to capture full day's state
    
    const lastWeekMetrics = calculateDriverMetrics(d, sevenDaysAgo);
    // Calculation Sync: Ensure snapshot only includes Base Principal
    const lastWeekDebt = lastWeekMetrics.principalOutstanding;

    // 3. Trend Calculation
    const trendValue = currentDebt - lastWeekDebt;
    const isDebtIncreasing = trendValue > 0;
    const isDebtDecreasing = trendValue < 0;

    // 4. Debt Streak Calculation (3-Week Increase)
    const fourteenDaysAgo = kualaLumpurNow();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const metrics14 = calculateDriverMetrics(d, fourteenDaysAgo);
    const debt14 = metrics14.principalOutstanding;

    const twentyOneDaysAgo = kualaLumpurNow();
    twentyOneDaysAgo.setDate(twentyOneDaysAgo.getDate() - 21);
    const metrics21 = calculateDriverMetrics(d, twentyOneDaysAgo);
    const debt21 = metrics21.principalOutstanding;

    // Logic: Debt must be strictly increasing week-over-week
    const inc1 = currentDebt > lastWeekDebt;
    const inc2 = lastWeekDebt > debt14;
    const inc3 = debt14 > debt21;
    
    // Trigger warning if debt has increased for 3 consecutive weeks AND current debt is significant (> 0)
    const isDebtStreak = inc1 && inc2 && inc3 && currentDebt > 0;

    return {
        ...d,
        metrics,
        activeBalance, // Exposed for UI
        recoveryBaseline,
        velocityData: {
            velocity,
            isSlipping,
            isRecovering,
            avgLateness: d.avgDaysLate || 0,
            lastLateness: d.lastDaysLate || 0
        },
        debtTrend: {
            value: Math.abs(trendValue),
            direction: isDebtIncreasing ? 'UP' : isDebtDecreasing ? 'DOWN' : 'FLAT',
            raw: trendValue,
            isStreak: isDebtStreak
        }
    };
  }), [drivers]);

  // Extract all unique tags for filter dropdown
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    driverData.forEach(d => d.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [driverData]);

  // --- Rent targets and late alerts ---
  // Re-read when the screening day rolls over at Kuala Lumpur midnight.
  const todayStr = useMemo(() => kualaLumpurToday(), [screeningDate]);
  const todayNormalized = useMemo(() => parseDate(todayStr), [todayStr]);

  const startOfWeek = useMemo(() => {
    const d = new Date(todayNormalized);
    const diff = d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1); // target Monday
    d.setDate(diff);
    return d;
  }, [todayNormalized]);

  const endOfWeek = useMemo(() => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + 6);
    return d;
  }, [startOfWeek]);

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

  // Analytics and Bank Recon receive all drivers in the list's default order (Bank Recon's matching keeps the first
  // of equally good candidates, so the order is part of its behaviour).
  const driversInDefaultOrder = useMemo(() => [...driverData].sort((a, b) => compareForList(a, b, DEFAULT_LIST_SORT)), [driverData]);

  // Drivers in the chosen scope, before the other filters
  const scopeDrivers = useMemo(() => driverData.filter(d => driverScope === 'DELISTED' ? d.isDelisted : !d.isDelisted), [driverData, driverScope]);

  // Filter by risk, search and staff group, then sort
  const filteredDrivers = useMemo(() => {
    let result = scopeDrivers;

    if (statusFilter !== 'ALL') {
      result = result.filter(d => d.metrics.status === statusFilter);
    }

    // 2. Search
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(d => 
        d.name.toLowerCase().includes(lower) || 
        d.carPlate.toLowerCase().includes(lower) ||
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

  const handleOpenPaymentModal = (driver: Driver) => {
    handleScreenDriver(driver.id);
    setSelectedDriverForPayment(driver);
    setPaymentAmount(driver.rentalRate.toString());
    setPaymentDate(kualaLumpurToday());
    setPaymentMethod(null); // start empty
    setPaymentError(null);
    setIsPaymentModalOpen(true);
  };

  const closePaymentModal = () => {
    setIsPaymentModalOpen(false);
    setPaymentError(null);
    setEditingTxId(null);
    setEditTxError(null);
  };

  const handleDelistClick = (driver: Driver) => { setDriverToDelist(driver); };
  const confirmDelist = () => { if (driverToDelist) { onDelistDriver(driverToDelist.id); setDriverToDelist(null); } };
  const confirmDelete = () => { if (driverToDelete) { onDeleteDriver(driverToDelete.id); setDriverToDelete(null); } };
  
  const handleSubmitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriverForPayment) return;
    const amount = parseFloat(paymentAmount) || 0;
    const serviceClaim = parseFloat(serviceClaimAmount) || 0;
    if (isNaN(amount) || amount < 0) { setPaymentError('Enter an amount of RM 0 or more.'); return; }
    if (!paymentDate) { setPaymentError('Choose the payment date.'); return; }
    
    let finalMethod = paymentMethod;
    if (!finalMethod) {
        if (amount === 0 && serviceClaim > 0) {
            finalMethod = 'CLAIM';
        } else {
            setPaymentError('Choose Bank Transfer or Cash Deposit.'); return;
        }
    }
    
    setPaymentError(null);
    onUpdatePayment(selectedDriverForPayment.id, amount, paymentDate, serviceClaim, finalMethod);
    setIsPaymentModalOpen(false); setSelectedDriverForPayment(null); setPaymentAmount(''); setServiceClaimAmount('0'); setPaymentDate(''); setPaymentMethod(null);
  };

  const handleStartEditTx = (tx: any) => {
    setEditTxError(null);
    setEditingTxId(tx.id);
    setEditAmount(tx.amount.toString());
    setEditServiceClaim((tx.serviceClaim || 0).toString());
    setEditDate(tx.date);
    setEditPaymentMethod(tx.paymentMethod || 'BANK TRANSFER');
  };

  const handleCancelEditTx = () => {
    setEditingTxId(null);
    setEditAmount('');
    setEditServiceClaim('');
    setEditDate('');
    setEditPaymentMethod(null);
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
      onEditPayment(txId, amountNum, serviceClaimNum, editDate, editPaymentMethod || 'BANK TRANSFER');
    }
    setEditingTxId(null);
    setEditPaymentMethod(null);
  };

  const handleOpenCreateModal = () => { setEditingId(null); setFormData(initialFormState); setTagInput(''); setDriverFormError(null); setIsDriverModalOpen(true); };
  
  const handleOpenEditModal = (driver: Driver) => {
    handleScreenDriver(driver.id);
    setEditingId(driver.id);
    setFormData({
      name: driver.name,
      email: driver.email || '',
      address: driver.address || '',
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
    
    // AUTOMATED LOGIC: Sync Duration if End Date is set
    const finalDuration = contractCyclesBetween(formData.contractStartDate, formData.contractEndDate, formData.rentalCycle) ?? formData.contractDuration;

    const submissionData = { ...formData, contractDuration: finalDuration };

    try {
      if (editingId) {
        const originalDriver = drivers.find(d => d.id === editingId);
        if (!originalDriver) return;
        await onUpdateDriver({ ...originalDriver, ...submissionData });
      } else {
        if (drivers.some(d => d.nric === formData.nric)) { setDriverFormError('A driver with this NRIC already exists.'); return; }
        await onCreateDriver({ id: Date.now().toString(), ...submissionData, totalAmountPaid: 0, paymentHistory: [] });
      }
      // Immediate Refresh on Update
      await onRefresh();
      setDriverFormError(null);
      setIsDriverModalOpen(false); setFormData(initialFormState);
    } catch (e) {
      // Error handled by parent, keep modal open
    }
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

          {userRole === 'admin' && (
            <nav aria-label="Sections" className="order-last basis-full md:order-none md:basis-auto flex gap-1 overflow-x-auto">
              {SECTIONS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-current={activeSection === id ? 'page' : undefined}
                  onClick={() => setSection(id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeSection === id ? 'bg-white/15 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'}`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" /> {label}
                </button>
              ))}
            </nav>
          )}

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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3 print:p-0 print:m-0 print:w-full print:max-w-none">
        {activeSection === 'DRIVERS' ? (
          <>
            {/* Fleet overview, late alerts and this week's / month's rent (active fleet) */}
            <section aria-label="Fleet overview" className="space-y-4 print:hidden">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Fleet health: risk tiles, fleet size and today's screening */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-md p-4 sm:p-6 space-y-5">
                  <h2 className="flex items-center gap-2.5 text-xl font-bold text-gray-900 tracking-tight">
                    <Activity className="w-6 h-6 text-blue-600 shrink-0" aria-hidden="true" />
                    Fleet Overview & Health Status
                  </h2>

                  <div className="grid grid-cols-3 gap-2 sm:gap-4">
                    {RISK_TILES.map(({ status, label, figure, pressedLook }) => {
                      const pressed = statusFilter === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          aria-pressed={pressed}
                          onClick={() => chooseRisk(status)}
                          className={`rounded-xl p-3 sm:p-5 border text-center flex flex-col items-center justify-between transition-all duration-300 hover:shadow-md ${pressed ? `ring-2 border-transparent ${pressedLook}` : 'bg-gray-50/40 border-gray-200/60'}`}
                        >
                          <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500">{label}</span>
                          <span className={`mt-2 text-3xl sm:text-5xl font-black ${figure}`}>{activeFleetCount ? Math.round((riskCounts[status] / activeFleetCount) * 100) : 0}%</span>
                          <span className="text-sm font-bold text-gray-500 sm:mb-2">{riskCounts[status]} drivers</span>
                          <span className="hidden sm:block mt-3 text-xs font-bold uppercase tracking-wider text-gray-500">{pressed ? 'Click to clear' : 'Click to filter'}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Total active fleet: jumps to the driver search */}
                    <button type="button" onClick={searchActiveFleet} className="w-full text-left bg-gray-50/60 rounded-xl p-5 border border-gray-200/60 flex items-center justify-between gap-3 shadow-sm hover:bg-gray-100/80 transition-colors">
                      <span className="flex items-center gap-3">
                        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                        <span className="text-xs font-extrabold uppercase tracking-wider text-gray-700">Total active fleet</span>
                      </span>
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black text-gray-900">{activeFleetCount}</span>
                        <span className="text-xs font-semibold text-gray-500">vehicles total</span>
                      </span>
                    </button>

                    {/* Daily screening progress (resets at midnight, Malaysia time) */}
                    <div className="bg-white rounded-xl p-5 border border-black shadow-sm space-y-3.5">
                      <div className="flex justify-between items-center gap-3">
                        <span className="flex items-center gap-2">
                          <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-[#E11D48] shrink-0" />
                          <span className="text-xs font-extrabold uppercase tracking-wider text-[#991B1B]">Daily screening progress</span>
                        </span>
                        <span className="text-sm font-mono font-black text-gray-950">{screenedCount} / {activeFleetCount}</span>
                      </div>
                      <div aria-hidden="true" className="w-full h-3 p-0.5 bg-gray-100 rounded-full border border-gray-200/40 shadow-inner overflow-hidden">
                        <div className="h-full bg-[#E11D48] rounded-full transition-all duration-700" style={{ width: `${activeFleetCount > 0 ? Math.min(100, (screenedCount / activeFleetCount) * 100) : 0}%` }} />
                      </div>
                      <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 text-xs font-bold uppercase">
                        <span className="text-gray-500">KL GMT+8 (resets at 00:00:00)</span>
                        <span className="text-[#E11D48]">{Math.max(0, activeFleetCount - screenedCount)} pending manual screening</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Late alerts: weekly drivers 8+ days without a payment, monthly drivers 8+ days overdue */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-md p-4 sm:p-6 flex flex-col max-h-[440px] overflow-hidden">
                  <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-200">
                    <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
                      <Clock className="w-5 h-5 text-amber-500 shrink-0" aria-hidden="true" />
                      Late Alerts (8d+)
                    </h2>
                    <span className="whitespace-nowrap bg-red-50 text-red-700 text-xs font-black px-2.5 py-1 rounded-full uppercase border border-red-200 tracking-wider">{lateAlerts.length} drivers</span>
                  </div>
                  {lateAlerts.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-gray-50/25 rounded-xl border border-dashed border-gray-200">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" aria-hidden="true" />
                      <p className="text-xs font-bold text-gray-500">All accounts are safe and active.</p>
                    </div>
                  ) : (
                    <ul className="flex-1 min-h-0 max-h-[310px] overflow-y-auto space-y-2.5 pr-2">
                      {lateAlerts.map(({ driver, days }) => {
                        const lateness = `${days} days ${driver.rentalCycle === 'MONTHLY' ? 'overdue' : 'without payment'}`;
                        return (
                          <li key={driver.id}>
                            <button
                              type="button"
                              onClick={() => showDriverRow(driver.id)}
                              aria-label={`${driver.name}, ${driver.carPlate}: ${lateness}. Show in the list`}
                              className="group w-full text-left flex items-center justify-between gap-2 p-3 rounded-xl border border-gray-100 bg-gray-50/55 hover:bg-orange-50/60 hover:border-orange-200 transition-colors text-xs"
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                                <span className="min-w-0 leading-tight">
                                  <span className="block truncate font-bold text-gray-800 group-hover:text-orange-950">{driver.name}</span>
                                  <span className="block mt-0.5 font-mono text-gray-500">{driver.carPlate}</span>
                                </span>
                              </span>
                              <span title={lateness} className="shrink-0 px-2 py-1 rounded-lg leading-none bg-orange-100/90 text-orange-950 font-mono font-extrabold">{days}d</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* This week's and this month's rent, and how much of it has been paid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TargetCard
                  title="Weekly Target"
                  period={`Mon – Sun (${formatDate(startOfWeek)} – ${formatDate(endOfWeek)})`}
                  icon={<CalendarCheck className="w-5 h-5 text-blue-600 shrink-0" aria-hidden="true" />}
                  look="week"
                  totals={weekTotals}
                />
                <TargetCard
                  title="Monthly Target"
                  period={`Period: ${startOfMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`}
                  icon={<Calendar className="w-5 h-5 text-indigo-600 shrink-0" aria-hidden="true" />}
                  look="month"
                  totals={monthTotals}
                />
              </div>
            </section>

            {/* Driver list */}
            <section ref={driversSectionRef} aria-labelledby="drivers-heading" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-clip print:shadow-none print:border-none">
              <h2 id="drivers-heading" className="sr-only">Drivers</h2>
              {/* Controls stay in view while scrolling the list */}
              <div className="lg:sticky lg:top-0 lg:z-10 bg-white border-b border-gray-200 print:hidden">
                <div className="px-3 sm:px-4 py-3 flex flex-col lg:flex-row gap-3 lg:items-center">
                  <div role="group" aria-label="Which drivers" className="flex bg-gray-100 p-1 rounded-lg shrink-0">
                    {([['ACTIVE', 'Active', activeFleetCount], ['DELISTED', 'Delisted / Returned', delistedCount]] as const).map(([id, label, count]) => (
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
                </div>

                {filtersActive && (
                  <div className="px-3 sm:px-4 py-2 bg-blue-50 border-t border-blue-100 flex flex-wrap items-center gap-2 text-xs text-blue-900">
                    <span className="font-semibold">Showing {filteredDrivers.length} of {scopeDrivers.length}:</span>
                    {statusFilter !== 'ALL' && <span className="bg-white border border-blue-200 px-2 py-0.5 rounded-full font-bold">Risk: {statusFilter}</span>}
                    {selectedTagFilter !== 'ALL' && <span className="bg-white border border-blue-200 px-2 py-0.5 rounded-full font-bold">Staff: {selectedTagFilter}</span>}
                    {searchTerm !== '' && <span className="bg-white border border-blue-200 px-2 py-0.5 rounded-full font-bold">Search: “{searchTerm}”</span>}
                    <button type="button" onClick={resetFilters} className="ml-auto bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg">Reset filters</button>
                  </div>
                )}
              </div>

              {showDetails ? (
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
                          <td colSpan={7} className="px-6 py-8 text-center text-gray-500">No drivers match these filters.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* Collections list */
                <div className="p-2 sm:p-3">
                  {/* Column headings and sorting (on phones, just the sort buttons) */}
                  <div className="flex items-center gap-2 px-1 pb-2 text-xs font-bold uppercase tracking-wider text-gray-500 lg:grid lg:grid-cols-[minmax(0,1fr)_13rem_17rem_12.5rem] xl:grid-cols-[minmax(0,1fr)_14rem_18.5rem_12.5rem] lg:gap-0 lg:px-3 lg:pl-4 lg:border lg:border-transparent">
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
                      const m = driver.metrics;
                      const v = driver.velocityData;
                      const expanded = expandedDriverIds.includes(driver.id);
                      const cycleLabel = driver.rentalCycle === 'MONTHLY' ? 'Months' : 'Weeks';
                      // The latest payment. Weekly late alerts count the same days once a payment exists (before that, from the contract
                      // start); monthly late alerts count from the oldest unpaid due date
                      const lastPaid = lastPayment(driver, todayNormalized);
                      const nextDueStr = formatDate(getNextDueDate(driver), 'N/A');
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
                      // Payment timing compared with the driver's own usual timing
                      let behaviorText = 'Usual payment timing';
                      let behaviorColor = 'text-slate-500';
                      if (v.isSlipping) { behaviorText = 'Paying later than usual'; behaviorColor = 'text-red-700 font-bold'; }
                      else if (v.isRecovering) { behaviorText = 'Paying earlier than usual'; behaviorColor = 'text-green-700 font-semibold'; }

                      return (
                        <li key={driver.id} id={`driver-row-${driver.id}`}>
                          <div className={`relative bg-white rounded-lg border border-slate-200 shadow-sm hover:border-slate-300 transition-colors ${highlight?.driverId === driver.id ? 'ring-2 ring-orange-500' : ''}`}>
                            <span aria-hidden="true" className={`absolute left-0 inset-y-0 w-1.5 rounded-l-lg ${m.status === 'GOOD' ? 'bg-emerald-500' : m.status === 'MID' ? 'bg-amber-500' : 'bg-rose-500'}`}></span>
                            <div className="grid gap-3 px-3 py-2.5 pl-4 lg:grid-cols-[minmax(0,1fr)_13rem_17rem_12.5rem] xl:grid-cols-[minmax(0,1fr)_14rem_18.5rem_12.5rem] lg:items-center lg:gap-0">
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
                                  </div>
                                </div>
                              </div>

                              {/* Risk status and payment timing */}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs lg:flex-col lg:justify-center lg:gap-1 lg:border-l lg:border-slate-100 lg:px-3 lg:text-center">
                                <span className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${m.status === 'GOOD' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : m.status === 'MID' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>{m.status}</span>
                                  <span className="font-bold text-slate-600">{m.cyclesOwed > 0 ? `${m.cyclesOwed.toFixed(1)} ${cycleLabel} Owed` : 'Up to date'}</span>
                                </span>
                                <span className={behaviorColor}>{behaviorText}</span>
                                {lastPaid
                                  ? <span className={`font-semibold flex items-center gap-1 ${lastPaid.isStale ? 'text-rose-700' : 'text-slate-500'}`}>{lastPaid.isStale && <AlertTriangle className="w-3 h-3" aria-hidden="true" />}Last pay: {formatDate(lastPaid.date)}</span>
                                  : <span className="text-slate-500">No payment yet</span>}
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
                                      <span>{labelText}</span>
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
                                <button type="button" onClick={() => handleOpenEditModal(driver)} aria-label={`Edit ${driver.name}`} title="Edit driver" className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0 p-2 flex items-center justify-center text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"><Pencil className="w-4 h-4" aria-hidden="true" /></button>
                                {driverScope === 'ACTIVE'
                                  ? <button type="button" onClick={() => handleDelistClick(driver)} aria-label={`Delist ${driver.name}`} title="Delist driver" className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0 p-2 flex items-center justify-center text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"><UserMinus className="w-4 h-4" aria-hidden="true" /></button>
                                  : <button type="button" onClick={() => setDriverToDelete(driver)} aria-label={`Delete ${driver.name}`} title="Delete driver" className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0 p-2 flex items-center justify-center text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>}
                              </div>
                            </div>
                          </div>
                          {expanded && (
                            <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-2 sm:p-4">
                              <ExpandedDriverDetails driver={driver} onLogPaymentClick={() => handleOpenPaymentModal(driver)} />
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
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[500px] print:shadow-none print:border-none print:bg-transparent">
            {activeSection === 'FINANCE' ? (
              <ScreenLoadBoundary><React.Suspense fallback={<div className="p-6">Loading Finance…</div>}><FinanceView /></React.Suspense></ScreenLoadBoundary>
            ) : activeSection === 'ANALYTICS' ? (
              <div className="p-6 bg-gray-50/50">
                <ScreenLoadBoundary><React.Suspense fallback={<div className="p-6">Loading Analytics…</div>}><AnalyticsView drivers={driversInDefaultOrder} /></React.Suspense></ScreenLoadBoundary>
              </div>
            ) : (
              <div className="p-6 bg-gray-50/50">
                <ScreenLoadBoundary><React.Suspense fallback={<div className="p-6">Loading Bank Recon…</div>}><BankReconciliation drivers={driversInDefaultOrder} /></React.Suspense></ScreenLoadBoundary>
              </div>
            )}
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
              <label htmlFor="driver-address" className="block text-sm font-bold text-gray-700 mb-1">Address</label>
              <textarea id="driver-address" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Driver Address"></textarea>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="driver-nric" className="block text-sm font-bold text-gray-700 mb-1">NRIC</label>
                <input id="driver-nric" required type="text" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.nric} onChange={e => setFormData({...formData, nric: formatNric(e.target.value)})} placeholder="NRIC Number" />
              </div>
              <div>
                <label htmlFor="driver-plate" className="block text-sm font-bold text-gray-700 mb-1">Plate Number</label>
                <input id="driver-plate" required type="text" className="w-full border border-gray-300 rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" value={formData.carPlate} onChange={e => setFormData({...formData, carPlate: e.target.value})} placeholder="ABC 1234" />
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
      {isPaymentModalOpen && liveDriverForPayment && (
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
                        </>
                      )}
                    </div>
                  </div>

                  {paymentError && <p role="alert" className="text-sm font-medium text-rose-600">{paymentError}</p>}

                  <div className="flex gap-3 pt-4 border-t border-gray-100">
                    <button type="button" onClick={closePaymentModal} className="flex-1 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                    <button type="submit" className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">Confirm</button>
                  </div>
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
                                </select>
                              )}
                            </div>
                          </div>
                          {editTxError && <p role="alert" className="text-xs font-medium text-rose-600">{editTxError}</p>}
                          <div className="flex gap-2 justify-end pt-1">
                            <button type="button" onClick={handleCancelEditTx} className="text-xs text-gray-600 bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded transition-colors">Cancel</button>
                            <button type="button" onClick={() => handleSaveEditTx(tx.id)} className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded transition-colors">Save</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div>
                            <div className="text-xs text-gray-500">{formatDate(tx.date)} <span className="font-mono text-xs bg-gray-200 px-1 rounded ml-1">ID: {tx.id.slice(-6)}</span></div>
                            <div className="text-xs font-bold text-gray-900 mt-0.5 mb-1">Paid: <PaymentAmount payment={tx} /></div>
                            <PaymentMethodBadge method={tx.paymentMethod} />
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
      )}
    </div>
  );
};

export default AdminDashboard;
