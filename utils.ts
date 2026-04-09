import { Driver, DriverMetrics, DriverStatus } from './types';

export const calculateDriverMetrics = (driver: Driver, referenceDate: Date = new Date()): DriverMetrics => {
  const now = new Date(referenceDate);
  const startDate = new Date(driver.contractStartDate);
  
  // Determine effective end date
  let effectiveEndDate = now;
  
  // 1. Cap at Contract End Date if exists (Ghost Record Logic)
  // Requirement: Exclude invoices dated exactly on the return date or after.
  if (driver.contractEndDate) {
      const cEndDate = new Date(driver.contractEndDate);
      // If the contract ended, we cap the effective end date.
      // We subtract 1 millisecond to ensure the invoice ON the end date is excluded (since we use <= comparison or math)
      // effectively making it strictly < contractEndDate
      cEndDate.setMilliseconds(cEndDate.getMilliseconds() - 1);
      
      if (cEndDate < now) {
          effectiveEndDate = cEndDate;
      }
  }

  // 2. Logic: If driver is delisted, stop clock at delist date
  if (driver.isDelisted && driver.delistDate) {
    const dDate = new Date(driver.delistDate);
    // Same logic: Exclude invoice on the delist date
    dDate.setMilliseconds(dDate.getMilliseconds() - 1);
    
    // If delisted BEFORE the current effective end date, cap it further
    if (dDate < effectiveEndDate) {
        effectiveEndDate = dDate;
    }
  }
  
  // Calculate Cycles Elapsed
  let cyclesElapsed = 0;
  
  if (driver.rentalCycle === 'MONTHLY') {
      // Monthly Logic
      // We use a loop to count valid invoice dates
      const timeDiff = effectiveEndDate.getTime() - startDate.getTime();
      if (timeDiff >= 0) {
          let d = new Date(startDate);
          let count = 0;
          // Loop: while invoice date <= effectiveEndDate
          // Since we subtracted 1ms from EndDate, an invoice ON the original EndDate will be > effectiveEndDate
          while (d <= effectiveEndDate) {
              count++;
              d.setMonth(d.getMonth() + 1);
          }
          cyclesElapsed = count;
      }
      
  } else {
      // Weekly Logic (Default)
      const timeDiff = effectiveEndDate.getTime() - startDate.getTime();
      const millisecondsPerWeek = 1000 * 60 * 60 * 24 * 7;
      
      if (timeDiff >= 0) {
        // Math.floor will count full weeks.
        // If effectiveEndDate is 6 days after start, result 0.
        // If effectiveEndDate is 7 days after start (exact next cycle), result 1.
        // But we want to include the START date invoice (cycle 0).
        // Standard formula: floor(diff / week) + 1
        // If effectiveEndDate is reduced by 1ms (just before next cycle), floor is 0. +1 = 1. Correct.
        cyclesElapsed = Math.floor(timeDiff / millisecondsPerWeek) + 1;
      }
  }

  const expectedPrincipal = cyclesElapsed * driver.rentalRate;
  
  // BASE OUTSTANDING: Pure Rent Arrears
  // Will be recalculated based on remaining invoice principals
  
  // --- COMPOUNDING PENALTY CALCULATION ---
  // Rate: 18% per annum => Daily Rate
  const dailyRate = 0.18 / 365;
  // Grace Period Logic:
  // We want penalties to start accruing strictly from Due Date + 2 Days.
  // Example: Due Jan 1. +2 Days = Jan 3.
  // We want Jan 3 to be the first day of penalty (1 day late).
  // So Threshold must be Jan 2.
  // Threshold = DueDate + gracePeriodDays.
  // Jan 2 = Jan 1 + 1.
  // So gracePeriodDays must be 1.
  const gracePeriodDays = 1;

  let totalPenalty = 0;
  let totalDailyInterest = 0;
  let sumRemainingPrincipal = 0;

  // Clone payments to consume them (FIFO)
  // Sort by date ascending AND Filter by referenceDate
  let availablePayments = (driver.paymentHistory || [])
    .map(p => ({ ...p, date: new Date(p.date) }))
    .filter(p => p.date <= now) // Filter payments made after the reference date
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Iterate through each cycle that has elapsed
  for (let i = 0; i < cyclesElapsed; i++) {
    // Determine the invoice date (Due Date) for this cycle
    const invoiceDate = new Date(startDate);
    if (driver.rentalCycle === 'MONTHLY') {
      invoiceDate.setMonth(startDate.getMonth() + i);
    } else {
      invoiceDate.setDate(startDate.getDate() + (i * 7));
    }

    let invoicePrincipal = driver.rentalRate;
    
    // Penalty Start Date: Interest begins accruing on the 3rd day after the invoice date
    // Grace Period = 3 days.
    // Example: Invoice Jan 1. Grace Jan 2, Jan 3, Jan 4. Interest starts Jan 5.
    // So threshold is InvoiceDate + 3 days.
    const penaltyStartDate = new Date(invoiceDate);
    penaltyStartDate.setDate(penaltyStartDate.getDate() + gracePeriodDays);

    // Consumption Logic: Pay off this invoice with available payments
    while (invoicePrincipal > 0.01) { // Float tolerance
        if (availablePayments.length === 0) break; // No more payments
        
        let payment = availablePayments[0];
        let allocation = Math.min(invoicePrincipal, payment.amount);
        
        // Check if this allocation was late
        // Late if payment date is AFTER the penalty start date
        if (payment.date > penaltyStartDate) {
            const diffTime = payment.date.getTime() - penaltyStartDate.getTime();
            const daysLate = Math.ceil(diffTime / (1000 * 3600 * 24));
            
            if (daysLate > 0) {
                // Calculate Interest on this chunk: Principal * ((1+r)^t - 1)
                // This is the penalty accrued for the duration it was unpaid
                const interest = allocation * (Math.pow(1 + dailyRate, daysLate) - 1);
                totalPenalty += interest;
            }
        }
        
        invoicePrincipal -= allocation;
        payment.amount -= allocation;
        
        if (payment.amount <= 0.01) {
            availablePayments.shift(); // Payment exhausted
        }
    }
    
    // If invoice is still outstanding (partially or fully)
    if (invoicePrincipal > 0.01) {
        sumRemainingPrincipal += invoicePrincipal;

        // Calculate penalty up to NOW if currently late
        if (now > penaltyStartDate) {
            const diffTime = now.getTime() - penaltyStartDate.getTime();
            const daysLate = Math.ceil(diffTime / (1000 * 3600 * 24));
            
            if (daysLate > 0) {
                // Current Debt for this chunk = Principal * (1+r)^t
                const currentDebt = invoicePrincipal * Math.pow(1 + dailyRate, daysLate);
                const interest = currentDebt - invoicePrincipal;
                totalPenalty += interest;
                
                // Calculate Daily Interest for Today (on the compounded debt)
                // Interest added today = CurrentDebt * dailyRate
                totalDailyInterest += currentDebt * dailyRate;
            }
        }
    }
  }

  // TOTAL DEBT
  // Constraint: Admin treats penalty as projection. So exposed "totalOutstanding" should be Base only.
  const principalOutstanding = sumRemainingPrincipal;
  const totalOutstanding = principalOutstanding; 
  
  // Cycles owed based on Principal only (fairness metric)
  const cyclesOwed = driver.rentalRate > 0 
    ? principalOutstanding / driver.rentalRate 
    : 0;

  let status = DriverStatus.GOOD;
  
  // Thresholds
  const badThreshold = driver.rentalCycle === 'MONTHLY' ? 1.1 : 3;
  const midThreshold = 0;

  if (cyclesOwed >= badThreshold) {
    status = DriverStatus.BAD;
  } else if (cyclesOwed > midThreshold) {
    status = DriverStatus.MID;
  }

  const progressPercent = Math.min(100, Math.max(0, (cyclesElapsed / driver.contractDuration) * 100));

  return {
    cyclesElapsed,
    expectedPayment: expectedPrincipal,
    principalOutstanding, // Explicit Base
    penaltyAmount: totalPenalty, // Explicit Penalty
    totalOutstanding, // Now strictly Base
    cyclesOwed,
    status,
    progressPercent,
    dailyInterest: totalDailyInterest
  };
};

