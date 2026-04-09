import React, { useMemo } from 'react';
import { Driver, DriverStatus } from '../types';
import { calculateDriverMetrics, formatCurrency, calculateMomentum } from '../utils';
import { 
  CheckCircle2, 
  AlertTriangle, 
  AlertOctagon, 
  LogOut, 
  Calendar, 
  Trophy,
  Flame,
  TrendingUp,
  Lock,
  Unlink
} from 'lucide-react';

interface DriverDashboardProps {
  driver: Driver;
  onLogout: () => void;
}

const DriverDashboard: React.FC<DriverDashboardProps> = ({ driver, onLogout }) => {
  const metrics = calculateDriverMetrics(driver);
  const momentum = calculateMomentum(driver);
  
  // Risk Calculations
  const maxTolerance = 4; // Assuming 4 cycles triggers suspension/repo
  const healthLevel = Math.max(0, 100 - (metrics.cyclesOwed / maxTolerance * 100));
  // Healthy if total debt (Base) is cleared. Penalties are projections.
  const isHealthy = metrics.totalOutstanding <= 0;

  // Trusted Driver Logic: Zero late days over last 4 billing cycles
  const isTrusted = useMemo(() => {
      if (!driver.paymentHistory || driver.paymentHistory.length < 4) return false;
      
      const sorted = [...driver.paymentHistory].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const last4 = sorted.slice(-4);
      const startIndex = sorted.length - 4;
      
      for (let i = 0; i < last4.length; i++) {
          const p = last4[i];
          const globalIndex = startIndex + i;
          
          const startDate = new Date(driver.contractStartDate);
          const expectedDate = new Date(startDate);
           if (driver.rentalCycle === 'MONTHLY') {
            expectedDate.setMonth(startDate.getMonth() + globalIndex);
          } else {
            expectedDate.setDate(startDate.getDate() + (globalIndex * 7));
          }
          
          // Check if late (strictly > expected date)
          // We use a small buffer of 0.5 days to avoid timezone edge cases, but requirement says "zero late days"
          const pDate = new Date(p.date);
          pDate.setHours(0,0,0,0);
          expectedDate.setHours(0,0,0,0);
          
          if (pDate > expectedDate) return false;
      }
      return true;
  }, [driver]);

  // Calculate Historical Best Streak for Psychological Anchor
  const bestStreak = useMemo(() => {
    if (!driver.paymentHistory || driver.paymentHistory.length === 0) return 0;
    
    // Sort oldest to newest
    const sortedHistory = [...driver.paymentHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    let max = 0;
    let current = 0;
    
    // Cycle duration in days + buffer
    const cycleDays = driver.rentalCycle === 'MONTHLY' ? 30 : 7;
    const tolerance = cycleDays + 5; 

    for (let i = 0; i < sortedHistory.length; i++) {
        if (i === 0) {
            current = 1;
            continue;
        }
        const prev = new Date(sortedHistory[i-1].date);
        const curr = new Date(sortedHistory[i].date);
        const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 3600 * 24);
        
        if (diffDays <= tolerance) {
            current++;
        } else {
            max = Math.max(max, current);
            current = 1;
        }
    }
    return Math.max(max, current);
  }, [driver.paymentHistory, driver.rentalCycle]);

  const getStatusUI = () => {
    // Specific UI for Delisted Drivers with Debt
    if (driver.isDelisted && metrics.totalOutstanding > 0) {
      return {
        bg: 'bg-red-900',
        lightBg: 'bg-red-50',
        text: 'text-red-100',
        border: 'border-red-900',
        icon: <AlertOctagon className="w-12 h-12 text-red-500 mb-2" />,
        title: 'Final Settlement Required',
        message: `Outstanding balance: ${formatCurrency(metrics.totalOutstanding)}. Please settle immediately to close account.`,
        ctaColor: 'bg-red-800 hover:bg-red-900'
      };
    }

    if (driver.isDelisted && metrics.totalOutstanding <= 0) {
      return {
        bg: 'bg-gradient-to-br from-amber-400 to-yellow-600',
        lightBg: 'bg-amber-50',
        text: 'text-amber-900',
        border: 'border-amber-300',
        icon: <Trophy className="w-12 h-12 text-white mb-2" />,
        title: 'You Are Always Welcome Back',
        message: "Thanks for being a Five-Star driver! Your record is perfect.",
        ctaColor: 'bg-amber-700 hover:bg-amber-800'
      };
    }

    switch (metrics.status) {
      case DriverStatus.GOOD:
        if (isTrusted) {
            return {
              bg: 'bg-green-500',
              lightBg: 'bg-green-50',
              text: 'text-green-700',
              border: 'border-green-200',
              icon: <CheckCircle2 className="w-12 h-12 text-white mb-2" />,
              title: 'Trusted Driver',
              message: 'Great job! You are up to date with your payments.',
              ctaColor: 'bg-green-600 hover:bg-green-700'
            };
        } else {
            // Late Payer - No Penalty Applied (Yellow)
            return {
              bg: 'bg-yellow-500',
              lightBg: 'bg-yellow-50',
              text: 'text-yellow-800',
              border: 'border-yellow-200',
              icon: <AlertTriangle className="w-12 h-12 text-white mb-2" />,
              title: 'Late Payer - No Penalty',
              message: 'You are up to date, but frequently late. Improve punctuality to regain Trusted status.',
              ctaColor: 'bg-yellow-600 hover:bg-yellow-700'
            };
        }
      case DriverStatus.MID:
        return {
          bg: 'bg-gray-800', // Changed to dark for Action Required
          lightBg: 'bg-yellow-50',
          text: 'text-yellow-400',
          border: 'border-yellow-600',
          icon: <AlertTriangle className="w-12 h-12 text-yellow-400 mb-2" />,
          title: 'Action Required',
          message: `You are lagging by ${metrics.cyclesOwed.toFixed(1)} ${driver.rentalCycle === 'MONTHLY' ? 'months' : 'weeks'}.`,
          ctaColor: 'bg-yellow-600 hover:bg-yellow-700'
        };
      case DriverStatus.BAD:
        return {
          bg: 'bg-red-900', // Dark red for Critical
          lightBg: 'bg-red-50',
          text: 'text-red-500',
          border: 'border-red-800',
          icon: <AlertOctagon className="w-12 h-12 text-red-500 mb-2 animate-pulse" />,
          title: 'CRITICAL ALERT',
          message: 'Immediate payment required to avoid vehicle suspension.',
          ctaColor: 'bg-red-600 hover:bg-red-700'
        };
    }
  };

  const ui = getStatusUI();

  // Dynamic sizing for long names to maintain clean UI
  const nameSizeClass = driver.name.length > 25 ? 'text-lg' : 'text-xl';

  const normalizeCategory = (cat?: string) => {
    if (!cat) return '';
    return cat.toUpperCase().replace(/\s+/g, '_');
  };
  const isSewaBiasa = normalizeCategory(driver.category) === 'SEWA_BIASA';

  const partnershipStatus = useMemo(() => {
    if (metrics.status !== DriverStatus.GOOD) return 'BAD';
    // If status is GOOD (Up to date), distinguish between Elite (GOOD) and Steady (MID)
    // Use Punctuality Score (Avg Lateness)
    // If score > 3 days, disable benefits (MID)
    return (momentum.avgLateness <= 3) ? 'GOOD' : 'MID';
  }, [metrics.status, momentum.avgLateness]);

  return (
    <div className="min-h-screen bg-gray-50 pb-10 font-sans">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-4 flex justify-between items-center gap-4">
          <div className="min-w-0 flex-1">
            <h1 className={`${nameSizeClass} font-bold text-gray-800 uppercase leading-snug break-words`}>
              Hello, {driver.name}
            </h1>
            <p className="text-sm text-gray-500 font-mono truncate">{driver.carPlate}</p>
          </div>
          <button onClick={onLogout} className="text-gray-400 hover:text-gray-600 shrink-0 p-1">
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-6 space-y-6">
        
        {/* Contract Progress (Top) - Hidden for Sewa Biasa */}
        {!isSewaBiasa && (
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span className="flex items-center gap-1"><Calendar className="w-4 h-4"/> Contract Progress</span>
              <span className="font-semibold">{driver.rentalCycle === 'MONTHLY' ? 'Month' : 'Week'} {metrics.cyclesElapsed}/{driver.contractDuration}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div 
                className={`h-2.5 rounded-full transition-all duration-1000 ease-out ${isHealthy ? 'bg-blue-600' : 'bg-gray-400'}`} 
                style={{ width: `${metrics.progressPercent}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Hero Status Card */}
        <div className={`${ui.bg} rounded-2xl shadow-lg p-6 text-white text-center transform transition-all border border-transparent`}>
            <div className="flex flex-col items-center">
                {ui.icon}
                <h2 className={`text-2xl font-bold mb-1 ${!isHealthy ? 'text-white' : ''}`}>{ui.title}</h2>
                <p className={`${!isHealthy ? 'text-gray-300' : 'text-white/90'} text-sm font-medium whitespace-pre-line`}>{ui.message}</p>
            </div>
        </div>

        {/* Financial Details */}
        <div className="grid grid-cols-2 gap-4">
            <div className={`bg-white p-4 rounded-xl shadow-sm border ${!isHealthy ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-100'}`}>
                {/* Changed to Principal/Base Outstanding */}
                <div className="text-gray-500 text-xs uppercase font-semibold mb-1">Base Outstanding</div>
                <div className={`text-xl font-bold ${isHealthy ? 'text-gray-800' : 'text-red-600'}`}>
                    {formatCurrency(Math.max(0, metrics.principalOutstanding))}
                </div>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <div className="text-gray-500 text-xs uppercase font-semibold mb-1">{driver.rentalCycle === 'MONTHLY' ? 'Monthly' : 'Weekly'} Rate</div>
                <div className="text-xl font-bold text-gray-800">
                    {formatCurrency(driver.rentalRate)}
                </div>
            </div>
        </div>

        {/* GAMIFIED / RISK SECTION */}
        {isSewaBiasa ? (
           /* --- SEWA BIASA: PARTNERSHIP STATUS --- */
           <div className={`p-6 rounded-2xl shadow-lg border ${
                partnershipStatus === 'BAD' 
                    ? 'bg-red-50 border-red-200' 
                    : partnershipStatus === 'GOOD' 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-white border-gray-100'
            }`}>
                <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-full shrink-0 ${
                        partnershipStatus === 'BAD' 
                            ? 'bg-red-100 text-red-600' 
                            : partnershipStatus === 'GOOD' 
                                ? 'bg-green-100 text-green-600' 
                                : 'bg-blue-100 text-blue-600'
                    }`}>
                        {partnershipStatus === 'BAD' ? <AlertOctagon className="w-6 h-6" /> : 
                         partnershipStatus === 'GOOD' ? <Trophy className="w-6 h-6" /> : 
                         <CheckCircle2 className="w-6 h-6" />}
                    </div>
                    <div>
                        <h3 className={`text-lg font-bold mb-1 ${
                            partnershipStatus === 'BAD' ? 'text-red-800' : 
                            partnershipStatus === 'GOOD' ? 'text-green-800' : 
                            'text-gray-800'
                        }`}>
                            {partnershipStatus === 'GOOD' ? "Preferred Partner Status" :
                             partnershipStatus === 'MID' ? "Active Rental Status" :
                             "Action Required"}
                        </h3>
                        <p className={`text-sm ${
                            partnershipStatus === 'BAD' ? 'text-red-700' : 
                            partnershipStatus === 'GOOD' ? 'text-green-700' : 
                            'text-gray-600'
                        }`}>
                            {partnershipStatus === 'GOOD' ? "Your account is in perfect standing. We appreciate your commitment to excellence!" :
                             partnershipStatus === 'MID' ? "You are currently up to date. Keep up the consistent payments to maintain your status." :
                             "Your vehicle potentially to be locked anytime, please make payment to ensure continued vehicle access."}
                        </p>
                    </div>
                </div>
            </div>
        ) : isHealthy ? (
            /* --- POSITIVE / TRUSTED STATE (SEWABELI) --- */
            <div className="bg-white/90 backdrop-blur-sm border border-green-100 p-6 rounded-2xl shadow-[0_4px_20px_rgba(34,197,94,0.1)] relative overflow-hidden">
                {/* Decorative Glass Glow */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-green-400/20 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
                
                {/* Streak Badge */}
                <div className="flex items-center gap-4 mb-6 relative z-10">
                    <div className="p-3 bg-gradient-to-br from-yellow-100 to-amber-100 rounded-full shadow-inner ring-1 ring-amber-200">
                        <Flame className="w-8 h-8 text-amber-500 fill-amber-500 animate-pulse" />
                    </div>
                    <div>
                        <h3 className="text-gray-900 font-bold text-lg leading-tight">Elite Status: Active</h3>
                        <p className="text-green-600 text-[10px] font-bold uppercase tracking-widest mt-1">Perfect Payment Streak</p>
                    </div>
                </div>

                {/* Ownership Journey Meter */}
                <div className="relative z-10">
                    <div className="flex justify-between items-end mb-2">
                        <h4 className="text-gray-600 font-bold text-xs uppercase tracking-wider">Ownership Journey</h4>
                        <span className="text-2xl font-bold text-gray-800">{metrics.progressPercent.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-4 shadow-inner overflow-hidden ring-1 ring-gray-200">
                        <div 
                            className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-1000"
                            style={{ width: `${metrics.progressPercent}%` }}
                        >
                             <div className="w-full h-full opacity-30 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImgridIiB4PSIwIiB5PSIwIiB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiPjxwYXRoIGQ9Ik0wIDQMEwIDQwIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')]"></div>
                        </div>
                    </div>
                    <p className="text-center text-xs text-gray-500 mt-3 font-medium">
                        You are <span className="text-green-600 font-bold">{metrics.progressPercent.toFixed(0)}%</span> of the way to owning this car!
                    </p>
                </div>
            </div>
        ) : (
            /* --- NEGATIVE / RISK STATE (SEWABELI) --- */
            <div className="bg-[#0f1115] text-white p-6 rounded-2xl shadow-2xl border border-red-900/50 relative overflow-hidden">
                {/* Dark Background Accents */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>

                {/* PENALTY ACCUMULATOR */}
                <div className="flex items-start justify-between mb-8 relative z-10">
                    <div>
                        <h3 className="text-red-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-1">Total Accrued Penalty</h3>
                        <div className="flex items-baseline gap-1.5">
                            {/* Showing Accumulated Penalty Pot */}
                            <span className="text-3xl font-bold text-white tracking-tight">{formatCurrency(metrics.penaltyAmount)}</span>
                        </div>
                        <div className="mt-1">
                             <p className="text-gray-400 text-xs flex items-center gap-1">
                                <span className="text-red-400 font-semibold">+{formatCurrency(metrics.dailyInterest)}</span> added today
                             </p>
                             <p className="text-gray-500 text-[10px] mt-0.5">Interest compounding daily at 18% p.a.</p>
                        </div>
                    </div>
                    <div className="p-2.5 bg-red-900/20 rounded-xl border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                        <TrendingUp className="w-6 h-6 text-red-500" />
                    </div>
                </div>

                {/* Streak Reset Warning */}
                <div className="mb-6 relative z-10">
                    <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 flex items-center gap-4">
                        <div className="p-3 bg-red-500/10 rounded-full border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                            <Unlink className="w-6 h-6 text-red-500" />
                        </div>
                        <div>
                            <h4 className="text-red-400 text-[10px] font-bold uppercase tracking-widest mb-0.5">Streak Broken</h4>
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-bold text-white">0 {driver.rentalCycle === 'MONTHLY' ? 'Mths' : 'Wks'}</span>
                                {bestStreak > 0 && (
                                    <span className="text-xs text-gray-500 font-medium">
                                        (Best: <span className="text-gray-400">{bestStreak}</span>)
                                    </span>
                                )}
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                                Consistent payment status lost.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Contract Health Meter */}
                <div className="mb-8 relative z-10">
                    <div className="flex justify-between text-xs mb-2">
                        <span className="text-gray-400 font-medium uppercase tracking-wider text-[10px]">Contract Health</span>
                        <span className={`${healthLevel < 30 ? 'text-red-500' : 'text-yellow-500'} font-bold text-[10px] uppercase tracking-wider`}>
                            {healthLevel < 30 ? 'Critical' : 'At Risk'}
                        </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden ring-1 ring-white/5">
                        <div 
                            className={`h-full rounded-full transition-all duration-1000 ${
                                healthLevel < 30 ? 'bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.8)]' : 'bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500'
                            }`}
                            style={{ width: `${healthLevel}%` }}
                        ></div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-red-400 font-medium">
                       <AlertOctagon className="w-3 h-3" />
                       <span>{metrics.cyclesOwed.toFixed(1)} cycles pending suspension</span>
                    </div>
                </div>

                {/* Frozen Progress */}
                <div className="relative border-t border-white/10 pt-4">
                    <div className="flex justify-between items-end mb-2 opacity-50">
                        <h4 className="text-gray-500 font-bold text-xs uppercase tracking-wider">Ownership Journey</h4>
                        <span className="text-xs font-bold text-gray-500 flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded"><Lock className="w-3 h-3"/> PAUSED</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2 opacity-40">
                        <div 
                            className="h-full bg-gray-500 rounded-full"
                            style={{ width: `${metrics.progressPercent}%` }}
                        ></div>
                    </div>
                    <p className="text-xs text-center mt-3 text-gray-500 italic">
                        Your journey to owning this vehicle is on hold until your account is cleared.
                    </p>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};

export default DriverDashboard;