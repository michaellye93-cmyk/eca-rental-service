import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle, AlertCircle, Download, FileText, Loader } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { supabase } from '../supabaseClient';
import { Driver } from '../types';

interface ReconcileTransaction {
  status: 'MATCHED' | 'UNMATCHED' | 'WITHDRAWAL';
  trans_date: string;
  display_date?: string;
  amount: number;
  sender_name: string;
  reference: string;
  plate_number?: string; 
  matched_by?: string; 
  matched_driver_name?: string;
  driver_id?: string;
  is_deposit?: boolean;
  amount_cr?: number | null;
  amount_dr?: number | null;
  branch_description?: string;
  ref_num?: string;
  balance?: number;
  original_index?: number;
}

interface ReconciliationResult {
  paired_transactions: ReconcileTransaction[];
  unpaired_transactions: ReconcileTransaction[];
  all_transactions?: ReconcileTransaction[];
  unsolved_system_transactions?: any[];
  summary?: {
    beginning_balance?: number;
    total_deposits_amount?: number;
    total_deposits_count?: number;
    total_withdrawals_amount?: number;
    total_withdrawals_count?: number;
    ending_balance?: number;
  };
}

function getSysDateLocal(sysPay: any) {
  let sysDateLocal = "";
  try {
      let safeDateStr = sysPay.trans_date || sysPay.date || "";
      if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(safeDateStr)) {
          const parts = safeDateStr.split(/[-\/]/);
          safeDateStr = parts[2]+"-"+parts[1].padStart(2,"0")+"-"+parts[0].padStart(2,"0");
      }
      let timeVal = new Date(safeDateStr).getTime();
      if (isNaN(timeVal)) timeVal = 0;
      else timeVal += (8 * 3600 * 1000);
      const sysDateObj = new Date(timeVal);
      sysDateLocal = sysDateObj.toISOString().split("T")[0];
  } catch(e) {
      sysDateLocal = sysPay.trans_date || sysPay.date || "";
  }
  return sysDateLocal;
}

function normalizeToken(token: string) {
  const t = token.toUpperCase().trim();
  if (/^(MOHD|MHD|MOHAMAD|MOHAMID|MOHAMED|MOHAMMAD|MOHAMMED|MUHD|MUHAMAD|MUHAMID|MUHAMED|MUHAMMAD|MUHAMMED|MD|M)$/.test(t)) {
    return 'MD';
  }
  if (/^(ABDUL|ABD)$/.test(t)) {
    return 'ABD';
  }
  if (/^(AHMAD|AHMED)$/.test(t)) {
    return 'AHMAD';
  }
  if (/^(CHANDRAN|CHNDRAN)$/.test(t)) {
    return 'CHANDRAN';
  }
  return t;
}

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  const s = str.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.add(s.substring(i, i + 2));
  }
  return bigrams;
}

function checkBigramSimilarity(str1: string, str2: string): number {
  const b1 = getBigrams(str1);
  const b2 = getBigrams(str2);
  if (b1.size === 0 || b2.size === 0) return 0;
  
  let intersection = 0;
  b1.forEach(bg => {
    if (b2.has(bg)) intersection++;
  });
  
  return (2 * intersection) / (b1.size + b2.size);
}

function isDateInPaddedMonth(dateStr: string, selectedMonth: string) {
  if (!selectedMonth) return true;
  try {
    const [year, month] = selectedMonth.split('-').map(Number);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    // Pads of 10 days
    const rangeStart = new Date(monthStart.getTime() - 10 * 24 * 3600 * 1000);
    const rangeEnd = new Date(monthEnd.getTime() + 10 * 24 * 3600 * 1000);
    
    let safeDate = dateStr;
    if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(safeDate)) {
        const parts = safeDate.split(/[-\/]/);
        safeDate = parts[2]+"-"+parts[1].padStart(2,"0")+"-"+parts[0].padStart(2,"0");
    }
    const checkDate = new Date(safeDate);
    return checkDate >= rangeStart && checkDate <= rangeEnd;
  } catch (e) {
    return true; 
  }
}

function checkNameMatch(sysDriverName: string, bankSenderName: string) {
  let sysClean = String(sysDriverName || '').toUpperCase().replace(/\b(BIN|BINTI|BTE|BT|B\.|B|A\/L|A\/P|MR|MRS|MS|KOP)\b/g, '');
  let bankClean = String(bankSenderName || '').toUpperCase().replace(/\b(BIN|BINTI|BTE|BT|B\.|B|A\/L|A\/P|MR|MRS|MS|KOP)\b/g, '');
  
  let sysTokens = sysClean.split(/[\s-]+/).filter(t => t.length >= 2).map(normalizeToken);
  let bankTokens = bankClean.split(/[\s-]+/).filter(t => t.length >= 2).map(normalizeToken);
  
  let commonTokens = sysTokens.filter(t => bankTokens.includes(t));
  let tokenSimilarity = 0;
  if (sysTokens.length + bankTokens.length > 0) {
      tokenSimilarity = (commonTokens.length * 2) / (sysTokens.length + bankTokens.length);
  }
  
  // Calculate Bigram similarity
  const bigramSim = checkBigramSimilarity(sysClean, bankClean);
  
  // Clean names for substring checks
  let sysNameClean = sysClean.replace(/[^A-Z0-9]/g, '');
  let bankNameClean = bankClean.replace(/[^A-Z0-9]/g, '');
  let hasInclusionMatch = false;
  let inclusionSimilarity = 0;
  
  if (sysNameClean.length >= 3 && bankNameClean.length >= 3) {
      if (sysNameClean.includes(bankNameClean) && (bankNameClean.length / sysNameClean.length) >= 0.5) {
          hasInclusionMatch = true;
          inclusionSimilarity = bankNameClean.length / sysNameClean.length;
      } else if (bankNameClean.includes(sysNameClean) && (sysNameClean.length / bankNameClean.length) >= 0.5) {
          hasInclusionMatch = true;
          inclusionSimilarity = sysNameClean.length / bankNameClean.length;
      }
  }

  const isNameMatch = tokenSimilarity >= 0.55 || bigramSim >= 0.6 || hasInclusionMatch;
  const nameSimilarity = Math.max(tokenSimilarity, bigramSim, inclusionSimilarity);
  
  return { isNameMatch, nameSimilarity };
}

