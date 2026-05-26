import React, { useMemo, useState, useEffect } from 'react';
import { Driver } from '../types';
import { generateDriverInvoices, formatCurrency } from '../utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, AreaChart, Area, ComposedChart } from 'recharts';
import { TrendingUp, Activity, DollarSign, PieChart, Wrench, Search, CarFront, ChevronLeft, ChevronRight, Eye, X, ShieldAlert, BadgeCheck, MessageSquareWarning } from 'lucide-react';

interface AnalyticsViewProps {
  drivers: Driver[];
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ drivers }) => {
  const today = new Date();
  
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [inflowViewMode, setInflowViewMode] = useState<'PERFORMANCE' | 'CASHFLOW'>('PERFORMANCE');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedWeekDetail, setSelectedWeekDetail] = useState<any | null>(null);
  
  // Collapse/Expand state for inline breakdowns instead of intrusive modals
  const [showArrearsList, setShowArrearsList] = useState<boolean>(false);
  const [showCollectionsList, setShowCollectionsList] = useState<boolean>(false);

  // 1. Calculate Active Arrears (cumulative outstanding base amounts for active drivers)
  const totalArrears = useMemo(() => {
    return drivers
      .filter(d => !d.isDelisted)
      .reduce((sum, d) => sum + Math.max(0, d.activeBalance.baseValue), 0);
  }, [drivers]);

  // Arrears breakdown list
  const arrearsBreakdownList = useMemo(() => {
    return drivers
      .filter(d => !d.isDelisted && d.activeBalance.baseValue > 0)
      .sort((a, b) => b.activeBalance.baseValue - a.activeBalance.baseValue);
  }, [drivers]);

  // 2. Count statuses for arrears overview
  const badArrearsCount = arrearsBreakdownList.filter(d => d.metrics.status === 'BAD').length;
  const midArrearsCount = arrearsBreakdownList.filter(d => d.metrics.status === 'MID').length;

  // 3. Current Month Inflow from Monthly collections
  const getMonthlyCollectionBreakdown = useMemo(() => {
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
  }, [drivers]);

  const currentMonthName = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, []);

  const currentMonthCollection = useMemo(() => {
    return getMonthlyCollectionBreakdown.find(b => b.month === currentMonthName)?.amount || 0;
  }, [getMonthlyCollectionBreakdown, currentMonthName]);

  // 4. Monthly progress / Chart Data for 6 Months
  const monthlyData = useMemo(() => {
    const months = Array.from({ length: 6 }).map((_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (5 - i), 1);
      return d;
    });

    return months.map(monthDate => {
      const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const endOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
      
      const monthName = startOfMonth.toLocaleString('default', { month: 'short', year: 'numeric' });

      let currentMonthInflow = 0;
      let currentMonthServiceClaim = 0;
      let snapshotTotalArrears = 0;
      let currentMonthInvoicesIssued = 0;
      let currentMonthInvoicesPaid = 0;
      let serviceClaimsList: { id: string, driverName: string, carPlate: string, date: string, amount: number }[] = [];

      drivers.forEach(driver => {
        if (driver.isDelisted) return;

        // Current Month Inflow (Cash collected this month regardless of invoice)
        driver.paymentHistory?.forEach(payment => {
          const pDate = new Date(payment.date);
          if (pDate >= startOfMonth && pDate <= endOfMonth) {
            currentMonthInflow += payment.amount;
            if (payment.serviceClaim && payment.serviceClaim > 0) {
              currentMonthServiceClaim += payment.serviceClaim;
              serviceClaimsList.push({
                id: payment.id,
                driverName: driver.name,
                carPlate: driver.carPlate,
                date: payment.date,
                amount: payment.serviceClaim
              });
            }
          }
        });

        // Snapshot Total Arrears at end of this month
        const snapshotInvoices = generateDriverInvoices(driver, endOfMonth);
        snapshotInvoices.forEach(inv => {
          const dDate = new Date(inv.dueDate + 'T00:00:00');
          if (dDate <= endOfMonth) {
            snapshotTotalArrears += inv.remainingBalance;
          }
        });

        // Performance Collection (Invoices issued IN this month, status as of today)
        const currentInvoices = generateDriverInvoices(driver, today);
        currentInvoices.forEach(inv => {
          const dDate = new Date(inv.dueDate + 'T00:00:00');
          if (dDate >= startOfMonth && dDate <= endOfMonth) {
            currentMonthInvoicesIssued += inv.amount;
            currentMonthInvoicesPaid += inv.amountPaid;
          }
        });
      });

      return {
        name: monthName,
        inflow: parseFloat(currentMonthInflow.toFixed(2)),
        serviceClaim: parseFloat(currentMonthServiceClaim.toFixed(2)),
        arrears: parseFloat(snapshotTotalArrears.toFixed(2)),
        issued: parseFloat(currentMonthInvoicesIssued.toFixed(2)),
        collected: parseFloat(currentMonthInvoicesPaid.toFixed(2)),
        unpaid: parseFloat((currentMonthInvoicesIssued - currentMonthInvoicesPaid).toFixed(2)),
        collectionRate: currentMonthInvoicesIssued > 0 
          ? Math.round((currentMonthInvoicesPaid / currentMonthInvoicesIssued) * 100) 
          : 0,
        serviceClaimsList: serviceClaimsList.sort((a,b) => b.amount - a.amount)
      };
    });
  }, [drivers, today.valueOf()]);

  // Set default selected month to current month on load
  useEffect(() => {
    if (monthlyData.length > 0 && !selectedMonth) {
      setSelectedMonth(monthlyData[monthlyData.length - 1].name);
    }
  }, [monthlyData, selectedMonth]);

  // Format Y-axis money
  const formatMoney = (value: number) => `RM ${(value / 1000).toFixed(1)}k`;

  const activeSvcData = monthlyData.find(m => m.name === selectedMonth) || monthlyData[monthlyData.length - 1];

  // 5. Weekly Financial calculations (Monday to Sunday) - Taken from old dashboard segment
  const allWeeklyFinancials = useMemo(() => {
    const weeks: any[] = [];
    const todayRef = new Date();
    todayRef.setHours(0,0,0,0);
    
    // Setup 12-Week Buckets
    const currentDay = todayRef.getDay(); 
    const diff = todayRef.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
    const currentMonday = new Date(todayRef);
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
            fullLabel: `${startOfWeek.toLocaleDateString('en-MY')} - ${endOfWeek.toLocaleDateString('en-MY')}`,
            expected: 0,
            collected: 0,
            activeDriverCount: 0,
            details: [] as any[]
        });
    }

    // Process Each Driver
    drivers.forEach(d => {
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

        if (d.isDelisted && d.delistDate) {
             const delistDate = new Date(d.delistDate + 'T23:59:59.999');
             if (delistDate < effectiveEnd) {
                 effectiveEnd = delistDate;
             }
        }

        if (inflowViewMode === 'PERFORMANCE') {
            let paymentPool = d.paymentHistory 
                ? d.paymentHistory.reduce((sum, p) => sum + p.amount + (p.serviceClaim || 0), 0) 
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
        } else {
            // CASH FLOW (Bank Deposits)
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

            if (d.paymentHistory) {
                d.paymentHistory.forEach(p => {
                    const pDate = new Date(p.date + 'T00:00:00');
                    const weekIndex = weeks.findIndex(w => pDate >= w.start && pDate <= w.end);
                    
                    if (weekIndex !== -1) {
                        weeks[weekIndex].collected += p.amount + (p.serviceClaim || 0);
                        
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
                        detail.paid += p.amount + (p.serviceClaim || 0);
                    }
                });
            }
        }
    });

    weeks.forEach(week => {
        week.variance = week.collected - week.expected;
        week.rate = week.expected > 0 ? (week.collected / week.expected) * 100 : 0;
        week.details.sort((a: any, b: any) => (b.expected - b.paid) - (a.expected - a.paid));
    });

    return weeks;
  }, [drivers, inflowViewMode]);

  // PAGINATION FOR WEEKLY DATA (8 weeks per page, total 12 weeks means 2 pages)
  const weeksPerPage = 8;
  const paginatedWeeks = useMemo(() => {
    const startIndex = (currentPage - 1) * weeksPerPage;
    return allWeeklyFinancials.slice(startIndex, startIndex + weeksPerPage);
  }, [allWeeklyFinancials, currentPage]);

  const totalPages = Math.ceil(allWeeklyFinancials.length / weeksPerPage);

  return (
    <div className="space-y-6">
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Financial Analytics & Operations</h2>
          <p className="text-gray-500 text-sm mt-1">Unified minimal dashboard containing health, arrears, collections, and weekly cash flows</p>
        </div>
      </div>

      {/* KPI Cards section (Integrated Arrears & Collections) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        
        {/* KPI 1: Active Arrears Card (Originally on main dashboard!) */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">Active Arrears</span>
              <span className="p-1 px-2 text-[10px] bg-red-100 text-red-800 rounded font-bold uppercase">Base Sum</span>
            </div>
            <div className="text-3xl font-black text-rose-600 font-sans tracking-tight">
              {formatCurrency(totalArrears)}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {arrearsBreakdownList.length} drivers have base arrears ({badArrearsCount} Bad, {midArrearsCount} Mid status)
            </p>
          </div>
          <button 
            onClick={() => {
              setShowArrearsList(!showArrearsList);
              setShowCollectionsList(false);
            }} 
            className={`mt-4 w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg border transition-all text-center
              ${showArrearsList ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'}`}
          >
            <Activity className="w-3.5 h-3.5" />
            {showArrearsList ? 'Hide Arrears List' : 'View Arrears List'}
          </button>
        </div>

        {/* KPI 2: Current Month Inflow Card (Originally on main dashboard!) */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">Current Month Inflow</span>
              <span className="p-1 px-2 text-[10px] bg-emerald-100 text-emerald-800 rounded font-bold uppercase">Deposits</span>
            </div>
            <div className="text-3xl font-black text-emerald-600 font-sans tracking-tight">
              {formatCurrency(currentMonthCollection)}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Month: {currentMonthName} (Bank receipts + repair claims)
            </p>
          </div>
          <button 
            onClick={() => {
              setShowCollectionsList(!showCollectionsList);
              setShowArrearsList(false);
            }} 
            className={`mt-4 w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg border transition-all text-center
              ${showCollectionsList ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'}`}
          >
            <PieChart className="w-3.5 h-3.5" />
            {showCollectionsList ? 'Hide Monthly Receipts' : 'View Collections Register'}
          </button>
        </div>

        {/* KPI 3: Total Service Claims Card */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">Service Claims (Latest)</span>
              <Wrench className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-3xl font-black text-amber-500 font-sans tracking-tight">
              {formatCurrency(activeSvcData?.serviceClaim || 0)}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Recorded claims for the selected month: {selectedMonth.split(' ')[0]}
            </p>
          </div>
          <div className="mt-4 text-[11px] text-gray-400 bg-amber-50/50 p-2 rounded border border-amber-100 italic">
            Maintenance costs are logged in payments drawer
          </div>
        </div>

        {/* KPI 4: Collection Rate Card */}
        {monthlyData.length > 0 && (() => {
          const currentMonth = monthlyData[monthlyData.length - 1];
          return (
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-500">Month Collection Rate</span>
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-3xl font-black text-blue-600 font-sans tracking-tight">
                  {currentMonth.collectionRate}%
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  RM {currentMonth.collected.toLocaleString()} collected vs RM {currentMonth.issued.toLocaleString()} issued
                </p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1 mt-4 overflow-hidden">
                <div className="bg-blue-600 h-1 rounded-full" style={{ width: `${currentMonth.collectionRate}%` }}></div>
              </div>
            </div>
          );
        })()}

      </div>

      {/* --- INLINE ACTIVE ARREARS BREAKDOWN (Premium, User-friendly table) --- */}
      {showArrearsList && (
        <div className="bg-white p-6 rounded-xl border border-rose-200 shadow-md animate-in fade-in duration-300">
          <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-4">
            <div>
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-500" /> Active Arrears Report
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">Live outstanding basic amounts across active agreements.</p>
            </div>
            <button onClick={() => setShowArrearsList(false)} className="text-gray-400 hover:text-gray-600 p-1 bg-gray-50 rounded-full">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-500 border-b border-gray-100">
                    <tr>
                        <th className="px-6 py-3">Driver Name</th>
                        <th className="px-6 py-3 text-center">Status</th>
                        <th className="px-6 py-3 text-right">Outstanding (Base)</th>
                        <th className="px-6 py-3 text-right">Cycles Owed</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {arrearsBreakdownList.map(d => (
                        <tr key={d.id} className="hover:bg-red-50/20 transition-colors">
                            <td className="px-6 py-4 font-semibold text-gray-900">{d.name}</td>
                            <td className="px-6 py-4 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${d.metrics.status === 'BAD' ? 'bg-red-100 text-red-800 border-red-200' : 'bg-yellow-105 text-yellow-850 bg-yellow-100 border-yellow-250 text-yellow-800 border-yellow-200'}`}>{d.metrics.status}</span>
                            </td>
                            <td className="px-6 py-4 text-right font-mono text-rose-600 font-bold">{formatCurrency(d.activeBalance.baseValue)}</td>
                            <td className="px-6 py-4 text-right font-mono text-gray-600">{d.metrics.cyclesOwed.toFixed(1)}</td>
                        </tr>
                    ))}
                    {arrearsBreakdownList.length === 0 && (
                        <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-400 italic">No agreements currently carry active arrears.</td></tr>
                    )}
                </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- INLINE MONTHLY COLLECTIONS REGISTER --- */}
      {showCollectionsList && (
        <div className="bg-white p-6 rounded-xl border border-emerald-200 shadow-md animate-in fade-in duration-300">
          <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-4">
            <div>
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-emerald-500" /> Historic Monthly Collections
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">Aggregate payments received on a monthly cycle (base rate + service claims).</p>
            </div>
            <button onClick={() => setShowCollectionsList(false)} className="text-gray-400 hover:text-gray-600 p-1 bg-gray-50 rounded-full">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="max-w-md mx-auto overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-semibold text-gray-500 border-b border-gray-100">
                    <tr>
                        <th className="px-6 py-3">Month</th>
                        <th className="px-6 py-3 text-right">Deposits Received</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {getMonthlyCollectionBreakdown.slice().reverse().map((item, idx) => (
                        <tr key={item.month} className={`hover:bg-emerald-50/10 transition-colors ${idx === 0 ? "bg-emerald-50/30" : ""}`}>
                            <td className="px-6 py-4 font-semibold text-gray-700">{item.month}</td>
                            <td className="px-6 py-4 text-right font-bold text-emerald-700">{formatCurrency(item.amount)}</td>
                        </tr>
                    ))}
                    {getMonthlyCollectionBreakdown.length === 0 && (
                        <tr><td colSpan={2} className="px-6 py-8 text-center text-gray-400 italic">No collections received on record.</td></tr>
                    )}
                </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- WEEKLY INFLOW MONITORING (Merged from main tabs & Paginated) --- */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 gap-4">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-blue-600" /> Weekly Inflow Analysis
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">Showing paginated 8-week segments of active cash-flow trends</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* Logic Toggle */}
            <div className="flex bg-gray-200 p-0.5 rounded-lg border border-gray-300">
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
            
            {/* Page selectors */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm text-xs text-gray-600 font-medium">
                <button 
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  className="p-1 hover:bg-gray-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>Page {currentPage} of {totalPages}</span>
                <button 
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  className="p-1 hover:bg-gray-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-b border-gray-100 bg-blue-50/20 text-xs text-gray-500 font-medium leading-relaxed">
          {inflowViewMode === 'PERFORMANCE' ? (
            <span className="text-blue-800">📊 <b>Accrual Basis</b>: Tracks expected rents sorted by contract schedules versus matched rents paid. Ideal for tracking asset yields.</span>
          ) : (
            <span className="text-green-800">💸 <b>Cash Basis</b>: Tracks payments received in banks this exact calendar week regardless of rent dates. Ideal for cash liquidity checks.</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 text-[11px] uppercase font-bold text-gray-500 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3">Week Range</th>
                <th className="px-6 py-3 text-center">Active Drivers</th>
                <th className="px-6 py-3 text-right font-semibold">Expected Rental</th>
                <th className="px-6 py-3 text-right text-black font-extrabold">Cash Collected</th>
                <th className="px-6 py-3 text-right">Variance</th>
                <th className="px-6 py-3 w-1/4">Collection Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {paginatedWeeks.map((week) => (
                <tr key={week.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-gray-900">{week.label}</div>
                    <div className="text-[10px] uppercase text-gray-400 font-bold">Week {12 - week.id}</div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button 
                      onClick={() => setSelectedWeekDetail(week)}
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 shadow-xs cursor-pointer underline decoration-blue-200 underline-offset-1 transition-all"
                      title="View Breakdowns"
                    >
                      <Eye className="w-3 h-3 mr-1" />
                      {week.activeDriverCount} Drivers
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-gray-500">
                    {formatCurrency(week.expected)}
                  </td>
                  <td className="px-6 py-4 text-right font-black text-gray-900">
                    {formatCurrency(week.collected)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className={`font-mono font-bold text-xs ${week.variance >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {week.variance > 0 ? '+' : ''}{formatCurrency(week.variance)}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-bold w-9 text-right text-gray-700">{Math.round(week.rate)}%</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden border border-gray-200">
                        <div 
                          className={`h-2 rounded-full transition-all ${
                            week.rate >= 100 ? 'bg-emerald-500' : 
                            week.rate >= 80 ? 'bg-amber-400' : 'bg-red-500'
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

      {/* Charts and Claims split row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Total Arrears Area Chart */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-gray-500" />
            Total Monthly Cumulative Arrears (Snapshot)
          </h3>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorArrears" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                <YAxis tickFormatter={formatMoney} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip 
                  formatter={(value: number) => [`RM ${value.toLocaleString()}`, 'Total Arrears']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Area type="monotone" dataKey="arrears" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorArrears)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-500 mt-4 text-center">A cumulative visual of active outstanding balances computed at month-ends.</p>
        </div>

        {/* Cash Inflow Bar Chart */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-gray-500" />
            Relative Cash Inflow Over Time
          </h3>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                <YAxis tickFormatter={formatMoney} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip 
                  cursor={{ fill: '#f3f4f6' }}
                  formatter={(value: number) => [`RM ${value.toLocaleString()}`, 'Total Inflow']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="inflow" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-500 mt-4 text-center">Total money received into bank accounts month-by-month.</p>
        </div>

      </div>

      {/* Monthly Billed vs Collected Performance block */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-500" />
          General Collection Yield Profile (Billed vs Received)
        </h3>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
              <YAxis yAxisId="left" tickFormatter={formatMoney} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
              <Tooltip 
                cursor={{ fill: '#f3f4f6' }}
                formatter={(value: number, name: string) => [
                  name === 'Collection Rate' ? `${value}%` : `RM ${value.toLocaleString()}`, 
                  name === 'collected' ? 'Amount Collected' : name === 'unpaid' ? 'Amount Unpaid' : 'Collection Rate'
                ]}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
              <Bar yAxisId="left" dataKey="collected" name="Collected" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} maxBarSize={60} />
              <Bar yAxisId="left" dataKey="unpaid" name="Unpaid" stackId="a" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={60} />
              <Line yAxisId="right" type="monotone" dataKey="collectionRate" name="Collection Rate" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Service Claims Master List */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
              <Wrench className="w-5 h-5 text-gray-500" />
              Maintenance Repair Claims Register
            </h3>
            <p className="text-sm text-gray-500 mt-1 font-medium">Verify structural fleet repairs claim records to coordinate drivers.</p>
          </div>
          
          <div className="flex bg-gray-50 rounded-lg p-1 border border-gray-250 border-gray-200 overflow-x-auto">
            {monthlyData.map(month => (
              <button
                key={month.name}
                onClick={() => setSelectedMonth(month.name)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${selectedMonth === month.name ? 'bg-white shadow-xs text-blue-700 border border-gray-100' : 'text-gray-500 hover:text-gray-900'}`}
              >
                {month.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 border-r border-gray-100 pr-0 lg:pr-6">
             <h4 className="text-xs uppercase font-extrabold text-gray-400 mb-4 tracking-wider">Claims Historical Trend</h4>
             <div className="h-64 w-full">
               <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={monthlyData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                   <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} dy={5} />
                   <YAxis tickFormatter={(v) => `RM ${(v/1000).toFixed(1)}k`} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                   <Tooltip 
                     cursor={{ fill: '#f3f4f6' }}
                     formatter={(value: number) => [`RM ${value.toLocaleString()}`, 'Service Claim']}
                     contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                   />
                   <Bar 
                     dataKey="serviceClaim" 
                     fill="#f59e0b" 
                     radius={[4, 4, 0, 0]} 
                     maxBarSize={40}
                   />
                 </BarChart>
               </ResponsiveContainer>
             </div>
          </div>

          <div className="lg:col-span-2">
             <div className="flex items-center justify-between mb-4">
                 <h4 className="text-xs uppercase font-extrabold text-gray-400 tracking-wider">Claims Breakdowns ({selectedMonth})</h4>
                 <div className="text-xs font-bold bg-amber-50 text-amber-800 px-3 py-1 rounded-full border border-amber-200">
                     Month Claims: RM {activeSvcData?.serviceClaim?.toLocaleString() || 0}
                 </div>
             </div>
             
             {activeSvcData && activeSvcData.serviceClaimsList && activeSvcData.serviceClaimsList.length > 0 ? (
               <div className="overflow-x-auto border border-gray-200 rounded-lg">
                 <table className="min-w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 border-b border-gray-200 uppercase text-xs font-semibold text-gray-500">
                        <tr>
                           <th className="px-4 py-3">Renter Name</th>
                           <th className="px-4 py-3">Car Plate</th>
                           <th className="px-4 py-3">Date</th>
                           <th className="px-4 py-3 text-right">Claim Amount</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {activeSvcData.serviceClaimsList.map((claim) => (
                           <tr key={claim.id} className="hover:bg-amber-50/20 transition-colors">
                              <td className="px-4 py-3 font-semibold text-gray-900">{claim.driverName}</td>
                              <td className="px-4 py-3">
                                 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-800 border-gray-205 border">
                                    <CarFront className="w-3.5 h-3.5 text-gray-500" />
                                    {claim.carPlate}
                                 </span>
                              </td>
                              <td className="px-4 py-3 text-gray-500 font-mono text-xs">{claim.date}</td>
                              <td className="px-4 py-3 text-right font-bold text-amber-700 font-mono">RM {claim.amount.toLocaleString()}</td>
                           </tr>
                        ))}
                    </tbody>
                 </table>
               </div>
             ) : (
               <div className="flex flex-col items-center justify-center p-8 bg-gray-50/50 border border-gray-100 rounded-lg h-52 text-gray-400">
                  <Search className="w-8 h-8 mb-3 opacity-40 text-gray-400" />
                  <p className="text-sm">No repair claims logs found for {selectedMonth}</p>
               </div>
             )}
          </div>
        </div>
      </div>

      {/* --- WEEKLY DETAIL OVERLAY MODAL (Integrated cleanly) --- */}
      {selectedWeekDetail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
           <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <div>
                      <h3 className="text-lg font-bold text-blue-900 flex items-center gap-2">
                          <Activity className="w-5 h-5 text-blue-600" /> Week Financial Details
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">Detailed agreements performance on index: {selectedWeekDetail.fullLabel}</p>
                  </div>
                  <button onClick={() => setSelectedWeekDetail(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                     <X className="w-5 h-5 text-gray-400 hover:text-gray-700" />
                  </button>
              </div>
              
              <div className="bg-white p-5 grid grid-cols-4 gap-4 border-b border-gray-100">
                   <div className="p-3 bg-gray-55 bg-gray-50 border border-gray-200/50 rounded-lg">
                       <span className="text-[10px] text-gray-400 uppercase font-black tracking-wider">Expected Rent</span>
                       <div className="text-lg font-black text-gray-900 mt-0.5">{formatCurrency(selectedWeekDetail.expected)}</div>
                   </div>
                   <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                       <span className="text-[10px] text-emerald-700 uppercase font-black tracking-wider text-emerald-800">Deposits Match</span>
                       <div className="text-lg font-black text-emerald-700 mt-0.5">{formatCurrency(selectedWeekDetail.collected)}</div>
                   </div>
                   <div className="p-3 bg-gray-50 border border-gray-200/50 rounded-lg font-mono">
                       <span className="text-[10px] text-gray-400 uppercase font-black tracking-wider">Net Variance</span>
                       <div className={`text-lg font-black mt-0.5 ${selectedWeekDetail.variance >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                           {selectedWeekDetail.variance > 0 ? '+' : ''}{formatCurrency(selectedWeekDetail.variance)}
                       </div>
                   </div>
                   <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                       <span className="text-[10px] text-blue-700 uppercase font-black tracking-wider">Matched Rate</span>
                       <div className="text-lg font-black text-blue-800 mt-0.5">{Math.round(selectedWeekDetail.rate)}%</div>
                   </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-0">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-gray-50 font-bold text-xs uppercase text-gray-500 sticky top-0 border-b border-gray-100">
                          <tr>
                              <th className="px-6 py-3">Renter Name</th>
                              <th className="px-6 py-3">Car Plate</th>
                              <th className="px-6 py-3 text-right">Target Rate</th>
                              <th className="px-6 py-3 text-right">Matched Received</th>
                              <th className="px-6 py-3 text-right">Agreement Gap</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                          {selectedWeekDetail.details.map((driver: any, index: number) => {
                              const shortfall = driver.expected - driver.paid;
                              return (
                                  <tr key={index} className="hover:bg-gray-50 transition-colors">
                                      <td className="px-6 py-4 font-bold text-gray-800">{driver.name}</td>
                                      <td className="px-6 py-4 font-mono text-xs text-gray-600">{driver.plate}</td>
                                      <td className="px-6 py-4 text-right font-semibold text-gray-500">{formatCurrency(driver.expected)}</td>
                                      <td className="px-6 py-4 text-right font-bold text-emerald-600">{formatCurrency(driver.paid)}</td>
                                      <td className="px-6 py-4 text-right">
                                          <span className={`font-mono text-xs font-bold ${shortfall > 0.01 ? 'text-rose-600' : 'text-emerald-700'}`}>
                                              {shortfall > 0.01 ? `Short: ${formatCurrency(shortfall)}` : 'Settle'}
                                          </span>
                                      </td>
                                  </tr>
                              );
                          })}
                          {selectedWeekDetail.details.length === 0 && (
                              <tr>
                                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400 italic">No registrations listed in this week.</td>
                              </tr>
                          )}
                      </tbody>
                  </table>
              </div>
              
              <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                  <button onClick={() => setSelectedWeekDetail(null)} className="px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                      Dismiss Breakdown
                  </button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
};

export default AnalyticsView;