export const calculateActiveBalance = (driver: Driver): { baseValue: number, accruedInterest: number } => {
  // Unified Calculation: Sums invoices where status === 'unpaid' (handled by metrics logic)
  // Ignores VOID (handled by contractEndDate capping logic above)
  const metrics = calculateDriverMetrics(driver);
  return {
    baseValue: metrics.principalOutstanding,
    accruedInterest: metrics.penaltyAmount
  };
};

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2
  }).format(amount);
};

export const analyzePaymentHabit = (driver: Driver) => {
  if (!driver.paymentHistory || driver.paymentHistory.length < 2) {
    return { type: 'NEW', label: 'New / No Data', color: 'bg-gray-100 text-gray-600' };
  }

  const recentPayments = driver.paymentHistory.slice(0, 3);
  let totalGapDays = 0;
  let count = 0;

  for (let i = 0; i < recentPayments.length - 1; i++) {
    const d1 = new Date(recentPayments[i].date);
    const d2 = new Date(recentPayments[i+1].date);
    const diffTime = Math.abs(d1.getTime() - d2.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    totalGapDays += diffDays;
    count++;
  }

  const avgInterval = count > 0 ? totalGapDays / count : 0;
  
  const targetInterval = driver.rentalCycle === 'MONTHLY' ? 30 : 7;
  const buffer = driver.rentalCycle === 'MONTHLY' ? 5 : 2; // Allow +X days slip

  if (avgInterval > (targetInterval * 2)) {
    return { type: 'ERRATIC', label: 'Erratic Payer', color: 'bg-purple-100 text-purple-700 border-purple-200' };
  }
  if (avgInterval > (targetInterval + buffer)) {
    return { type: 'LATE_CYCLE', label: 'Habitual Late', color: 'bg-orange-100 text-orange-700 border-orange-200' };
  }
  return { type: 'CONSISTENT', label: 'Consistent', color: 'bg-blue-50 text-blue-700 border-blue-200' };
};

export const calculateMomentum = (driver: Driver) => {
    // 1. Sort Payments by Date Ascending
    const payments = [...driver.paymentHistory].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Default safe values for new drivers
    if (payments.length === 0) return { avgLateness: 0, lastLateness: 0, velocity: 0, isSlipping: false, trend: 'STAGNANT', isPerfect: false };

    const startDate = new Date(driver.contractStartDate);
    
    // LOGIC: Map N-th payment transaction to N-th cycle due date
    const latenessData = payments.map((p, index) => {
        // Expected Due Date = Start Date + (index * CycleInterval)
        const expectedDate = new Date(startDate);
        if (driver.rentalCycle === 'MONTHLY') {
            expectedDate.setMonth(startDate.getMonth() + index);
        } else {
            expectedDate.setDate(startDate.getDate() + (index * 7));
        }
        
        const actualDate = new Date(p.date);
        const diffTime = actualDate.getTime() - expectedDate.getTime();
        // Calculate days late (can be negative if paid early)
        return Math.ceil(diffTime / (1000 * 3600 * 24));
    });

    const totalLateness = latenessData.reduce((acc, val) => acc + val, 0);
    const avgLateness = latenessData.length > 0 ? totalLateness / latenessData.length : 0;
    const lastLateness = latenessData.length > 0 ? latenessData[latenessData.length - 1] : 0;
    
    // Velocity: How much worse (or better) the last payment was compared to average
    const velocity = lastLateness - avgLateness;
    
    // Trigger: If last payment is 3+ days later than their average
    const isSlipping = velocity >= 3; 

    // Trend Icon Logic
    let trend = 'STAGNANT'; // ➡️
    if (velocity >= 3) trend = 'DETERIORATING'; // 📉 Paying later than avg
    else if (velocity <= -3) trend = 'IMPROVING'; // 📈 Paying earlier than avg
    else trend = 'STAGNANT';
    
    // Perfect check: Avg lateness is <= 0 (mostly early/on-time) AND not currently slipping
    const isPerfect = avgLateness <= 0 && velocity <= 0;
    if (isPerfect) trend = 'PERFECT';

    return { avgLateness, lastLateness, velocity, isSlipping, trend, isPerfect };
};