
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Driver, DriverStatus, Car } from '../types';
import { calculateDriverMetrics, formatCurrency, analyzePaymentHabit, calculateActiveBalance } from '../utils';
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
  Sparkles,
  Brain,
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
  FileText
} from 'lucide-react';
import { supabase } from '../supabaseClient';

interface AdminDashboardProps {
  drivers: Driver[];
  cars: Car[];
  userRole: 'admin' | 'staff'; // Role passed from parent
  onUpdatePayment: (driverId: string, amount: number, date: string) => void;
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
  userRole, 
  onUpdatePayment, 
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
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'DELISTED' | 'INFLOW' | 'CARS'>('ACTIVE');
  const [inflowViewMode, setInflowViewMode] = useState<'PERFORMANCE' | 'CASHFLOW'>('PERFORMANCE');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('ALL');
  const [sortConfig, setSortConfig] = useState<{ key: 'RISK_STATUS' | 'OUTSTANDING' | 'DEFAULT', direction: 'asc' | 'desc' }>({ key: 'DEFAULT', direction: 'desc' });
  
  const handleSort = (key: 'RISK_STATUS' | 'OUTSTANDING') => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
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
  
  // AI Analysis State
  const [aiAnalysisResult, setAiAnalysisResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);



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
  const [paymentDate, setPaymentDate] = useState('');

