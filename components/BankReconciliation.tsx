import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle, AlertCircle, Download, FileText, Loader } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { supabase } from '../supabaseClient';
import { Driver } from '../types';

interface ReconcileTransaction {
  status: 'MATCHED' | 'UNMATCHED';
  trans_date: string;
  amount: number;
  sender_name: string;
  reference: string;
  plate_number?: string; matched_by?: string; matched_driver_name?: string;
  driver_id?: string;
}

interface ReconciliationResult {
  paired_transactions: ReconcileTransaction[];
  unpaired_transactions: ReconcileTransaction[];
  unsolved_system_transactions?: any[];
}

interface BankReconciliationProps {
  drivers: Driver[]; // We pass drivers just in case we need it for mock local data
}

const BankReconciliation: React.FC<BankReconciliationProps> = ({ drivers }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'BANK_STATEMENT' | 'SYSTEM_UNSOLVED'>('BANK_STATEMENT');
  
  const reportRef = useRef<HTMLDivElement>(null);

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
                   driver_id: driver.id
               });
           });
        });

        const unpaired: ReconcileTransaction[] = [
           { status: 'UNMATCHED', trans_date: new Date().toISOString().split('T')[0], amount: 100.00, sender_name: 'UNKNOWN TRANSFER', reference: 'NO REF', plate_number: 'UNKNOWN' }
        ];

        resolve({
          paired_transactions: paired,
          unpaired_transactions: unpaired,
          unsolved_system_transactions: unsolved
        });
      }, 2000);
    });
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
    if (!reportRef.current) return;
    const element = reportRef.current;
    
    // Briefly remove the 'hidden' class to render then print
    
      const opt = {
      margin:       0.5,
      filename:     `Bank-Reconciliation-${new Date().toISOString().split('T')[0]}.pdf`,
      image:        { type: 'jpeg' as const, quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(element).save();
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[#111827]">Bank Reconciliation</h2>
        <p className="text-[#6b7280] text-sm mt-1">AI-powered bank statement matching with Gemini 3.0 Flash</p>
      </div>

      {!result && !isLoading && (
        <div 
           className="border-2 border-dashed border-gray-300 rounded-xl p-10 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
           onDragOver={(e) => e.preventDefault()}
           onDrop={handleDrop}
           onClick={() => document.getElementById('fileUpload')?.click()}
        >
          <UploadCloud className="w-12 h-12 text-blue-500 mb-4" />
          <h3 className="text-lg font-semibold text-[#1f2937]">Drag & Drop Bank Statement or JSON</h3>
          <p className="text-[#6b7280] text-sm mt-1 mb-4">or click to select PDF, Image, or JSON file</p>
          <input 
            type="file" 
            id="fileUpload" 
            className="hidden" 
            accept=".pdf,image/*,.json" 
            onChange={handleFileChange}
          />
          {file && (
             <div className="text-sm font-medium text-emerald-600 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-200">
               Selected: {file.name}
             </div>
          )}
          {file && (
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
        <div className="space-y-6">
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
                 <span className="text-4xl font-bold text-amber-600">{result.unsolved_system_transactions?.length || 0}</span>
              </div>
              <AlertCircle className="w-12 h-12 text-amber-300" />
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <div className="flex gap-2">
                <button onClick={() => setViewMode('BANK_STATEMENT')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === 'BANK_STATEMENT' ? 'bg-blue-600 text-[#ffffff]' : 'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50'}`}>Bank Statement Audit</button>
                <button onClick={() => setViewMode('SYSTEM_UNSOLVED')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === 'SYSTEM_UNSOLVED' ? 'bg-amber-600 text-[#ffffff]' : 'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50'}`}>Unsolved Transactions ({result.unsolved_system_transactions?.length || 0})</button>
            </div>
            <div className="flex gap-2">
            <button 
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-[#ffffff] font-medium rounded-lg hover:bg-gray-800 transition "
            >
              <Download className="w-4 h-4" />
              Download Audited Statement PDF
            </button>
            <button onClick={() => {setResult(null); setFile(null);}} className="ml-4 px-5 py-2.5 bg-gray-200 text-[#1f2937] font-medium rounded-lg hover:bg-gray-300">
               Start Over
            </button>
          </div>
        </div>

          <p className="text-sm text-[#6b7280]">
            A corporate audited document will be generated locally. Below is a preview of the report.
          </p>
        </div>
      )}

      {/* Hidden Div for PDF Generation Layout */}
      <div ref={reportRef} className="mt-8 border border-[#e5e7eb] overflow-x-auto rounded-lg  bg-[#ffffff]">
         {result && (() => {
            const allTxs = [...result.paired_transactions, ...result.unpaired_transactions].sort((a,b) => new Date(a.trans_date).getTime() - new Date(b.trans_date).getTime());
            let currentBalance = 0;
            const txsWithBalance = allTxs.map(tx => {
               currentBalance += tx.amount;
               return { ...tx, runningBalance: currentBalance };
            });
            const totalDeposits = allTxs.reduce((sum, tx: any) => sum + (tx.amount_cr ? Number(tx.amount_cr) : (tx.amount_dr ? 0 : Number(tx.amount))), 0);
            const totalWithdrawals = allTxs.reduce((sum, tx: any) => sum + (tx.amount_dr ? Number(tx.amount_dr) : 0), 0);
            const depositsCount = allTxs.filter((tx: any) => tx.amount_cr || (!tx.amount_dr && tx.amount)).length;
            const withdrawalsCount = allTxs.filter((tx: any) => tx.amount_dr).length;
            const itemsCount = allTxs.length;

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
                        <th className="p-2 border-b border-[#e5e7eb]">Deposit Account Summary</th>
                        <th className="p-2 border-b border-[#e5e7eb] text-right w-1/4">Amount (RM)</th>
                      </tr>
                   </thead>
                   <tbody className="text-[11px]">
                      <tr>
                        <td className="p-2 font-bold border-b border-[#f3f4f6]">Beginning Balance</td>
                        <td className="p-2 text-right border-b border-[#f3f4f6] text-[#1f2937]">0.00</td>
                      </tr>
                      <tr>
                        <td className="p-2 border-b border-[#f3f4f6]">Total Deposits ({depositsCount} Items matched or flagged)</td>
                        <td className="p-2 text-right border-b border-[#f3f4f6] text-[#1f2937]">{(totalDeposits).toLocaleString(undefined, {minimumFractionDigits: 2})}+</td>
                      </tr>
                      <tr>
                        <td className="p-2 border-b border-[#f3f4f6]">Total Withdrawals ({withdrawalsCount} Items)</td>
                        <td className="p-2 text-right border-b border-[#f3f4f6] text-[#1f2937]">{(totalWithdrawals).toLocaleString(undefined, {minimumFractionDigits: 2})}-</td>
                      </tr>
                      <tr className="bg-[#fafafa]">
                        <td className="p-2 font-bold text-[#111827] border-t border-[#e5e7eb]">Ending Balance</td>
                        <td className="p-2 text-right font-bold text-[#111827] border-t border-[#e5e7eb]">{(totalDeposits - totalWithdrawals).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                      </tr>
                   </tbody>
                 </table>
               </div>

               {/* Transactions Table */}
               <table className="w-full text-left border-collapse border border-[#9bdcf6] mt-4">
                 <thead>
                    <tr className="bg-[#9bdcf6] text-[#3e78a8] font-bold text-[10px]">
                      <th className="p-2 border-r border-[#ffffff]/50 w-[70px]">Date</th>
                      <th className="p-2 border-r border-[#ffffff]/50 w-[110px]">Branch Description</th>
                      <th className="p-2 border-r border-[#ffffff]/50 w-[120px]">Sender's<br/>/ Beneficiary's<br/>Name</th>
                      <th className="p-2 border-r border-[#ffffff]/50 w-[120px]">Reference 1 /<br/>Recipient's<br/>Reference</th>
                      <th className="p-2 border-r border-[#ffffff]/50 w-[100px]">Reference 2 /<br/>Other Payment<br/>Details</th>
                      <th className="p-2 border-r border-[#ffffff]/50 w-[70px]">RefNum</th>
                      <th className="p-2 border-r border-[#ffffff]/50 text-right w-[70px]">Amount (DR)</th>
                      <th className="p-2 border-r border-[#ffffff]/50 text-right w-[70px]">Amount (CR)</th>
                      <th className="p-2 text-right w-[80px]">Balance</th>
                    </tr>
                 </thead>
                 <tbody className="text-[10px] text-[#1f2937] align-top bg-[#ffffff]">
                    {txsWithBalance.map((tx, idx) => (
                       <tr key={idx} className={`border-b border-[#f0f0f0] ${tx.status === 'UNMATCHED' ? 'bg-[#fff5f5]' : ''}`}>
                         <td className="p-2">{tx.display_date || tx.trans_date}</td>
                         <td className="p-2 uppercase leading-tight text-[#4b5563]">{tx.branch_description || 'RPP INWARD INST TRF'}</td>
                         <td className="p-2 uppercase leading-tight">{tx.sender_name}</td>
                         <td className="p-2 text-[#4b5563] leading-tight break-words">{tx.reference_1 || tx.reference || '-'}</td>
                         <td className="p-2 text-[#4b5563] leading-tight break-words">{tx.reference_2 || '-'}</td>
                         <td className="p-2 text-[#4b5563]">{tx.ref_num || '-'}</td>
                         <td className="p-2 font-bold text-right text-[#6b7280] relative">
                             {tx.amount_dr ? tx.amount_dr.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}
                             {/* The Audit Mark */}
                             {tx.status === 'UNMATCHED' && (
                                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                                  <div className="border-4 border-[#000000] px-2 py-0.5 rounded-sm font-bold text-[#000000] text-[10px] flex items-center justify-center rotate-[-5deg]">
                                     UNMATCHED
                                  </div>
                                </div>
                             )}
                             {tx.status === 'MATCHED' && (
                                <div className="absolute top-1/2 left-3 transform -translate-y-1/2 opacity-90 pointer-events-none">
                                  <div className="border-2 border-[#16a34a] px-2 py-0.5 rounded-sm font-bold text-[#16a34a] text-[11px] flex items-center justify-center rotate-[-2deg] uppercase tracking-widest bg-white/80 backdrop-blur-sm whitespace-nowrap">
                                     {tx.plate_number || 'MATCHED'}
                                  </div>
                                </div>
                             )}
                         </td>
                         <td className="p-2 font-bold text-right">{tx.amount_cr ? tx.amount_cr.toLocaleString(undefined, {minimumFractionDigits: 2}) : (tx.amount ? tx.amount.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-')}</td>
                         <td className="p-2 text-right tabular-nums">{tx.balance ? tx.balance.toLocaleString(undefined, {minimumFractionDigits: 2}) : tx.runningBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}+</td>
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
                          {(result.unsolved_system_transactions || []).length === 0 ? (
                            <tr><td colSpan={5} className="p-6 text-center text-[#6b7280] italic text-xs">No unsolved transactions found.</td></tr>
                          ) : (result.unsolved_system_transactions || []).map((tx, idx) => (
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
                          ))}
                       </tbody>
                     </table>
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
