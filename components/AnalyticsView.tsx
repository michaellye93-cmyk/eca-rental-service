import React, { useMemo } from 'react';
import { Driver } from '../types';
import { generateDriverInvoices } from '../utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, AreaChart, Area, ComposedChart } from 'recharts';
import { TrendingUp, Activity, DollarSign, PieChart } from 'lucide-react';

interface AnalyticsViewProps {
  drivers: Driver[];
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ drivers }) => {
  const today = new Date();

  const monthlyData = useMemo(() => {
    // Generate data for the last 6 months
    const months = Array.from({ length: 6 }).map((_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (5 - i), 1);
      return d;
    });

    return months.map(monthDate => {
      const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const endOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
      
      const monthName = startOfMonth.toLocaleString('default', { month: 'short', year: 'numeric' });

      let currentMonthInflow = 0;
      let snapshotTotalArrears = 0;
      let currentMonthInvoicesIssued = 0;
      let currentMonthInvoicesPaid = 0;

      drivers.forEach(driver => {
        if (driver.isDelisted) return; // or include delisted for historical accuracy? The prompt says "sync from active fleet", let's keep it active.

        // 1. Current Month Inflow (Cash collected this month regardless of invoice)
        driver.paymentHistory?.forEach(payment => {
          const pDate = new Date(payment.date);
          if (pDate >= startOfMonth && pDate <= endOfMonth) {
            currentMonthInflow += payment.amount;
          }
        });

        // 2. Snapshot Total Arrears at end of this month
        const snapshotInvoices = generateDriverInvoices(driver, endOfMonth);
        snapshotInvoices.forEach(inv => {
          const dDate = new Date(inv.dueDate + 'T00:00:00');
          if (dDate <= endOfMonth) {
            snapshotTotalArrears += inv.remainingBalance;
          }
        });

        // 3. Performance Collection (Invoices issued IN this month, status as of today)
        // We use today's invoices to see how much of that month's invoices were paid eventually OR 
        // we use snapshot at the end of that month. "current month invoice paid vs unpaid". Let's use today's status.
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
        arrears: parseFloat(snapshotTotalArrears.toFixed(2)),
        issued: parseFloat(currentMonthInvoicesIssued.toFixed(2)),
        collected: parseFloat(currentMonthInvoicesPaid.toFixed(2)),
        unpaid: parseFloat((currentMonthInvoicesIssued - currentMonthInvoicesPaid).toFixed(2)),
        collectionRate: currentMonthInvoicesIssued > 0 
          ? Math.round((currentMonthInvoicesPaid / currentMonthInvoicesIssued) * 100) 
          : 0
      };
    });
  }, [drivers, today.valueOf()]);

  // Format Y-axis money
  const formatMoney = (value: number) => `RM ${(value / 1000).toFixed(1)}k`;

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Analytics & Cash Flow</h2>
        <p className="text-gray-500 text-sm mt-1">Snapshot of your business health over the last 6 months</p>
      </div>

      {/* KPI Cards for the current month */}
      {monthlyData.length > 0 && (() => {
        const currentMonth = monthlyData[monthlyData.length - 1];
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <DollarSign className="w-4 h-4" />
                <h3 className="font-medium text-sm">Total Inflow ({currentMonth.name})</h3>
              </div>
              <div className="text-3xl font-bold text-blue-600">RM {currentMonth.inflow.toLocaleString()}</div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <Activity className="w-4 h-4" />
                <h3 className="font-medium text-sm">End-of-Month Arrears</h3>
              </div>
              <div className="text-3xl font-bold text-red-500">RM {currentMonth.arrears.toLocaleString()}</div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <TrendingUp className="w-4 h-4" />
                <h3 className="font-medium text-sm">Collection Rate</h3>
              </div>
              <div className="text-3xl font-bold text-emerald-500">{currentMonth.collectionRate}%</div>
              <div className="text-xs text-gray-400 mt-1">Paid vs Issued</div>
            </div>
          </div>
        )
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Total Arrears by Monthly Basis (Snapshot) */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-gray-500" />
            Total Arrears (Snapshot)
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
          <p className="text-xs text-gray-500 mt-4 text-center">Snapshot of cumulative arrears at the end of each month.</p>
        </div>

        {/* 2. Current Month Inflow */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-gray-500" />
            Cash Inflow
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
          <p className="text-xs text-gray-500 mt-4 text-center">Total cash collected during the month, regardless of invoice date.</p>
        </div>

        {/* 3. Performance Collection (Current month invoice paid vs unpaid) */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm lg:col-span-2">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-500" />
            Collection Performance (Billed vs Collected)
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
          <p className="text-xs text-gray-500 mt-4 text-center">Compares the collected amount vs left unpaid for invoices issued in that specific month.</p>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsView;
