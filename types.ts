
export interface Car {
  id: string;
  make: string;
  model: string;
  plateNumber: string;
  roadtaxExpiry: string; // YYYY-MM-DD
  insuranceExpiry: string; // YYYY-MM-DD
  inspectionExpiry: string; // YYYY-MM-DD
  notes?: string;
}

export enum DriverStatus {
  GOOD = 'GOOD',
  MID = 'MID',
  BAD = 'BAD'
}

export interface PaymentTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
}

export interface Driver {
  id: string;
  nric: string; // Acts as password
  name: string;
  carPlate: string;
  contractStartDate: string; // YYYY-MM-DD
  contractEndDate?: string; // YYYY-MM-DD (New)
  
  category?: 'SEWABELI' | 'SEWA_BIASA'; // New Category

  // Generalized Duration and Rate
  rentalCycle: 'WEEKLY' | 'MONTHLY'; 
  contractDuration: number; // Number of Cycles (Weeks or Months)
  rentalRate: number; // Amount per Cycle
  
  totalAmountPaid: number;
  paymentHistory: PaymentTransaction[];
  isDelisted?: boolean;
  delistDate?: string; // YYYY-MM-DD
  tags?: string[];

  // New Performance Metrics from SQL View
  avgDaysLate?: number;
  lastDaysLate?: number;
  performanceVelocity?: number;
}

export interface DriverMetrics {
  cyclesElapsed: number;
  expectedPayment: number;
  
  // New separated financial fields
  principalOutstanding: number; // The Base Debt (Pure Rent)
  penaltyAmount: number;        // The Accrued Penalty (Projection)
  totalOutstanding: number;     // Base Only (Principal) to ensure Admin View doesn't include projection
  
  cyclesOwed: number;
  status: DriverStatus;
  progressPercent: number;
  dailyInterest: number;        // Next day's penalty increment
}
