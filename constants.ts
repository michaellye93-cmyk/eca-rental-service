
import { Driver } from './types';

// Helper to get a date X weeks ago
const weeksAgo = (weeks: number) => {
  const d = new Date();
  d.setDate(d.getDate() - (weeks * 7));
  return d.toISOString().split('T')[0];
};

// Helper to get a specific date (for mock payments)
const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
};

export const INITIAL_DRIVERS: Driver[] = [
  {
    id: '1',
    nric: '880101-01-1234',
    name: 'Ali Bin Abu',
    carPlate: 'VAA 1234',
    contractStartDate: weeksAgo(20),
    rentalCycle: 'WEEKLY',
    contractDuration: 52,
    rentalRate: 400,
    totalAmountPaid: 400 * 15,
    paymentHistory: [
      { id: 'tx_1', date: daysAgo(35), amount: 400 * 15 }
    ]
  },
  {
    id: '2',
    nric: '900202-02-5678',
    name: 'Chong Wei',
    carPlate: 'WBB 8888',
    contractStartDate: weeksAgo(10),
    rentalCycle: 'WEEKLY',
    contractDuration: 52,
    rentalRate: 450,
    totalAmountPaid: 450 * 9,
    paymentHistory: [
      { id: 'tx_2', date: daysAgo(7), amount: 450 * 9 }
    ]
  },
  {
    id: '3',
    nric: '950505-05-9999',
    name: 'Muthu Kumar',
    carPlate: 'JCC 7777',
    contractStartDate: weeksAgo(30),
    rentalCycle: 'WEEKLY',
    contractDuration: 52,
    rentalRate: 400,
    totalAmountPaid: 400 * 30,
    paymentHistory: [
      { id: 'tx_3', date: daysAgo(2), amount: 400 },
      { id: 'tx_3_old', date: daysAgo(30), amount: 400 * 29 }
    ]
  },
  {
    id: '4',
    nric: '990909-09-0000',
    name: 'Sarah Lee',
    carPlate: 'PKD 1111',
    contractStartDate: weeksAgo(5),
    rentalCycle: 'WEEKLY',
    contractDuration: 24,
    rentalRate: 350,
    totalAmountPaid: 350 * 5,
    paymentHistory: [
       { id: 'tx_4', date: daysAgo(3), amount: 350 * 5 }
    ]
  },
  {
    id: '5',
    nric: '850303-03-3333',
    name: 'Ahmad Zaki',
    carPlate: 'BEE 5555',
    contractStartDate: weeksAgo(12),
    rentalCycle: 'WEEKLY',
    contractDuration: 52,
    rentalRate: 500,
    totalAmountPaid: 500 * 5,
    paymentHistory: [
       { id: 'tx_5', date: daysAgo(50), amount: 500 * 5 }
    ]
  }
];
