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
  plate_number?: string;
  driver_id?: string;
}

interface ReconciliationResult {
  paired_transactions: ReconcileTransaction[];
  unpaired_transactions: ReconcileTransaction[];
}

interface BankReconciliationProps {
  drivers: Driver[]; // We pass drivers just in case we need it for mock local data
}

const BankReconciliation: React.FC<BankReconciliationProps> = ({ drivers }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
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
    // Local mock for preview in AI Studio
    return new Promise<ReconciliationResult>((resolve) => {
      setTimeout(() => {
        resolve({
          paired_transactions: [
             { status: 'MATCHED', trans_date: '2026-05-17', amount: 350.00, sender_name: 'JOHN DOE', reference: 'RENTAL WK 3', plate_number: 'BEE1234' },
             { status: 'MATCHED', trans_date: '2026-05-18', amount: 280.00, sender_name: 'ALICE SMITH', reference: 'SEWA KERETA', plate_number: 'WQB5555' }
          ],
          unpaired_transactions: [
             { status: 'UNMATCHED', trans_date: '2026-05-18', amount: 100.00, sender_name: 'UNKNOWN ENTITY', reference: 'TRANSFER', plate_number: 'UNKNOWN' }
          ]
        });
      }, 3000);
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
    element.style.display = 'block';

    const opt = {
      margin:       0.5,
      filename:     `Bank-Reconciliation-${new Date().toISOString().split('T')[0]}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2 },
      jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        // hide again
        element.style.display = 'none';
    });
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Bank Reconciliation</h2>
        <p className="text-gray-500 text-sm mt-1">AI-powered bank statement matching with Gemini 3.0 Flash</p>
      </div>

      {!result && !isLoading && (
        <div 
           className="border-2 border-dashed border-gray-300 rounded-xl p-10 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
           onDragOver={(e) => e.preventDefault()}
           onDrop={handleDrop}
           onClick={() => document.getElementById('fileUpload')?.click()}
        >
          <UploadCloud className="w-12 h-12 text-blue-500 mb-4" />
          <h3 className="text-lg font-semibold text-gray-800">Drag & Drop Bank Statement</h3>
          <p className="text-gray-500 text-sm mt-1 mb-4">or click to select PDF or Image file</p>
          <input 
            type="file" 
            id="fileUpload" 
            className="hidden" 
            accept=".pdf,image/*" 
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
                className="mt-6 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg shadow hover:bg-blue-700 transition"
            >
              Start AI Reconciliation
            </button>
          )}
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col items-center justify-center p-16 bg-white rounded-xl shadow-sm border border-gray-200">
          <Loader className="w-10 h-10 text-blue-600 animate-spin mb-4" />
          <h3 className="text-lg font-semibold text-gray-800 tracking-tight">Gemini AI is parsing statement transactions...</h3>
          <p className="text-gray-500 text-sm mt-2 text-center max-w-sm">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-center justify-between shadow-sm">
              <div>
                 <h3 className="text-emerald-800 font-semibold text-sm uppercase tracking-wider mb-1">Total Auto-Paired</h3>
                 <span className="text-4xl font-bold text-emerald-600">{result.paired_transactions.length}</span>
              </div>
              <CheckCircle className="w-12 h-12 text-emerald-300" />
            </div>
            
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between shadow-sm">
               <div>
                 <h3 className="text-red-800 font-semibold text-sm uppercase tracking-wider mb-1">Items Unpaired</h3>
                 <span className="text-4xl font-bold text-red-600">{result.unpaired_transactions.length}</span>
              </div>
              <AlertCircle className="w-12 h-12 text-red-300" />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button 
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download Audited Statement PDF
            </button>
            <button onClick={() => {setResult(null); setFile(null);}} className="ml-4 px-5 py-2.5 bg-gray-200 text-gray-800 font-medium rounded-lg hover:bg-gray-300">
               Start Over
            </button>
          </div>

          <p className="text-sm text-gray-500">
            A corporate audited document will be generated locally. Below is a preview of the report.
          </p>
        </div>
      )}

      {/* Hidden Div for PDF Generation Layout */}
      <div style={{ display: 'none' }} ref={reportRef}>
         {result && (
            <div className="p-8 bg-white text-gray-900 font-sans mx-auto max-w-4xl border border-gray-200 shadow-sm">
               {/* Corporate Header */}
               <div className="border-b-4 border-blue-800 pb-6 mb-6">
                 <h1 className="text-3xl font-bold text-blue-900 uppercase tracking-tight">Enterprise Bank Reconciliation Audit</h1>
                 <p className="text-gray-500 mt-2">Generated automatically via Gemini AI & Supabase | <strong>Date:</strong> {new Date().toLocaleDateString()}</p>
                 <p className="text-gray-500"><strong>Status:</strong> {result.paired_transactions.length} Matched / {result.unpaired_transactions.length} Unmatched</p>
               </div>

               {/* Table */}
               <table className="w-full text-left border-collapse">
                 <thead>
                    <tr className="bg-gray-100 uppercase text-xs tracking-wider text-gray-600">
                      <th className="p-3 border-b border-gray-300">Date</th>
                      <th className="p-3 border-b border-gray-300 w-1/4">Sender / Ref</th>
                      <th className="p-3 border-b border-gray-300">Amount</th>
                      <th className="p-3 border-b border-gray-300">Audited Vehicle Plate</th>
                      <th className="p-3 border-b border-gray-300">Status</th>
                    </tr>
                 </thead>
                 <tbody>
                    {[...result.paired_transactions, ...result.unpaired_transactions].map((tx, idx) => (
                       <tr key={idx} className={`border-b ${tx.status === 'UNMATCHED' ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                         <td className="p-3 text-sm">{tx.trans_date}</td>
                         <td className="p-3 text-sm">
                            <div className="font-semibold">{tx.sender_name}</div>
                            <div className="text-xs text-gray-500">{tx.reference}</div>
                         </td>
                         <td className="p-3 font-medium text-sm">RM {tx.amount.toFixed(2)}</td>
                         <td className="p-3 font-bold text-sm">
                            <span className={`px-2 py-1 rounded inline-block ${tx.status === 'MATCHED' ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'text-red-500'}`}>
                               {tx.plate_number || 'UNKNOWN'}
                            </span>
                         </td>
                         <td className="p-3">
                            {tx.status === 'MATCHED' ? (
                               <span className="text-emerald-600 font-semibold text-xs uppercase flex items-center gap-1"><CheckCircle className="w-3 h-3"/> {tx.status}</span>
                            ) : (
                               <span className="text-red-600 font-semibold text-xs uppercase flex items-center gap-1"><AlertCircle className="w-3 h-3"/> {tx.status}</span>
                            )}
                         </td>
                       </tr>
                    ))}
                 </tbody>
               </table>
               
               <div className="mt-10 text-xs text-center text-gray-400 border-t border-gray-200 pt-4">
                  ECA Rental Management System • Automated Audit Control
               </div>
            </div>
         )}
      </div>
    </div>
  );
};

export default BankReconciliation;