function checkPlateMatch(plateNumber: string, reference?: string, reference_1?: string, reference_2?: string) {
  let sysPlate = String(plateNumber || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
  if (sysPlate.length <= 3) return false;
  
  let rawRef = String(reference || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
               String(reference_1 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
               String(reference_2 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
  return rawRef.includes(sysPlate);
}

function performMultiPassMatching(deposits: any[], allSystemPayments: any[]): { paired: any[], unpaired: any[] } {
    const paired: any[] = [];
    const unpaired: any[] = [];
    
    // Init status
    deposits.forEach(bankTx => {
        bankTx.isMatched = false;
    });
    allSystemPayments.forEach(sysPay => {
        sysPay.isMatched = false;
    });

    // Pass 1: Strict Matches (Within 1 day, same amount, and Name or Plate match)
    deposits.forEach(bankTx => {
        if (bankTx.isMatched) return;
        let bestMatchIndex = -1;
        let bestScore = -1;
        
        for (let i = 0; i < allSystemPayments.length; i++) {
             const sysPay = allSystemPayments[i];
             if (sysPay.isMatched) continue;
             
             let sysTime = new Date(getSysDateLocal(sysPay)).getTime();
             let bankTime = new Date(bankTx.trans_date).getTime();
             let daysDiff = Math.abs(sysTime - bankTime) / (24 * 3600 * 1000);
             
             if (daysDiff <= 1.05 && Math.abs(Number(sysPay.amount) - Number(bankTx.amount)) < 0.01) {
                 const { isNameMatch, nameSimilarity } = checkNameMatch(sysPay.driver_name, bankTx.sender_name);
                 const isPlateMatch = checkPlateMatch(sysPay.plate_number, bankTx.reference, bankTx.reference_1, bankTx.reference_2);
                 
                 if (isNameMatch || isPlateMatch) {
                     let score = (isNameMatch ? 100 * nameSimilarity : 0) + (isPlateMatch ? 150 : 0);
                     score += (1.05 - daysDiff) * 50; // Closer date gets bonus points
                     
                     if (score > bestScore) {
                         bestScore = score;
                         bestMatchIndex = i;
                     }
                 }
             }
        }
        
        if (bestMatchIndex > -1) {
             const bestSysPay = allSystemPayments[bestMatchIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ 
                 ...bankTx, 
                 status: 'MATCHED', 
                 matched_by: 'AUTO_PASS1_STRICT', 
                 plate_number: bestSysPay.plate_number, 
                 driver_id: bestSysPay.driver_id, 
                 matched_driver_name: bestSysPay.driver_name 
             });
        }
    });

    // Pass 2: Relaxed Matches (Within 5.05 days, same amount, and Name or Plate match)
    deposits.forEach(bankTx => {
        if (bankTx.isMatched) return;
        let bestMatchIndex = -1;
        let bestScore = -1;
        
        for (let i = 0; i < allSystemPayments.length; i++) {
             const sysPay = allSystemPayments[i];
             if (sysPay.isMatched) continue;
             
             let sysTime = new Date(getSysDateLocal(sysPay)).getTime();
             let bankTime = new Date(bankTx.trans_date).getTime();
             let daysDiff = Math.abs(sysTime - bankTime) / (24 * 3600 * 1000);
             
             if (daysDiff <= 5.05 && Math.abs(Number(sysPay.amount) - Number(bankTx.amount)) < 0.01) {
                 const { isNameMatch, nameSimilarity } = checkNameMatch(sysPay.driver_name, bankTx.sender_name);
                 const isPlateMatch = checkPlateMatch(sysPay.plate_number, bankTx.reference, bankTx.reference_1, bankTx.reference_2);
                 
                 if (isNameMatch || isPlateMatch) {
                     let score = (isNameMatch ? 100 * nameSimilarity : 0) + (isPlateMatch ? 150 : 0);
                     score += Math.max(0, (5.05 - daysDiff) * 20); // Closer date gets bonus points
                     
                     if (score > bestScore) {
                         bestScore = score;
                         bestMatchIndex = i;
                     }
                 }
             }
        }
        
        if (bestMatchIndex > -1) {
             const bestSysPay = allSystemPayments[bestMatchIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ 
                 ...bankTx, 
                 status: 'MATCHED', 
                 matched_by: 'AUTO_PASS2_RELAXED', 
                 plate_number: bestSysPay.plate_number, 
                 driver_id: bestSysPay.driver_id, 
                 matched_driver_name: bestSysPay.driver_name 
             });
        }
    });

    // Pass 3: Extended Name/Plate Matches (Within 14.05 days, same amount, Name or Plate match)
    deposits.forEach(bankTx => {
        if (bankTx.isMatched) return;
        let bestMatchIndex = -1;
        let bestScore = -1;
        
        for (let i = 0; i < allSystemPayments.length; i++) {
             const sysPay = allSystemPayments[i];
             if (sysPay.isMatched) continue;
             
             let sysTime = new Date(getSysDateLocal(sysPay)).getTime();
             let bankTime = new Date(bankTx.trans_date).getTime();
             let daysDiff = Math.abs(sysTime - bankTime) / (24 * 3600 * 1000);
             
             if (daysDiff <= 14.05 && Math.abs(Number(sysPay.amount) - Number(bankTx.amount)) < 0.01) {
                 const { isNameMatch, nameSimilarity } = checkNameMatch(sysPay.driver_name, bankTx.sender_name);
                 const isPlateMatch = checkPlateMatch(sysPay.plate_number, bankTx.reference, bankTx.reference_1, bankTx.reference_2);
                 
                 if (isNameMatch || isPlateMatch) {
                     let score = (isNameMatch ? 100 * nameSimilarity : 0) + (isPlateMatch ? 150 : 0);
                     score += Math.max(0, (14.05 - daysDiff) * 5); // Closer date gets bonus points
                     
                     if (score > bestScore) {
                         bestScore = score;
                         bestMatchIndex = i;
                     }
                 }
             }
        }
        
        if (bestMatchIndex > -1) {
             const bestSysPay = allSystemPayments[bestMatchIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ 
                 ...bankTx, 
                 status: 'MATCHED', 
                 matched_by: 'AUTO_PASS3_EXTENDED_NAME', 
                 plate_number: bestSysPay.plate_number, 
                 driver_id: bestSysPay.driver_id, 
                 matched_driver_name: bestSysPay.driver_name 
             });
        }
    });

    // Pass 4: Wide Late-Payment Name/Plate Matches (Within 32.05 days, same amount, Name or Plate match)
    deposits.forEach(bankTx => {
        if (bankTx.isMatched) return;
        let bestMatchIndex = -1;
        let bestScore = -1;
        
        for (let i = 0; i < allSystemPayments.length; i++) {
             const sysPay = allSystemPayments[i];
             if (sysPay.isMatched) continue;
             
             let sysTime = new Date(getSysDateLocal(sysPay)).getTime();
             let bankTime = new Date(bankTx.trans_date).getTime();
             let daysDiff = Math.abs(sysTime - bankTime) / (24 * 3600 * 1000);
             
             if (daysDiff <= 32.05 && Math.abs(Number(sysPay.amount) - Number(bankTx.amount)) < 0.01) {
                 const { isNameMatch, nameSimilarity } = checkNameMatch(sysPay.driver_name, bankTx.sender_name);
                 const isPlateMatch = checkPlateMatch(sysPay.plate_number, bankTx.reference, bankTx.reference_1, bankTx.reference_2);
                 
                 if (isNameMatch || isPlateMatch) {
                     let score = (isNameMatch ? 100 * nameSimilarity : 0) + (isPlateMatch ? 150 : 0);
                     score += Math.max(0, (32.05 - daysDiff) * 2); // Closer date gets bonus points
                     
                     if (score > bestScore) {
                         bestScore = score;
                         bestMatchIndex = i;
                     }
                 }
             }
        }
        
        if (bestMatchIndex > -1) {
             const bestSysPay = allSystemPayments[bestMatchIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ 
                 ...bankTx, 
                 status: 'MATCHED', 
                 matched_by: 'AUTO_PASS4_WIDE_NAME', 
                 plate_number: bestSysPay.plate_number, 
                 driver_id: bestSysPay.driver_id, 
                 matched_driver_name: bestSysPay.driver_name 
             });
        }
    });

    // Pass 5: Cash Deposit Matches - Strict (Within 5.05 days, same amount, and payment method is Cash Deposit or Cash)
    deposits.forEach(bankTx => {
        if (bankTx.isMatched) return;
        let bestMatchIndex = -1;
        let bestScore = -1;
        
        for (let i = 0; i < allSystemPayments.length; i++) {
             const sysPay = allSystemPayments[i];
             if (sysPay.isMatched) continue;
             
             let sysTime = new Date(getSysDateLocal(sysPay)).getTime();
             let bankTime = new Date(bankTx.trans_date).getTime();
             let daysDiff = Math.abs(sysTime - bankTime) / (24 * 3600 * 1000);
             
             if (daysDiff <= 5.05 && Math.abs(Number(sysPay.amount) - Number(bankTx.amount)) < 0.01) {
                 let rawSenderBase = String(bankTx.sender_name).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                 let rawRef = String(bankTx.reference || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                              String(bankTx.reference_1 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                              String(bankTx.reference_2 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                 let isCashDepositText = (rawSenderBase.includes('CASHDEPOSIT') || rawSenderBase.includes('CDM') || rawRef.includes('CASHDEPOSIT') || rawRef.includes('CDM'));
                 
                 const pMethod = String(sysPay.p_method || '').toUpperCase();
                 let isCashDepositMatch = (isCashDepositText && (pMethod === 'CASH DEPOSIT' || pMethod === 'CASH'));
                 
                 if (isCashDepositMatch) {
                     let score = 50; 
                     score += Math.max(0, (5.05 - daysDiff) * 20); // Closer date gets bonus points
                     
                     if (score > bestScore) {
                         bestScore = score;
                         bestMatchIndex = i;
                     }
                 }
             }
        }
        
        if (bestMatchIndex > -1) {
             const bestSysPay = allSystemPayments[bestMatchIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ 
                 ...bankTx, 
                 status: 'MATCHED', 
                 matched_by: 'AUTO_PASS5_CDM_STRICT', 
                 plate_number: bestSysPay.plate_number, 
                 driver_id: bestSysPay.driver_id, 
                 matched_driver_name: bestSysPay.driver_name 
             });
        }
    });

    // Pass 6: Cash Deposit Matches - Medium (Within 12.05 days, same amount, and payment method is Cash Deposit or Cash)
    deposits.forEach(bankTx => {
        if (bankTx.isMatched) return;
        let bestMatchIndex = -1;
        let bestScore = -1;
        
        for (let i = 0; i < allSystemPayments.length; i++) {
             const sysPay = allSystemPayments[i];
             if (sysPay.isMatched) continue;
             
             let sysTime = new Date(getSysDateLocal(sysPay)).getTime();
             let bankTime = new Date(bankTx.trans_date).getTime();
             let daysDiff = Math.abs(sysTime - bankTime) / (24 * 3600 * 1000);
             
             if (daysDiff <= 12.05 && Math.abs(Number(sysPay.amount) - Number(bankTx.amount)) < 0.01) {
                 let rawSenderBase = String(bankTx.sender_name).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                 let rawRef = String(bankTx.reference || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                              String(bankTx.reference_1 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                              String(bankTx.reference_2 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                 let isCashDepositText = (rawSenderBase.includes('CASHDEPOSIT') || rawSenderBase.includes('CDM') || rawRef.includes('CASHDEPOSIT') || rawRef.includes('CDM'));
                 
                 const pMethod = String(sysPay.p_method || '').toUpperCase();
                 let isCashDepositMatch = (isCashDepositText && (pMethod === 'CASH DEPOSIT' || pMethod === 'CASH'));
                 
                 if (isCashDepositMatch) {
                     let score = 50; 
                     score += Math.max(0, (12.05 - daysDiff) * 5); // Closer date gets bonus points
                     
                     if (score > bestScore) {
                         bestScore = score;
                         bestMatchIndex = i;
                     }
                 }
             }
        }
        
        if (bestMatchIndex > -1) {
             const bestSysPay = allSystemPayments[bestMatchIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ 
                 ...bankTx, 
                 status: 'MATCHED', 
                 matched_by: 'AUTO_PASS6_CDM_MEDIUM', 
                 plate_number: bestSysPay.plate_number, 
                 driver_id: bestSysPay.driver_id, 
                 matched_driver_name: bestSysPay.driver_name 
             });
        }
    });

    // Pass 7: Relaxed Cash Deposit Matches (Unique matching unmatched system payment of same amount within 12 days)
    deposits.forEach(bankTx => {
        if (bankTx.isMatched) return;
        
        let rawSenderBase = String(bankTx.sender_name).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
        let rawRef = String(bankTx.reference || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                     String(bankTx.reference_1 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                     String(bankTx.reference_2 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
        let isCashDepositText = (rawSenderBase.includes('CASHDEPOSIT') || rawSenderBase.includes('CDM') || rawRef.includes('CASHDEPOSIT') || rawRef.includes('CDM'));
        if (!isCashDepositText) return;
        
        let matchingSysPays: any[] = [];
        for (let i = 0; i < allSystemPayments.length; i++) {
             const sysPay = allSystemPayments[i];
             if (sysPay.isMatched) continue;
             
             let sysTime = new Date(getSysDateLocal(sysPay)).getTime();
             let bankTime = new Date(bankTx.trans_date).getTime();
             let daysDiff = Math.abs(sysTime - bankTime) / (24 * 3600 * 1000);
             
             if (daysDiff <= 12.05 && Math.abs(Number(sysPay.amount) - Number(bankTx.amount)) < 0.01) {
                 matchingSysPays.push({ index: i, daysDiff });
             }
        }
        
        if (matchingSysPays.length === 1) {
             const bestIndex = matchingSysPays[0].index;
             const bestSysPay = allSystemPayments[bestIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ 
                 ...bankTx, 
                 status: 'MATCHED', 
                 matched_by: 'AUTO_PASS7_CDM_RELAXED_UNIQUE', 
                 plate_number: bestSysPay.plate_number, 
                 driver_id: bestSysPay.driver_id, 
                 matched_driver_name: bestSysPay.driver_name 
             });
        } else if (matchingSysPays.length > 1) {
             matchingSysPays.sort((a, b) => a.daysDiff - b.daysDiff);
             const bestIndex = matchingSysPays[0].index;
             const bestSysPay = allSystemPayments[bestIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ 
                 ...bankTx, 
                 status: 'MATCHED', 
                 matched_by: 'AUTO_PASS7_CDM_RELAXED_CLOSEST', 
                 plate_number: bestSysPay.plate_number, 
                 driver_id: bestSysPay.driver_id, 
                 matched_driver_name: bestSysPay.driver_name 
             });
        }
    });

    // Populate unpaired list for final return
    deposits.forEach(bankTx => {
        if (!bankTx.isMatched) {
            unpaired.push({ ...bankTx, status: 'UNMATCHED', plate_number: 'UNKNOWN' });
        }
    });

    return { paired, unpaired };
}

interface BankReconciliationProps {
  drivers: Driver[]; // We pass drivers just in case we need it for mock local data
}

const BankReconciliation: React.FC<BankReconciliationProps> = ({ drivers }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'BANK_STATEMENT' | 'SYSTEM_UNSOLVED' | 'MANUAL_MATCH'>('BANK_STATEMENT');
  const [showOnlyDeposits, setShowOnlyDeposits] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [editedSenderNames, setEditedSenderNames] = useState<Record<string, string>>({});
  const [selectedBankTxOriginalIndex, setSelectedBankTxOriginalIndex] = useState<number | null>(null);
  const [selectedSysTxId, setSelectedSysTxId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(''); // YYYY-MM

  const reportRef = useRef<HTMLDivElement>(null);

  // Derive available months from local system data
  const availableMonths = React.useMemo(() => {
     const months = new Set<string>();
     drivers.forEach(d => {
         (d.paymentHistory || []).forEach(tx => {
             if (tx.date) {
                 months.add(tx.date.substring(0, 7));
             }
         });
     });
     return Array.from(months).sort().reverse();
  }, [drivers]);

  // Calculate local system transactions length for the selected month to show BEFORE checking backend
  const localSystemTransactionsCount = React.useMemo(() => {
      if (!selectedMonth) return 0;
      let count = 0;
      drivers.forEach(d => {
         (d.paymentHistory || []).forEach(tx => {
             if (tx.date && tx.date.startsWith(selectedMonth)) {
                 count++;
             }
         });
      });
      return count;
  }, [drivers, selectedMonth]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
       setFile(e.dataTransfer.files[0]);
    }
  };

    const processMockReconciliation = async () => {
    // Local mock for preview in AI Studio: Synergized with System Data
    return new Promise<ReconciliationResult>((resolve) => {
      setTimeout(() => {
        const paired: ReconcileTransaction[] = [];
        const unsolved: any[] = [];
        
        drivers.forEach(driver => {
           if (driver.isDelisted) return;
           driver.paymentHistory.forEach(tx => {
               const isCashDeposit = tx.paymentMethod === 'CASH DEPOSIT';
               
               paired.push({
                   status: 'MATCHED',
                   trans_date: tx.date,
                   amount: tx.amount,
                   sender_name: isCashDeposit ? 'CASH DEPOSIT MACH' : driver.name.toUpperCase(),
                   reference: isCashDeposit ? 'CASH DEPOSIT' : 'TRF ' + driver.carPlate,
                   plate_number: driver.carPlate,
                   driver_id: driver.id,
                   is_deposit: true,
                   amount_cr: tx.amount
               });
           });
        });

        const unpaired: ReconcileTransaction[] = [
           { status: 'UNMATCHED', trans_date: new Date().toISOString().split('T')[0], amount: 100.00, sender_name: 'UNKNOWN TRANSFER', reference: 'NO REF', plate_number: 'UNKNOWN', is_deposit: true, amount_cr: 100.00 }
        ];

        // Give them sequential indices
        const allTxs = [...paired, ...unpaired];
        allTxs.forEach((t, i) => { t.original_index = i * 2; });

        // Mock a few withdrawals
        const withdrawalsMock: ReconcileTransaction[] = [
            { status: 'WITHDRAWAL', trans_date: new Date().toISOString().split('T')[0], amount: 45.00, sender_name: 'SUPPLIER AUTO DEBIT', reference: 'TOYOTA CAPITAL', is_deposit: false, amount_dr: 45.00, original_index: 1 },
            { status: 'WITHDRAWAL', trans_date: new Date().toISOString().split('T')[0], amount: 15.00, sender_name: 'BANK CHARGE', reference: 'SERVICE CHARGE', is_deposit: false, amount_dr: 15.00, original_index: 3 }
        ];

        const combined = [...allTxs, ...withdrawalsMock];
        combined.sort((a, b) => (a.original_index ?? 0) - (b.original_index ?? 0));

        resolve({
          paired_transactions: paired,
          unpaired_transactions: unpaired,
          all_transactions: combined,
          unsolved_system_transactions: unsolved
        });
      }, 2000);
    });
  };

  const processJsonLocally = async (parsed: any): Promise<ReconciliationResult> => {
      // Process the JSON data locally and run multi-pass matching
      let transactions: any[] = [];
      if (parsed && Array.isArray(parsed.transactions)) {
          transactions = parsed.transactions;
      } else if (Array.isArray(parsed)) {
          transactions = parsed;
      }
      
      let summary: any = parsed.summary || {};

      let deposits: any[] = [];
      
      transactions.forEach((tx, idx) => {
           if (!tx) return;
           
           // Strict filtering for Amount (CR)
           const crVal = tx['Amount (CR)'] || tx['amount_cr'] || tx['credit'] || tx['deposit'] || tx['Amount(CR)'];
           let isExplicitWithdrawal = false;
           
           if (crVal === null || crVal === '' || String(crVal).trim() === '-' || String(crVal).trim().toLowerCase() === 'null') {
               isExplicitWithdrawal = true; // This is a withdrawal based on "Amount (CR)" being null/-
           }
           
           const parseNum = (val: any) => {
              if (val === undefined || val === null || val === "") return 0;
              const str = String(val).replace(/[^0-9.-]/g, "").trim();
              const num = Number(str);
              return isNaN(num) ? 0 : num;
           };
           
           let cr = parseNum(crVal);
           let dr = parseNum(tx['Amount (DR)'] || tx['amount_dr'] || tx['debit'] || tx['withdrawal'] || 0);
           let amt = parseNum(tx.Amount || tx.amount || tx.transaction_amount || tx['Transaction Amount'] || 0);
           
           if (cr > 0) { isExplicitWithdrawal = false; }
           if (dr > 0 && cr === 0) { isExplicitWithdrawal = true; }
           if (amt < 0) { isExplicitWithdrawal = true; amt = Math.abs(amt); }

           // Look for withdrawal keywords
           const refText = String(tx.reference || tx.Reference || tx['Description/Location'] || tx.branch_description || '').toUpperCase() + ' ' + 
                         String(tx.reference_1 || tx.reference_2 || '').toUpperCase() + ' ' +
                         String(tx.sender_name || tx['Transaction Description'] || '').toUpperCase();
           
           if (/\b(DR|DEBIT|WITHDRAWAL|WITHDRAW|OUT|MINUS|CHARGE|CHG|FEE|PAY_OUT|PAYMENT_OUT|OUTWARD|SPEND|SPENT|AUTO DEBIT)\b/.test(refText) && cr === 0) {
              isExplicitWithdrawal = true;
           }
           
           if (isExplicitWithdrawal) {
               return; // Skip withdrawals entirely, only process DEPOSITS
           }
           
           let depositAmt = cr > 0 ? cr : amt;
           if (depositAmt <= 0) return; // Skip 0 or negative
           
           let dateStr = String(tx['trans_date'] || tx['Date'] || tx['date'] || tx['Transaction Date'] || '').trim();
           let pgDate = '';
           const dmyMatch = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
           if (dmyMatch) {
               pgDate = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
           } else {
               pgDate = dateStr;
           }
           
           deposits.push({
               ...tx,
               is_deposit: true,
               amount: depositAmt,
               amount_cr: depositAmt,
               amount_dr: 0,
               trans_date: pgDate,
               display_date: dateStr,
               original_index: idx,
               reference: String(tx.reference || tx.Reference || tx['Description/Location'] || '').trim(),
               reference_1: String(tx.reference_1 || tx['Reference 1'] || '').trim(),
               reference_2: String(tx.reference_2 || tx['Reference 2'] || '').trim(),
               sender_name: String(tx.sender_name || tx['Beneficiary Name'] || tx['Transaction Description'] || '').trim(),
           });
      });
      
      const paired: ReconcileTransaction[] = [];
      const unpaired: ReconcileTransaction[] = [];
      const unsolved: any[] = [];
      
      const allSystemPayments: any[] = [];
      drivers.forEach(d => {
           (d.paymentHistory || []).forEach(pt => {
                if (!selectedMonth || (pt.date && isDateInPaddedMonth(pt.date, selectedMonth))) {
                    allSystemPayments.push({
                        id: pt.id || Math.random().toString(),
                        amount: pt.amount,
                        trans_date: pt.date,
                        driver_name: d.name,
                        plate_number: d.carPlate,
                        p_method: pt.paymentMethod || 'BANK TRANSFER',
                        driver_id: d.id,
                        isMatched: false
                    });
                }
           });
      });
      
      // Perform robust multi-pass matching to prioritize exact/strict matches and prevent plate misassignment
      const { paired: matchedPaired, unpaired: matchedUnpaired } = performMultiPassMatching(deposits, allSystemPayments);
      paired.push(...matchedPaired);
      unpaired.push(...matchedUnpaired);

      /* Original sequential match loop commented out for accuracy
      deposits.forEach(bankTx => {
          if (bankTx.isMatched) return;
          let bestMatchIndex = -1;
          let bestScore = -1;
          
          for (let i = 0; i < allSystemPayments.length; i++) {
               const sysPay = allSystemPayments[i];
               if (sysPay.isMatched) continue;
               
               // The restriction: Must automatically +8 hours to tally with bank statement date
               let sysDateLocal = "";
try {
    let safeDateStr = sysPay.trans_date;
    if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(safeDateStr)) {
        const parts = safeDateStr.split(/[-\/]/);
        safeDateStr = parts[2]+"-"+parts[1].padStart(2,"0")+"-"+parts[0].padStart(2,"0");
    }
    let timeVal = new Date(safeDateStr).getTime();
    if (isNaN(timeVal)) timeVal = 0;
    else timeVal += (8 * 3600 * 1000);
    const sysDateObj = new Date(timeVal);
    sysDateLocal = sysDateObj.toISOString().split("T")[0];
} catch(e) {
    sysDateLocal = sysPay.trans_date;
}
               if (Number(sysPay.amount) === Number(bankTx.amount)) {
                   bankTx._debug_sys_dates = (bankTx._debug_sys_dates || '') + sysDateLocal + ',';
               }
               
               let sysTime = new Date(sysDateLocal).getTime();
               let bankTime = new Date(bankTx.trans_date).getTime();
               let isDateMatch = Math.abs(sysTime - bankTime) <= (3 * 24 * 3600 * 1000);

               if (isDateMatch) {
                   bankTx._debug_seen_date_match = true;
                   
                   // Pass 1: Compare the transaction amount
                   if (Number(sysPay.amount) === Number(bankTx.amount)) {
                       bankTx._debug_amt_match = 'Y';
                       // Pass 2 Criteria Evaluation:
                       // Criteria 1. Amount match (We already achieved this, counts as 1 point)
                       let criteriaPassed = 1;
                       
                       // Evaluate Name Match (>= 60% similarity threshold)
                       let sysNameRaw = String(sysPay.driver_name).toUpperCase().replace(/\b(BIN|BINTI|B\.|B|A\/L|A\/P|MR|MRS|MS|KOP)\b/g, '');
                       let bankNameRaw = String(bankTx.sender_name).toUpperCase().replace(/\b(BIN|BINTI|B\.|B|A\/L|A\/P|MR|MRS|MS|KOP)\b/g, '');
                       let sysNameTokens = sysNameRaw.split(/[\s-]+/).filter(t => t.length > 2);
                       let bankNameTokens = bankNameRaw.split(/[\s-]+/).filter(t => t.length > 2);
                       
                       let commonTokens = sysNameTokens.filter(t => bankNameTokens.includes(t));
                       let nameSimilarity = 0;
                       if (sysNameTokens.length + bankNameTokens.length > 0) {
                           nameSimilarity = (commonTokens.length * 2) / (sysNameTokens.length + bankNameTokens.length);
                       }
                       bankTx._debug_name_sim = Math.max((bankTx._debug_name_sim || 0), nameSimilarity);
                       
                       let isNameMatch = nameSimilarity >= 0.6;
                       if (!isNameMatch) {
                           let sysName = String(sysPay.driver_name).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                           let rawSender = String(bankTx.sender_name).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                           if (sysName.length > 3) {
                               if (rawSender.includes(sysName) && (sysName.length / rawSender.length) >= 0.6) {
                                   isNameMatch = true;
                               } else if (sysName.includes(rawSender) && rawSender.length > 3 && (rawSender.length / sysName.length) >= 0.6) {
                                   isNameMatch = true;
                               }
                           }
                       }
                       
                       if (isNameMatch) {
                           criteriaPassed++;
                       }
                       bankTx._debug_crit = Math.max((bankTx._debug_crit || 0), criteriaPassed);
                       
                       // Evaluate Reference 1/2 Match (Plate matching)
                       let sysPlate = String(sysPay.plate_number).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                       let rawRef = String(bankTx.reference || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                                    String(bankTx.reference_1 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                                    String(bankTx.reference_2 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                       let isPlateMatch = sysPlate.length > 3 && rawRef.includes(sysPlate);
                       
                       if (isPlateMatch) {
                           criteriaPassed++;
                       }
                       
                       // For Cash Deposit, it's a straightforward separate condition
                       let rawSenderBase = String(bankTx.sender_name).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                       let isCashDepositText = (rawSenderBase.includes('CASHDEPOSIT') || rawSenderBase.includes('CDM') || rawRef.includes('CASHDEPOSIT') || rawRef.includes('CDM'));
                       let isCashDepositMatch = (isCashDepositText && sysPay.p_method === 'CASH DEPOSIT');
                       
                       // Verification: If any 2 of 3 criteria is passed (which means Pass 1 + EITHER Name OR Plate), OR if it's a valid Cash Deposit Match
                       let isPass2 = criteriaPassed >= 2 || isCashDepositMatch;
                       
                       if (isPass2) {
                           // Pick the best score if multiple system records fulfill the criteria
                           let score = (isNameMatch ? 10 * nameSimilarity : 0) + (isPlateMatch ? 15 : 0) + (isCashDepositMatch ? 20 : 0);
                           if (score > bestScore) {
                               bestScore = score;
                               bestMatchIndex = i;
                           }
                       }
                   }
               }
          }
          
          if (bestMatchIndex > -1) {
               const bestSysPay = allSystemPayments[bestMatchIndex];
               bestSysPay.isMatched = true;
               bankTx.isMatched = true;
               paired.push({ ...bankTx, status: 'MATCHED', plate_number: bestSysPay.plate_number, driver_id: bestSysPay.driver_id, matched_driver_name: bestSysPay.driver_name });
          } else {
               unpaired.push({ ...bankTx, status: 'UNMATCHED', plate_number: 'UNKNOWN' });
          }
      });
      */
      
      allSystemPayments.forEach(sysPay => {
           if (!sysPay.isMatched) {
                unsolved.push({
                     id: sysPay.id,
                     amount: sysPay.amount,
                     trans_date: sysPay.trans_date,
                     driver_name: sysPay.driver_name,
                     plate_number: sysPay.plate_number,
                     payment_method: sysPay.p_method,
                     status: 'SYSTEM_UNSOLVED'
                });
           }
      });
      
      return {
           summary: summary,
           paired_transactions: paired,
           unpaired_transactions: unpaired,
           unsolved_system_transactions: unsolved,
           all_transactions: [...paired, ...unpaired].sort((a,b) => (a.original_index||0) - (b.original_index||0))
      };
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsLoading(true);
    setErrorMsg(null);
    setResult(null);

    try {
      // Check if we're dealing with a placeholder Supabase URL from AI Studio preview
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'placeholder-project';
      if (supabaseUrl.includes('placeholder')) {
         const mockData = await processMockReconciliation();
         setResult(mockData);
         setIsLoading(false);
         return;
      }
      
      if (file.name.endsWith('.json') || file.type === 'application/json') {
          const text = await file.text();
          let parsed;
          try {
             parsed = JSON.parse(text);
          } catch (e) {
             throw new Error("Invalid JSON file uploaded.");
          }
          const localData = await processJsonLocally(parsed);
          setResult(localData);
          setIsLoading(false);
          return;
      }

      // Real edge function invocation
      const formData = new FormData();
      formData.append('file', file);

      // We use supabase.functions.invoke
      // Notice how we pass body as FormData, and specify we don't want it stringified.
      // Wait, supabase js invoke doesn't natively handle FormData perfectly sometimes.
      // So let's use a standard fetch to the edge function URL
      
      // Try using native fetch to avoid supabase JS FormData bugs
      if (file.size > 2 * 1024 * 1024) {
        throw new Error("File is too large. Please upload a file smaller than 2MB.");
      }

      const sessionResponse = await supabase.auth.getSession();
      const token = sessionResponse.data.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

      const functionUrl = `${supabaseUrl}/functions/v1/reconcile-statement`;
      
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: formData,
      });

      if (!response.ok) {
        let msg = await response.text();
        try {
           const json = JSON.parse(msg);
           if (json.error) msg = json.error;
        } catch(e) {}
        throw new Error(msg || 'Failed to trigger reconciliation');
      }

      const data = await response.json();
      
      if (data) {
        setResult(data);
      }

    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to process statement.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadPdf = () => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      // Delay resetting isPrinting to allow print dialog to capture the DOM reliably
      setTimeout(() => {
        setIsPrinting(false);
      }, 500);
    }, 500);
  };

  const handleAutoReEvaluate = (txOriginalIndex: number, newSenderName: string) => {
    if (!result || !result.unpaired_transactions || !result.unsolved_system_transactions) return;

    const bankTxIndex = result.unpaired_transactions.findIndex(t => t.original_index === txOriginalIndex);
    if (bankTxIndex === -1) return;

    const bankTx = { ...result.unpaired_transactions[bankTxIndex], sender_name: newSenderName };
    
    const unconvertedPayments = result.unsolved_system_transactions.map(sysPay => ({
         id: sysPay.id,
         amount: sysPay.amount,
         trans_date: sysPay.trans_date,
         driver_name: sysPay.driver_name,
         plate_number: sysPay.plate_number,
         p_method: sysPay.payment_method || 'BANK TRANSFER',
         driver_id: sysPay.driver_id,
         isMatched: false
    }));

    const { paired: newlyPaired } = performMultiPassMatching([bankTx], unconvertedPayments);

    if (newlyPaired.length > 0) {
        // MATCH FOUND! Auto-link and update!
        const matchedBankTx = newlyPaired[0];

        const newUnpaired = [...result.unpaired_transactions];
        newUnpaired.splice(bankTxIndex, 1);

        const newUnsolved = unconvertedPayments.filter(p => !p.isMatched).map(sysPay => ({
             id: sysPay.id,
             amount: sysPay.amount,
             trans_date: sysPay.trans_date,
             driver_name: sysPay.driver_name,
             plate_number: sysPay.plate_number,
             payment_method: sysPay.p_method,
             driver_id: sysPay.driver_id,
             status: 'SYSTEM_UNSOLVED'
        }));

        const newPaired = [...result.paired_transactions, matchedBankTx];

        const newAll = (result.all_transactions || []).map(t => {
            if (t.original_index === bankTx.original_index) {
                return matchedBankTx;
            }
            return t;
        });

        setResult({
            ...result,
            paired_transactions: newPaired,
            unpaired_transactions: newUnpaired,
            all_transactions: newAll,
            unsolved_system_transactions: newUnsolved
        });
    }
  };

  const handleManualMatch = () => {
    if (selectedBankTxOriginalIndex === null || selectedSysTxId === null || !result) return;

    const bankTxIndex = result.unpaired_transactions.findIndex(t => t.original_index === selectedBankTxOriginalIndex);
    const sysTxIndex = (result.unsolved_system_transactions || []).findIndex(t => String(t.id) === String(selectedSysTxId));

    if (bankTxIndex === -1 || sysTxIndex === -1) {
        alert("Selection invalid. Ensure you selected both a bank deposit and a system transaction.");
        return;
    }

    const sysTx = result.unsolved_system_transactions![sysTxIndex];
    const bankTx = result.unpaired_transactions[bankTxIndex];

    const updatedBankTx: ReconcileTransaction = {
        ...bankTx,
        status: 'MATCHED',
        matched_by: 'MANUAL',
        matched_driver_name: sysTx.driver_name,
        plate_number: sysTx.plate_number,
        driver_id: sysTx.driver_id || sysTx.id 
    };

    const newUnpaired = [...result.unpaired_transactions];
    newUnpaired.splice(bankTxIndex, 1);

    const newUnsolved = [...result.unsolved_system_transactions!];
    newUnsolved.splice(sysTxIndex, 1);

    const newPaired = [...result.paired_transactions, updatedBankTx];

    const newAll = (result.all_transactions || []).map(t => {
        if (t.original_index === bankTx.original_index) {
            return updatedBankTx;
        }
        return t;
    });

    setResult({
        ...result,
        paired_transactions: newPaired,
        unpaired_transactions: newUnpaired,
        all_transactions: newAll,
        unsolved_system_transactions: newUnsolved
    });

    setSelectedBankTxOriginalIndex(null);
    setSelectedSysTxId(null);
  };

  const handleReevaluateAll = () => {
    if (!result || !result.unpaired_transactions || !result.unsolved_system_transactions) return;

    // Convert unsolved payments format to include standard keys
    const unconvertedPayments = result.unsolved_system_transactions.map(sysPay => ({
         id: sysPay.id,
         amount: sysPay.amount,
         trans_date: sysPay.trans_date,
         driver_name: sysPay.driver_name,
         plate_number: sysPay.plate_number,
         p_method: sysPay.payment_method || 'BANK TRANSFER',
         driver_id: sysPay.driver_id,
         isMatched: false
    }));

    const { paired: newlyPaired, unpaired: newlyUnpaired } = performMultiPassMatching(result.unpaired_transactions, unconvertedPayments);

    if (newlyPaired.length === 0) {
        setErrorMsg("No additional automatic matches could be established.");
        return;
    }

    // Build the updated unsolved array
    const remainingUnsolvedSys = unconvertedPayments.filter(p => !p.isMatched).map(sysPay => ({
         id: sysPay.id,
         amount: sysPay.amount,
         trans_date: sysPay.trans_date,
         driver_name: sysPay.driver_name,
         plate_number: sysPay.plate_number,
         payment_method: sysPay.p_method,
         driver_id: sysPay.driver_id,
         status: 'SYSTEM_UNSOLVED'
    }));

    // Build the updated paired array
    const updatedPaired = [...result.paired_transactions, ...newlyPaired];

    setResult({
        ...result,
        paired_transactions: updatedPaired,
        unpaired_transactions: newlyUnpaired,
        unsolved_system_transactions: remainingUnsolvedSys,
        all_transactions: [...updatedPaired, ...newlyUnpaired].sort((a,b) => (a.original_index||0) - (b.original_index||0))
    });
    
    setErrorMsg(`Successfully auto-matched ${newlyPaired.length} more transactions based on Name/Amount/Date matches!`);
  };

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="mb-6 print:hidden">
        <h2 className="text-2xl font-bold text-[#111827]">Bank Reconciliation</h2>
        <p className="text-[#6b7280] text-sm mt-1">AI-powered bank statement matching with Gemini 3.0 Flash</p>
      </div>

      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm mb-6 print:hidden">
         <h3 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider">Step 1: Select Reconciliation Month</h3>
         <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 max-w-xs">
                <label className="block text-xs text-gray-500 mb-1">Target Month</label>
                <select 
                    value={selectedMonth} 
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                >
                    <option value="">-- Select a month --</option>
                    {availableMonths.map(m => (
                        <option key={m} value={m}>{m}</option>
                    ))}
                </select>
            </div>
            {selectedMonth && (
                <div className="bg-blue-50 text-blue-800 border border-blue-200 px-4 py-2.5 rounded-lg text-sm font-medium">
                    Total System Transactions for Month: <strong className="text-lg ml-1">{localSystemTransactionsCount}</strong>
                </div>
            )}
         </div>
      </div>

      {!result && !isLoading && (
        <div 
           className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center transition-colors ${selectedMonth ? 'border-blue-300 bg-blue-50/50 hover:bg-blue-50 cursor-pointer' : 'border-gray-300 bg-gray-50 opacity-60 cursor-not-allowed'}`}
           onDragOver={(e) => {
               if (selectedMonth) e.preventDefault();
           }}
           onDrop={(e) => {
               if (selectedMonth) handleDrop(e);
           }}
           onClick={() => {
               if (selectedMonth) document.getElementById('fileUpload')?.click();
           }}
        >
          <UploadCloud className={`w-12 h-12 mb-4 ${selectedMonth ? 'text-blue-500' : 'text-gray-400'}`} />
          <h3 className="text-lg font-semibold text-[#1f2937]">
              {selectedMonth ? 'Drag & Drop Bank Statement or JSON' : 'Select a month first to upload statements'}
          </h3>
          {selectedMonth && <p className="text-[#6b7280] text-sm mt-1 mb-4">or click to select PDF, Image, or JSON file</p>}
          <input 
            type="file" 
            id="fileUpload" 
            className="hidden" 
            accept=".pdf,image/*,.json" 
            onChange={handleFileChange}
            disabled={!selectedMonth}
          />
          {file && selectedMonth && (
             <div className="text-sm font-medium text-emerald-600 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-200 mt-4">
               Selected: {file.name}
             </div>
          )}
          {file && selectedMonth && (
            <button 
                onClick={(e) => { e.stopPropagation(); handleUpload(); }}
                className="mt-6 px-6 py-2.5 bg-blue-600 text-[#ffffff] font-medium rounded-lg shadow hover:bg-blue-700 transition"
            >
              Start AI Reconciliation
            </button>
          )}
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col items-center justify-center p-16 bg-[#ffffff] rounded-xl shadow-sm border border-[#e5e7eb]">
          <Loader className="w-10 h-10 text-blue-600 animate-spin mb-4" />
          <h3 className="text-lg font-semibold text-[#1f2937] tracking-tight">Gemini AI is parsing statement transactions...</h3>
          <p className="text-[#6b7280] text-sm mt-2 text-center max-w-sm">
            Extracting tabular data and matching against outstanding driver balances via Supabase Edge Functions.
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 font-medium">
          Error: {errorMsg}
          <button className="ml-4 underline text-sm" onClick={() => setErrorMsg(null)}>Try Again</button>
        </div>
      )}

      {result && !isLoading && (
        <div className="space-y-6 print:hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-center justify-between ">
              <div>
                 <h3 className="text-emerald-800 font-semibold text-sm uppercase tracking-wider mb-1">Total Auto-Paired</h3>
                 <span className="text-4xl font-bold text-emerald-600">{result.paired_transactions.length}</span>
              </div>
              <CheckCircle className="w-12 h-12 text-emerald-300" />
            </div>
            
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between ">
               <div>
                 <h3 className="text-red-800 font-semibold text-sm uppercase tracking-wider mb-1">Items Unpaired</h3>
                 <span className="text-4xl font-bold text-red-600">{result.unpaired_transactions.length}</span>
              </div>
              <AlertCircle className="w-12 h-12 text-red-300" />
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center justify-between cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => setViewMode('SYSTEM_UNSOLVED')} >
               <div>
                 <h3 className="text-amber-800 font-semibold text-sm uppercase tracking-wider mb-1">System Unsolved</h3>
                 <span className="text-4xl font-bold text-amber-600">{(result.unsolved_system_transactions || []).filter(tx => !selectedMonth || (tx.trans_date && tx.trans_date.startsWith(selectedMonth))).length}</span>
              </div>
              <AlertCircle className="w-12 h-12 text-amber-300" />
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <div className="flex gap-2">
                <button onClick={() => setViewMode('BANK_STATEMENT')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === 'BANK_STATEMENT' ? 'bg-blue-600 text-[#ffffff]' : 'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50'}`}>Bank Statement Audit</button>
                <button onClick={() => setViewMode('SYSTEM_UNSOLVED')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === 'SYSTEM_UNSOLVED' ? 'bg-amber-600 text-[#ffffff]' : 'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50'}`}>Unsolved Transactions ({(result.unsolved_system_transactions || []).filter(tx => !selectedMonth || (tx.trans_date && tx.trans_date.startsWith(selectedMonth))).length})</button>
                <button onClick={() => setViewMode('MANUAL_MATCH')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === 'MANUAL_MATCH' ? 'bg-indigo-600 text-[#ffffff]' : 'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50'}`}>Manual Link Match</button>
            </div>
            <div className="flex gap-2">
            <button 
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-[#ffffff] font-medium rounded-lg hover:bg-gray-800 transition "
            >
              <Download className="w-4 h-4" />
              Download Audited Statement PDF
            </button>
            <button
               onClick={handleReevaluateAll}
               className="ml-4 px-5 py-2.5 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 shadow-sm"
            >
               Retry Auto-Match
            </button>
            <button onClick={() => {setResult(null); setFile(null);}} className="ml-4 px-5 py-2.5 bg-gray-200 text-[#1f2937] font-medium rounded-lg hover:bg-gray-300">
               Start Over
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-right w-full">Note: PDF download may block in AI Studio preview. Please open the app in a new tab to download.</p>
        </div>

        {(() => {
            const totalSystemInputs = localSystemTransactionsCount;
            const isDep = (t: any) => t.is_deposit !== undefined ? t.is_deposit : t.status !== 'WITHDRAWAL';
            const totalJsonDeposits = (result.paired_transactions?.filter(isDep).length || 0) + (result.unpaired_transactions?.filter(isDep).length || 0);
            return (
              <div className="bg-[#f0f9ff] border border-[#bae6fd] rounded-xl p-4 flex justify-between items-center text-sm font-medium text-[#075985] mt-4 print:hidden">
                <div>
                  <span className="opacity-80 uppercase tracking-wider text-[10px] block mb-1">Data Comparison</span>
                  Total Bank Deposits (JSON): <strong className="text-lg">{totalJsonDeposits}</strong>
                </div>
                <div className="text-right">
                  <span className="opacity-80 uppercase tracking-wider text-[10px] block mb-1">&nbsp;</span>
                  Total System Transactions: <strong className="text-lg">{totalSystemInputs}</strong>
                </div>
              </div>
            );
        })()}

        {viewMode === 'BANK_STATEMENT' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200 print:hidden">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Statements Filter:</span>
            <div className="flex gap-1.5">
              <button 
                onClick={() => setShowOnlyDeposits(true)} 
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${showOnlyDeposits ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}
              >
                Deposits Only (Audit Mode)
              </button>
              <button 
                onClick={() => setShowOnlyDeposits(false)} 
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${!showOnlyDeposits ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}
              >
                All Transactions (Deposits + Withdrawals)
              </button>
            </div>
            <span className="text-[11px] text-gray-400 italic sm:ml-auto mr-1">
              * Note: Withdrawals are always automatically re-included in their original positions when downloading the PDF.
            </span>
          </div>
        )}

          <p className="text-sm text-[#6b7280] print:hidden">
            A corporate audited document will be generated locally. Below is a preview of the report.
          </p>
        </div>
      )}

      {/* Hidden Div for PDF Generation Layout */}
      <div ref={reportRef} className="mt-8 border border-[#e5e7eb] overflow-x-auto rounded-lg bg-[#ffffff] print:mt-0 print:border-none print:shadow-none print:overflow-visible">
         {result && (() => {
             const rawAllTxs = result.all_transactions || [...result.paired_transactions, ...result.unpaired_transactions];
             
             const processedTxs = rawAllTxs.map((tx, idx) => {
                  if (!tx) return null;
                  
                  let is_deposit = tx.is_deposit;
                  if (is_deposit === undefined) {
                      if (tx.status === 'WITHDRAWAL') {
                          is_deposit = false;
                      } else {
                          is_deposit = true;
                      }
                  }
                  
                  const original_index = tx.original_index !== undefined ? tx.original_index : idx;
                  const trans_date = tx.trans_date || tx.date || '';
                  const display_date = tx.display_date || tx.trans_date || '';
                  
                  let sender_name = '';
                  if (editedSenderNames[original_index] !== undefined) {
                      sender_name = String(editedSenderNames[original_index]).trim().toUpperCase();
                  } else {
                      const getSenderValFromObj = (obj: any): string => {
                          if (!obj || typeof obj !== 'object') return '';

                          const isValidStr = (v: any): boolean => {
                              if (v === undefined || v === null) return false;
                              const s = String(v).trim();
                              if (s === '' || s === '-' || s === '/' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'none') {
                                  return false;
                              }
                              return true;
                          };

                          // 1. Prioritize explicit sender keys
                          if (isValidStr(obj.sender_name)) return String(obj.sender_name).trim();
                          if (isValidStr(obj.senderName)) return String(obj.senderName).trim();
                          if (isValidStr(obj.sender)) return String(obj.sender).trim();

                          // 2. Scan properties for sender/remitter/payer keywords
                          const keys = Object.keys(obj);
                          const specificPatterns = [
                              /sender/i,
                              /beneficiary/i,
                              /customer/i,
                              /payer/i,
                              /remitter/i,
                              /payee/i,
                              /recipient/i,
                              /party/i,
                              /from/i,
                              /applicant/i,
                              /client/i,
                              /depositor/i,
                              /originator/i,
                              /name/i
                          ];

                          for (const pattern of specificPatterns) {
                              const matchedKeys = keys.filter(k => 
                                  pattern.test(k) && 
                                  !/date/i.test(k) && 
                                  !/amount/i.test(k) && 
                                  !/credit/i.test(k) && 
                                  !/debit/i.test(k) && 
                                  !/balance/i.test(k) && 
                                  !/reference/i.test(k) && 
                                  !/index/i.test(k) && 
                                  !/status/i.test(k) && 
                                  !/plate/i.test(k) &&
                                  !/driver/i.test(k) &&
                                  !/match/i.test(k)
                              );

                              for (const matchedKey of matchedKeys) {
                                  const val = obj[matchedKey];
                                  if (val !== undefined && val !== null) {
                                      if (typeof val === 'object') {
                                          const innerKeys = Object.keys(val);
                                          const nameKey = innerKeys.find(ik => /name/i.test(ik) && isValidStr(val[ik]));
                                          if (nameKey) {
                                              return String(val[nameKey]).trim();
                                          }
                                          const secondaryKey = innerKeys.find(ik => isValidStr(val[ik]));
                                          if (secondaryKey) {
                                              return String(val[secondaryKey]).trim();
                                          }
                                      } else if (isValidStr(val)) {
                                          return String(val).trim();
                                      }
                                  }
                              }
                          }

                          // 3. Last fallback: any string key not in common blocklist
                          const blocklistKeys = [
                              'trans_date', 'display_date', 'date', 'amount', 'amount_cr', 'amount_dr', 
                              'balance', 'reference', 'reference_1', 'reference_2', 'ref_num', 'status', 
                              'original_index', 'plate_number', 'matched_by', 'driver_id', 'is_deposit',
                              'matched_driver_name', 'branch_description', 'runningBalance'
                          ];
                          for (const key of keys) {
                              if (!blocklistKeys.includes(key) && isValidStr(obj[key]) && typeof obj[key] === 'string') {
                                  return String(obj[key]).trim();
                              }
                          }

                          return '';
                      };

                      let trimmedSender = getSenderValFromObj(tx);
                      const lowerSender = trimmedSender.toLowerCase();
                      if (!trimmedSender || trimmedSender === '-' || lowerSender === 'null' || lowerSender === 'undefined' || lowerSender === 'none') {
                          if (tx.matched_driver_name) {
                              sender_name = tx.matched_driver_name.toUpperCase();
                          } else {
                              sender_name = '-';
                          }
                      } else {
                          sender_name = trimmedSender;
                      }
                  }

                  const branch_description = tx.branch_description || tx.branchDescription || '-';
                  const reference_1 = tx.reference_1 || tx.reference1 || tx.reference || '-';
                  const reference_2 = tx.reference_2 || tx.reference2 || '-';
                  const ref_num = tx.ref_num || tx.refNum || '-';
                  
                  const amount = Number(String(tx.amount || 0).replace(/[^0-9.-]/g, ''));
                  const amount_cr = tx.amount_cr !== undefined && tx.amount_cr !== null
                      ? Number(String(tx.amount_cr).replace(/[^0-9.-]/g, ''))
                      : (is_deposit ? amount : null);
                  const amount_dr = tx.amount_dr !== undefined && tx.amount_dr !== null
                      ? Number(String(tx.amount_dr).replace(/[^0-9.-]/g, ''))
                      : (!is_deposit ? amount : null);
                      
                  return {
                      ...tx,
                      is_deposit,
                      trans_date,
                      display_date,
                      sender_name,
                      branch_description,
                      reference_1,
                      reference_2,
                      ref_num,
                      amount_cr,
                      amount_dr,
                      amount,
                      original_index
                  };
              }).filter((t) => t !== null && (t.is_deposit ? (t.amount_cr || t.amount || 0) > 0 : (t.amount_dr || t.amount || 0) > 0));

              const parseDateForSort = (dateStr) => {
                  if (!dateStr) return 0;
                  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
                      return new Date(dateStr).getTime();
                  }
                  const dmyMatch = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
                  if (dmyMatch) {
                      return new Date(`${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`).getTime();
                  }
                  const t = Date.parse(dateStr);
                  return isNaN(t) ? 0 : t;
              };

              processedTxs.sort((a, b) => {
                  return (a.original_index ?? 0) - (b.original_index ?? 0);
              });

             const totalDepositsAmountCalculated = processedTxs
                 .filter(tx => tx.is_deposit)
                 .reduce((sum, tx) => sum + (tx.amount_cr || tx.amount || 0), 0);
                 
             const totalWithdrawalsAmountCalculated = processedTxs
                 .filter(tx => !tx.is_deposit)
                 .reduce((sum, tx) => sum + (tx.amount_dr || tx.amount || 0), 0);
                 
             const countDepositsCalculated = processedTxs.filter(tx => tx.is_deposit).length;
             const countWithdrawalsCalculated = processedTxs.filter(tx => !tx.is_deposit).length;

             let beginningBalance = 0;
              let totalDepositsAmount = totalDepositsAmountCalculated;
              let countDeposits = countDepositsCalculated;
              let totalWithdrawalsAmount = totalWithdrawalsAmountCalculated;
              let countWithdrawals = countWithdrawalsCalculated;
              let endingBalance = beginningBalance + totalDepositsAmount - totalWithdrawalsAmount;

              let currentBalance = beginningBalance;
             const txsWithBalance = processedTxs.map(tx => {
                if (tx.is_deposit) {
                    currentBalance += (tx.amount_cr || tx.amount || 0);
                } else {
                    currentBalance -= (tx.amount_dr || tx.amount || 0);
                }
                return { ...tx, runningBalance: currentBalance };
             });

             const filteredDisplayTxs = txsWithBalance.filter(tx => {
                 const isDep = tx.is_deposit !== undefined ? tx.is_deposit : tx.status !== 'WITHDRAWAL';
                 if (isPrinting) return isDep;
                 if (showOnlyDeposits) return isDep;
                 return true;
             });

             return (
             <div className="p-4 bg-[#ffffff] font-sans mx-auto " style={{ width: '100%', minWidth: '900px', fontSize: '11px', color: '#333' }}>
                {/* Corporate Header */}
                <div className="flex justify-between items-start mb-2">
                  <div className="bg-[#3861d8] text-[#ffffff] px-4 py-2 font-bold text-lg inline-block w-2/3 max-w-[600px]">
                    Cash Management
                  </div>
                  <div className="text-right">
                    <h1 className="text-xl font-bold text-[#3861d8]">Reconciliation</h1>
                    <p className="text-[#6b7280] font-medium text-sm mt-1">Audit Report</p>
                  </div>
                </div>

                <div className="font-bold text-sm mb-4 text-[#1f2937]">
                  System Generated Report
                </div>

                
                {viewMode === 'BANK_STATEMENT' && (
                  <>
                {/* Summary Table */}
                <div className="border border-[#e5e7eb] mb-6 rounded-sm overflow-hidden bg-[#fbfbfb]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                       <tr className="bg-[#f0f0f0] text-[#4b5563] font-bold text-[11px]">
                         <th className="p-2 border-b border-[#e5e7eb]">Account Summary</th>
                         <th className="p-2 border-b border-[#e5e7eb] text-right w-1/4">Amount (RM)</th>
                       </tr>
                    </thead>
                    <tbody className="text-[11px]">
                       <tr>
                         <td className="p-2 font-bold border-b border-[#f3f4f6]">Beginning Balance</td>
                         <td className="p-2 text-right border-b border-[#f3f4f6] text-[#1f2937]">{beginningBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}+</td>
                       </tr>
                       <tr>
                         <td className="p-2 border-b border-[#f3f4f6]">Total Deposits ({countDeposits} Items matched or flagged)</td>
                         <td className="p-2 text-right border-b border-[#f3f4f6] text-emerald-600 font-medium">+{totalDepositsAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                       </tr>
                       <tr>
                         <td className="p-2 border-b border-[#f3f4f6]">Total Withdrawals ({countWithdrawals} Items)</td>
                         <td className="p-2 text-right border-b border-[#f3f4f6] text-red-650 font-medium">-{totalWithdrawalsAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                       </tr>
                       <tr className="bg-[#fafafa]">
                         <td className="p-2 font-bold text-[#111827] border-t border-[#e5e7eb]">Ending Balance (Audited)</td>
                         <td className="p-2 text-right font-bold text-[#111827] border-t border-[#e5e7eb]">{endingBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                       </tr>
                    </tbody>
                  </table>
                </div>

                {/* Transactions Table */}
                <table className="w-full text-left border-collapse border border-[#9bdcf6] mt-4">
                  <thead>
                    <tr className="bg-[#9bdcf6] text-[#3e78a8] font-bold text-[10px]">
                       <th className="p-2 border-r border-[#ffffff]/50 w-[80px]">Date</th>
                       <th className="p-2 border-r border-[#ffffff]/50 w-[150px]">Sender's Name</th>
                       <th className="p-2 border-r border-[#ffffff]/50 w-[150px]">Reference 1</th>
                       <th className="p-2 border-r border-[#ffffff]/50 w-[120px]">Reference 2</th>
                       <th className="p-2 border-r border-[#ffffff]/50 text-right w-[80px]">Amount (DR)</th>
                       <th className="p-2 border-r border-[#ffffff]/50 text-right w-[80px]">Amount (CR)</th>
                       {!isPrinting && <th className="p-2 border-r border-[#ffffff]/50 text-right w-[90px]">Balance</th>}
                       <th className="p-2 text-center w-[110px]">Audit Status</th>
                     </tr>
                  </thead>
                  <tbody className="text-[10px] text-[#1f2937] align-top bg-[#ffffff]">
                     {filteredDisplayTxs.map((tx, idx) => (
                        <tr key={idx} className={`border-b border-[#f0f0f0] ${tx.status === 'UNMATCHED' ? 'bg-[#fff5f5]' : tx.status === 'WITHDRAWAL' ? 'bg-[#fbfbfb]' : ''}`}>
                          <td className="p-2 whitespace-nowrap">{tx.display_date || tx.trans_date}</td>
                                                     <td className="p-2 uppercase leading-tight font-medium">
                             {tx.status === 'UNMATCHED' && !isPrinting ? (
                               <input
                                 type="text"
                                 placeholder="Insert sender's name"
                                 value={tx.sender_name === '-' ? '' : tx.sender_name}
                                 onChange={(e) => {
                                   const newName = e.target.value;
                                   const txKey = tx.original_index !== undefined ? tx.original_index : idx;
                                   setEditedSenderNames(prev => ({
                                     ...prev,
                                     [txKey]: newName
                                   }));
                                   
                                   if (result) {
                                     const updatedAll = (result.all_transactions || []).map((t, i) => {
                                       const currentKey = t.original_index !== undefined ? t.original_index : i;
                                       if (currentKey === txKey) {
                                         return { ...t, sender_name: newName };
                                       }
                                       return t;
                                     });
                                     const updatedUnpaired = (result.unpaired_transactions || []).map((t, i) => {
                                       const currentKey = t.original_index !== undefined ? t.original_index : i;
                                       if (currentKey === txKey) {
                                         return { ...t, sender_name: newName };
                                       }
                                       return t;
                                     });
                                     setResult({
                                       ...result,
                                       all_transactions: updatedAll,
                                       unpaired_transactions: updatedUnpaired
                                     });
                                   }
                                 }}
                                 onBlur={(e) => {
                                    const newName = e.target.value;
                                    const txKey = tx.original_index !== undefined ? tx.original_index : idx;
                                    if (newName && newName.length > 2) {
                                       handleAutoReEvaluate(txKey, newName);
                                    }
                                 }}
                                 className="bg-red-50/50 border border-red-200 rounded px-1.5 py-0.5 text-[9px] w-full text-red-950 focus:outline-none focus:ring-1 focus:ring-red-400 placeholder:normal-case placeholder:text-red-400 uppercase font-medium"
                               />
                             ) : (
                               tx.sender_name
                             )}
                           </td>
                           <td className="p-2 text-[#4b5563] leading-tight break-words">{tx.reference_1 || '-'}</td>
                          <td className="p-2 text-[#4b5563] leading-tight break-words">{tx.reference_2 || '-'}</td>
                          <td className="p-2 font-bold text-right text-red-600 tabular-nums">
                              {tx.is_deposit === false ? (tx.amount_dr || tx.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}
                          </td>
                          <td className="p-2 font-bold text-right text-emerald-600 tabular-nums">
                              {tx.is_deposit === true ? (tx.amount_cr || tx.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}
                          </td>
                          {!isPrinting && (
                            <td className="p-2 text-right tabular-nums font-semibold">
                              {tx.runningBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}+
                            </td>
                          )}
                          <td className="p-2 text-center align-middle" style={{ height: '40px' }}>
                              {tx.status === 'WITHDRAWAL' ? (
                                  <span className="inline-block border-2 border-gray-400 text-gray-500 px-1.5 py-0.5 rounded font-bold text-[8px] uppercase tracking-wider rotate-[1deg] bg-gray-50 shadow-sm whitespace-nowrap">WITHDRAWAL</span>
                              ) : tx.status === 'UNMATCHED' ? (
                                  <span className="inline-block border-2 border-red-500 text-red-600 px-1.5 py-0.5 rounded font-bold text-[8px] uppercase tracking-wider rotate-[-2deg] bg-red-50/50 shadow-sm whitespace-nowrap">UNMATCHED</span>
                              ) : (
                                  <span className="inline-block border-2 border-emerald-600 text-emerald-600 px-1.5 py-0.5 rounded font-bold text-[8px] uppercase tracking-wider rotate-[-2deg] bg-emerald-50/50 shadow-sm whitespace-nowrap">{tx.plate_number || 'MATCHED'}</span>
                              )}
                          </td>
                        </tr>
                     ))}
                  </tbody>
                </table>
                  </>
                )}

                {viewMode === 'SYSTEM_UNSOLVED' && (
                  <div className="mt-4">
                      <h3 className="font-bold text-[#1f2937] text-sm mb-4">Unsolved System Transactions</h3>
                      <p className="text-[#6b7280] text-xs mb-4">These are internal recorded payments that could not be matched with any transaction in the loaded Bank Statement. Flagged for potential audit or fake receipt claims.</p>
                      <table className="w-full text-left border-collapse border border-[#f3f4f6]">
                        <thead>
                           <tr className="bg-[#fffbeb] text-[#92400e] font-bold text-[10px]">
                             <th className="p-2 border-r border-[#ffffff]/50 w-[70px]">Date</th>
                             <th className="p-2 border-r border-[#ffffff]/50 w-[120px]">Driver Profile</th>
                             <th className="p-2 border-r border-[#ffffff]/50 w-[100px]">Car Plate</th>
                             <th className="p-2 border-r border-[#ffffff]/50 text-right w-[70px]">Recorded Amount</th>
                             <th className="p-2 text-center w-[80px]">Status</th>
                           </tr>
                        </thead>
                        <tbody className="text-[10px] text-[#1f2937] align-top bg-[#ffffff]">
                           {(() => {
                              const filteredSys = (result.unsolved_system_transactions || []).filter(tx => !selectedMonth || (tx.trans_date && tx.trans_date.startsWith(selectedMonth)));
                              return filteredSys.length === 0 ? (
                                <tr><td colSpan={5} className="p-6 text-center text-[#6b7280] italic text-xs">No unsolved transactions found for current month.</td></tr>
                              ) : filteredSys.map((tx, idx) => (
                              <tr key={idx} className="border-b border-[#f0f0f0] bg-[#fffbeb]/30">
                                <td className="p-2">{tx.trans_date}</td>
                                <td className="p-2 uppercase leading-tight font-bold">{tx.driver_name || '-'}</td>
                                <td className="p-2 font-mono text-[#4b5563]">{tx.plate_number || '-'}</td>
                                <td className="p-2 font-bold text-right tabular-nums text-[#92400e]">{Number(tx.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                <td className="p-2 text-center relative">
                                   <div className="border-2 border-[#b45309] px-2 py-0.5 rounded-sm font-bold text-[#b45309] text-[10px] inline-flex items-center justify-center bg-[#ffffff] shadow-sm uppercase tracking-widest bg-white/80 backdrop-blur-sm">
                                      FLAGGED
                                   </div>
                                </td>
                              </tr>
                           ));
                           })()}
                        </tbody>
                      </table>
                  </div>
                )}

                {viewMode === 'MANUAL_MATCH' && (
                  <div className="mt-4">
                      <h3 className="font-bold text-indigo-900 text-sm mb-2">Manual Link Match</h3>
                      <p className="text-gray-600 text-xs mb-4">
                        Select one unmatched transaction from the Bank Statement on the left, and one unsolved recorded payment from the System Data on the right, then click "Force Match". The transaction will then be paired and displayed inside the Audit.
                      </p>
                      
                      <div className="flex justify-end mb-4">
                        <button 
                            onClick={handleManualMatch}
                            disabled={selectedBankTxOriginalIndex === null || selectedSysTxId === null}
                            className={`px-4 py-2 text-xs font-bold rounded-lg shadow-sm transition-all ${
                                selectedBankTxOriginalIndex !== null && selectedSysTxId !== null 
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            }`}
                        >
                            Force Match Selected
                        </button>
                      </div>

                      <div className="flex flex-col md:flex-row gap-4">
                          <div className="flex-1 bg-white border border-red-200 rounded-lg overflow-hidden">
                              <div className="bg-red-50 text-red-900 font-bold p-3 text-xs border-b border-red-200 sticky top-0 shadow-sm z-10">Unmatched Bank Statement Deposits</div>
                              <div className="max-h-[500px] overflow-y-auto p-2 bg-gray-50">
                                  {result.unpaired_transactions.filter(t => t.is_deposit !== undefined ? t.is_deposit : t.status !== 'WITHDRAWAL').length === 0 ? (
                                      <div className="text-gray-500 text-xs text-center p-4 italic">No unmatched deposits</div>
                                  ) : result.unpaired_transactions.filter(t => t.is_deposit !== undefined ? t.is_deposit : t.status !== 'WITHDRAWAL').map((tx, idx) => (
                                      <div 
                                        key={tx.original_index ?? `unpaired-${idx}`} 
                                        onClick={() => setSelectedBankTxOriginalIndex(tx.original_index!)}
                                        className={`p-3 mb-2 rounded border cursor-pointer transition-colors ${
                                            selectedBankTxOriginalIndex === tx.original_index 
                                            ? 'bg-blue-50 border-blue-400 shadow-sm ring-2 ring-blue-500' 
                                            : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm'
                                        }`}
                                      >
                                          <div className="flex justify-between items-start mb-1">
                                              <span className="font-bold text-gray-900 text-xs tracking-tight">{tx.trans_date}</span>
                                              <span className="font-bold text-emerald-600 text-xs bg-emerald-50 px-1 rounded">{(tx.amount_cr || tx.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                          </div>
                                          <div className="text-[10px] text-gray-800 font-bold uppercase truncate">{tx.sender_name || 'UNKNOWN SENDER'}</div>
                                          <div className="text-[9px] text-gray-500 mt-0.5 truncate">{tx.reference_1 || tx.reference || '-'}</div>
                                      </div>
                                  ))}
                              </div>
                          </div>

                          <div className="flex-1 bg-white border border-amber-200 rounded-lg overflow-hidden">
                              <div className="bg-amber-50 text-amber-900 font-bold p-3 text-xs border-b border-amber-200 sticky top-0 shadow-sm z-10">Unsolved System Payments</div>
                              <div className="max-h-[500px] overflow-y-auto p-2 bg-gray-50">
                                  {(() => {
                                      const filteredUnsolved = (result.unsolved_system_transactions || []).filter(tx => !selectedMonth || (tx.trans_date && tx.trans_date.startsWith(selectedMonth)));
                                      return filteredUnsolved.length === 0 ? (
                                          <div className="text-gray-500 text-xs text-center p-4 italic">No unsolved system payments for current month</div>
                                      ) : filteredUnsolved.map(tx => (
                                          <div 
                                            key={tx.id} 
                                            onClick={() => setSelectedSysTxId(tx.id)}
                                            className={`p-3 mb-2 rounded border cursor-pointer transition-colors ${
                                                selectedSysTxId === tx.id 
                                                ? 'bg-blue-50 border-blue-400 shadow-sm ring-2 ring-blue-500' 
                                                : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm'
                                            }`}
                                          >
                                              <div className="flex justify-between items-start mb-1">
                                                  <span className="font-bold text-gray-900 text-xs tracking-tight">{tx.trans_date}</span>
                                                  <span className="font-bold text-amber-600 text-xs bg-amber-50 px-1 rounded">{Number(tx.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                              </div>
                                              <div className="text-[10px] text-gray-800 font-bold uppercase truncate">{tx.driver_name || '-'}</div>
                                              <div className="text-[9px] text-gray-500 font-mono mt-0.5 font-bold">Plate: {tx.plate_number || '-'}</div>
                                          </div>
                                      ));
                                  })()}
                              </div>
                          </div>
                      </div>
                  </div>
                )}

                <div className="mt-6 text-[9px] text-[#999] font-medium border-t border-[#eee] pt-2">
                   Internal Audit Copy — Generated via ECA Core Engine <span className="float-right">Page 1 of 1</span>
                </div>
             </div>
             );
          })()}
      </div>
    </div>
  );
};

export default BankReconciliation;
