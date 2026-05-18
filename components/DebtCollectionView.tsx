import React, { useMemo, useState } from 'react';
import { Driver } from '../types';
import { formatCurrency, generateDriverInvoices } from '../utils';
import { HelpCircle, AlertCircle, Calendar, CalendarCheck, Clock, FileText, LayoutDashboard, Send, Siren, TrendingDown, DollarSign } from 'lucide-react';

interface DebtCollectionViewProps {
  drivers: Driver[];
  onLogPayment: (driver: Driver, amount: number) => void;
}

const DebtCollectionView: React.FC<DebtCollectionViewProps> = ({ drivers, onLogPayment }) => {
  const [selectedDriverForPayment, setSelectedDriverForPayment] = useState<Driver | null>(null);

  const [currentDateState, setCurrentDateState] = useState(new Date());

  React.useEffect(() => {
    // Refresh the current date every minute to catch day rollovers if app stays open
    const interval = setInterval(() => {
      setCurrentDateState(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Today's Date normalized (no time)
  const today = new Date(currentDateState);
  today.setHours(0, 0, 0, 0);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayNormalized = new Date(todayStr + 'T00:00:00'); // Stable local midnight-ish ref for safe comparison

  // Date Math helpers
  const getStartOfWeek = (d: Date) => {
    const diff = d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1); // target Monday
    const date = new Date(d);
    date.setDate(diff);
    return date;
  };
  const getEndOfWeek = (d: Date) => {
    const start = getStartOfWeek(d);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return end;
  };

  const startOfWeek = getStartOfWeek(todayNormalized);
  const endOfWeek = getEndOfWeek(todayNormalized);

  const startOfMonth = new Date(todayNormalized.getFullYear(), todayNormalized.getMonth(), 1);
  const endOfMonth = new Date(todayNormalized.getFullYear(), todayNormalized.getMonth() + 1, 0);

  const yesterdayEnd = new Date(todayNormalized);
  yesterdayEnd.setDate(todayNormalized.getDate() - 1);

  const yesterdayStart = new Date(todayNormalized);
  yesterdayStart.setDate(todayNormalized.getDate() - 3);

  // Extract all invoices from active drivers
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
  }, [drivers, todayStr]);

  // Aggregate metrics
  const weeklyTargetAmount = allInvoices.reduce((acc, inv) => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    if (dDate >= startOfWeek && dDate <= endOfWeek) {
      return acc + inv.amount;
    }
    return acc;
  }, 0);
  const weeklyCollectedAmount = allInvoices.reduce((acc, inv) => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    if (dDate >= startOfWeek && dDate <= endOfWeek) {
      return acc + inv.amountPaid;
    }
    return acc;
  }, 0);

  const monthlyTargetAmount = allInvoices.reduce((acc, inv) => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    if (dDate >= startOfMonth && dDate <= endOfMonth) {
      return acc + inv.amount;
    }
    return acc;
  }, 0);
  const monthlyCollectedAmount = allInvoices.reduce((acc, inv) => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    if (dDate >= startOfMonth && dDate <= endOfMonth) {
      return acc + inv.amountPaid;
    }
    return acc;
  }, 0);

  // Categorize Unpaid/Partial Invoices
  const unpaidInvoices = allInvoices.filter(inv => inv.status !== 'PAID');

  const mustCollectToday = unpaidInvoices.filter(inv => {
    return inv.dueDate === todayStr;
  });

  const yesterdayDue = unpaidInvoices.filter(inv => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    return dDate >= yesterdayStart && dDate <= yesterdayEnd;
  });

  const overdue = unpaidInvoices.filter(inv => {
    const dDate = new Date(inv.dueDate + 'T00:00:00');
    return dDate < yesterdayStart;
  });

  // State for active queue list
  const [activeQueue, setActiveQueue] = useState<'TODAY' | 'YESTERDAY' | 'OVERDUE'>('TODAY');

  const getQueueList = () => {
    if (activeQueue === 'TODAY') return mustCollectToday;
    if (activeQueue === 'YESTERDAY') return yesterdayDue;
    return overdue;
  };

  const queueList = getQueueList();

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Weekly Target Card */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="p-5">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="text-gray-900 font-semibold flex items-center gap-2">
                  <CalendarCheck className="w-4 h-4 text-gray-500" />
                  Weekly Target
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  Mon-Sun ({formatDateLabel(startOfWeek.toISOString())} - {formatDateLabel(endOfWeek.toISOString())})
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <span className="text-xs text-gray-500 font-medium">RM </span>
                <span className="text-3xl font-bold text-gray-900">{weeklyCollectedAmount}</span>
              </div>
              <div className="text-right">
                <span className="text-sm text-gray-500">/ RM{weeklyTargetAmount}</span>
              </div>
            </div>
            {/* Progress Bar */}
            <div className="w-full bg-gray-100 rounded-full h-2.5 mt-4">
              <div 
                className="bg-blue-600 h-2.5 rounded-full" 
                style={{ width: `${weeklyTargetAmount > 0 ? Math.min(100, (weeklyCollectedAmount / weeklyTargetAmount) * 100) : 0}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Monthly Target Card */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="p-5">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="text-gray-900 font-semibold flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  Monthly Target
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {startOfMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <span className="text-xs text-gray-500 font-medium">RM </span>
                <span className="text-3xl font-bold text-gray-900">{monthlyCollectedAmount}</span>
              </div>
              <div className="text-right">
                <span className="text-sm text-gray-500">/ RM{monthlyTargetAmount}</span>
              </div>
            </div>
            {/* Progress Bar */}
            <div className="w-full bg-gray-100 rounded-full h-2.5 mt-4">
              <div 
                className="bg-blue-600 h-2.5 rounded-full" 
                style={{ width: `${monthlyTargetAmount > 0 ? Math.min(100, (monthlyCollectedAmount / monthlyTargetAmount) * 100) : 0}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Must Collect Today */}
        <div 
          onClick={() => setActiveQueue('TODAY')}
          className={`cursor-pointer bg-white rounded-xl border p-5 relative overflow-hidden transition-all shadow-sm
            ${activeQueue === 'TODAY' ? 'border-orange-500 ring-1 ring-orange-500' : 'border-gray-200 hover:border-orange-300'}`}
        >
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-orange-500"></div>
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className={`font-semibold ${activeQueue === 'TODAY' ? 'text-orange-600' : 'text-gray-900'}`}>Must Collect Today</h3>
              <p className="text-xs text-gray-500 mt-1">Due today</p>
            </div>
            <span className="text-3xl font-bold text-orange-500">{mustCollectToday.length}</span>
          </div>
          <div className="flex justify-end mt-4">
            <span className="text-xs font-medium text-orange-500 flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> Log Payment
            </span>
          </div>
        </div>

        {/* Yesterday Unpaid */}
        <div 
          onClick={() => setActiveQueue('YESTERDAY')}
          className={`cursor-pointer bg-white rounded-xl border p-5 relative overflow-hidden transition-all shadow-sm
            ${activeQueue === 'YESTERDAY' ? 'border-amber-500 ring-1 ring-amber-500' : 'border-gray-200 hover:border-amber-300'}`}
        >
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500"></div>
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className={`font-semibold ${activeQueue === 'YESTERDAY' ? 'text-amber-600' : 'text-gray-900'}`}>Yesterday Unpaid</h3>
              <p className="text-xs text-gray-500 mt-1">Previous 3 days</p>
            </div>
            <span className="text-3xl font-bold text-amber-500">{yesterdayDue.length}</span>
          </div>
          <div className="flex justify-end mt-4">
            <span className="text-xs font-medium text-amber-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Follow up
            </span>
          </div>
        </div>

        {/* Overdue */}
        <div 
          onClick={() => setActiveQueue('OVERDUE')}
          className={`cursor-pointer bg-white rounded-xl border p-5 relative overflow-hidden transition-all shadow-sm
            ${activeQueue === 'OVERDUE' ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-200 hover:border-red-300'}`}
        >
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-600"></div>
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className={`font-semibold ${activeQueue === 'OVERDUE' ? 'text-red-600' : 'text-gray-900'}`}>Overdue</h3>
              <p className="text-xs text-gray-500 mt-1">Not fully paid yet</p>
            </div>
            <span className="text-3xl font-bold text-red-600">{overdue.length}</span>
          </div>
          <div className="flex justify-end mt-4">
             <span className="text-xs font-medium text-red-600 flex items-center gap-1">
              <Siren className="w-3 h-3" /> Follow up
            </span>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Queue Details</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          {queueList.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p className="text-sm">No active items in the {activeQueue.toLowerCase()} queue.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3">Driver / Car</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3">Invoice Auth</th>
                    <th className="px-4 py-3 text-right">Remaining Balance</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {queueList.sort((a,b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{inv.driverName}</div>
                        <div className="text-xs text-gray-500">{inv.carPlate}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDateLabel(inv.dueDate)}
                        {(activeQueue === 'OVERDUE' || activeQueue === 'YESTERDAY') && (
                          <div className={`text-[10px] font-semibold mt-0.5 ${activeQueue === 'OVERDUE' ? 'text-red-500' : 'text-amber-500'}`}>
                            {Math.floor((todayNormalized.getTime() - new Date(inv.dueDate + 'T00:00:00').getTime()) / (1000 * 3600 * 24))} Days Late
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-gray-500 mb-0.5">RM {inv.amountPaid.toFixed(2)} / RM {inv.amount.toFixed(2)}</div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 w-24">
                          <div 
                            className="bg-green-500 h-1.5 rounded-full" 
                            style={{ width: `${(inv.amountPaid / inv.amount) * 100}%` }}
                          ></div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">
                        RM {inv.remainingBalance.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => onLogPayment(inv.driver, inv.remainingBalance)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium rounded-md text-xs transition-colors"
                        >
                          <DollarSign className="w-3.5 h-3.5" />
                          Log Payment
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DebtCollectionView;
