
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Driver, DriverStatus, Car, FleetSnapshot } from '../types';
import { calculateDriverMetrics, formatCurrency, analyzePaymentHabit, calculateActiveBalance, generateDriverInvoices } from '../utils';
import DebtCollectionView from './DebtCollectionView';
import AnalyticsView from './AnalyticsView';
import BankReconciliation from './BankReconciliation';
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
  CheckCircle2,
  AlertCircle,
  Archive,
  UserMinus,
  Trash2,
  Calendar,
  Activity,
  PieChart,
  AlertTriangle,
  Clock,
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
  User
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { ExpandedDriverDetails } from './ExpandedDriverDetails';

interface AdminDashboardProps {
  drivers: Driver[];
  cars: Car[];
  snapshots?: FleetSnapshot[];
  userRole: 'admin' | 'staff'; // Role passed from parent
  onUpdatePayment: (driverId: string, amount: number, date: string, serviceClaim?: number, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT') => void;
  onEditPayment?: (paymentId: string, amount: number, serviceClaim: number, date: string, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT') => void;
  onCreateDriver: (driver: Driver) => void;
  onUpdateDriver: (driver: Driver) => void;
  onDelistDriver: (driverId: string) => void;
  onDeleteDriver: (driverId: string) => void;
  onCreateCar: (car: Car) => void;
  onUpdateCar: (car: Car) => void;
  onDeleteCar: (carId: string) => void;
  onLogout: () => void;
  onRefresh: () => Promise<void>;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  drivers, 
  cars,
  snapshots = [],
  userRole, 
  onUpdatePayment, 
  onEditPayment,
  onCreateDriver, 
  onUpdateDriver, 
  onDelistDriver,
  onDeleteDriver,
  onCreateCar,
  onUpdateCar,
  onDeleteCar,
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
  
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'DELISTED' | 'CARS' | 'DEBT_COLLECTION' | 'ANALYTICS' | 'RECONCILE' | 'DRIVER_LIST'>(() => {
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
  const [driverListSortConfig, setDriverListSortConfig] = useState<{ direction: 'asc' | 'desc' | null }>({ direction: null });

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
  const [isCarModalOpen, setIsCarModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isArrearsModalOpen, setIsArrearsModalOpen] = useState(false);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  
  // Weekly Detail Modal State
  const [selectedWeek, setSelectedWeek] = useState<any>(null);
  
  // Confirmation Modal State
  const [driverToDelist, setDriverToDelist] = useState<Driver | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCarId, setEditingCarId] = useState<string | null>(null);
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
        const anchor = document.getElementById('current-invoice-anchor');
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
    nric: '',
    // contactNumber removed
    carPlate: '',
    contractStartDate: new Date().toISOString().split('T')[0],
    contractEndDate: '',
    category: 'SEWABELI' as 'SEWABELI' | 'SEWA_BIASA',
    rentalCycle: 'WEEKLY' as 'WEEKLY' | 'MONTHLY',
    contractDuration: 52,
    rentalRate: 400,
    tags: [] as string[]
  };

  const [formData, setFormData] = useState(initialFormState);
  const [carFormData, setCarFormData] = useState({
    make: '',
    model: '',
    plateNumber: '',
    roadtaxExpiry: '',
    insuranceExpiry: '',
    inspectionExpiry: '',
    notes: ''
  });
  const [tagInput, setTagInput] = useState('');
  
  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState('');
  const [serviceClaimAmount, setServiceClaimAmount] = useState('0');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'BANK TRANSFER' | 'CASH DEPOSIT' | null>(null);

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
    const parts = formatter.formatToParts(new Date());
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

  // --- Security Logic ---
  useEffect(() => {
    // Access Restriction: If staff is on CARS tab, redirect to ACTIVE
    if (userRole === 'staff' && viewMode === 'CARS') {
      setViewMode('ACTIVE');
    }
  }, [userRole, viewMode]);

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
    if (formData.contractStartDate && formData.contractEndDate) {
      const start = new Date(formData.contractStartDate);
      const end = new Date(formData.contractEndDate);
      
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let calculatedDuration = 0;
        if (formData.rentalCycle === 'MONTHLY') {
          calculatedDuration = Math.ceil(diffDays / 30); // Approx
        } else {
          calculatedDuration = Math.ceil(diffDays / 7);
        }
        
        setFormData(prev => ({
          ...prev,
          contractDuration: calculatedDuration
        }));
      }
    }
  }, [formData.contractStartDate, formData.contractEndDate, formData.rentalCycle]);


  // Enhance drivers with metrics for sorting
  const driverData = useMemo(() => drivers.map(d => {
    // Basic financial metrics
    const metrics = calculateDriverMetrics(d);
    // Unified Calculation for Active Balance
    const activeBalance = calculateActiveBalance(d);

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
    const sevenDaysAgo = new Date();
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
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const metrics14 = calculateDriverMetrics(d, fourteenDaysAgo);
    const debt14 = metrics14.principalOutstanding;

    const twentyOneDaysAgo = new Date();
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
    const today = new Date();
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
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    if (dDate >= startOfWeek && dDate <= endOfWeek) {
      return acc + inv.amount;
    }
    return acc;
  }, 0), [allInvoices, startOfWeek, endOfWeek]);

  const weeklyCollectedAmount = useMemo(() => allInvoices.reduce((acc, inv) => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    if (dDate >= startOfWeek && dDate <= endOfWeek) {
      return acc + inv.amountPaid;
    }
    return acc;
  }, 0), [allInvoices, startOfWeek, endOfWeek]);

  const monthlyTargetAmount = useMemo(() => allInvoices.reduce((acc, inv) => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    if (dDate >= startOfMonth && dDate <= endOfMonth) {
      return acc + inv.amount;
    }
    return acc;
  }, 0), [allInvoices, startOfMonth, endOfMonth]);

  const monthlyCollectedAmount = useMemo(() => allInvoices.reduce((acc, inv) => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
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
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    return dDate >= yesterdayStart && dDate <= yesterdayEnd;
  }), [unpaidInvoices, yesterdayStart, yesterdayEnd]);

  const overdue = useMemo(() => unpaidInvoices.filter(inv => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    return dDate < yesterdayStart;
  }), [unpaidInvoices, yesterdayStart]);

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Calculate top 10 active drivers whose last paid was 8 or more days ago
  const habitualLateAlerts = useMemo(() => {
    const alerts: { driver: Driver; daysSinceLastPay: number }[] = [];
    const todayRef = new Date();
    todayRef.setHours(0,0,0,0);

    driverData.filter(d => !d.isDelisted).forEach(d => {
      const lastPayment = d.paymentHistory && d.paymentHistory.length > 0 ? d.paymentHistory[0] : null;
      if (lastPayment) {
        const lastPaymentDate = new Date(lastPayment.date);
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
        const contractStartDate = new Date(d.contractStartDate);
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
  const totalArrears = driverData.filter(d => !d.isDelisted).reduce((sum, d) => sum + Math.max(0, d.activeBalance.baseValue), 0);
  const badDriversCount = driverData.filter(d => !d.isDelisted && d.metrics.status === DriverStatus.BAD).length;
  const midDriversCount = driverData.filter(d => !d.isDelisted && d.metrics.status === DriverStatus.MID).length;
  const goodDriversCount = driverData.filter(d => !d.isDelisted && d.metrics.status === DriverStatus.GOOD).length;
  const activeFleetCount = driverData.filter(d => !d.isDelisted).length;

  const lastSnapshot = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return null;
    return snapshots[snapshots.length - 1];
  }, [snapshots]);

  const getMonthlyCollectionBreakdown = () => {
    const breakdown: Record<string, number> = {};
    drivers.forEach(driver => {
      if (driver.paymentHistory) {
        driver.paymentHistory.forEach(payment => {
            const date = new Date(payment.date);
            const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            breakdown[monthKey] = (breakdown[monthKey] || 0) + payment.amount + (payment.serviceClaim || 0);
        });
      }
    });
    return Object.entries(breakdown).map(([month, amount]) => ({ month, amount })).sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  };

  // --- Helpers ---
  const formatSnapshotDateFriendly = (dateStr: string): string => {
    try {
      const parts = dateStr.split('-');
      if (parts.length !== 3) return dateStr;
      const day = parseInt(parts[2], 10);
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months[parseInt(parts[1], 10) - 1] || 'month';
      
      let j = day % 10, k = day % 100;
      let suffix = "th";
      if (j === 1 && k !== 11) {
          suffix = "st";
      } else if (j === 2 && k !== 12) {
          suffix = "nd";
      } else if (j === 3 && k !== 13) {
          suffix = "rd";
      }
      return `${day}${suffix} ${month}`;
    } catch (e) {
      return dateStr;
    }
  };

  const renderTrendIndicator = (current: number, previous: number, type: 'GOOD' | 'MID' | 'BAD') => {
    if (!lastSnapshot) {
      return (
        <span className="text-[9px] text-gray-400 block mt-1">
          No baseline snapshot
        </span>
      );
    }

    const diff = current - previous;
    const friendlyDate = formatSnapshotDateFriendly(lastSnapshot.snapshot_date);
    
    let isPositiveAspect = false;
    if (type === 'GOOD') {
      isPositiveAspect = diff > 0;
    } else {
      isPositiveAspect = diff < 0; 
    }

    const isUnchanged = diff === 0;
    const diffPrefixed = diff > 0 ? `+${diff}` : `${diff}`;
    
    let textColorClass = "text-gray-500";
    let bgClass = "bg-gray-100 border-gray-200 text-gray-600";
    let Icon = Minus;

    if (!isUnchanged) {
      if (isPositiveAspect) {
        textColorClass = "text-emerald-700 font-bold";
        bgClass = "bg-emerald-50 border-emerald-200 text-emerald-700";
        Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
      } else {
        textColorClass = "text-red-700 font-bold";
        bgClass = "bg-red-50 border-red-200 text-red-700";
        Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
      }
    }

    return (
      <div className="flex flex-col items-center mt-1.5 space-y-1">
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full border ${bgClass} ${textColorClass}`}>
          <Icon className="w-2.5 h-2.5 stroke-[2.5]" />
          {isUnchanged ? "Unchanged" : diffPrefixed}
        </span>
        <span className="text-[10px] text-gray-400 block font-medium">
          vs {friendlyDate}
        </span>
      </div>
    );
  };

  const formatNric = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    const truncated = cleaned.slice(0, 12);
    if (truncated.length > 8) return `${truncated.slice(0, 6)}-${truncated.slice(6, 8)}-${truncated.slice(8)}`;
    else if (truncated.length > 6) return `${truncated.slice(0, 6)}-${truncated.slice(6)}`;
    return truncated;
  };

  const formatDateShort = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
  };

  const getNextDueDate = (driver: Driver) => {
    const cyclesPaid = driver.rentalRate > 0 ? driver.totalAmountPaid / driver.rentalRate : 0;
    const fullCycles = Math.floor(cyclesPaid);
    
    // Ensure we don't project a date beyond the contract end
    const maxCycleIndex = Math.max(0, driver.contractDuration - 1);
    const cycleIndex = Math.min(fullCycles, maxCycleIndex);
    
    const startDate = new Date(driver.contractStartDate);
    const nextDueDate = new Date(startDate);
    
    if (driver.rentalCycle === 'MONTHLY') {
        nextDueDate.setMonth(startDate.getMonth() + cycleIndex);
    } else {
        nextDueDate.setDate(startDate.getDate() + (cycleIndex * 7));
    }
    
    return nextDueDate;
  };

  const currentMonthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const currentMonthCollection = getMonthlyCollectionBreakdown().find(b => b.month === currentMonthName)?.amount || 0;

  // --- Handlers ---
  const handleSearchFocus = () => {
    tableContainerRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { searchInputRef.current?.focus(); }, 500);
  };

  const handleOpenPaymentModal = (driver: Driver) => {
    handleScreenDriver(driver.id);
    setSelectedDriverForPayment(driver);
    setPaymentAmount(driver.rentalRate.toString());
    setPaymentDate(new Date().toISOString().split('T')[0]); 
    setPaymentMethod(null); // start empty
    setIsPaymentModalOpen(true);
  };

  const handleDelistClick = (driver: Driver) => { setDriverToDelist(driver); };
  const confirmDelist = () => { if (driverToDelist) { onDelistDriver(driverToDelist.id); setDriverToDelist(null); } };
  
  const handleSubmitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriverForPayment) return;
    const amount = parseFloat(paymentAmount);
    const serviceClaim = parseFloat(serviceClaimAmount) || 0;
    if (isNaN(amount) || amount < 0) { alert("Invalid amount."); return; }
    if (!paymentDate) { alert("Select date."); return; }
    if (!paymentMethod) { alert("Please select either BANK TRANSFER or CASH DEPOSIT."); return; }
    onUpdatePayment(selectedDriverForPayment.id, amount, paymentDate, serviceClaim, paymentMethod);
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
    let finalDuration = formData.contractDuration;
    if (formData.contractStartDate && formData.contractEndDate) {
        const start = new Date(formData.contractStartDate);
        const end = new Date(formData.contractEndDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (formData.rentalCycle === 'MONTHLY') {
            finalDuration = Math.ceil(diffDays / 30);
        } else {
            finalDuration = Math.ceil(diffDays / 7);
        }
    }

    const submissionData = { ...formData, contractDuration: finalDuration };

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
  };

  const handleCarFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!carFormData.make || !carFormData.model || !carFormData.plateNumber) {
        alert("Missing fields.");
        return;
    }

    if (editingCarId) {
        onUpdateCar({ id: editingCarId, ...carFormData });
    } else {
        onCreateCar({ id: Date.now().toString(), ...carFormData });
    }
    setIsCarModalOpen(false);
  };

  const renderPaymentSchedule = (driver: Driver) => {
    const schedule = [];
    const startDate = new Date(driver.contractStartDate);
    let remainingPayment = driver.totalAmountPaid;
    const now = new Date();
    let effectiveEndDate = now;
    if (driver.isDelisted && driver.delistDate) { effectiveEndDate = new Date(driver.delistDate); }

    let anchorFound = false;

    for (let i = 0; i < driver.contractDuration; i++) {
      const itemDate = new Date(startDate);
      if (driver.rentalCycle === 'MONTHLY') itemDate.setMonth(startDate.getMonth() + i);
      else itemDate.setDate(startDate.getDate() + (i * 7));
      
      const isDue = itemDate <= now;
      const isFutureDelisted = itemDate > effectiveEndDate && driver.isDelisted; 
      let status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'CANCELLED' | 'FUTURE' = 'FUTURE';
      let paidForThisCycle = 0;
      let isAdvance = false;

      if (isFutureDelisted) status = 'CANCELLED';
      else {
          if (remainingPayment >= driver.rentalRate - 0.01) {
            status = 'PAID'; paidForThisCycle = driver.rentalRate; remainingPayment -= driver.rentalRate;
            if (!isDue) isAdvance = true;
          } else if (remainingPayment > 0.01) {
            status = 'PARTIAL'; paidForThisCycle = remainingPayment; remainingPayment = 0;
            if (!isDue) isAdvance = true;
          } else {
            if (isDue) status = 'UNPAID';
            else status = 'FUTURE';
          }
      }
      
      let isAnchor = false;
      if (!anchorFound && (status === 'PARTIAL' || status === 'UNPAID')) {
        isAnchor = true;
        anchorFound = true;
      }

      schedule.push({
        no: i + 1, date: itemDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }),
        amount: driver.rentalRate, paid: paidForThisCycle, status, isDue: isDue && status !== 'CANCELLED' && status !== 'FUTURE', isAdvance, isAnchor
      });
    }

    return (
      <div className="space-y-1">
        <div className="grid grid-cols-4 text-xs font-semibold text-gray-500 uppercase px-3 mb-2">
          <div>Due Date</div><div>Cycle</div><div className="text-right">Status</div><div className="text-right">Paid / Due</div>
        </div>
        <div className="max-h-64 overflow-y-auto pr-2 space-y-2 pb-10 scroll-smooth">
          {schedule.map((item) => (
            <div key={item.no} id={item.isAnchor ? 'current-invoice-anchor' : undefined} className={`grid grid-cols-4 items-center text-sm p-2 rounded-lg border transition-colors ${
                item.status === 'CANCELLED' ? 'bg-gray-100 border-gray-200 opacity-60' :
                item.isAdvance ? 'bg-indigo-50 border-indigo-100' :
                item.status === 'PAID' ? 'bg-green-50 border-green-100' :
                item.status === 'PARTIAL' ? 'bg-yellow-50 border-yellow-100' :
                item.status === 'UNPAID' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100 text-gray-400'
              }`}>
              <div className="text-gray-600">{item.date}</div>
              <div className="font-medium text-gray-800">{driver.rentalCycle === 'MONTHLY' ? `Month ${item.no}` : `Week ${item.no}`}</div>
              <div className="text-right">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                   item.status === 'CANCELLED' ? 'bg-gray-300 text-gray-600' : item.isAdvance ? 'bg-indigo-100 text-indigo-700' : item.status === 'PAID' ? 'bg-green-200 text-green-800' : item.status === 'PARTIAL' ? 'bg-yellow-200 text-yellow-800' : item.status === 'UNPAID' ? 'bg-red-200 text-red-800' : 'bg-gray-200 text-gray-500'
                }`}>{item.isAdvance ? (item.status === 'PARTIAL' ? 'ADVANCE' : 'ADVANCE') : item.status}</span>
              </div>
              <div className="text-right font-mono text-xs">
                {item.status === 'PAID' ? <span className="text-green-600 font-bold"><Check className="w-3 h-3 inline"/> {formatCurrency(item.amount)}</span> :
                 item.status === 'CANCELLED' || item.status === 'FUTURE' ? <span>{formatCurrency(item.amount)}</span> :
                 <span className="text-red-600 font-bold">{formatCurrency(item.paid)} / {formatCurrency(item.amount)}</span>}
              </div>
            </div>
          ))}
        </div>
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
        
        {/* Immediate Capture Alert Feed - deactivated */}
        {false && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex items-center h-16 relative">
                 <div className="bg-gray-900 text-white px-4 h-full flex items-center gap-2 z-10 shrink-0 shadow-md">
                    <Siren className="w-5 h-5 text-red-500 animate-pulse" />
                    <div className="flex flex-col leading-tight">
                        <span className="font-bold text-sm tracking-wide uppercase">Immediate Capture</span>
                        <span className="text-[10px] text-gray-400 font-medium tracking-wider">LIVE FEED</span>
                    </div>
                 </div>
                 
                 <div className="flex-1 overflow-x-auto whitespace-nowrap p-3 flex items-center gap-3 no-scrollbar mask-image-gradient">
                     {/* Alert Feed Items */}
                     {[].map((alert: any) => (
                         <div key={alert.id} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold shadow-sm shrink-0 transition-transform hover:scale-105 cursor-default
                             ${alert.type === 'CRITICAL' 
                                ? 'bg-red-100 text-red-800 border-red-200 ring-1 ring-red-300' 
                                : alert.type === 'GOOD' ? 'bg-green-100 text-green-800 border-green-200' 
                                : 'bg-amber-100 text-amber-800 border-amber-200'
                             }`}>
                             {alert.type === 'CRITICAL' ? (
                                 <AlertOctagon className="w-3 h-3 text-red-600 animate-pulse" />
                             ) : alert.type === 'GOOD' ? (
                                 <TrendingUp className="w-3 h-3 text-green-600" />
                             ) : (
                                 <TrendingDown className="w-3 h-3 text-amber-600" />
                             )}
                             <span>{alert.driver.name}</span>
                             <span className="opacity-70 font-normal border-l border-current pl-2 ml-1">
                                 {alert.msg}
                             </span>
                         </div>
                     ))}
                     {[].length === 0 && (
                         <div className="text-sm text-gray-400 italic flex items-center gap-2 pl-2">
                             <CheckCircle2 className="w-4 h-4 text-green-500" /> Fleet performance stable. No alerts.
                         </div>
                     )}
                 </div>
                 
                 <div className="bg-gradient-to-l from-white via-white/80 to-transparent w-16 h-full absolute right-0 pointer-events-none z-10"></div>
            </div>
        )}

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
                    <span className="text-5xl font-black text-emerald-600 my-2 font-sans">{goodDriversCount}</span>
                    {renderTrendIndicator(goodDriversCount, lastSnapshot ? lastSnapshot.good_count : 0, 'GOOD')}
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
                    <span className="text-5xl font-black text-amber-500 my-2 font-sans">{midDriversCount}</span>
                    {renderTrendIndicator(midDriversCount, lastSnapshot ? lastSnapshot.mid_count : 0, 'MID')}
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
                    <span className="text-5xl font-black text-rose-600 my-2 font-sans">{badDriversCount}</span>
                    {renderTrendIndicator(badDriversCount, lastSnapshot ? lastSnapshot.bad_count : 0, 'BAD')}
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

        {/* KPI Cards Grid - unchanged */}
        {false && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 relative overflow-hidden">
            <div className="flex justify-between items-start relative z-0">
              <div className="w-full">
                <p className="text-sm font-medium text-gray-500">Active Arrears</p>
                {userRole === 'staff' ? (
                  <div className="relative mt-1 w-full">
                     <h3 className="text-2xl font-bold text-gray-900 blur-md select-none opacity-50">RM 14,250.00</h3>
                     <div className="absolute inset-0 flex items-center justify-start">
                         <div className="bg-gray-100/90 backdrop-blur-sm px-2 py-1 rounded border border-gray-200 flex items-center gap-1.5 shadow-sm">
                             <Lock className="w-3 h-3 text-gray-500" />
                             <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Restricted Access</span>
                         </div>
                     </div>
                  </div>
                ) : (
                  <h3 className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(totalArrears)}</h3>
                )}
              </div>
              
              {userRole === 'admin' && (
                <button onClick={() => setIsArrearsModalOpen(true)} className="p-2 bg-red-100 rounded-lg hover:bg-red-200 transition-colors cursor-pointer shadow-sm active:scale-95">
                  <TrendingUp className="w-5 h-5 text-red-600" />
                </button>
              )}
            </div>
          </div>
          
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <div className="w-full">
                <p className="text-sm font-medium text-gray-500">Current Month Inflow</p>
                {userRole === 'staff' ? (
                   <div className="relative mt-1 w-full">
                     <h3 className="text-2xl font-bold text-green-600 blur-md select-none opacity-50">RM 48,000.00</h3>
                     <div className="absolute inset-0 flex items-center justify-start">
                         <div className="bg-gray-100/90 backdrop-blur-sm px-2 py-1 rounded border border-gray-200 flex items-center gap-1.5 shadow-sm">
                             <Lock className="w-3 h-3 text-gray-500" />
                             <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Restricted Access</span>
                         </div>
                     </div>
                  </div>
                ) : (
                  <h3 className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(currentMonthCollection)}</h3>
                )}
              </div>
              
              {userRole === 'admin' && (
                <button onClick={() => setIsCollectionModalOpen(true)} className="p-2 bg-green-100 rounded-lg hover:bg-green-200 transition-colors cursor-pointer shadow-sm active:scale-95">
                  <PieChart className="w-5 h-5 text-green-600" />
                </button>
              )}
            </div>
             <div className="mt-2 text-xs text-gray-400">Month: {currentMonthName}</div>
          </div>
          
          {/* Performance Summary Card */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-500">Fleet Health</p>
                  <Activity className="w-4 h-4 text-gray-400" />
              </div>
              <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                      <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500"></div> Bad</span>
                      <span className="font-bold text-gray-900">{badDriversCount}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-red-500 h-1.5 rounded-full transition-all duration-1000" style={{ width: `${activeFleetCount > 0 ? (badDriversCount/activeFleetCount)*100 : 0}%` }}></div>
                  </div>
                   <div className="flex justify-between items-center text-xs pt-1">
                      <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Mid</span>
                      <span className="font-bold text-gray-900">{midDriversCount}</span>
                  </div>
                   <div className="flex justify-between items-center text-xs pt-1">
                      <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500"></div> Good</span>
                      <span className="font-bold text-gray-900">{goodDriversCount}</span>
                  </div>
              </div>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 relative group cursor-pointer" onClick={handleSearchFocus}>
             <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-gray-500">Active Fleet</p>
                <h3 className="text-2xl font-bold text-gray-900 mt-1">{activeFleetCount}</h3>
              </div>
              <button className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors"><Search className="w-5 h-5 text-blue-600" /></button>
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
              <button onClick={() => setViewMode('CARS')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'CARS' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><CarIcon className="w-4 h-4" /> Fleet Management</button>
              <button onClick={() => setViewMode('DRIVER_LIST')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'DRIVER_LIST' ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><Users className="w-4 h-4" /> Driver List</button>
              <button onClick={() => setViewMode('ANALYTICS')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'ANALYTICS' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><PieChart className="w-4 h-4" /> Analytics</button>
              <button onClick={() => setViewMode('RECONCILE')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'RECONCILE' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><CheckCircle2 className="w-4 h-4" /> Bank Recon</button>
            </>
          )}
        </div>

        {/* Main Table Section - unchanged */}
        <div ref={tableContainerRef} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[500px] print:shadow-none print:border-none print:bg-transparent">
          {viewMode === 'CARS' ? (
             /* --- CARS VIEW --- */
             <div>
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                        <CarIcon className="w-5 h-5 text-blue-600" /> Fleet Management
                    </h2>
                    <button 
                        onClick={() => {
                            setEditingCarId(null);
                            setCarFormData({
                                make: '',
                                model: '',
                                plateNumber: '',
                                roadtaxExpiry: '',
                                insuranceExpiry: '',
                                inspectionExpiry: '',
                                notes: ''
                            });
                            setIsCarModalOpen(true);
                        }}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" /> Add New Car
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-500">
                            <tr>
                                <th className="px-6 py-3">Car Details</th>
                                <th className="px-6 py-3">Plate Number</th>
                                <th className="px-6 py-3">Roadtax Expiry</th>
                                <th className="px-6 py-3">Insurance Expiry</th>
                                <th className="px-6 py-3">Inspection Expiry</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {cars.map(car => (
                                <tr key={car.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-gray-900">{car.make} {car.model}</div>
                                        {car.notes && <div className="text-xs text-gray-500 mt-1">{car.notes}</div>}
                                    </td>
                                    <td className="px-6 py-4 font-mono font-bold text-blue-600">{car.plateNumber}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-gray-400" />
                                            {car.roadtaxExpiry}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <Shield className="w-4 h-4 text-gray-400" />
                                            {car.insuranceExpiry}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <Wrench className="w-4 h-4 text-gray-400" />
                                            {car.inspectionExpiry}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button 
                                                onClick={() => {
                                                    setEditingCarId(car.id);
                                                    setCarFormData({
                                                        make: car.make,
                                                        model: car.model,
                                                        plateNumber: car.plateNumber,
                                                        roadtaxExpiry: car.roadtaxExpiry,
                                                        insuranceExpiry: car.insuranceExpiry,
                                                        inspectionExpiry: car.inspectionExpiry,
                                                        notes: car.notes || ''
                                                    });
                                                    setIsCarModalOpen(true);
                                                }}
                                                className="p-1 text-gray-400 hover:text-blue-600"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    if (window.confirm(`Delete car ${car.plateNumber}?`)) {
                                                        onDeleteCar(car.id);
                                                    }
                                                }}
                                                className="p-1 text-gray-400 hover:text-red-600"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {cars.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500 italic">No cars found in fleet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
             </div>
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
                                <th className="px-6 py-3">Full Name</th>
                                <th className="px-6 py-3">NRIC</th>
                                <th className="px-6 py-3">Plate Number</th>
                                <th 
                                  className="px-6 py-3 cursor-pointer hover:text-gray-800 transition-colors group select-none"
                                  onClick={() => setDriverListSortConfig(prev => ({ direction: prev.direction === 'asc' ? 'desc' : prev.direction === 'desc' ? null : 'asc' }))}
                                >
                                  <div className="flex items-center gap-1">
                                    Category
                                    <span className={`text-[10px] ${driverListSortConfig.direction ? 'text-blue-600' : 'text-gray-300 group-hover:text-gray-500'}`}>
                                      {driverListSortConfig.direction === 'asc' ? '▲' : driverListSortConfig.direction === 'desc' ? '▼' : '↕'}
                                    </span>
                                  </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {(() => {
                                const driverListSorted = [...driverData.filter(d => !d.isDelisted)];
                                if (driverListSortConfig.direction) {
                                  driverListSorted.sort((a, b) => {
                                    const valA = a.category || '';
                                    const valB = b.category || '';
                                    if (valA < valB) return driverListSortConfig.direction === 'asc' ? -1 : 1;
                                    if (valA > valB) return driverListSortConfig.direction === 'asc' ? 1 : -1;
                                    return 0;
                                  });
                                }
                                return driverListSorted.map(driver => (
                                <tr key={driver.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 font-bold text-gray-900">{driver.name}</td>
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
                                </tr>
                                ));
                            })()}
                            {driverData.filter(d => !d.isDelisted).length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">No active drivers found.</td>
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
                           const lastPaymentDate = lastPayment ? new Date(lastPayment.date) : null;
                           let showLastPayWarning = false;
                           if (lastPaymentDate) {
                               const today = new Date();
                               const diffTime = Math.abs(today.getTime() - lastPaymentDate.getTime());
                               const daysSinceLastPay = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                               const threshold = driver.rentalCycle === 'MONTHLY' ? 30 : 7;
                               showLastPayWarning = daysSinceLastPay > threshold;
                           }
                           const nextDue = getNextDueDate(driver);
                           const excessPaymentTotal = 0; // legacy unused;
                               // legacy reduce cleared
                           const currentOutstanding = driver.activeBalance.baseValue;
                           const startOfToday = new Date('2026-05-27T00:00:00Z');
                           const baselineOutstanding = calculateActiveBalance(driver, startOfToday).baseValue;
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
                               valueText = `+${formatCurrency(addedDebt)} / ${formatCurrency(driver.weeklyRate || driver.rentalRate || 380)}`;
                               barColorClass = 'bg-rose-500 animate-pulse';
                           }
                           // totalOutstandingLimit legacy cleared
                           // duplicate progressPercent cleared
                           const nextDueStr = nextDue.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
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
                                                          {lastPaymentDate ? <div className={`text-[9px] font-bold flex items-center justify-center gap-0.5 mt-1 ${showLastPayWarning ? 'text-rose-600' : 'text-slate-400'}`}>{showLastPayWarning && <AlertTriangle className="w-3 h-3" />}Last Pay: {formatDateShort(lastPaymentDate.toISOString())}</div> : <div className="text-[9px] text-slate-400 mt-1 text-center">No payment yet</div>}
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
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">NRIC</label>
                                        <input required type="text" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.nric} onChange={e => setFormData({...formData, nric: e.target.value})} placeholder="NRIC Number" />
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
                                        <input type="text" className="flex-1 border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. SUN" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(e); } }} />
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
                                                    <select value={editPaymentMethod || 'BANK TRANSFER'} onChange={e => setEditPaymentMethod(e.target.value as any)} className="w-full p-1 border border-gray-300 rounded text-xs">
                                                      <option value="BANK TRANSFER">Bank Transfer</option>
                                                      <option value="CASH DEPOSIT">Cash Deposit</option>
                                                    </select>
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
                                                    <div className="text-[10px] text-gray-500">{new Date(tx.date).toLocaleDateString()} <span className="font-mono text-[9px] bg-gray-200 px-1 rounded ml-1">ID: {tx.id.slice(-6)}</span></div>
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
                                              <button type="button" onClick={() => setPaymentMethod('BANK TRANSFER')} className={`p-2 rounded border ${paymentMethod === 'BANK TRANSFER' ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold' : 'border-gray-300'}`}>Bank Transfer</button>
                                              <button type="button" onClick={() => setPaymentMethod('CASH DEPOSIT')} className={`p-2 rounded border ${paymentMethod === 'CASH DEPOSIT' ? 'bg-blue-50 border-blue-500 text-blue-700 font-bold' : 'border-gray-300'}`}>Cash Deposit</button>
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
            </>
         )}
      </div>

      {/* Arrears/Week/Collection Modals - unchanged */}
      {isArrearsModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
           <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                  <div>
                      <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                          <TrendingUp className="w-5 h-5 text-red-600" /> Active Arrears Report
                      </h2>
                      <p className="text-sm text-gray-500 mt-1">Breakdown of all outstanding base amounts (penalties excluded).</p>
                  </div>
                  <button onClick={() => setIsArrearsModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
              </div>
              <div className="flex-1 overflow-auto p-0">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-gray-100 text-xs uppercase font-bold text-gray-500 sticky top-0">
                          <tr>
                              <th className="px-6 py-3">Driver</th>
                              <th className="px-6 py-3 text-center">Status</th>
                              <th className="px-6 py-3 text-right">Base Outstanding</th>
                              <th className="px-6 py-3 text-right">Cycles Owed</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                          {driverData.filter(d => !d.isDelisted && d.activeBalance.baseValue > 0)
                            .sort((a, b) => b.activeBalance.baseValue - a.activeBalance.baseValue)
                            .map(d => (
                              <tr key={d.id} className="hover:bg-red-50/30">
                                  <td className="px-6 py-4 font-medium text-gray-900">{d.name}</td>
                                  <td className="px-6 py-4 text-center">
                                      <span className={`px-2 py-1 rounded text-xs font-bold ${d.metrics.status === 'BAD' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{d.metrics.status}</span>
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono text-red-600 font-bold">{formatCurrency(d.activeBalance.baseValue)}</td>
                                  <td className="px-6 py-4 text-right">{d.metrics.cyclesOwed.toFixed(1)}</td>
                              </tr>
                          ))}
                          {driverData.filter(d => !d.isDelisted && d.activeBalance.baseValue > 0).length === 0 && (
                              <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-400 italic">No active arrears! Great job.</td></tr>
                          )}
                      </tbody>
                  </table>
              </div>
              <div className="p-4 bg-gray-50 border-t border-gray-200 text-right">
                   <span className="text-sm font-medium text-gray-500 mr-2">Total Arrears:</span>
                   <span className="text-lg font-bold text-red-600">{formatCurrency(totalArrears)}</span>
              </div>
           </div>
        </div>
      )}
      
      {/* Monthly Collection Modal */}
      {isCollectionModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
             <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                 <div className="p-6 bg-green-600 text-white flex justify-between items-center">
                     <h2 className="text-lg font-bold flex items-center gap-2"><PieChart className="w-5 h-5"/> Monthly Collections</h2>
                     <button onClick={() => setIsCollectionModalOpen(false)} className="text-green-100 hover:text-white"><X className="w-5 h-5" /></button>
                 </div>
                 <div className="p-0 max-h-[60vh] overflow-y-auto">
                     <table className="w-full text-left text-sm">
                         <tbody className="divide-y divide-gray-100">
                             {getMonthlyCollectionBreakdown().reverse().map((item, idx) => (
                                 <tr key={item.month} className={idx === 0 ? "bg-green-50" : ""}>
                                     <td className="px-6 py-4 font-medium text-gray-700">{item.month}</td>
                                     <td className="px-6 py-4 text-right font-bold text-gray-900">{formatCurrency(item.amount)}</td>
                                 </tr>
                             ))}
                         </tbody>
                     </table>
                 </div>
             </div>
          </div>
      )}

      {/* Week Details Modal */}
      {selectedWeek && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
           <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                  <div>
                      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          <Activity className="w-5 h-5 text-blue-600" /> Week Breakdown
                      </h2>
                      <p className="text-sm text-gray-500">{selectedWeek.fullLabel}</p>
                  </div>
                  <button onClick={() => setSelectedWeek(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
              </div>
              
              <div className="bg-white p-4 grid grid-cols-4 gap-4 border-b border-gray-100">
                   <div className="p-3 bg-gray-50 rounded-lg">
                       <div className="text-xs text-gray-500 uppercase font-bold">Expected</div>
                       <div className="text-lg font-bold text-gray-800">{formatCurrency(selectedWeek.expected)}</div>
                   </div>
                   <div className="p-3 bg-green-50 rounded-lg">
                       <div className="text-xs text-green-700 uppercase font-bold">Collected</div>
                       <div className="text-lg font-bold text-green-700">{formatCurrency(selectedWeek.collected)}</div>
                   </div>
                   <div className="p-3 bg-gray-50 rounded-lg">
                       <div className="text-xs text-gray-500 uppercase font-bold">Variance</div>
                       <div className={`text-lg font-bold ${selectedWeek.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                           {selectedWeek.variance > 0 ? '+' : ''}{formatCurrency(selectedWeek.variance)}
                       </div>
                   </div>
                   <div className="p-3 bg-gray-50 rounded-lg">
                       <div className="text-xs text-gray-500 uppercase font-bold">Rate</div>
                       <div className="text-lg font-bold text-blue-600">{Math.round(selectedWeek.rate)}%</div>
                   </div>
              </div>

              <div className="flex-1 overflow-auto">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-gray-100 text-xs uppercase font-bold text-gray-500 sticky top-0">
                          <tr>
                              <th className="px-6 py-3">Driver</th>
                              <th className="px-6 py-3 text-right">Expected</th>
                              <th className="px-6 py-3 text-right">Paid</th>
                              <th className="px-6 py-3 text-right">Status</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                          {selectedWeek.details.map((d: any) => {
                             const shortfall = d.expected - d.paid;
                             const isFull = shortfall <= 0.01; // floating point tolerance
                             const isZero = d.paid === 0;
                             
                             return (
                                <tr key={d.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-3">
                                        <div className="font-medium text-gray-900">{d.name}</div>
                                        <div className="text-xs text-gray-500">{d.plate}</div>
                                    </td>
                                    <td className="px-6 py-3 text-right text-gray-500">
                                        {formatCurrency(d.expected)}
                                    </td>
                                    <td className="px-6 py-3 text-right font-medium">
                                        {formatCurrency(d.paid)}
                                    </td>
                                    <td className="px-6 py-3 text-right">
                                        {d.contractEnded ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200">
                                                Contract Ended
                                            </span>
                                        ) : isFull ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800">
                                                PAID
                                            </span>
                                        ) : isZero ? (
                                             <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800">
                                                MISSED
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-yellow-100 text-yellow-800">
                                                PARTIAL
                                            </span>
                                        )}
                                    </td>
                                </tr>
                             );
                          })}
                      </tbody>
                  </table>
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
                                        {new Date(inv.dueDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
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
