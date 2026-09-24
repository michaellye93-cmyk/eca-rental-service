import React, { useMemo, useState, useEffect } from 'react';
import type { Driver, DriverWithMetrics, Invoice } from '../types';
import TerminationReport from './TerminationReport';
import { buildWeeklyFinancials, generateDriverInvoices, formatCurrency, formatDate, kualaLumpurNow, parseDate } from '../utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, AreaChart, Area, ComposedChart } from 'recharts';
import { TrendingUp, Activity, DollarSign, PieChart, Wrench, Search, CarFront, X, ShieldAlert, BadgeCheck } from 'lucide-react';

interface AnalyticsViewProps {
  drivers: DriverWithMetrics[];
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ drivers }) => {
  // Re-read with each data load, so the six-month history is rebuilt only when the data changes.
  const today = useMemo(() => kualaLumpurNow(), [drivers]);

  const [selectedMonth, setSelectedMonth] = useState<string>('');

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
          const date = parseDate(payment.date);
          if (date && !isNaN(date.getTime())) {
            const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            breakdown[monthKey] = (breakdown[monthKey] || 0) + payment.amount + (payment.serviceClaim || 0);
          }
        });
      }
    });
    return Object.entries(breakdown).map(([month, amount]) => ({ month, amount })).sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  }, [drivers]);

  const currentMonthName = useMemo(() => {
    return kualaLumpurNow().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
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
    const currentInvoicesByDriver = new Map<string, Invoice[]>(drivers.map((driver: Driver) => [driver.id, generateDriverInvoices(driver, today)]));

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
        // Current Month Inflow (Cash collected this month regardless of invoice or current delisted status)
        driver.paymentHistory?.forEach(payment => {
          const pDate = parseDate(payment.date);
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

        // Check if driver was active during or up to this month for snapshot arrears
        const delistStr = driver.isDelisted ? (driver.delistDate || driver.contractEndDate || driver.contractStartDate) : null;
        const delistDate = delistStr ? parseDate(delistStr) : null;

        if (!delistDate || delistDate >= startOfMonth) {
          // Snapshot Total Arrears at end of this month
          const snapshotInvoices = generateDriverInvoices(driver, endOfMonth);
          snapshotInvoices.forEach(inv => {
            const dDate = parseDate(inv.dueDate);
            if (dDate <= endOfMonth) {
              snapshotTotalArrears += inv.remainingBalance;
            }
          });

          // Performance Collection (Invoices issued IN this month)
          const currentInvoices = currentInvoicesByDriver.get(driver.id) ?? [];
          currentInvoices.forEach(inv => {
            const dDate = parseDate(inv.dueDate);
            if (dDate >= startOfMonth && dDate <= endOfMonth) {
              currentMonthInvoicesIssued += inv.amount;
              currentMonthInvoicesPaid += inv.amountPaid;
            }
          });
        }
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
  }, [drivers, today]);

  // Set default selected month to current month on load
  useEffect(() => {
    if (monthlyData.length > 0 && !selectedMonth) {
      setSelectedMonth(monthlyData[monthlyData.length - 1].name);
    }
  }, [monthlyData, selectedMonth]);

  // Format Y-axis money
  const formatMoney = (value: number) => `RM ${(value / 1000).toFixed(1)}k`;

  const activeSvcData = monthlyData.find(m => m.name === selectedMonth) || monthlyData[monthlyData.length - 1];

  // 5. Weekly rent performance (Monday to Sunday) from the shared schedule, oldest week first
  const allWeeklyFinancials = useMemo(() => buildWeeklyFinancials(drivers), [drivers]);
  

  return (
    <div className="space-y-6">
      <TerminationReport />
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
              <span className="p-1 px-2 text-xs bg-red-100 text-red-800 rounded font-bold uppercase">Base Sum</span>
            </div>
            <div className="text-3xl font-black text-rose-600 font-sans tracking-tight">
              {formatCurrency(totalArrears)}
            </div>
            <p className="text-xs text-gray-500 mt-2">
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
              <span className="p-1 px-2 text-xs bg-emerald-100 text-emerald-800 rounded font-bold uppercase">Deposits</span>
            </div>
            <div className="text-3xl font-black text-emerald-600 font-sans tracking-tight">
              {formatCurrency(currentMonthCollection)}
            </div>
            <p className="text-xs text-gray-500 mt-2">
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
            <p className="text-xs text-gray-500 mt-2">
              Recorded claims for the selected month: {selectedMonth.split(' ')[0]}
            </p>
          </div>
          <div className="mt-4 text-xs text-gray-500 bg-amber-50/50 p-2 rounded border border-amber-100 italic">
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
                <p className="text-xs text-gray-500 mt-2">
                  {formatCurrency(currentMonth.collected)} collected vs {formatCurrency(currentMonth.issued)} issued
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
        <div className="bg-white p-6 rounded-xl border border-rose-200 shadow-md">
          <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-4">
            <div>
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-500" /> Active Arrears Report
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">Live outstanding basic amounts across active agreements.</p>
            </div>
            <button type="button" onClick={() => setShowArrearsList(false)} aria-label="Close arrears list" className="text-gray-500 hover:text-gray-600 p-1 bg-gray-50 rounded-full">
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
                                <span className={`px-2 py-0.5 rounded text-xs font-bold border ${d.metrics.status === 'BAD' ? 'bg-red-100 text-red-800 border-red-200' : 'bg-yellow-100 text-yellow-800 border-yellow-200'}`}>{d.metrics.status}</span>
                            </td>
                            <td className="px-6 py-4 text-right font-mono text-rose-600 font-bold">{formatCurrency(d.activeBalance.baseValue)}</td>
                            <td className="px-6 py-4 text-right font-mono text-gray-600">{d.metrics.cyclesOwed.toFixed(1)}</td>
                        </tr>
                    ))}
                    {arrearsBreakdownList.length === 0 && (
                        <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500 italic">No agreements currently carry active arrears.</td></tr>
                    )}
                </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- INLINE MONTHLY COLLECTIONS REGISTER --- */}
      {showCollectionsList && (
        <div className="bg-white p-6 rounded-xl border border-emerald-200 shadow-md">
          <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-4">
            <div>
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-emerald-500" /> Historic Monthly Collections
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">Aggregate payments received on a monthly cycle (base rate + service claims).</p>
            </div>
            <button type="button" onClick={() => setShowCollectionsList(false)} aria-label="Close collections register" className="text-gray-500 hover:text-gray-600 p-1 bg-gray-50 rounded-full">
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
                        <tr><td colSpan={2} className="px-6 py-8 text-center text-gray-500 italic">No collections received on record.</td></tr>
                    )}
                </tbody>
            </table>
          </div>
        </div>
      )}

            {/* --- WEEKLY INFLOW MONITORING (Line Chart) --- */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 gap-4">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-blue-600" /> Weekly Inflow Analysis
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Tracking Expected Rental vs Performance vs Cash Flow over the last 12 weeks</p>
          </div>
        </div>

        <div className="p-6">
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={allWeeklyFinancials} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis 
                    dataKey="label" 
                    tick={{ fontSize: 11, fill: '#6B7280', fontWeight: 'bold' }} 
                    axisLine={false} 
                    tickLine={false}
                    dy={10}
                />
                <YAxis 
                    tickFormatter={formatMoney}
                    tick={{ fontSize: 11, fill: '#6B7280', fontWeight: 'bold' }}
                    axisLine={false}
                    tickLine={false}
                    dx={-10}
                />
                <Tooltip 
                    formatter={(value: any) => formatCurrency(Number(value))}
                    labelStyle={{ fontWeight: 'bold', color: '#374151', marginBottom: '8px' }}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #E5E7EB', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend 
                    wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold' }}
                    iconType="circle"
                />
                <Line 
                    type="monotone" 
                    dataKey="expected" 
                    name="Expected Rental" 
                    stroke="#9CA3AF" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    activeDot={{ r: 6 }} 
                />
                <Line 
                    type="monotone" 
                    dataKey="performanceCollected" 
                    name="Performance" 
                    stroke="#2563EB" 
                    strokeWidth={3} 
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6, stroke: '#1D4ED8', strokeWidth: 2 }}
                />
                <Line 
                    type="monotone" 
                    dataKey="cashFlowCollected" 
                    name="Cash InFlow" 
                    stroke="#10B981" 
                    strokeWidth={3} 
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6, stroke: '#059669', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
                  formatter={(value: number) => [formatCurrency(value), 'Total Arrears']}
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
                  formatter={(value: number) => [formatCurrency(value), 'Total Inflow']}
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
                  name === 'Collection Rate' ? `${value}%` : formatCurrency(value), 
                  name === 'Collected' ? 'Amount Collected' : name === 'Unpaid' ? 'Amount Unpaid' : 'Collection Rate'
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
          
          <div className="flex bg-gray-50 rounded-lg p-1 border border-gray-200 overflow-x-auto">
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
             <h4 className="text-xs uppercase font-extrabold text-gray-500 mb-4 tracking-wider">Claims Historical Trend</h4>
             <div className="h-64 w-full">
               <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={monthlyData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                   <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} dy={5} />
                   <YAxis tickFormatter={formatMoney} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                   <Tooltip 
                     cursor={{ fill: '#f3f4f6' }}
                     formatter={(value: number) => [formatCurrency(value), 'Service Claim']}
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
                 <h4 className="text-xs uppercase font-extrabold text-gray-500 tracking-wider">Claims Breakdowns ({selectedMonth})</h4>
                 <div className="text-xs font-bold bg-amber-50 text-amber-800 px-3 py-1 rounded-full border border-amber-200">
                     Month Claims: {formatCurrency(activeSvcData?.serviceClaim || 0)}
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
                                 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-800 border-gray-200 border">
                                    <CarFront className="w-3.5 h-3.5 text-gray-500" />
                                    {claim.carPlate}
                                 </span>
                              </td>
                              <td className="px-4 py-3 text-gray-500 font-mono text-xs">{formatDate(claim.date)}</td>
                              <td className="px-4 py-3 text-right font-bold text-amber-700 font-mono">{formatCurrency(claim.amount)}</td>
                           </tr>
                        ))}
                    </tbody>
                 </table>
               </div>
             ) : (
               <div className="flex flex-col items-center justify-center p-8 bg-gray-50/50 border border-gray-100 rounded-lg h-52 text-gray-500">
                  <Search className="w-8 h-8 mb-3 opacity-40 text-gray-500" />
                  <p className="text-sm">No repair claims logs found for {selectedMonth}</p>
               </div>
             )}
          </div>
        </div>
      </div>


    </div>
  );
};

export default AnalyticsView;
