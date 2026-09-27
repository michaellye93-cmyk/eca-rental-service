import React, { useMemo, useState, useEffect } from 'react';
import type { Driver, DriverWithMetrics, Invoice } from '../types';
import { buildWeeklyFinancials, generateDriverInvoices, formatCurrency, formatDate, kualaLumpurNow, monthlyReceipts, parseDate } from '../utils';
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

  // 3. Money received each month, with repair credits (claims) kept apart: they settle rent but are not cash
  const receiptsByMonth = useMemo(() => monthlyReceipts(drivers), [drivers]);
  const monthLabel = (key: string) => new Date(`${key}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthReceipts = receiptsByMonth.find(row => row.month === currentMonthKey) ?? { month: currentMonthKey, cash: 0, repairCredits: 0 };

  // 4. Monthly progress / Chart Data for 6 Months
  const monthlyData = useMemo(() => {
    const months = Array.from({ length: 6 }).map((_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (5 - i), 1);
      return d;
    });
    // The current month counts all of its rent from day one, including cycles falling due later this month.
    const endOfCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    const currentInvoicesByDriver = new Map<string, Invoice[]>(drivers.map((driver: Driver) => [driver.id, generateDriverInvoices(driver, today, endOfCurrentMonth)]));

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

        {/* KPI 2: Cash received this month (money only; repair credits shown apart) */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">Cash received this month</span>
              <span className="p-1 px-2 text-xs bg-emerald-100 text-emerald-800 rounded font-bold uppercase">Money in</span>
            </div>
            <div className="text-3xl font-black text-emerald-700 font-sans tracking-tight">
              {formatCurrency(currentMonthReceipts.cash)}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {monthLabel(currentMonthKey)}. Repair credits of {formatCurrency(currentMonthReceipts.repairCredits)} also settled rent; they are not cash.
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
            {showCollectionsList ? 'Hide monthly receipts' : 'View monthly receipts'}
          </button>
        </div>

        {/* KPI 3: Total Service Claims Card */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">Repair credits (claims)</span>
              <Wrench className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-3xl font-black text-amber-500 font-sans tracking-tight">
              {formatCurrency(activeSvcData?.serviceClaim || 0)}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Repairs drivers paid and deducted from rent in {selectedMonth.split(' ')[0]}. They settle rent but are not cash.
            </p>
          </div>
          <div className="mt-4 text-xs text-gray-500 bg-amber-50/50 p-2 rounded border border-amber-100">
            Choose the month in the repair-credits register below.
          </div>
        </div>

        {/* KPI 4: Collection Rate Card */}
        {monthlyData.length > 0 && (() => {
          const currentMonth = monthlyData[monthlyData.length - 1];
          return (
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-500">Rent settled this month</span>
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-3xl font-black text-blue-700 font-sans tracking-tight">
                  {currentMonth.collectionRate}%
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {formatCurrency(currentMonth.collected)} settled of {formatCurrency(currentMonth.issued)} due this month (cash and repair credits)
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
                <BadgeCheck className="w-5 h-5 text-emerald-500" /> Monthly receipts
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">Money received each month, with repair credits (claims) shown separately because they are not cash.</p>
            </div>
            <button type="button" onClick={() => setShowCollectionsList(false)} aria-label="Close monthly receipts" className="text-gray-500 hover:text-gray-600 p-1 bg-gray-50 rounded-full">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-w-xl mx-auto overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-semibold text-gray-500 border-b border-gray-100">
                    <tr>
                        <th className="px-6 py-3">Month</th>
                        <th className="px-6 py-3 text-right">Cash received</th>
                        <th className="px-6 py-3 text-right">Repair credits</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {receiptsByMonth.slice().reverse().map((item, idx) => (
                        <tr key={item.month} className={`hover:bg-emerald-50/10 transition-colors ${idx === 0 ? "bg-emerald-50/30" : ""}`}>
                            <td className="px-6 py-4 font-semibold text-gray-700">{monthLabel(item.month)}</td>
                            <td className="px-6 py-4 text-right font-bold text-emerald-700 tabular-nums">{formatCurrency(item.cash)}</td>
                            <td className="px-6 py-4 text-right text-amber-800 tabular-nums">{formatCurrency(item.repairCredits)}</td>
                        </tr>
                    ))}
                    {receiptsByMonth.length === 0 && (
                        <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-500 italic">No payments recorded yet.</td></tr>
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
              <Activity className="w-5 h-5 text-blue-600" /> Weekly rent and cash
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Rent due, rent settled (cash and repair credits applied to that week's rent) and cash received, over the last 12 weeks</p>
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
                    name="Rent due"
                    stroke="#9CA3AF" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    activeDot={{ r: 6 }} 
                />
                <Line 
                    type="monotone" 
                    dataKey="performanceCollected"
                    name="Rent settled"
                    stroke="#2563EB" 
                    strokeWidth={3} 
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6, stroke: '#1D4ED8', strokeWidth: 2 }}
                />
                <Line 
                    type="monotone" 
                    dataKey="cashReceived"
                    name="Cash received"
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
            Cash received by month
          </h3>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                <YAxis tickFormatter={formatMoney} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip 
                  cursor={{ fill: '#f3f4f6' }}
                  formatter={(value: number) => [formatCurrency(value), 'Cash received']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="inflow" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-500 mt-4 text-center">Money received from drivers each month. Repair credits are not included.</p>
        </div>

      </div>

      {/* Monthly Billed vs Collected Performance block */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-500" />
          Rent due vs rent settled, by month
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
                  name === 'Share settled' ? `${value}%` : formatCurrency(value), 
                  name === 'Settled' ? 'Rent settled' : name === 'Unpaid' ? 'Rent unpaid' : 'Share settled'
                ]}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
              <Bar yAxisId="left" dataKey="collected" name="Settled" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} maxBarSize={60} />
              <Bar yAxisId="left" dataKey="unpaid" name="Unpaid" stackId="a" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={60} />
              <Line yAxisId="right" type="monotone" dataKey="collectionRate" name="Share settled" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
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
              Repair credits register
            </h3>
            <p className="text-sm text-gray-500 mt-1 font-medium">Repairs drivers paid themselves and deducted from rent, by month. These settle rent but are not cash.</p>
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
