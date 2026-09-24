
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Driver, DriverStatus } from '../types';
import { calculateDriverMetrics, formatCurrency, formatNric, analyzePaymentHabit, generateDriverInvoices, getNextDueDate, kualaLumpurNow, parseDate } from '../utils';
import AnalyticsView from './AnalyticsView';
import BankReconciliation from './BankReconciliation';
const FinanceView = React.lazy(() => import('./finance/FinanceView'));
import { 
  LogOut, 
  TrendingUp, 
  AlertOctagon, 
  Search, 
  Phone, 
  DollarSign,
  Plus,
  X,
  UserPlus,
  Pencil,
  CalendarCheck,
  History,
  Check,
  Archive,
  UserMinus,
  Trash2,
  Calendar,
  Activity,
  PieChart,
  AlertTriangle,
  Tags,
  Filter,
  Users,
  Eye,
  TrendingDown,
  ArrowRight,
  Minus,
  Star,
  Siren,
  ArrowUpRight,
  ArrowDownRight,
  Info,
  Lock,
  Shield,
  ShieldAlert,
  ChevronUp,
  ChevronDown,
  Car as CarIcon,
  Wrench,
  FileText,
  ChevronRight,
  HelpCircle,
  AlertOctagon as AlertOctagonIcon,
  User,
  XCircle,
  CheckCircle2,
  AlertCircle,
  Clock
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { ExpandedDriverDetails } from './ExpandedDriverDetails';

interface AdminDashboardProps {
  drivers: Driver[];
  userRole: 'admin' | 'staff'; // Role passed from parent
  onUpdatePayment: (driverId: string, amount: number, date: string, serviceClaim?: number, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM') => void;
  onEditPayment?: (paymentId: string, amount: number, serviceClaim: number, date: string, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM') => void;
  onCreateDriver: (driver: Driver) => void;
  onUpdateDriver: (driver: Driver) => void;
  onDelistDriver: (driverId: string) => void;
  onDeleteDriver: (driverId: string) => void;
  onLogout: () => void;
  onRefresh: () => Promise<void>;
}

// Fixed baseline for the "Restored / Slipped" recovery bar on each driver row.
const RECOVERY_BASELINE_DATE = new Date('2026-05-27T00:00:00Z');

// Recorded contract length implied by the start and end dates (months approximated as 30 days).
const contractCyclesBetween = (startDate: string, endDate: string, cycle: Driver['rentalCycle']): number | null => {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  if (!startDate || !endDate || isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return Math.ceil(days / (cycle === 'MONTHLY' ? 30 : 7));
};

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
  const [searchTerm, setSearchTerm] = useState<string>(() => {
    try {
      return localStorage.getItem('eca_admin_search_term') || '';
    } catch {
      return '';
    }
  });
  
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'DELISTED' | 'ANALYTICS' | 'RECONCILE' | 'DRIVER_LIST' | 'FINANCE'>(() => {
    try {
      const saved = localStorage.getItem('eca_admin_view_mode');
      return (saved as any) || 'ACTIVE';
    } catch {
      return 'ACTIVE';
    }
  });
  
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'GOOD' | 'MID' | 'BAD'>(() => {
    try {
      const saved = localStorage.getItem('eca_admin_status_filter');
      return (saved as any) || 'ALL';
    } catch {
      return 'ALL';
    }
  });
  
  const [urgencyFilter, setUrgencyFilter] = useState<'ALL' | 'TODAY' | 'YESTERDAY' | 'OVERDUE'>('ALL');
  
  const [expandedDriverIds, setExpandedDriverIds] = useState<string[]>([]);
  const [highlightedDriverId, setHighlightedDriverId] = useState<string | null>(null);
  
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('eca_admin_selected_tag_filter');
      return saved || 'ALL';
    } catch {
      return 'ALL';
    }
  });

  const [sortConfig, setSortConfig] = useState<{ key: 'RISK_STATUS' | 'OUTSTANDING' | 'DEFAULT', direction: 'asc' | 'desc' }>({ key: 'DEFAULT', direction: 'desc' });
  const [driverListSortConfig, setDriverListSortConfig] = useState<{ key: 'CATEGORY' | 'NAME' | null, direction: 'asc' | 'desc' | null }>({ key: null, direction: null });

  // Persistence hooks
  useEffect(() => {
    try {
      localStorage.setItem('eca_admin_search_term', searchTerm);
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  }, [searchTerm]);

  useEffect(() => {
    try {
      localStorage.setItem('eca_admin_view_mode', viewMode);
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem('eca_admin_status_filter', statusFilter);
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  }, [statusFilter]);

  useEffect(() => {
    try {
      localStorage.setItem('eca_admin_urgency_filter', urgencyFilter);
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  }, [urgencyFilter]);

  useEffect(() => {
    try {
      localStorage.setItem('eca_admin_selected_tag_filter', selectedTagFilter);
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  }, [selectedTagFilter]);
  
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedDriverForPayment, setSelectedDriverForPayment] = useState<Driver | null>(null);

  // Invoice Popup State
  const [invoicePopupData, setInvoicePopupData] = useState<{ title: string; invoices: any[] } | null>(null);
  
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
        const anchor = document.getElementById('current-payment-anchor');
        if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  }, [isPaymentModalOpen, liveDriverForPayment?.id]);

  // Refs for navigation
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // New Driver Form State
  const initialFormState = {
    name: '',
    email: '',
    address: '',
    nric: '',
    // contactNumber removed
    carPlate: '',
    contractStartDate: kualaLumpurNow().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }),
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

  const getKualaLumpurTodayDateString = (): string => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(kualaLumpurNow());
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    const month = parts.find(p => p.type === 'month')?.value || '05';
    const day = parts.find(p => p.type === 'day')?.value || '27';
    return `${year}-${month}-${day}`;
  };

  // Load screened status today
  useEffect(() => {
    const todayStr = getKualaLumpurTodayDateString();
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
      const todayStr = getKualaLumpurTodayDateString();
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
    const todayStr = getKualaLumpurTodayDateString();
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

  // --- UI Refresh: Trigger Global State Refresh on Mount ---
  // REMOVED: This causes a flicker on login because it triggers the global loading state.
  // The data is already fetched in App.tsx on initial load.
  /*
  useEffect(() => {
      onRefresh();
  }, []);
  */

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

    // Habit analysis
    const habit = analyzePaymentHabit(d);
    
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
        habit,
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

  // --- Debt Target & Urgency Queue Computations ---
  const todayNormalized = useMemo(() => {
    const today = kualaLumpurNow();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return new Date(todayStr + 'T00:00:00');
  }, [screeningDate]);

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

  const yesterdayEnd = useMemo(() => {
    const d = new Date(todayNormalized);
    d.setDate(todayNormalized.getDate() - 1);
    return d;
  }, [todayNormalized]);

  const yesterdayStart = useMemo(() => {
    const d = new Date(todayNormalized);
    d.setDate(todayNormalized.getDate() - 3);
    return d;
  }, [todayNormalized]);

  const allInvoices = useMemo(() => {
    let invoicesList: any[] = [];
    drivers.forEach(driver => {
      if (driver.isDelisted) return; // Only process active fleet
      const invoices = generateDriverInvoices(driver, todayNormalized);
      invoices.forEach(inv => {
        invoicesList.push({
          ...inv,
          driverName: driver.name,
          carPlate: driver.carPlate,
          driver
        });
      });
    });
    return invoicesList;
  }, [drivers, todayNormalized]);

  const weeklyTargetAmount = useMemo(() => allInvoices.reduce((acc, inv) => {
    const dDate = parseDate(inv.dueDate);
    if (dDate >= startOfWeek && dDate <= endOfWeek) {
      return acc + inv.amount;
    }
    return acc;
  }, 0), [allInvoices, startOfWeek, endOfWeek]);

  const weeklyCollectedAmount = useMemo(() => allInvoices.reduce((acc, inv) => {
    const dDate = parseDate(inv.dueDate);
    if (dDate >= startOfWeek && dDate <= endOfWeek) {
      return acc + inv.amountPaid;
    }
    return acc;
  }, 0), [allInvoices, startOfWeek, endOfWeek]);

  const monthlyTargetAmount = useMemo(() => allInvoices.reduce((acc, inv) => {
    const dDate = parseDate(inv.dueDate);
    if (dDate >= startOfMonth && dDate <= endOfMonth) {
      return acc + inv.amount;
    }
    return acc;
  }, 0), [allInvoices, startOfMonth, endOfMonth]);

  const monthlyCollectedAmount = useMemo(() => allInvoices.reduce((acc, inv) => {
    const dDate = parseDate(inv.dueDate);
    if (dDate >= startOfMonth && dDate <= endOfMonth) {
      return acc + inv.amountPaid;
    }
    return acc;
  }, 0), [allInvoices, startOfMonth, endOfMonth]);

  const unpaidInvoices = useMemo(() => allInvoices.filter(inv => inv.status !== 'PAID'), [allInvoices]);

  const todayStr = useMemo(() => {
    return `${todayNormalized.getFullYear()}-${String(todayNormalized.getMonth() + 1).padStart(2, '0')}-${String(todayNormalized.getDate()).padStart(2, '0')}`;
  }, [todayNormalized]);

  const mustCollectToday = useMemo(() => unpaidInvoices.filter(inv => {
    return inv.dueDate === todayStr;
  }), [unpaidInvoices, todayStr]);

  const yesterdayDue = useMemo(() => unpaidInvoices.filter(inv => {
    const dDate = parseDate(inv.dueDate);
    return dDate >= yesterdayStart && dDate <= yesterdayEnd;
  }), [unpaidInvoices, yesterdayStart, yesterdayEnd]);

  const overdue = useMemo(() => unpaidInvoices.filter(inv => {
    const dDate = parseDate(inv.dueDate);
    return dDate < yesterdayStart;
  }), [unpaidInvoices, yesterdayStart]);

  const formatDateLabel = (dateStr: string) => {
    const d = parseDate(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Calculate top 10 active drivers whose last paid was 8 or more days ago
  const habitualLateAlerts = useMemo(() => {
    const alerts: { driver: Driver; daysSinceLastPay: number }[] = [];
    const todayRef = kualaLumpurNow();
    todayRef.setHours(0,0,0,0);

    driverData.filter(d => !d.isDelisted).forEach(d => {
      const lastPayment = d.paymentHistory && d.paymentHistory.length > 0 ? d.paymentHistory[0] : null;
      if (lastPayment) {
        const lastPaymentDate = parseDate(lastPayment.date);
        lastPaymentDate.setHours(0,0,0,0);
        const diffTime = todayRef.getTime() - lastPaymentDate.getTime();
        const daysSinceLastPay = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        if (daysSinceLastPay >= 8) {
          alerts.push({
            driver: d,
            daysSinceLastPay
          });
        }
      } else {
        // Rent started, no payment yet
        const contractStartDate = parseDate(d.contractStartDate);
        contractStartDate.setHours(0,0,0,0);
        const diffTime = todayRef.getTime() - contractStartDate.getTime();
        const daysSinceStart = Math.round(diffTime / (1000 * 60 * 60 * 24));
        if (daysSinceStart >= 8) {
          alerts.push({
            driver: d,
            daysSinceLastPay: daysSinceStart
          });
        }
      }
    });

    // Sort descending by delay time
    return alerts.sort((a, b) => b.daysSinceLastPay - a.daysSinceLastPay);
  }, [driverData]);

  const handleAlertClick = (driverId: string) => {
    setViewMode('ACTIVE');
    setStatusFilter('ALL');
    setSearchTerm('');
    setHighlightedDriverId(driverId);
    
    // Scroll and flash
    setTimeout(() => {
      const element = document.getElementById(`driver-row-${driverId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

    // Clear highlight after 4.5 seconds
    setTimeout(() => {
      setHighlightedDriverId(null);
    }, 4500);
  };


  // Filter based on View Mode, Search, Tags, and Risk Sort
  const filteredDrivers = useMemo(() => {
    let result = driverData;

    // 1. View Mode
    if (viewMode === 'ACTIVE') result = result.filter(d => !d.isDelisted);
    if (viewMode === 'DELISTED') result = result.filter(d => d.isDelisted);

    // 1.5 Fleet Health statusFilter click
    if (statusFilter !== 'ALL') {
      result = result.filter(d => d.metrics.status === statusFilter);
    }

    // 1.75 Urgency Categorization Filtering
    if (urgencyFilter !== 'ALL') {
      const driverIdsToKeep = new Set<string>();
      if (urgencyFilter === 'TODAY') {
        mustCollectToday.forEach(inv => driverIdsToKeep.add(inv.driver.id));
      } else if (urgencyFilter === 'YESTERDAY') {
        yesterdayDue.forEach(inv => driverIdsToKeep.add(inv.driver.id));
      } else if (urgencyFilter === 'OVERDUE') {
        overdue.forEach(inv => driverIdsToKeep.add(inv.driver.id));
      }
      result = result.filter(d => driverIdsToKeep.has(d.id));
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

    // 4. Sorting
    return result.sort((a, b) => {
      if (sortConfig.key === 'RISK_STATUS') {
        const statusPriority = { [DriverStatus.BAD]: 3, [DriverStatus.MID]: 2, [DriverStatus.GOOD]: 1 };
        const diff = statusPriority[b.metrics.status] - statusPriority[a.metrics.status];
        if (diff !== 0) {
          return sortConfig.direction === 'desc' ? diff : -diff;
        }
        return b.metrics.cyclesOwed - a.metrics.cyclesOwed;
      }

      if (sortConfig.key === 'OUTSTANDING') {
        const diff = b.activeBalance.baseValue - a.activeBalance.baseValue;
        if (diff !== 0) {
          return sortConfig.direction === 'desc' ? diff : -diff;
        }
        return b.metrics.cyclesOwed - a.metrics.cyclesOwed;
      }

      // Default Sorting
      // Priority 1: Worsened (Slipping) drivers at the top
      if (a.velocityData.isSlipping && !b.velocityData.isSlipping) return -1;
      if (!a.velocityData.isSlipping && b.velocityData.isSlipping) return 1;

      // Priority 2: Higher velocity (more positive) is worse
      if (b.velocityData.velocity !== a.velocityData.velocity) {
          return b.velocityData.velocity - a.velocityData.velocity;
      }

      // Priority 3: BAD Status > Habitual Late > Cycles Owed
      const statusPriority = { [DriverStatus.BAD]: 3, [DriverStatus.MID]: 2, [DriverStatus.GOOD]: 1 };
      
      if (statusPriority[a.metrics.status] !== statusPriority[b.metrics.status]) {
        return statusPriority[b.metrics.status] - statusPriority[a.metrics.status];
      }
      return b.metrics.cyclesOwed - a.metrics.cyclesOwed;
    });
  }, [driverData, viewMode, searchTerm, selectedTagFilter, sortConfig, statusFilter]);

  // Summary Stats
  const badDriversCount = driverData.filter(d => !d.isDelisted && d.metrics.status === DriverStatus.BAD).length;
  const midDriversCount = driverData.filter(d => !d.isDelisted && d.metrics.status === DriverStatus.MID).length;
  const goodDriversCount = driverData.filter(d => !d.isDelisted && d.metrics.status === DriverStatus.GOOD).length;
  const activeFleetCount = driverData.filter(d => !d.isDelisted).length;

  // --- Helpers ---

  const formatDateShort = (dateInput: any) => {
    try {
        if (!dateInput) return 'No payment yet';
        const d = parseDate(dateInput);
        if (isNaN(d.getTime())) return 'N/A';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch(e) { return 'N/A'; }
  };

  // --- Handlers ---
  const handleSearchFocus = () => {
    tableContainerRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { searchInputRef.current?.focus(); }, 500);
  };

  const handleOpenPaymentModal = (driver: Driver) => {
    handleScreenDriver(driver.id);
    setSelectedDriverForPayment(driver);
    setPaymentAmount(driver.rentalRate.toString());
    setPaymentDate(kualaLumpurNow().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" })); 
    setPaymentMethod(null); // start empty
    setIsPaymentModalOpen(true);
  };

  const handleDelistClick = (driver: Driver) => { setDriverToDelist(driver); };
  const confirmDelist = () => { if (driverToDelist) { onDelistDriver(driverToDelist.id); setDriverToDelist(null); } };
  
  const handleSubmitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriverForPayment) return;
    const amount = parseFloat(paymentAmount) || 0;
    const serviceClaim = parseFloat(serviceClaimAmount) || 0;
    if (isNaN(amount) || amount < 0) { alert("Invalid amount."); return; }
    if (!paymentDate) { alert("Select date."); return; }
    
    let finalMethod = paymentMethod;
    if (!finalMethod) {
        if (amount === 0 && serviceClaim > 0) {
            finalMethod = 'CLAIM';
        } else {
            alert("Please select either BANK TRANSFER or CASH DEPOSIT."); return;
        }
    }
    
    onUpdatePayment(selectedDriverForPayment.id, amount, paymentDate, serviceClaim, finalMethod);
    setIsPaymentModalOpen(false); setSelectedDriverForPayment(null); setPaymentAmount(''); setServiceClaimAmount('0'); setPaymentDate(''); setPaymentMethod(null);
  };

  const handleStartEditTx = (tx: any) => {
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
      alert("Invalid payment amount.");
      return;
    }
    if (!editDate) {
      alert("Please specify a valid payment date.");
      return;
    }
    if (onEditPayment) {
      onEditPayment(txId, amountNum, serviceClaimNum, editDate, editPaymentMethod || 'BANK TRANSFER');
    }
    setEditingTxId(null);
    setEditPaymentMethod(null);
  };

  const handleOpenCreateModal = () => { setEditingId(null); setFormData(initialFormState); setTagInput(''); setIsDriverModalOpen(true); };
  
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
    if (!formData.name || !formData.nric || !formData.carPlate) { alert("Missing fields."); return; }
    
    // AUTOMATED LOGIC: Sync Duration if End Date is set
    const finalDuration = contractCyclesBetween(formData.contractStartDate, formData.contractEndDate, formData.rentalCycle) ?? formData.contractDuration;

    const submissionData = { ...formData, contractDuration: finalDuration };

    try {
      if (editingId) {
        const originalDriver = drivers.find(d => d.id === editingId);
        if (!originalDriver) return;
        await onUpdateDriver({ ...originalDriver, ...submissionData });
      } else {
        if (drivers.some(d => d.nric === formData.nric)) { alert("NRIC exists."); return; }
        await onCreateDriver({ id: Date.now().toString(), ...submissionData, totalAmountPaid: 0, paymentHistory: [] });
      }
      // Immediate Refresh on Update
      await onRefresh();
      setIsDriverModalOpen(false); setFormData(initialFormState);
    } catch (e) {
      // Error handled by parent, keep modal open
    }
  };

  const renderPaymentSchedule = (driver: Driver) => {
    const invoices = generateDriverInvoices(driver, kualaLumpurNow());
    let anchorFound = false;

    return (
      <div className="space-y-1.5 max-h-[22rem] overflow-y-auto pr-2 scroll-smooth">
        {invoices.map((inv, index) => {
          let isAnchor = false;
          if (!anchorFound && (inv.status === 'PARTIAL' || inv.status === 'UNPAID')) {
            isAnchor = true;
            anchorFound = true;
          }

          let bgColor = 'bg-white';
          let textColor = 'text-gray-600';
          let icon = <XCircle className="w-4 h-4 text-gray-300" />;
          let label: string = inv.status;
          let showAnchor = isAnchor;
          let pulseClass = isAnchor ? "animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.4)] ring-2 ring-red-400" : "";

          if (inv.status === 'CANCELLED') {
              bgColor = 'bg-gray-100'; textColor = 'text-gray-400'; label = 'CANCELLED'; icon = <XCircle className="w-4 h-4 text-gray-400" />; showAnchor = false; pulseClass = '';
          } else if (inv.status === 'PAID') {
              bgColor = 'bg-emerald-50'; textColor = 'text-emerald-700'; label = 'PAID'; icon = <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
          } else if (inv.status === 'PARTIAL') {
              bgColor = 'bg-amber-50'; textColor = 'text-amber-700'; label = `PARTIAL (${formatCurrency(inv.amountPaid)} paid)`; icon = <AlertCircle className="w-4 h-4 text-amber-500" />;
          } else if (inv.status === 'UNPAID') {
              bgColor = 'bg-red-50'; textColor = 'text-red-700'; label = 'UNPAID'; icon = <AlertCircle className="w-4 h-4 text-red-500" />;
          } else if (inv.status === 'FUTURE') {
              bgColor = 'bg-gray-50'; textColor = 'text-gray-500'; label = 'FUTURE'; icon = <Clock className="w-4 h-4 text-gray-400" />; showAnchor = false; pulseClass = '';
          }

          return (
            <div key={inv.id} id={showAnchor ? "current-payment-anchor" : undefined} className={`flex justify-between items-center p-2.5 rounded-lg border border-gray-100 ${bgColor} ${pulseClass} transition-all duration-300 relative overflow-hidden`}>
              {showAnchor && (
                <div className="absolute top-0 left-0 w-1 h-full bg-red-500 animate-pulse"></div>
              )}
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${textColor} mb-0.5`}>Cycle {inv.cycleIndex + 1}</span>
                  <span className="text-sm font-medium text-gray-900">{inv.dueDate}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-bold text-gray-900">{formatCurrency(inv.amount)}</span>
                <div className={`flex items-center gap-1.5 ${textColor}`}>
                  {icon}
                  <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };


  return (
    <div className="min-h-screen bg-gray-100 font-sans print:bg-white">
      {/* Top Navigation - unchanged */}
      <div className="bg-gray-900 text-white px-6 py-4 flex justify-between items-center shadow-md sticky top-0 z-20 print:hidden">
        <h1 className="text-xl font-bold tracking-tight">Admin<span className="text-blue-400">Control</span></h1>
        
        <div className="flex items-center gap-4">
           {/* Current Role Indicator */}
           <div className="flex bg-gray-800 rounded-lg p-1.5 px-3 items-center gap-2 border border-gray-700">
              {userRole === 'admin' ? <Shield className="w-3 h-3 text-blue-400" /> : <UserPlus className="w-3 h-3 text-indigo-400" />}
              <span className="text-xs font-bold uppercase tracking-wide text-gray-300">
                {userRole === 'admin' ? 'Administrator' : 'Staff View'}
              </span>
           </div>
           
           <div className="h-6 w-px bg-gray-700"></div>

           <button onClick={handleOpenCreateModal} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-blue-900/50">
            <UserPlus className="w-4 h-4" /> Add Driver
          </button>
          
          <button onClick={onLogout} className="text-gray-400 hover:text-white flex items-center gap-2 text-sm transition-colors">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 print:p-0 print:m-0 print:w-full print:max-w-none">
        
        {/* Merged Fleet Overview & Fleet Health Card Grid */}
        {(viewMode === 'ACTIVE' || viewMode === 'DELISTED') && (
          <div className="space-y-6">
            
            {/* Grid container for Fleet Status and Late Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Fleet Overview & Health Status */}
              <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-md p-6 space-y-6 font-sans">
                <div className="flex items-center gap-2.5">
                  <Activity className="w-6 h-6 text-blue-600 animate-pulse" />
                  <h2 className="text-xl font-bold text-gray-900 tracking-tight">Fleet Overview & Health Status</h2>
                </div>

                {/* Status Counters Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* GOOD STATUS */}
                  <button
                    type="button"
                    onClick={() => {
                      const nextVal = statusFilter === 'GOOD' ? 'ALL' : 'GOOD';
                      setStatusFilter(nextVal);
                      if (nextVal !== 'ALL') {
                        setViewMode('ACTIVE');
                        setTimeout(() => {
                          tableContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 50);
                      }
                    }}
                    className={`bg-gray-50/40 rounded-xl p-5 border text-center transition-all duration-300 flex flex-col items-center justify-between hover:shadow-md cursor-pointer hover:scale-[1.01] ${
                      statusFilter === 'GOOD' ? 'ring-2 ring-emerald-500 border-transparent bg-emerald-50/10' : 'border-gray-200/60'
                    }`}
                  >
                    <span className="text-gray-450 font-extrabold text-xs uppercase tracking-wider">GOOD STATUS</span>
                    <span className="text-5xl font-black text-emerald-600 mt-2 mb-0 font-sans">{activeFleetCount ? Math.round((goodDriversCount / activeFleetCount) * 100) : 0}%</span>
                    <span className="text-sm font-bold text-gray-400 mb-2">{goodDriversCount} drivers</span>
                    
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-3">CLICK TO FILTER</span>
                  </button>

                  {/* MID STATUS */}
                  <button
                    type="button"
                    onClick={() => {
                      const nextVal = statusFilter === 'MID' ? 'ALL' : 'MID';
                      setStatusFilter(nextVal);
                      if (nextVal !== 'ALL') {
                        setViewMode('ACTIVE');
                        setTimeout(() => {
                          tableContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 50);
                      }
                    }}
                    className={`bg-gray-50/40 rounded-xl p-5 border text-center transition-all duration-300 flex flex-col items-center justify-between hover:shadow-md cursor-pointer hover:scale-[1.01] ${
                      statusFilter === 'MID' ? 'ring-2 ring-amber-550 border-transparent bg-amber-50/10' : 'border-gray-200/60'
                    }`}
                  >
                    <span className="text-gray-450 font-extrabold text-xs uppercase tracking-wider">MID STATUS</span>
                    <span className="text-5xl font-black text-amber-500 mt-2 mb-0 font-sans">{activeFleetCount ? Math.round((midDriversCount / activeFleetCount) * 100) : 0}%</span>
                    <span className="text-sm font-bold text-gray-400 mb-2">{midDriversCount} drivers</span>
                    
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-3">CLICK TO FILTER</span>
                  </button>

                  {/* BAD STATUS */}
                  <button
                    type="button"
                    onClick={() => {
                      const nextVal = statusFilter === 'BAD' ? 'ALL' : 'BAD';
                      setStatusFilter(nextVal);
                      if (nextVal !== 'ALL') {
                        setViewMode('ACTIVE');
                        setTimeout(() => {
                          tableContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 50);
                      }
                    }}
                    className={`bg-gray-50/40 rounded-xl p-5 border text-center transition-all duration-300 flex flex-col items-center justify-between hover:shadow-md cursor-pointer hover:scale-[1.01] ${
                      statusFilter === 'BAD' ? 'ring-2 ring-rose-500 border-transparent bg-rose-50/10' : 'border-gray-200/60'
                    }`}
                  >
                    <span className="text-gray-450 font-extrabold text-xs uppercase tracking-wider">BAD STATUS</span>
                    <span className="text-5xl font-black text-rose-600 mt-2 mb-0 font-sans">{activeFleetCount ? Math.round((badDriversCount / activeFleetCount) * 100) : 0}%</span>
                    <span className="text-sm font-bold text-gray-400 mb-2">{badDriversCount} drivers</span>
                    
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-3">CLICK TO FILTER</span>
                  </button>
                </div>

                {/* Fleet Metric & Screening Progress Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                  {/* TOTAL ACTIVE FLEET */}
                  <div 
                    onClick={handleSearchFocus}
                    className="bg-gray-50/60 rounded-xl p-5 border border-gray-200/60 flex items-center justify-between shadow-sm cursor-pointer hover:bg-gray-50/80 transition-all font-sans"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                      <span className="text-gray-700 font-extrabold text-xs uppercase tracking-wider">TOTAL ACTIVE FLEET</span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-black text-gray-900 font-sans">{activeFleetCount}</span>
                      <span className="text-xs text-gray-400 font-semibold">vehicles total</span>
                    </div>
                  </div>

                  {/* DAILY SCREENING PROGRESS */}
                  <div className="bg-white rounded-xl p-5 border border-black shadow-sm space-y-3.5 relative overflow-hidden font-sans">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#E11D48]" />
                        <span className="text-[#991B1B] font-extrabold text-xs uppercase tracking-wider">DAILY SCREENING PROGRESS</span>
                      </div>
                      <span className="text-sm font-mono font-black text-gray-950">
                        {screenedDriverIds.length} / {activeFleetCount}
                      </span>
                    </div>

                    {/* Red progress bar */}
                    <div className="w-full bg-gray-100 rounded-full h-3 border border-gray-200/40 shadow-inner overflow-hidden p-0.5">
                      <div 
                        className="bg-[#E11D48] h-full rounded-full transition-all duration-700"
                        style={{ width: `${activeFleetCount > 0 ? (screenedDriverIds.length / activeFleetCount) * 100 : 0}%` }}
                      />
                    </div>

                    <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                      <span className="text-gray-400">KL GMT+8 (Resets at 00:00:00)</span>
                      <span className="text-[#E11D48]">
                        {activeFleetCount - screenedDriverIds.length} pending manual screening
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Late Alerts Feed */}
              <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-200 shadow-md p-6 flex flex-col max-h-[440px] overflow-hidden font-sans">
                <div className="flex items-center justify-between mb-4 border-b border-gray-150 pb-3 mt-0.5">
                  <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-500 animate-pulse" />
                    Late Alerts (8d+)
                  </h3>
                  <span className="bg-red-50 text-red-700 text-[10px] font-black px-2.5 py-1 rounded-full uppercase border border-red-200 tracking-wider">
                    {habitualLateAlerts.length} Drivers
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto max-h-[310px] space-y-2.5 pr-2 scrollbar-thin scrollbar-thumb-gray-200 hover:scrollbar-thumb-gray-300">
                  {habitualLateAlerts.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-gray-50/25 rounded-xl border border-dashed border-gray-250">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2 animate-bounce" />
                      <p className="text-xs text-gray-400 font-bold">All accounts are safe and active.</p>
                    </div>
                  ) : (
                    habitualLateAlerts.map(({ driver, daysSinceLastPay }) => (
                      <button
                        key={driver.id}
                        type="button"
                        onClick={() => handleAlertClick(driver.id)}
                        className="w-full text-left flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50/55 hover:bg-orange-50/60 hover:border-orange-200 transition-all text-xs cursor-pointer group"
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0 group-hover:scale-125 transition-transform" />
                          <div className="truncate font-bold text-gray-800 group-hover:text-orange-950 leading-tight">
                            {driver.name}
                            <span className="block text-[10px] text-gray-405 font-mono font-normal mt-0.5">
                              {driver.carPlate}
                            </span>
                          </div>
                        </div>
                        <span className="bg-orange-100/90 text-orange-950 font-mono font-extrabold px-2 py-1 rounded-lg shrink-0 leading-none">
                          {daysSinceLastPay}d
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Section 1: The Macro Header (Financial Targets) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-sans">
              {/* Weekly Target Card */}
              <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/75 backdrop-blur-md shadow-lg p-6 flex flex-col justify-between min-h-[175px]">
                <div className="absolute top-0 right-0 w-36 h-36 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-gray-950 font-bold flex items-center gap-2 tracking-tight">
                      <CalendarCheck className="w-5 h-5 text-blue-600" />
                      Weekly Target
                    </h3>
                    <p className="text-[11px] text-gray-400 font-medium mt-1 uppercase tracking-wider">
                      Mon - Sun ({formatDateLabel(startOfWeek.toISOString())} - {formatDateLabel(endOfWeek.toISOString())})
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <div>
                    <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Collected</span>
                    <div className="text-3xl font-black text-blue-950 tracking-tight mt-1 font-mono">
                      RM {weeklyCollectedAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <span className="text-[11px] text-gray-400 block font-bold uppercase tracking-wider">Target</span>
                    <span className="text-base font-extrabold text-gray-500">/ RM {weeklyTargetAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
                {/* Progress Bar */}
                <div className="w-full bg-gray-200/60 rounded-full h-3.5 mt-4 overflow-hidden p-0.5 border border-white/40 shadow-inner">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2.5 rounded-full transition-all duration-1000" 
                    style={{ width: `${weeklyTargetAmount > 0 ? Math.min(100, (weeklyCollectedAmount / weeklyTargetAmount) * 100) : 0}%` }}
                  ></div>
                </div>
              </div>

              {/* Monthly Target Card */}
              <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/75 backdrop-blur-md shadow-lg p-6 flex flex-col justify-between min-h-[175px]">
                <div className="absolute top-0 right-0 w-36 h-36 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-gray-950 font-bold flex items-center gap-2 tracking-tight">
                      <Calendar className="w-5 h-5 text-indigo-600" />
                      Monthly Target
                    </h3>
                    <p className="text-[11px] text-gray-400 font-medium mt-1 uppercase tracking-wider">
                      Period: {startOfMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <div>
                    <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Collected</span>
                    <div className="text-3xl font-black text-indigo-950 tracking-tight mt-1 font-mono">
                      RM {monthlyCollectedAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <span className="text-[11px] text-gray-400 block font-bold uppercase tracking-wider">Target</span>
                    <span className="text-base font-extrabold text-gray-500">/ RM {monthlyTargetAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
                {/* Progress Bar */}
                <div className="w-full bg-gray-200/60 rounded-full h-3.5 mt-4 overflow-hidden p-0.5 border border-white/40 shadow-inner">
                  <div 
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 h-2.5 rounded-full transition-all duration-1000" 
                    style={{ width: `${monthlyTargetAmount > 0 ? Math.min(100, (monthlyCollectedAmount / monthlyTargetAmount) * 100) : 0}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Section 2: The Urgency Row (KPI Alerts) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-sans">
              {/* Must Collect Today */}
              <div 
                onClick={() => setInvoicePopupData({ title: 'Must Collect Today', invoices: mustCollectToday })}
                className="cursor-pointer bg-white rounded-2xl border p-6 relative overflow-hidden transition-all duration-300 shadow-md flex flex-col justify-between hover:scale-[1.01] hover:shadow-lg min-h-[140px] border-gray-200 hover:border-orange-300"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-orange-500"></div>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-base tracking-tight text-gray-900">Must Collect Today</h3>
                    <p className="text-xs text-gray-400 mt-0.5 font-medium">Invoices due today</p>
                  </div>
                  <span className="text-3xl font-black text-orange-600 tracking-tight font-mono">{mustCollectToday.length}</span>
                </div>
                <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-105">
                  <span className="text-[11px] font-black text-orange-600 flex items-center gap-1 uppercase tracking-wider">
                    <span className="font-bold text-xs mr-0.5">RM</span> Payment
                  </span>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                    View Invoices
                  </span>
                </div>
              </div>

              {/* Yesterday Unpaid */}
              <div 
                onClick={() => setInvoicePopupData({ title: 'Yesterday Unpaid', invoices: yesterdayDue })}
                className="cursor-pointer bg-white rounded-2xl border p-6 relative overflow-hidden transition-all duration-300 shadow-md flex flex-col justify-between hover:scale-[1.01] hover:shadow-lg min-h-[140px] border-gray-200 hover:border-amber-300"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500"></div>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-base tracking-tight text-gray-900">Yesterday Unpaid</h3>
                    <p className="text-xs text-gray-400 mt-0.5 font-medium">Overdue 1 to 3 days</p>
                  </div>
                  <span className="text-3xl font-black text-amber-500 tracking-tight font-mono">{yesterdayDue.length}</span>
                </div>
                <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-105">
                  <span className="text-[11px] font-black text-amber-600 flex items-center gap-1 uppercase tracking-wider">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> ! Follow up
                  </span>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                    View Invoices
                  </span>
                </div>
              </div>

              {/* Overdue */}
              <div 
                onClick={() => setInvoicePopupData({ title: 'Overdue', invoices: overdue })}
                className="cursor-pointer bg-white rounded-2xl border p-6 relative overflow-hidden transition-all duration-300 shadow-md flex flex-col justify-between hover:scale-[1.01] hover:shadow-lg min-h-[140px] border-gray-200 hover:border-red-300"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-650"></div>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-base tracking-tight text-gray-900">Overdue</h3>
                    <p className="text-xs text-gray-400 mt-0.5 font-medium">Severe backlog (3d+ late)</p>
                  </div>
                  <span className="text-3xl font-black text-red-650 tracking-tight font-mono">{overdue.length}</span>
                </div>
                <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-105">
                  <span className="text-[11px] font-black text-red-600 flex items-center gap-1 uppercase tracking-wider">
                    <Siren className="w-3.5 h-3.5 shrink-0 animate-pulse text-red-600" /> ! Urgent Action
                  </span>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                    View Invoices
                  </span>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* View Toggle Tabs - unchanged */}
        <div className="flex space-x-1 bg-gray-200 p-1 rounded-lg w-fit overflow-x-auto print:hidden">
          <button onClick={() => setViewMode('ACTIVE')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${viewMode === 'ACTIVE' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}>Active Fleet</button>
          <button onClick={() => setViewMode('DELISTED')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'DELISTED' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><Archive className="w-4 h-4" /> Delisted / Returned</button>
          
          {userRole === 'admin' && (
            <>
              
              <button onClick={() => setViewMode('DRIVER_LIST')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'DRIVER_LIST' ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><Users className="w-4 h-4" /> Driver List</button>
              <button onClick={() => setViewMode('ANALYTICS')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'ANALYTICS' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><PieChart className="w-4 h-4" /> Analytics</button>
              <button onClick={() => setViewMode('RECONCILE')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'RECONCILE' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><CheckCircle2 className="w-4 h-4" /> Bank Recon</button>
              <button onClick={() => setViewMode('FINANCE')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'FINANCE' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><DollarSign className="w-4 h-4" /> Finance</button>
            </>
          )}
        </div>

        {/* Main Table Section - unchanged */}
        <div ref={tableContainerRef} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[500px] print:shadow-none print:border-none print:bg-transparent">
          {viewMode === 'FINANCE' && userRole === 'admin' ? (
            <React.Suspense fallback={<div className="p-6">Loading Finance…</div>}><FinanceView /></React.Suspense>
          ) : viewMode === 'ANALYTICS' && userRole === 'admin' ? (
             <div className="p-6 bg-gray-50/50">
               <AnalyticsView drivers={driverData} />
             </div>
          ) : viewMode === 'RECONCILE' && userRole === 'admin' ? (
             <div className="p-6 bg-gray-50/50">
               <BankReconciliation drivers={driverData} />
             </div>
          ) : viewMode === 'DRIVER_LIST' && userRole === 'admin' ? (
             <div className="bg-white">
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                        <Users className="w-5 h-5 text-orange-600" /> Driver List
                    </h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-500">
                            <tr>
                                <th 
                                  className="px-6 py-3 cursor-pointer hover:text-gray-800 transition-colors group select-none"
                                  onClick={() => setDriverListSortConfig(prev => ({ 
                                      key: 'NAME', 
                                      direction: prev.key === 'NAME' ? (prev.direction === 'asc' ? 'desc' : prev.direction === 'desc' ? null : 'asc') : 'asc' 
                                  }))}
                                >
                                  <div className="flex items-center gap-1">
                                    Full Name
                                    <span className={`text-[10px] ${driverListSortConfig.key === 'NAME' && driverListSortConfig.direction ? 'text-blue-600' : 'text-gray-300 group-hover:text-gray-500'}`}>
                                      {driverListSortConfig.key === 'NAME' && driverListSortConfig.direction === 'asc' ? '▲' : driverListSortConfig.key === 'NAME' && driverListSortConfig.direction === 'desc' ? '▼' : '↕'}
                                    </span>
                                  </div>
                                </th>
                                <th className="px-6 py-3">Email Address</th>
                                <th className="px-6 py-3">Address</th>
                                <th className="px-6 py-3">NRIC</th>
                                <th className="px-6 py-3">Plate Number</th>
                                <th 
                                  className="px-6 py-3 cursor-pointer hover:text-gray-800 transition-colors group select-none"
                                  onClick={() => setDriverListSortConfig(prev => ({ 
                                      key: 'CATEGORY', 
                                      direction: prev.key === 'CATEGORY' ? (prev.direction === 'asc' ? 'desc' : prev.direction === 'desc' ? null : 'asc') : 'asc' 
                                  }))}
                                >
                                  <div className="flex items-center gap-1">
                                    Category
                                    <span className={`text-[10px] ${driverListSortConfig.key === 'CATEGORY' && driverListSortConfig.direction ? 'text-blue-600' : 'text-gray-300 group-hover:text-gray-500'}`}>
                                      {driverListSortConfig.key === 'CATEGORY' && driverListSortConfig.direction === 'asc' ? '▲' : driverListSortConfig.key === 'CATEGORY' && driverListSortConfig.direction === 'desc' ? '▼' : '↕'}
                                    </span>
                                  </div>
                                </th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {(() => {
                                const driverListSorted = [...driverData.filter(d => !d.isDelisted)];
                                if (driverListSortConfig.direction && driverListSortConfig.key) {
                                  driverListSorted.sort((a, b) => {
                                    let valA = '';
                                    let valB = '';
                                    
                                    if (driverListSortConfig.key === 'CATEGORY') {
                                      valA = a.category || '';
                                      valB = b.category || '';
                                    } else if (driverListSortConfig.key === 'NAME') {
                                      valA = (a.name || '').toLowerCase();
                                      valB = (b.name || '').toLowerCase();
                                    }

                                    if (valA < valB) return driverListSortConfig.direction === 'asc' ? -1 : 1;
                                    if (valA > valB) return driverListSortConfig.direction === 'asc' ? 1 : -1;
                                    return 0;
                                  });
                                }
                                return driverListSorted.map(driver => {
                                    let isNew = false;
                                    if (driver.contractStartDate) {
                                      const start = new Date(driver.contractStartDate + 'T00:00:00');
                                      const now = kualaLumpurNow();
                                      const diffTime = Math.abs(now.getTime() - start.getTime());
                                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                      isNew = diffDays <= 30;
                                    }
                                    return (
                                    <tr key={driver.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 font-bold text-gray-900 flex items-center gap-2">
                                          {driver.name}
                                          {isNew && (
                                            <span className="text-[10px] text-red-500 font-black animate-pulse drop-shadow-[0_0_8px_rgba(239,68,68,0.8)] tracking-widest border border-red-500/30 px-1.5 py-0.5 rounded-sm bg-red-50">NEW</span>
                                          )}
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
                                            <button 
                                                onClick={() => handleOpenEditModal(driver)} 
                                                className="text-xs text-blue-600 font-semibold hover:bg-blue-50 px-3 py-1.5 rounded transition-colors border border-blue-100 bg-white shadow-sm"
                                            >
                                                Edit Details
                                            </button>
                                        </td>
                                    </tr>
                                )});
                            })()}
                            {driverData.filter(d => !d.isDelisted).length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">No active drivers found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
             </div>
          ) : (
            /* --- ACTIVE / DELISTED VIEW --- */
            <>
                {/* Section 3: The Control Ribbon */}
                <div className="px-6 py-4 border-b border-gray-200 bg-white flex flex-col xl:flex-row gap-4 justify-between items-stretch xl:items-center sticky top-0 z-10 shadow-sm">
                  {/* Search and Staff Group Dropdown */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-3.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <input 
                        ref={searchInputRef}
                        type="text" 
                        placeholder="Search driver, car plate, NRIC..." 
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm shadow-sm transition-all focus:outline-none placeholder-gray-400 font-sans"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>

                    {/* Filter by Staff / Group */}
                    <div className="relative min-w-[200px]">
                      <Filter className="w-4 h-4 absolute left-3.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <select 
                        className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm appearance-none cursor-pointer hover:bg-gray-50/50 transition-colors font-medium text-gray-700"
                        value={selectedTagFilter}
                        onChange={(e) => setSelectedTagFilter(e.target.value)}
                      >
                        <option value="ALL">All Staff Groups</option>
                        {allTags.map(tag => (
                          <option key={tag} value={tag}>{tag}</option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-550">
                        <ChevronDown className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Active Indicator Badges */}
                {(statusFilter !== 'ALL' || selectedTagFilter !== 'ALL' || urgencyFilter !== 'ALL' || searchTerm !== '') && (
                  <div className="px-6 py-3 bg-blue-50/60 border-b border-blue-100 flex justify-between items-center text-xs text-blue-800 font-semibold sticky top-[68px] z-10 backdrop-blur-md font-sans">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse shrink-0" />
                      <span>Viewing Matched Queue:</span>
                      {statusFilter !== 'ALL' && (
                        <span className="bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] border border-blue-200">
                          Risk: {statusFilter}
                        </span>
                      )}
                      {urgencyFilter !== 'ALL' && (
                        <span className="bg-orange-100 text-orange-950 px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] border border-orange-200">
                          Urgency: {urgencyFilter === 'TODAY' ? 'Must Collect Today' : urgencyFilter === 'YESTERDAY' ? 'Yesterday Unpaid' : 'Overdue'}
                        </span>
                      )}
                      {selectedTagFilter !== 'ALL' && (
                        <span className="bg-purple-100 text-purple-805 px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] border border-purple-200">
                          Staff: {selectedTagFilter}
                        </span>
                      )}
                      {searchTerm !== '' && (
                        <span className="bg-gray-100 text-gray-805 px-2.5 py-0.5 rounded-full font-bold text-[10px] border border-gray-200">
                          Query: "{searchTerm}"
                        </span>
                      )}
                      <span className="text-gray-400 font-semibold">({filteredDrivers.length} matching entries)</span>
                    </div>
                    <button 
                      type="button"
                      onClick={() => {
                        setStatusFilter('ALL');
                        setUrgencyFilter('ALL');
                        setSelectedTagFilter('ALL');
                        setSearchTerm('');
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold px-3 py-1.5 rounded-lg shadow-sm text-[10px] cursor-pointer"
                    >
                      RESET ALL FILTERS
                    </button>
                  </div>
                )}

                {/* DRIVERS LISTING STAGE */}
                    <div className="space-y-6">
                        {/* Table Header */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-600">
                    <thead className="bg-gray-100 text-xs uppercase font-bold text-gray-500 tracking-wider">
                        <tr>
                            <th colSpan={4} className="p-2 border-b border-gray-200 pb-3">
                                <div className="pr-4 pl-6 flex items-center justify-between gap-4">
                                     <div className="flex-1 text-left">DRIVER PROFILE</div>
                                     <div 
                                        className="w-56 shrink-0 px-8 flex items-center justify-center gap-1 cursor-pointer hover:text-gray-800 transition-colors"
                                        onClick={() => handleSort('RISK_STATUS')}
                                     >
                                         Risk Status
                                         {sortConfig.key === 'RISK_STATUS' && (
                                            sortConfig.direction === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                                         )}
                                     </div>
                                      <div 
                                        className="w-[320px] shrink-0 px-6 flex items-center justify-end gap-1 cursor-pointer hover:text-gray-800 transition-colors"
                                        onClick={() => handleSort('OUTSTANDING')}
                                     >
                                         Outstanding (Base)
                                         {sortConfig.key === 'OUTSTANDING' && (
                                            sortConfig.direction === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                                         )}
                                     </div>
                                     <div className="w-[170px] shrink-0 text-center pl-4">Actions</div>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {filteredDrivers.map((driver, index) => {
                           // (Row Rendering unchanged)
                           const m = driver.metrics;
                           const v = driver.velocityData;
                           const cycleLabel = driver.rentalCycle === 'MONTHLY' ? 'Months' : 'Weeks';
                           const lastPayment = driver.paymentHistory[0]; 
                           const lastPaymentDate = lastPayment && lastPayment.date ? parseDate(lastPayment.date) : null;
                           let showLastPayWarning = false;
                           if (lastPaymentDate && !isNaN(lastPaymentDate.getTime())) {
                               const today = kualaLumpurNow();
                               const diffTime = Math.abs(today.getTime() - lastPaymentDate.getTime());
                               const daysSinceLastPay = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                               const threshold = driver.rentalCycle === 'MONTHLY' ? 30 : 7;
                               showLastPayWarning = daysSinceLastPay > threshold;
                           }
                           const nextDue = getNextDueDate(driver);
                           const currentOutstanding = driver.activeBalance.baseValue;
                           const baselineOutstanding = driver.recoveryBaseline;
                           let labelText = 'Restored';
                           let valueText = '';
                           let progressPercent = 0;
                           let barColorClass = 'bg-gray-300';
                           let isNegativeProgress = false;
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
                                   isNegativeProgress = true;
                                   labelText = 'Slipped';
                                   valueText = `+${formatCurrency(addedDebt)} / ${formatCurrency(baselineOutstanding)}`;
                                   barColorClass = 'bg-rose-500 animate-pulse';
                               } else {
                                   labelText = 'Restored';
                                   valueText = `${formatCurrency(0)} / ${formatCurrency(baselineOutstanding)}`;
                                   progressPercent = 0;
                                   barColorClass = 'bg-gray-200';
                               }
                           } else if (currentOutstanding > 0) {
                               const addedDebt = currentOutstanding;
                               progressPercent = 100;
                               isNegativeProgress = true;
                               labelText = 'Slipped';
                               valueText = `+${formatCurrency(addedDebt)} / ${formatCurrency(driver.rentalRate)}`;
                               barColorClass = 'bg-rose-500 animate-pulse';
                           }
                           const nextDueStr = nextDue && !isNaN(nextDue.getTime()) ? nextDue.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
                           const isRiskyAndSlipping = (m.status === DriverStatus.BAD || m.status === DriverStatus.MID) && v.isSlipping;
                           let behaviorText = 'Consistent Habit';
                           let behaviorColor = 'text-gray-400';
                           if (v.isSlipping) { behaviorText = 'Behavior Worsening'; behaviorColor = 'text-red-600 font-bold'; } 
                           else if (v.isRecovering) { behaviorText = 'Habit Improving'; behaviorColor = 'text-green-600 font-medium'; }
                           const tooltipText = `This driver paid ${Math.round(v.lastLateness)} days late, which is ${Math.round(v.velocity)} days slower than their usual ${Math.round(v.avgLateness)}-day habit. Contact them to prevent further slippage.`;

                        return (
                           <React.Fragment key={driver.id}>
                               
                             <tr id={`driver-row-${driver.id}`}>
                                         <td colSpan={4} className="p-2 border-b border-slate-100 bg-white">
                                             <div className={`bg-white px-4 py-3 rounded-lg shadow-sm border border-slate-200 relative group hover:border-slate-300 transition-colors ${highlightedDriverId === driver.id ? 'ring-2 ring-orange-500 scale-[1.01]' : ''}`}>
                                                 <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${m.status === 'GOOD' ? 'bg-emerald-500' : m.status === 'MID' ? 'bg-amber-500' : 'bg-rose-500'}`}></div>
                                                 
                                                 <div className="flex items-center justify-between gap-4 pl-2">
                                                     {/* DRIVER PROFILE */}
                                                     <div className="flex items-center gap-3 flex-1 min-w-0">
                                                         <button onClick={(e) => { e.stopPropagation(); toggleRowExpand(driver.id); }} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-colors shrink-0 -ml-1">
                                                             <ChevronRight className={`w-4 h-4 transform transition-transform duration-300 ${expandedDriverIds.includes(driver.id) ? 'rotate-90 text-blue-600' : ''}`} />
                                                         </button>
                                                         <div className="min-w-0 flex-1">
                                                             <div className="flex items-center gap-2 flex-wrap">
                                                                 <h3 className="font-bold text-slate-900 text-base truncate">{driver.name}</h3>
                                                                 {!screenedDriverIds.includes(driver.id) && !driver.isDelisted && (
                                                                    <button type="button" onClick={(e) => { e.stopPropagation(); handleScreenDriver(driver.id); }} className="relative flex h-3 w-3 items-center justify-center cursor-pointer group/reddot shrink-0" title="Pending Daily Screening">
                                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600 border border-white hover:bg-rose-700 shadow-sm"></span>
                                                                    </button>
                                                                 )}
                                                                 {screenedDriverIds.includes(driver.id) && !driver.isDelisted && (
                                                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 stroke-[3]" title="Screened Today" />
                                                                 )}
                                                                 {driver.debtTrend.isStreak && <span className="text-sm" title="3-Week Debt Streak">⚠️</span>}
                                                                 {v.isSlipping && <div title="Driver's payment behavior is worsening" className="cursor-help inline-flex"><TrendingDown className="w-4 h-4 text-rose-500 animate-bounce" /></div>}
                                                                 {v.isRecovering && <div title="Driver's payment behavior is improving" className="cursor-help inline-flex"><TrendingUp className="w-4 h-4 text-emerald-500" /></div>}
                                                             </div>
                                                             <div className="flex items-center gap-2 mt-0.5 text-[11px] flex-wrap w-full">
                                                                 <span className="font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{driver.carPlate}</span>
                                                                 <span className="flex items-center gap-1 font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100"><Calendar className="w-3 h-3" /> Due {nextDueStr}</span>
                                                                 {/* TAGS & CATEGORY PLACED TOGETHER TIGHTLY */}
                                                                 {driver.category && <span className={`font-bold px-1.5 py-0.5 uppercase tracking-wider rounded border ${driver.category === 'SEWABELI' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>{driver.category === 'SEWABELI' ? 'Sewabeli' : 'Sewa Biasa'}</span>}
                                                                 {driver.tags?.map((tag, i) => <span key={i} className="bg-slate-50 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-medium">{tag}</span>)}
                                                             </div>
                                                         </div>
                                                     </div>

                                                     {/* RISK STATUS & BEHAVIOR */}
                                                     <div className="flex flex-col items-center justify-center w-56 shrink-0 border-l border-slate-100 px-8">
                                                          <div className="flex items-center gap-2">
                                                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${m.status === 'GOOD' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : m.status === 'MID' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>{m.status}</span>
                                                          </div>
                                                          <div className="text-[10px] font-bold text-slate-500 mt-1">{m.cyclesOwed > 0 ? `${m.cyclesOwed.toFixed(1)} ${cycleLabel} Owed` : 'Up to date'}</div>
                                                          <div className={`text-[10px] ${behaviorColor} font-bold mt-1 text-center`}>{behaviorText}</div>
                                                          {/* LAST PAY POSITIONED RIGHT BELOW BEHAVIOR WORSENING */}
                                                          {lastPaymentDate && !isNaN(lastPaymentDate.getTime()) ? <div className={`text-[9px] font-bold flex items-center justify-center gap-0.5 mt-1 ${showLastPayWarning ? 'text-rose-600' : 'text-slate-400'}`}>{showLastPayWarning && <AlertTriangle className="w-3 h-3" />}Last Pay: {formatDateShort(lastPaymentDate)}</div> : <div className="text-[9px] text-slate-400 mt-1 text-center">No payment yet</div>}
                                                     </div>

                                                     {/* OUTSTANDING ALIGNED RIGHT */}
                                                     <div className="flex flex-col items-end w-[320px] shrink-0 border-l border-slate-100 px-6">
                                                         <div className="flex flex-col items-end gap-1">
                                                             <div className="font-mono font-bold text-xl text-slate-900">
                                                                 {currentOutstanding > 0 ? <span className="text-rose-600">{formatCurrency(currentOutstanding)}</span> : <span className="text-emerald-600">PAID</span>}
                                                             </div>
                                                             {driver.debtTrend.direction !== 'FLAT' && (
                                                                 <div className={`text-[10px] font-bold flex items-center justify-end ${driver.debtTrend.direction === 'UP' ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                                     {driver.debtTrend.direction === 'UP' ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                                                                     {driver.debtTrend.direction === 'UP' ? '+' : '-'}{formatCurrency(driver.debtTrend.value)}
                                                                 </div>
                                                             )}
                                                         </div>
                                                         
                                                         {(currentOutstanding > 0 || baselineOutstanding > 0) && (
                                                             <div className="w-full mt-2 text-left">
                                                                 <div className="flex justify-between items-center text-[10px] font-bold text-gray-700 uppercase tracking-wider mb-1.5 px-0.5 whitespace-nowrap">
                                                                     <span>{labelText}</span>
                                                                     <span className="font-mono ml-2 text-right">{valueText}</span>
                                                                 </div>
                                                                 <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden shadow-inner">
                                                                     <div className={`h-full ${barColorClass} transition-all duration-500`} style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}></div>
                                                                 </div>
                                                             </div>
                                                         )}
                                                     </div>

                                                     {/* ACTIONS STRIP */}
                                                     <div className="flex items-center gap-3 shrink-0 border-l border-slate-100 pl-4 h-full w-[170px]">
                                                          <button onClick={() => handleOpenPaymentModal(driver)} className="w-[90px] justify-center py-2 bg-emerald-500 text-white text-sm font-normal rounded hover:bg-emerald-600 shadow-sm flex items-center gap-1 transition-colors">
                                                              <span className="font-bold text-xs">RM</span> Payment
                                                          </button>
                                                          <div className="flex items-center gap-1 text-slate-400 shrink-0">
                                                              <button onClick={() => handleOpenEditModal(driver)} className="hover:text-slate-600 p-1.5 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200"><Pencil className="w-3.5 h-3.5" /></button>
                                                              {viewMode === 'ACTIVE' ? <button onClick={() => handleDelistClick(driver)} className="hover:text-rose-600 p-1.5 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200"><UserMinus className="w-3.5 h-3.5" /></button> : <button onClick={() => { if(window.confirm('Delete?')) onDeleteDriver(driver.id); }} className="hover:text-rose-600 p-1.5 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200"><Trash2 className="w-3.5 h-3.5" /></button>}
                                                          </div>
                                                     </div>
                                                 </div>
                                             </div>
                                         </td>
                                     </tr>
                                     {expandedDriverIds.includes(driver.id) && (
                                       <tr className="bg-slate-50">
                                         <td colSpan={4} className="px-6 py-4 border-b border-slate-200 shadow-inner">
                                           <ExpandedDriverDetails 
                                             driver={driver} 
                                             onLogPaymentClick={() => handleOpenPaymentModal(driver)} 
                                           />
                                         </td>
                                       </tr>
                                     )}
                                   </React.Fragment>
                      );
                   })}
                </tbody>
             </table>
          </div>
       </div>


                
            </>
         )}
      </div>

                {/* Driver Modal */}
                {isDriverModalOpen && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                                <h2 className="text-xl font-bold text-gray-900">{editingId ? "Edit Driver Profile" : "Add Driver Profile"}</h2>
                                <button onClick={() => setIsDriverModalOpen(false)} title="Close" className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
                            </div>
                            <form onSubmit={handleDriverFormSubmit} className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Full Name</label>
                                    <input required type="text" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Driver Full Name" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Email Address</label>
                                    <input type="email" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="Email (Optional)" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Address</label>
                                    <textarea className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Driver Address"></textarea>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">NRIC</label>
                                        <input required type="text" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.nric} onChange={e => setFormData({...formData, nric: formatNric(e.target.value)})} placeholder="NRIC Number" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Plate Number</label>
                                        <input required type="text" className="w-full border border-gray-300 rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" value={formData.carPlate} onChange={e => setFormData({...formData, carPlate: e.target.value})} placeholder="ABC 1234" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Category</label>
                                        <select className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                                            <option value="SEWABELI">SEWABELI</option>
                                            <option value="SEWA_BIASA">SEWA BIASA</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Rental Rate (Base)</label>
                                        <input required type="number" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.rentalRate} onChange={e => setFormData({...formData, rentalRate: Number(e.target.value)})} min="0" step="0.01" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Start Date</label>
                                        <input required type="date" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.contractStartDate} onChange={e => setFormData({...formData, contractStartDate: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Duration (Wks)</label>
                                        <input required type="number" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.contractDuration} onChange={e => setFormData({...formData, contractDuration: Number(e.target.value)})} min="1" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">End Date</label>
                                        <input type="date" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.contractEndDate} onChange={e => setFormData({...formData, contractEndDate: e.target.value})} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Tags (Press Enter)</label>
                                    <div className="flex gap-2">
                                        <input type="text" list="existing-tags" className="flex-1 border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. SUN" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(e); } }} />
                                        <datalist id="existing-tags">
                                            {Array.from(new Set(drivers.flatMap(d => d.tags || []))).sort().map(tag => <option key={tag} value={tag} />)}
                                        </datalist>
                                        <button type="button" onClick={handleAddTag} className="bg-slate-800 text-white px-3 py-2 rounded text-sm font-bold hover:bg-slate-700 shrink-0">Add Tag</button>
                                    </div>
                                    {formData.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {formData.tags.map(tag => (
                                                <span key={tag} className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 flex items-center gap-1">
                                                    {tag} <button type="button" onClick={() => handleRemoveTag(tag)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                                    <button type="button" onClick={() => setIsDriverModalOpen(false)} className="px-5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                                    <button type="submit" className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">{editingId ? "Save Changes" : "Create Driver"}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Delist Confirmation Modal */}
                {driverToDelist && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
                            <div className="p-6">
                                <div className="flex items-center gap-3 text-rose-600 mb-4">
                                    <AlertTriangle className="w-8 h-8 shrink-0" />
                                    <h2 className="text-xl font-bold text-gray-900">Delist Driver</h2>
                                </div>
                                <p className="text-sm text-gray-600 mb-6">
                                    Are you sure you want to delist <strong>{driverToDelist.name}</strong>? This will mark them as inactive and freeze their active balance.
                                </p>
                                <div className="flex justify-end gap-3">
                                    <button onClick={() => setDriverToDelist(null)} className="px-5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                                    <button onClick={confirmDelist} className="px-5 py-2 bg-rose-600 text-white text-sm font-bold rounded-lg hover:bg-rose-700 transition-colors shadow-sm">Confirm Delist</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Payment Modal */}
                {isPaymentModalOpen && liveDriverForPayment && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
                          <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                              <div>
                                  <h2 className="text-xl font-bold text-gray-900">Driver Payment Panel</h2>
                                  <p className="text-sm text-gray-500">For {liveDriverForPayment.name}</p>
                              </div>
                              <button onClick={() => setIsPaymentModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-6 h-6 text-gray-500" /></button>
                          </div>
                          
                          <div className="flex-1 overflow-y-auto p-6 flex gap-6">
                              <div className="flex-1 space-y-6">
                                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                                      <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                                          <CalendarCheck className="w-4 h-4 text-emerald-600" /> Invoice Schedule
                                      </h3>
                                      {renderPaymentSchedule(liveDriverForPayment)}
                                  </div>

                                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                                      <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <History className="w-4 h-4 text-blue-600" /> Recent 10 Transactions
                                          </div>
                                          <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded">Staff Log</span>
                                      </h3>
                                      <div className="space-y-1.5 max-h-[22rem] overflow-y-auto pr-2 scroll-smooth">
                                        {(liveDriverForPayment?.paymentHistory || []).slice(0,10).map((tx: any) => (
                                          <div key={tx.id} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg border border-gray-100">
                                            {editingTxId === tx.id ? (
                                              <div className="w-full space-y-1">
                                                <div className="flex gap-2">
                                                  <div className="flex-1">
                                                    <label className="text-[9px] font-bold text-gray-500 uppercase">Amount</label>
                                                    <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="w-full p-1 border border-gray-300 rounded text-xs" />
                                                  </div>
                                                  <div className="flex-1">
                                                    <label className="text-[9px] font-bold text-gray-500 uppercase">Claim</label>
                                                    <input type="number" value={editServiceClaim} onChange={e => setEditServiceClaim(e.target.value)} className="w-full p-1 border border-gray-300 rounded text-xs" />
                                                  </div>
                                                </div>
                                                <div className="flex gap-2">
                                                  <div className="flex-1">
                                                    <label className="text-[9px] font-bold text-gray-500 uppercase">Date</label>
                                                    <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="w-full p-1 border border-gray-300 rounded text-xs" />
                                                  </div>
                                                  <div className="flex-1">
                                                    <label className="text-[9px] font-bold text-gray-500 uppercase block mb-0.5">Method</label>
                                                    {(parseFloat(editAmount || '0') === 0 && parseFloat(editServiceClaim || '0') > 0) ? (
                                                      <div className="w-full p-1 border border-amber-200 bg-amber-50 text-amber-700 rounded text-xs font-bold text-center">CLAIM</div>
                                                    ) : (
                                                      <select value={editPaymentMethod || 'BANK TRANSFER'} onChange={e => setEditPaymentMethod(e.target.value as any)} className="w-full p-1 border border-gray-300 rounded text-xs">
                                                        <option value="BANK TRANSFER">Bank Transfer</option>
                                                        <option value="CASH DEPOSIT">Cash Deposit</option>
                                                      </select>
                                                    )}
                                                  </div>
                                                </div>
                                                <div className="flex gap-2 justify-end pt-1">
                                                  <button onClick={handleCancelEditTx} className="text-[10px] text-gray-600 bg-gray-200 hover:bg-gray-300 px-2 py-0.5 rounded transition-colors">Cancel</button>
                                                  <button onClick={() => handleSaveEditTx(tx.id)} className="text-[10px] text-white bg-blue-600 hover:bg-blue-700 px-2 py-0.5 rounded transition-colors">Save</button>
                                                </div>
                                              </div>
                                            ) : (
                                              <>
                                                <div>
                                                    <div className="text-[10px] text-gray-500">{parseDate(tx.date).toLocaleDateString('en-GB')} <span className="font-mono text-[9px] bg-gray-200 px-1 rounded ml-1">ID: {tx.id.slice(-6)}</span></div>
                                                    <div className="text-xs font-bold text-gray-900 mt-0.5 mb-1">Paid: {formatCurrency(tx.amount + (tx.serviceClaim || 0))}</div>
                                                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">{tx.paymentMethod}</span>
                                                </div>
                                                <button onClick={() => handleStartEditTx(tx)} className="text-[10px] text-blue-600 font-semibold hover:bg-blue-50 px-2 py-1.5 rounded transition-colors bg-white border border-blue-100">Edit Figure</button>
                                              </>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                  </div>
                              </div>

                              <div className="w-96 shrink-0">
                                  <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm sticky top-0">
                                      <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2 border-b border-gray-100 pb-2">
                                          <DollarSign className="w-4 h-4 text-blue-600" /> Record New Payment
                                      </h3>
                                      <form onSubmit={handleSubmitPayment} className="space-y-4">
                                          <div className="grid grid-cols-2 gap-4">
                                              <div>
                                                  <label className="text-[10px] font-bold text-gray-500 uppercase">Amount (RM)</label>
                                                  <input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm mt-1" />
                                              </div>
                                              <div>
                                                  <label className="text-[10px] font-bold text-gray-500 uppercase">Claim (RM)</label>
                                                  <input type="number" value={serviceClaimAmount} onChange={(e) => setServiceClaimAmount(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm mt-1" />
                                              </div>
                                          </div>
                                          
                                          <div>
                                              <label className="text-[10px] font-bold text-gray-500 uppercase">Payment Date</label>
                                              <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm mt-1" />
                                          </div>
                                          
                                          <div>
                                            <label className="text-[10px] font-bold text-gray-500 uppercase block mb-2">Payment Method</label>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                              {(parseFloat(paymentAmount || '0') === 0 && parseFloat(serviceClaimAmount || '0') > 0) ? (
                                                <div className="col-span-2 p-2 rounded border bg-amber-50 border-amber-200 text-amber-700 font-bold text-center">
                                                  Claim Only (Auto)
                                                </div>
                                              ) : (
                                                <>
                                                  <button type="button" onClick={() => setPaymentMethod('BANK TRANSFER')} className={`p-2 rounded border ${paymentMethod === 'BANK TRANSFER' ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold' : 'border-gray-300'}`}>Bank Transfer</button>
                                                  <button type="button" onClick={() => setPaymentMethod('CASH DEPOSIT')} className={`p-2 rounded border ${paymentMethod === 'CASH DEPOSIT' ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold' : 'border-gray-300'}`}>Cash Deposit</button>
                                                </>
                                              )}
                                            </div>
                                          </div>

                                          <div className="flex gap-3 pt-4 border-t border-gray-100">
                                              <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="flex-1 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                                              <button type="submit" className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">Confirm</button>
                                          </div>
                                      </form>
                                  </div>
                              </div>
                          </div>
                      </div>
                    </div>
                )}
      {/* Invoice Details Popup Modal */}
      {invoicePopupData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
           <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                  <div>
                      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          <Activity className="w-5 h-5 text-orange-600" /> {invoicePopupData.title}
                      </h2>
                      <p className="text-sm text-gray-500">Showing {invoicePopupData.invoices.length} invoices</p>
                  </div>
                  <button onClick={() => setInvoicePopupData(null)} title="Close" className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
              </div>
              
              <div className="flex-1 overflow-auto">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-gray-100 text-xs uppercase font-bold text-gray-500 sticky top-0">
                          <tr>
                              <th className="px-6 py-3">Driver / Car</th>
                              <th className="px-6 py-3">Due Date</th>
                              <th className="px-6 py-3">Invoice Auth</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                          {invoicePopupData.invoices.map((inv: any) => {
                             const isFull = inv.remainingBalance <= 0.01;
                             return (
                                <tr key={inv.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-gray-900">{inv.driverName}</div>
                                        <div className="text-xs text-gray-500 mt-1 uppercase tracking-wider">{inv.carPlate}</div>
                                    </td>
                                    <td className="px-6 py-4 font-medium text-gray-600">
                                        {(() => { const d = parseDate(inv.dueDate); return d && !isNaN(d.getTime()) ? d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'; })()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm font-medium text-gray-500 mb-1">
                                            {formatCurrency(inv.amountPaid)} / {formatCurrency(inv.amount)}
                                        </div>
                                        <div className="w-48 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-orange-500" style={{ width: `${Math.min(100, Math.max(0, (inv.amountPaid / inv.amount) * 100))}%` }}></div>
                                        </div>
                                    </td>
                                </tr>
                             );
                          })}
                          {invoicePopupData.invoices.length === 0 && (
                              <tr>
                                  <td colSpan={3} className="px-6 py-8 text-center text-gray-400 italic">No invoices found.</td>
                              </tr>
                          )}
                      </tbody>
                  </table>
              </div>
           </div>
        </div>
      )}

        </div>
    </div>
  );
};

export default AdminDashboard;
