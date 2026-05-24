import React, { useMemo, useState, useEffect } from 'react';
import { Driver } from '../types';
import { generateDriverInvoices } from '../utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, AreaChart, Area, ComposedChart } from 'recharts';
import { TrendingUp, Activity, DollarSign, PieChart, Wrench, Search, CarFront } from 'lucide-react';

interface AnalyticsViewProps {
  drivers: Driver[];
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ drivers }) => {
  const today = new Date();
  
  const [selectedMonth, setSelectedMonth] = useState<string>('');

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
      let currentMonthServiceClaim = 0;
      let snapshotTotalArrears = 0;
      let currentMonthInvoicesIssued = 0;
      let currentMonthInvoicesPaid = 0;
      let serviceClaimsList: { id: string, driverName: string, carPlate: string, date: string, amount: number }[] = [];

      drivers.forEach(driver => {
        if (driver.isDelisted) return;

        // 1. Current Month Inflow (Cash collected this month regardless of invoice)
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

        // 2. Snapshot Total Arrears at end of this month
        const snapshotInvoices = generateDriverInvoices(driver, endOfMonth);
        snapshotInvoices.forEach(inv => {
          const dDate = new Date(inv.dueDate + 'T00:00:00');
          if (dDate <= endOfMonth) {
            snapshotTotalArrears += inv.remainingBalance;
          }
        });

        // 3. Performance Collection (Invoices issued IN this month, status as of today)
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <DollarSign className="w-4 h-4" />
                <h3 className="font-medium text-sm">Total Inflow ({currentMonth.name})</h3>
              </div>
              <div className="text-3xl font-bold text-blue-600">RM {currentMonth.inflow.toLocaleString()}</div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <Wrench className="w-4 h-4" />
                <h3 className="font-medium text-sm">Total Service Claim</h3>
              </div>
              <div className="text-3xl font-bold text-amber-500">RM {currentMonth.serviceClaim.toLocaleString()}</div>
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

      {/* 4. Service Claims Breakdown */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-lg">
              <Wrench className="w-5 h-5 text-gray-500" />
              Service Claims Master List
            </h3>
            <p className="text-sm text-gray-500 mt-1">Identify fleet maintenance costs easily and cross-check drivers manually.</p>
          </div>
          
          <div className="flex bg-gray-50 rounded-lg p-1 border border-gray-200 w-full sm:w-auto">
            {monthlyData.map(month => (
              <button
                key={month.name}
                onClick={() => setSelectedMonth(month.name)}
                className={`flex-1 sm:flex-none px-4 py-2 text-xs font-semibold rounded-md transition-colors ${selectedMonth === month.name ? 'bg-white shadow-sm text-blue-700 border border-gray-100' : 'text-gray-500 hover:text-gray-900'}`}
              >
                {month.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Chart: Claims Over Time */}
          <div className="lg:col-span-1">
             <h4 className="text-sm font-bold text-gray-700 mb-4">Total Claims (6 Months)</h4>
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

          {/* Right Table: Breakdown List */}
          <div className="lg:col-span-2">
             <div className="flex items-center justify-between mb-4">
                 <h4 className="text-sm font-bold text-gray-700">Driver Claim Breakdown ({selectedMonth})</h4>
                 <div className="text-xs font-bold bg-amber-100 text-amber-800 px-3 py-1 rounded-full border border-amber-200">
                     Total: RM {activeSvcData?.serviceClaim?.toLocaleString() || 0}
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
                           <tr key={claim.id} className="hover:bg-amber-50/30 transition-colors">
                              <td className="px-4 py-3 font-medium text-gray-900">{claim.driverName}</td>
                              <td className="px-4 py-3">
                                 <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-800 border-gray-200 border">
                                    <CarFront className="w-3 h-3 text-gray-500" />
                                    {claim.carPlate}
                                 </span>
                              </td>
                              <td className="px-4 py-3 text-gray-500">{claim.date}</td>
                              <td className="px-4 py-3 text-right font-bold text-amber-700">RM {claim.amount.toLocaleString()}</td>
                           </tr>
                        ))}
                    </tbody>
                 </table>
               </div>
             ) : (
               <div className="flex flex-col items-center justify-center p-8 bg-gray-50 border border-gray-100 rounded-lg h-52 text-gray-400">
                  <Search className="w-8 h-8 mb-3 opacity-50" />
                  <p>No service claims recorded for {selectedMonth}</p>
               </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsView;