  // --- Security Logic ---
  useEffect(() => {
    // Access Restriction: If staff is on INFLOW tab, redirect to ACTIVE
    if (userRole === 'staff' && (viewMode === 'INFLOW' || viewMode === 'CARS')) {
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

  // Calculate Alerts for Feed
  const alertFeedItems = useMemo(() => {
    const alerts: any[] = [];

    driverData.filter(d => !d.isDelisted).forEach(d => {
        // 1. Critical Slipping Alert (Mid or Bad Status + Slipping)
        if ((d.metrics.status === DriverStatus.BAD || d.metrics.status === DriverStatus.MID) && d.velocityData.isSlipping) {
             alerts.push({
                id: d.id + '-slip',
                driver: d,
                type: 'CRITICAL',
                msg: `Slipping Rapidly (+${d.velocityData.velocity.toFixed(0)} days)`
             });
        }
        // 2. Recovery Alert
        else if (d.velocityData.isRecovering) {
            alerts.push({
                id: d.id + '-recover',
                driver: d,
                type: 'GOOD',
                msg: `Recovering Habit (-${Math.abs(d.velocityData.velocity).toFixed(0)} days)`
            });
        }
        // 3. New Bad Entry
        else if (d.metrics.status === DriverStatus.BAD && d.velocityData.velocity > 0) {
             alerts.push({
                id: d.id + '-bad',
                driver: d,
                type: 'WARNING',
                msg: 'Entered Bad Status'
             });
        }
    });

    // Sort: Critical first
    return alerts.sort((a,b) => (a.type === 'CRITICAL' ? -1 : 1));
  }, [driverData]);


  // Filter based on View Mode, Search, Tags, and Risk Sort
  const filteredDrivers = useMemo(() => {
    let result = driverData;

    // 1. View Mode
    if (viewMode === 'ACTIVE') result = result.filter(d => !d.isDelisted);
    if (viewMode === 'DELISTED') result = result.filter(d => d.isDelisted);
    if (viewMode === 'INFLOW') return result; 

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
  }, [driverData, viewMode, searchTerm, selectedTagFilter, sortConfig]);

  // Summary Stats
  const totalArrears = driverData.filter(d => !d.isDelisted).reduce((sum, d) => sum + Math.max(0, d.activeBalance.baseValue), 0);
  const badDriversCount = driverData.filter(d => !d.isDelisted && d.metrics.status === DriverStatus.BAD).length;
  const midDriversCount = driverData.filter(d => !d.isDelisted && d.metrics.status === DriverStatus.MID).length;
  const goodDriversCount = driverData.filter(d => !d.isDelisted && d.metrics.status === DriverStatus.GOOD).length;
  const activeFleetCount = driverData.filter(d => !d.isDelisted).length;

  // --- Financial Logic (Refactored: Dual Mode) ---
  const weeklyFinancials = useMemo(() => {
    const weeks: any[] = [];
    const today = new Date();
    today.setHours(0,0,0,0);
    
    // 1. Setup 12-Week Buckets (Monday to Sunday)
    const currentDay = today.getDay(); 
    const diff = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
    const currentMonday = new Date(today);
    currentMonday.setDate(diff);

    for (let i = 0; i < 12; i++) {
        const startOfWeek = new Date(currentMonday);
        startOfWeek.setDate(currentMonday.getDate() - (i * 7));
        startOfWeek.setHours(0,0,0,0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23,59,59,999);

        weeks.push({
            id: i,
            start: startOfWeek,
            end: endOfWeek,
            label: `${startOfWeek.getDate()}/${startOfWeek.getMonth()+1} - ${endOfWeek.getDate()}/${endOfWeek.getMonth()+1}`,
            fullLabel: `${startOfWeek.toLocaleDateString()} - ${endOfWeek.toLocaleDateString()}`,
            expected: 0,
            collected: 0,
            activeDriverCount: 0,
            details: [] as any[]
        });
    }

    // 2. Process Each Driver
    drivers.forEach(d => {
        // A. Determine Effective End Date
        const contractStart = new Date(d.contractStartDate + 'T00:00:00');
        let effectiveEnd: Date;
        
        if (d.contractEndDate) {
            effectiveEnd = new Date(d.contractEndDate + 'T23:59:59.999');
        } else {
            let durationDays = d.contractDuration * (d.rentalCycle === 'MONTHLY' ? 30 : 7);
            effectiveEnd = new Date(contractStart);
            effectiveEnd.setDate(effectiveEnd.getDate() + durationDays);
            effectiveEnd.setHours(23,59,59,999);
        }

        // Handle Delisted (Early Termination) overrides
        if (d.isDelisted && d.delistDate) {
             const delistDate = new Date(d.delistDate + 'T23:59:59.999');
             if (delistDate < effectiveEnd) {
                 effectiveEnd = delistDate;
             }
        }

        // --- MODE 1: PERFORMANCE (Accrual/Recovery) ---
        if (inflowViewMode === 'PERFORMANCE') {
            let paymentPool = d.paymentHistory 
                ? d.paymentHistory.reduce((sum, p) => sum + p.amount, 0) 
                : 0;

            let invoiceDate = new Date(contractStart);
            let safetyCounter = 0;
            const maxCycles = 500; 

            while (invoiceDate <= effectiveEnd && safetyCounter < maxCycles) {
                if (invoiceDate > weeks[0].end) break;

                const invoiceAmount = d.rentalCycle === 'MONTHLY' ? (d.rentalRate * 12 / 52) : d.rentalRate;
                
                let paidForThisInvoice = 0;
                if (paymentPool >= invoiceAmount - 0.01) {
                    paidForThisInvoice = invoiceAmount;
                    paymentPool -= invoiceAmount;
                } else if (paymentPool > 0) {
                    paidForThisInvoice = paymentPool;
                    paymentPool = 0;
                }

                const weekIndex = weeks.findIndex(w => invoiceDate >= w.start && invoiceDate <= w.end);
                
                if (weekIndex !== -1) {
                    const week = weeks[weekIndex];
                    week.expected += invoiceAmount;
                    week.collected += paidForThisInvoice;
                    week.activeDriverCount++;

                    week.details.push({
                        id: d.id,
                        name: d.name,
                        plate: d.carPlate,
                        cycle: d.rentalCycle,
                        expected: invoiceAmount,
                        paid: paidForThisInvoice,
                        isActive: true,
                        contractEnded: false
                    });
                }

                if (d.rentalCycle === 'MONTHLY') invoiceDate.setMonth(invoiceDate.getMonth() + 1);
                else invoiceDate.setDate(invoiceDate.getDate() + 7);
                safetyCounter++;
            }
        } 
        // --- MODE 2: CASH FLOW (Bank Deposits) ---
        else {
            // 1. Calculate Expected (Same as Performance - based on Invoices Due)
            let invoiceDate = new Date(contractStart);
            let safetyCounter = 0;
            const maxCycles = 500;

            while (invoiceDate <= effectiveEnd && safetyCounter < maxCycles) {
                if (invoiceDate > weeks[0].end) break;
                const invoiceAmount = d.rentalCycle === 'MONTHLY' ? (d.rentalRate * 12 / 52) : d.rentalRate;
                const weekIndex = weeks.findIndex(w => invoiceDate >= w.start && invoiceDate <= w.end);
                
                if (weekIndex !== -1) {
                    weeks[weekIndex].expected += invoiceAmount;
                    weeks[weekIndex].activeDriverCount++;
                    // Initialize detail for this driver if not exists
                    let detail = weeks[weekIndex].details.find((x: any) => x.id === d.id);
                    if (!detail) {
                        detail = {
                            id: d.id,
                            name: d.name,
                            plate: d.carPlate,
                            cycle: d.rentalCycle,
                            expected: 0,
                            paid: 0,
                            isActive: true,
                            contractEnded: false
                        };
                        weeks[weekIndex].details.push(detail);
                    }
                    detail.expected += invoiceAmount;
                }

                if (d.rentalCycle === 'MONTHLY') invoiceDate.setMonth(invoiceDate.getMonth() + 1);
                else invoiceDate.setDate(invoiceDate.getDate() + 7);
                safetyCounter++;
            }

            // 2. Calculate Collected (Based on Actual Payment Date)
            if (d.paymentHistory) {
                d.paymentHistory.forEach(p => {
                    const pDate = new Date(p.date + 'T00:00:00');
                    const weekIndex = weeks.findIndex(w => pDate >= w.start && pDate <= w.end);
                    
                    if (weekIndex !== -1) {
                        weeks[weekIndex].collected += p.amount;
                        
                        // Add to details
                        let detail = weeks[weekIndex].details.find((x: any) => x.id === d.id);
                        if (!detail) {
                             // If they paid but had no invoice due (e.g. advance or old debt), add them
                            detail = {
                                id: d.id,
                                name: d.name,
                                plate: d.carPlate,
                                cycle: d.rentalCycle,
                                expected: 0,
                                paid: 0,
                                isActive: true, // They paid, so they are active in cash flow terms
                                contractEnded: false
                            };
                            weeks[weekIndex].details.push(detail);
                        }
                        detail.paid += p.amount;
                    }
                });
            }
        }
    });

    // 3. Final Aggregation & Sorting
    weeks.forEach(week => {
        week.variance = week.collected - week.expected;
        week.rate = week.expected > 0 ? (week.collected / week.expected) * 100 : 0;
        // Sort details by shortfall (biggest shortfall first)
        week.details.sort((a: any, b: any) => (b.expected - b.paid) - (a.expected - a.paid));
    });

    return weeks;
  }, [drivers, inflowViewMode]);

  const getMonthlyCollectionBreakdown = () => {
    const breakdown: Record<string, number> = {};
    drivers.forEach(driver => {
      if (driver.paymentHistory) {
        driver.paymentHistory.forEach(payment => {
            const date = new Date(payment.date);
            const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            breakdown[monthKey] = (breakdown[monthKey] || 0) + payment.amount;
        });
      }
    });
    return Object.entries(breakdown).map(([month, amount]) => ({ month, amount })).sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  };

  // --- Helpers ---
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
    setSelectedDriverForPayment(driver);
    setPaymentAmount(driver.rentalRate.toString());
    setPaymentDate(new Date().toISOString().split('T')[0]); 
    setAiAnalysisResult(null); 
    setIsPaymentModalOpen(true);
  };

  const handleAnalyzeDriver = async () => {
    if (!selectedDriverForPayment) return;
    setIsAnalyzing(true);
    setAiAnalysisResult(null);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const historyText = selectedDriverForPayment.paymentHistory
            .map(p => `- ${p.date}: RM${p.amount}`)
            .join('\n');
        const prompt = `Role: Collection Analyst. Task: Analyze driver payment behavior. Driver: ${selectedDriverForPayment.name}. History:\n${historyText}\nProvide concise assessment and action item.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
        setAiAnalysisResult(response.text);
    } catch (error: any) {
        setAiAnalysisResult("Unable to generate analysis.");
    } finally {
        setIsAnalyzing(false);
    }
  };

  const handleDelistClick = (driver: Driver) => { setDriverToDelist(driver); };
  const confirmDelist = () => { if (driverToDelist) { onDelistDriver(driverToDelist.id); setDriverToDelist(null); } };
  
  const handleSubmitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriverForPayment) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) { alert("Invalid amount."); return; }
    if (!paymentDate) { alert("Select date."); return; }
    onUpdatePayment(selectedDriverForPayment.id, amount, paymentDate);
    setIsPaymentModalOpen(false); setSelectedDriverForPayment(null); setPaymentAmount(''); setPaymentDate('');
  };

  const handleOpenCreateModal = () => { setEditingId(null); setFormData(initialFormState); setTagInput(''); setIsDriverModalOpen(true); };
  
  const handleOpenEditModal = (driver: Driver) => {
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
      schedule.push({
        no: i + 1, date: itemDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }),
        amount: driver.rentalRate, paid: paidForThisCycle, status, isDue: isDue && status !== 'CANCELLED' && status !== 'FUTURE', isAdvance
      });
    }

    return (
      <div className="space-y-1">
        <div className="grid grid-cols-4 text-xs font-semibold text-gray-500 uppercase px-3 mb-2">
          <div>Due Date</div><div>Cycle</div><div className="text-right">Status</div><div className="text-right">Paid / Due</div>
        </div>
        <div className="max-h-64 overflow-y-auto pr-2 space-y-2">
          {schedule.map((item) => (
            <div key={item.no} className={`grid grid-cols-4 items-center text-sm p-2 rounded-lg border transition-colors ${
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
    <div className="min-h-screen bg-gray-100 font-sans">
      {/* Top Navigation - unchanged */}
      <div className="bg-gray-900 text-white px-6 py-4 flex justify-between items-center shadow-md sticky top-0 z-20">
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* Immediate Capture Alert Feed - unchanged */}
        {viewMode === 'ACTIVE' && (
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
                     {alertFeedItems.map(alert => (
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
                     {alertFeedItems.length === 0 && (
                         <div className="text-sm text-gray-400 italic flex items-center gap-2 pl-2">
                             <CheckCircle2 className="w-4 h-4 text-green-500" /> Fleet performance stable. No alerts.
                         </div>
                     )}
                 </div>
                 
                 <div className="bg-gradient-to-l from-white via-white/80 to-transparent w-16 h-full absolute right-0 pointer-events-none z-10"></div>
            </div>
        )}

        {/* KPI Cards Grid - unchanged */}
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

        {/* View Toggle Tabs - unchanged */}
        <div className="flex space-x-1 bg-gray-200 p-1 rounded-lg w-fit overflow-x-auto">
          <button onClick={() => setViewMode('ACTIVE')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${viewMode === 'ACTIVE' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}>Active Fleet</button>
          <button onClick={() => setViewMode('DELISTED')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'DELISTED' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><Archive className="w-4 h-4" /> Delisted / Returned</button>
          
          {userRole === 'admin' && (
            <>
              <button onClick={() => setViewMode('INFLOW')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'INFLOW' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><Activity className="w-4 h-4" /> Weekly Inflow</button>
              <button onClick={() => setViewMode('CARS')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${viewMode === 'CARS' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}><CarIcon className="w-4 h-4" /> Fleet Management</button>
            </>
          )}
        </div>

        {/* Main Table Section - unchanged */}
        <div ref={tableContainerRef} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[500px]">
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
          ) : viewMode === 'INFLOW' ? (
             /* --- INFLOW VIEW --- */
             <div>
                 <div className="px-6 py-4 border-b border-gray-200 flex flex-col md:flex-row justify-between items-center bg-gray-50 gap-4">
                    <div className="flex items-center gap-4">
                        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-blue-600" /> Cash Inflow Monitoring
                        </h2>
                        
                        {/* LOGIC TOGGLE */}
                        <div className="flex bg-gray-200 rounded-lg p-1">
                            <button 
                                onClick={() => setInflowViewMode('PERFORMANCE')}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${inflowViewMode === 'PERFORMANCE' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Performance
                            </button>
                            <button 
                                onClick={() => setInflowViewMode('CASHFLOW')}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${inflowViewMode === 'CASHFLOW' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Cash Flow
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border border-gray-200">Last 12 Weeks</span>
                    </div>
                 </div>
                 <div className="p-6 text-center text-gray-500 text-sm italic">
                    {inflowViewMode === 'PERFORMANCE' 
                        ? "Tracking debt recovery based on invoice due dates (Accrual Basis)." 
                        : "Tracking actual bank deposits received within the week (Cash Basis)."}
                 </div>
                 <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-600">
                        <thead className="bg-gray-50 text-xs uppercase font-medium text-gray-500">
                            <tr>
                                <th className="px-6 py-3">Week Range</th>
                                <th className="px-6 py-3 text-center">Active Drivers</th>
                                <th className="px-6 py-3 text-right">Expected Rental</th>
                                <th className="px-6 py-3 text-right">Cash Collected</th>
                                <th className="px-6 py-3 text-right">{inflowViewMode === 'PERFORMANCE' ? 'Variance (Owed)' : 'Surplus / Deficit'}</th>
                                <th className="px-6 py-3 w-1/4">Collection Rate</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {weeklyFinancials.map((week) => (
                                <tr key={week.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-gray-900">{week.label}</div>
                                        <div className="text-xs text-gray-400">Week {12 - week.id}</div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button 
                                          onClick={() => setSelectedWeek(week)}
                                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 hover:bg-blue-200 cursor-pointer underline decoration-blue-300 underline-offset-2 transition-colors"
                                          title="View Breakdown"
                                        >
                                            <Eye className="w-3 h-3 mr-1" />
                                            {week.activeDriverCount}
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 text-right font-medium text-gray-500">
                                        {formatCurrency(week.expected)}
                                    </td>
                                    <td className="px-6 py-4 text-right font-bold text-gray-900">
                                        {formatCurrency(week.collected)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className={`font-mono font-medium ${week.variance >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                            {week.variance > 0 ? '+' : ''}{formatCurrency(week.variance)}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs font-bold w-8 text-right">{Math.round(week.rate)}%</span>
                                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                                                <div 
                                                    className={`h-2 rounded-full transition-all ${
                                                        week.rate >= 100 ? 'bg-green-500' : 
                                                        week.rate >= 80 ? 'bg-yellow-500' : 'bg-red-500'
                                                    }`} 
                                                    style={{ width: `${Math.min(100, week.rate)}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                 </div>
             </div>
          ) : (
            /* --- ACTIVE / DELISTED VIEW --- */
            <>
                {/* Advanced Filter Bar - unchanged */}
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex flex-col md:flex-row gap-4 justify-between items-center sticky top-0 z-10">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="relative w-full md:w-64">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                            <input 
                                ref={searchInputRef}
                                type="text" 
                                placeholder="Search driver, plate, NRIC..." 
                                className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm shadow-sm"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {/* Tag Filter */}
                        <div className="relative">
                           <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                              <Filter className="h-4 w-4 text-gray-400" />
                           </div>
                           <select 
                             className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm appearance-none cursor-pointer hover:bg-gray-50"
                             value={selectedTagFilter}
                             onChange={(e) => setSelectedTagFilter(e.target.value)}
                           >
                             <option value="ALL">All Groups</option>
                             {allTags.map(tag => (
                               <option key={tag} value={tag}>{tag}</option>
                             ))}
                           </select>
                        </div>
                    </div>

                    {/* Risk Sort Toggle - Removed to use table headers */}
                </div>

                {/* Table Header */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-600">
                    <thead className="bg-gray-100 text-xs uppercase font-bold text-gray-500 tracking-wider">
                        <tr>
                        <th className="px-6 py-4 border-b border-gray-200 w-1/4">DRIVER PROFILE</th>
                        <th className="px-6 py-4 border-b border-gray-200">Staff / Grouping</th>
                        <th 
                           className="px-6 py-4 border-b border-gray-200 text-center cursor-pointer hover:bg-gray-200 transition-colors"
                           onClick={() => handleSort('RISK_STATUS')}
                        >
                           <div className="flex items-center justify-center gap-1">
                             Risk Status
                             {sortConfig.key === 'RISK_STATUS' && (
                               sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                             )}
                           </div>
                        </th>
                        <th 
                           className="px-6 py-4 border-b border-gray-200 text-right cursor-pointer hover:bg-gray-200 transition-colors"
                           onClick={() => handleSort('OUTSTANDING')}
                        >
                           <div className="flex items-center justify-end gap-1">
                             Outstanding (Base)
                             {sortConfig.key === 'OUTSTANDING' && (
                               sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                             )}
                           </div>
                        </th>
                        <th className="px-6 py-4 border-b border-gray-200 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {filteredDrivers.map((driver) => {
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
                           const nextDueStr = nextDue.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
                           const isRiskyAndSlipping = (m.status === DriverStatus.BAD || m.status === DriverStatus.MID) && v.isSlipping;
                           let behaviorText = 'Consistent Habit';
                           let behaviorColor = 'text-gray-400';
                           if (v.isSlipping) { behaviorText = 'Behavior Worsening'; behaviorColor = 'text-red-600 font-bold'; } 
                           else if (v.isRecovering) { behaviorText = 'Habit Improving'; behaviorColor = 'text-green-600 font-medium'; }
                           const tooltipText = `This driver paid ${Math.round(v.lastLateness)} days late, which is ${Math.round(v.velocity)} days slower than their usual ${Math.round(v.avgLateness)}-day habit. Contact them to prevent further slippage.`;

                        return (
                            <tr key={driver.id} className={`group hover:bg-blue-50/50 transition-colors ${isRiskyAndSlipping ? 'bg-red-50/40 shadow-[0_0_15px_rgba(225,29,72,0.15)] border-l-4 border-l-red-500' : ''}`}>
                                <td className="px-6 py-4 align-top">
                                    <div className="flex items-start gap-3">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <div className={`font-bold text-base ${driver.debtTrend.isStreak ? 'text-[#DC143C] font-bold' : 'text-gray-900'}`}>
                                                    {driver.name}
                                                </div>
                                                {driver.debtTrend.isStreak && (
                                                    <div className="group/streak relative">
                                                        <span className="cursor-help text-lg animate-pulse">⚠️</span>
                                                        <div className="invisible group-hover/streak:visible opacity-0 group-hover/streak:opacity-100 transition-opacity absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-2 py-1 bg-[#DC143C] text-white text-[10px] font-bold rounded shadow-lg z-50 pointer-events-none whitespace-nowrap">
                                                            3-Week Debt Streak
                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#DC143C]"></div>
                                                        </div>
                                                    </div>
                                                )}
                                                {v.isSlipping && <TrendingDown className="w-6 h-6 text-red-500 animate-bounce" />}
                                                {v.isRecovering && <TrendingUp className="w-6 h-6 text-green-500" />}
                                            </div>
                                            <div className="text-xs text-gray-500 font-mono mt-0.5">{driver.carPlate}</div>
                                            <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded w-fit border border-blue-100">
                                                <Calendar className="w-3 h-3" />
                                                <span>Due: {nextDueStr}</span>
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 align-top">
                                    <div className="flex flex-wrap gap-1.5">
                                        {driver.tags && driver.tags.length > 0 ? (
                                            driver.tags.map((tag, i) => <span key={i} className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">{tag}</span>)
                                        ) : <span className="text-xs text-gray-400 italic">No tags</span>}
                                        {/* Added Category Badge */}
                                        {driver.category && (
                                           <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-bold border ${driver.category === 'SEWABELI' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                                              {driver.category === 'SEWABELI' ? 'Sewabeli' : 'Sewa Biasa'}
                                           </span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4 align-top text-center relative">
                                    <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border shadow-sm ${m.status === DriverStatus.GOOD ? 'bg-green-50 text-green-700 border-green-200' : ''} ${m.status === DriverStatus.MID ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : ''} ${m.status === DriverStatus.BAD ? 'bg-red-50 text-red-700 border-red-200' : ''}`}>{m.status}</div>
                                    <div className="mt-2 text-xs text-gray-500">{m.cyclesOwed > 0 ? `${m.cyclesOwed.toFixed(1)} ${cycleLabel} Owed` : 'Up to date'}</div>
                                    <div className="mt-3 group/tooltip relative inline-flex justify-center w-full cursor-help">
                                        <span className={`text-xs ${behaviorColor} border-b border-dotted border-current pb-0.5`}>{behaviorText}</span>
                                        <div className="invisible group-hover/tooltip:visible opacity-0 group-hover/tooltip:opacity-100 transition-opacity absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl z-50 pointer-events-none text-left leading-relaxed">
                                            {tooltipText}
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-900"></div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 align-top text-right">
                                    <div className="flex flex-col items-end gap-1">
                                        <div className="font-mono font-bold text-gray-900 text-lg">
                                            {driver.activeBalance.baseValue > 0 ? <span className="text-red-600">{formatCurrency(driver.activeBalance.baseValue)}</span> : <span className="text-green-600">PAID</span>}
                                        </div>
                                        
                                        {/* DEBT TREND BADGE */}
                                        {driver.debtTrend.direction !== 'FLAT' && (
                                            <div className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                                driver.debtTrend.direction === 'UP' 
                                                    ? 'bg-red-50 text-red-700 border-red-100' 
                                                    : 'bg-green-50 text-green-700 border-green-100'
                                            }`}>
                                                {driver.debtTrend.direction === 'UP' ? (
                                                    <TrendingUp className="w-3 h-3 mr-1" />
                                                ) : (
                                                    <TrendingDown className="w-3 h-3 mr-1" />
                                                )}
                                                {driver.debtTrend.direction === 'UP' ? '+' : '-'}{formatCurrency(driver.debtTrend.value)}
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-1 flex flex-col items-end">
                                        {lastPaymentDate ? (<div className={`text-xs font-medium flex items-center gap-1 ${showLastPayWarning ? 'text-red-600 animate-pulse' : 'text-gray-400'}`}>{showLastPayWarning && <AlertTriangle className="w-3 h-3" />}Last Pay: {formatDateShort(lastPaymentDate.toISOString())}</div>) : (<div className="text-xs text-gray-300 italic">No payment yet</div>)}
                                    </div>
                                </td>
                                <td className="px-6 py-4 align-top text-right">
                                    <div className="flex flex-col gap-2 items-end">
                                        <button onClick={() => handleOpenPaymentModal(driver)} className="w-full md:w-auto inline-flex items-center justify-center px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"><DollarSign className="w-3 h-3 mr-1" /> Pay / Track</button>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleOpenEditModal(driver)} className="text-gray-400 hover:text-gray-600 p-1"><Pencil className="w-4 h-4" /></button>
                                            {viewMode === 'ACTIVE' ? (<button onClick={() => handleDelistClick(driver)} className="text-gray-400 hover:text-red-600 p-1"><UserMinus className="w-4 h-4" /></button>) : (<button onClick={() => { if(window.confirm(`PERMANENTLY DELETE ${driver.name}?`)) onDeleteDriver(driver.id); }} className="text-gray-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>)}
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        );
                        })}
                    </tbody>
                    </table>
                </div>
            </>
          )}
        </div>
      </div>

      {/* Confirmation Modal - unchanged */}
      {driverToDelist && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
             <div className="p-6 text-center">
                <h3 className="font-bold">Confirm Delist?</h3>
                <div className="flex gap-2 justify-center mt-4">
                    <button onClick={() => setDriverToDelist(null)} className="px-4 py-2 border rounded">Cancel</button>
                    <button onClick={confirmDelist} className="px-4 py-2 bg-red-600 text-white rounded">Delist</button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Driver Profile Modal - UPDATED */}
      {isDriverModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 bg-gray-900 text-white flex justify-between items-center">
              <h2 className="text-lg font-bold flex items-center gap-2">
                {editingId ? <Pencil className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
                {editingId ? 'Edit Driver' : 'Add New Driver'}
              </h2>
              <button onClick={() => setIsDriverModalOpen(false)} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleDriverFormSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              
              {/* Row 1: Name & NRIC */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Full Name</label>
                  <input type="text" required className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">NRIC</label>
                  <input 
                    type="text" 
                    required 
                    maxLength={14} 
                    placeholder="XXXXXX-XX-XXXX"
                    className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-300" 
                    value={formData.nric} 
                    onChange={e => { const val = e.target.value; if (val.length < formData.nric.length) { setFormData({...formData, nric: val}); } else { setFormData({...formData, nric: formatNric(val)}); } }} 
                  />
                </div>
                
                {/* REPLACED CONTACT WITH CATEGORY DROPDOWN */}
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Category</label>
                  <select 
                    className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-medium"
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value as 'SEWABELI' | 'SEWA_BIASA'})}
                  >
                    <option value="SEWABELI">Sewabeli</option>
                    <option value="SEWA_BIASA">Sewa Biasa</option>
                  </select>
                </div>
              </div>

              {/* Row 2: Plate & Cycle */}
              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Car Plate</label>
                    <input type="text" required className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none" value={formData.carPlate} onChange={e => setFormData({...formData, carPlate: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Billing Cycle</label>
                    <select 
                      className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                      value={formData.rentalCycle}
                      onChange={(e) => setFormData({...formData, rentalCycle: e.target.value as 'WEEKLY' | 'MONTHLY'})}
                    >
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                  </div>
              </div>

              {/* Row 3: Contract */}
              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Duration ({formData.rentalCycle === 'MONTHLY' ? 'Months' : 'Weeks'})</label>
                    <input 
                        type="number" 
                        required 
                        className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-gray-50" 
                        value={formData.contractDuration} 
                        onChange={e => setFormData({...formData, contractDuration: parseInt(e.target.value) || 0})} 
                        title="Auto-calculated from Start and End dates"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Rate (RM)</label>
                    <input type="number" required className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none" value={formData.rentalRate} onChange={e => setFormData({...formData, rentalRate: parseFloat(e.target.value) || 0})} />
                  </div>
              </div>

               {/* Row 4: Start Date & UPDATED End Date */}
               <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Contract Start</label>
                      <input type="date" required className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none" value={formData.contractStartDate} onChange={e => setFormData({...formData, contractStartDate: e.target.value})} />
                   </div>
                   <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Contract End</label>
                      <input 
                        type="date" 
                        className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none" 
                        value={formData.contractEndDate} 
                        onChange={e => setFormData({...formData, contractEndDate: e.target.value})} 
                      />
                   </div>
               </div>

              {/* Row 5: Tags */}
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Tags / Groups</label>
                  <div className="flex gap-2 mb-2 flex-wrap">
                      {formData.tags.map(tag => (
                          <span key={tag} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs flex items-center gap-1">
                              {tag}
                              <button type="button" onClick={() => handleRemoveTag(tag)} className="hover:text-red-600"><X className="w-3 h-3" /></button>
                          </span>
                      ))}
                  </div>
                  <div className="flex gap-2">
                      <input 
                          type="text" 
                          placeholder="Add tag (e.g. Batch A, Staff)" 
                          className="flex-1 px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag(e))}
                      />
                      <button type="button" onClick={handleAddTag} className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-2 rounded transition-colors"><Plus className="w-4 h-4" /></button>
                  </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsDriverModalOpen(false)} className="flex-1 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors">Cancel</button>
                <button type="submit" className="flex-1 py-3 bg-blue-600 rounded-lg text-white font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20">{editingId ? 'Save Changes' : 'Create Driver'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Car Modal */}
      {isCarModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <CarIcon className="w-5 h-5 text-blue-600" /> {editingCarId ? 'Edit Car' : 'Add New Car'}
              </h2>
              <button onClick={() => setIsCarModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleCarFormSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Make</label>
                  <input type="text" required placeholder="e.g. Proton" className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" value={carFormData.make} onChange={e => setCarFormData({...carFormData, make: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Model</label>
                  <input type="text" required placeholder="e.g. Saga" className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" value={carFormData.model} onChange={e => setCarFormData({...carFormData, model: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Plate Number</label>
                <input type="text" required placeholder="e.g. ABC 1234" className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none font-mono font-bold" value={carFormData.plateNumber} onChange={e => setCarFormData({...carFormData, plateNumber: e.target.value.toUpperCase()})} />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Roadtax Expiry</label>
                  <input type="date" required className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" value={carFormData.roadtaxExpiry} onChange={e => setCarFormData({...carFormData, roadtaxExpiry: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Insurance Expiry</label>
                  <input type="date" required className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" value={carFormData.insuranceExpiry} onChange={e => setCarFormData({...carFormData, insuranceExpiry: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Inspection Expiry</label>
                  <input type="date" required className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" value={carFormData.inspectionExpiry} onChange={e => setCarFormData({...carFormData, inspectionExpiry: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notes</label>
                <textarea className="w-full px-3 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm" rows={2} value={carFormData.notes} onChange={e => setCarFormData({...carFormData, notes: e.target.value})} />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20">
                {editingCarId ? 'Update Car' : 'Register Car'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal & others - unchanged */}
      {isPaymentModalOpen && selectedDriverForPayment && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col">
            <div className="bg-blue-600 p-6 text-white shrink-0">
               <h2 className="text-xl font-bold">Record Payment</h2>
               <p className="text-blue-100 text-sm mt-1">For {selectedDriverForPayment.name}</p>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                
                {/* --- Payment Schedule --- */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                        <CalendarCheck className="w-4 h-4" /> Invoice Schedule
                    </h3>
                    {renderPaymentSchedule(selectedDriverForPayment)}
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    {/* Form Section */}
                    <form onSubmit={handleSubmitPayment} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Amount (RM)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">RM</span>
                                <input 
                                    type="number" 
                                    required
                                    min="1"
                                    step="0.01"
                                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-lg font-bold text-gray-800"
                                    value={paymentAmount}
                                    onChange={(e) => setPaymentAmount(e.target.value)}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                            <input 
                                type="date" 
                                required
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                value={paymentDate}
                                onChange={(e) => setPaymentDate(e.target.value)}
                            />
                        </div>
                        
                        <div className="pt-2 flex gap-3">
                            <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="flex-1 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors">Cancel</button>
                            <button type="submit" className="flex-1 py-3 bg-blue-600 rounded-lg text-white font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20">Confirm</button>
                        </div>
                    </form>

                    {/* AI & Analysis Section */}
                    <div className="space-y-4">
                        {!aiAnalysisResult && !isAnalyzing && (
                            <button onClick={handleAnalyzeDriver} className="w-full py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 hover:bg-purple-100 transition-colors">
                                <Sparkles className="w-4 h-4" /> AI Analysis
                            </button>
                        )}
                        {isAnalyzing && (
                            <div className="flex items-center justify-center gap-2 text-purple-600 text-sm py-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                                Analyzing payment patterns...
                            </div>
                        )}
                        {aiAnalysisResult && (
                            <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 text-sm text-gray-800">
                                <div className="flex items-start gap-2 mb-2">
                                    <Brain className="w-5 h-5 text-purple-600 mt-0.5" />
                                    <h4 className="font-bold text-purple-900">AI Insight</h4>
                                </div>
                                <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-line leading-relaxed">
                                    {aiAnalysisResult}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
          </div>
        </div>
      )}

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

    </div>
  );
};

export default AdminDashboard;
