import React, { useState, useRef } from 'react';
import { Driver, DriverStatus, PaymentTransaction } from '../types';
import { formatCurrency } from '../utils';
import { 
  Phone, 
  User, 
  MapPin, 
  Calendar, 
  FileText, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  DollarSign, 
  Upload, 
  File, 
  Trash2, 
  ExternalLink,
  MessageSquare,
  ShieldAlert,
  X
} from 'lucide-react';

interface ExpandedDriverDetailsProps {
  driver: Driver;
  onLogPaymentClick: () => void;
}

export const ExpandedDriverDetails: React.FC<ExpandedDriverDetailsProps> = ({ 
  driver, 
  onLogPaymentClick 
}) => {
  const [receipts, setReceipts] = useState<Record<string, { name: string; size: string; previewUrl: string }>>(() => {
    // Try to load any previously saved file previews from localStorage (simulated string data)
    try {
      const saved = localStorage.getItem(`driver_receipts_${driver.id}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate simulated weekly/monthly bills based on rental cycles
  const billingSchedule = React.useMemo(() => {
    const cycleDays = driver.rentalCycle === 'MONTHLY' ? 30 : 7;
    const items = [];
    const dateCursor = new Date();
    
    // We render the last 6 cycles of billing schedules
    for (let i = 0; i < 6; i++) {
      const dueDate = new Date(dateCursor.getTime() - i * cycleDays * 24 * 60 * 65 * 1000);
      const isOverdue = i > 0 && driver.activeBalance.baseValue > (i * driver.weeklyRate);
      let status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' = 'PAID';
      
      if (i === 0) {
        status = driver.activeBalance.baseValue <= 0 ? 'PAID' : 'PARTIAL';
      } else if (isOverdue) {
        status = 'OVERDUE';
      } else if (driver.activeBalance.baseValue > 0 && i < 3) {
        status = 'PARTIAL';
      }

      items.push({
        id: `inv-${driver.id}-${i}`,
        dueDate,
        amount: driver.weeklyRate,
        status,
        cycleLabel: driver.rentalCycle === 'MONTHLY' ? 'Monthly Rental' : 'Weekly Rental'
      });
    }
    return items;
  }, [driver]);

  const saveReceipts = (newReceipts: Record<string, { name: string; size: string; previewUrl: string }>) => {
    setReceipts(newReceipts);
    try {
      localStorage.setItem(`driver_receipts_${driver.id}`, JSON.stringify(newReceipts));
    } catch (e) {
      console.error("Local storage quota exceeded or unavailable:", e);
    }
  };

  const processFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const sizeStr = `${(file.size / 1024).toFixed(1)} KB`;
      const previewUrl = reader.result as string;
      const txId = `tx-manual-${Date.now()}`;
      
      const updated = {
        ...receipts,
        [txId]: {
          name: file.name,
          size: sizeStr,
          previewUrl
        }
      };
      saveReceipts(updated);
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      processFile(files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      processFile(files[0]);
    }
  };

  const handleRemoveReceipt = (txId: string) => {
    const updated = { ...receipts };
    delete updated[txId];
    saveReceipts(updated);
  };

  return (
    <div className="bg-white/95 rounded-2xl border border-gray-200/80 shadow-inner p-6 space-y-8 animate-fade-in font-sans text-gray-800">
      {/* Drawer Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Column 1: Driver Directory Profile */}
        <div className="bg-gray-50/50 rounded-xl p-5 border border-gray-200/60 shadow-sm space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-gray-900">{driver.name}</h4>
              <p className="text-xs text-gray-400 font-medium font-mono">ID: {driver.id.substring(0, 8)}</p>
            </div>
          </div>

          <div className="space-y-3.5 border-t border-gray-200/60 pt-4">
            {/* Phone */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                <Phone className="w-3.5 h-3.5" /> Contact
              </span>
              <div className="flex items-center gap-2">
                <a 
                  href={`tel:${driver.phone || '0123456789'}`} 
                  className="font-bold text-blue-600 hover:underline hover:text-blue-700 min-h-[30px] flex items-center"
                >
                  {driver.phone || '012-345 6789'}
                </a>
                <a 
                  href={`https://wa.me/${driver.phone?.replace(/[^0-9]/g, '') || '60123456789'}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 bg-green-50 text-green-600 rounded hover:bg-green-100 transition-colors"
                  title="WhatsApp Chat"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* NRIC */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400 font-semibold uppercase tracking-wider shrink-0">NRIC No</span>
              <span className="font-mono font-bold text-gray-700">{driver.nric}</span>
            </div>

            {/* Group Label */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400 font-semibold uppercase tracking-wider shrink-0">Roster Tag</span>
              <span className="font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100 uppercase tracking-wide">
                {driver.tags?.[0] || 'Default'}
              </span>
            </div>

            {/* Category */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400 font-semibold uppercase tracking-wider shrink-0">Category</span>
              <span className={`font-black uppercase tracking-wider text-[10px] px-2 py-0.5 rounded border ${
                driver.category === 'SEWABELI' 
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-100' 
                  : 'bg-orange-50 text-orange-700 border-orange-100'
              }`}>
                {driver.category === 'SEWABELI' ? 'Rent-To-Own (Sewabeli)' : 'Basic Hire (Sewa)'}
              </span>
            </div>

            {/* Registered Car Plate */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400 font-semibold uppercase tracking-wider shrink-0">Registered Car</span>
              <span className="font-mono font-extrabold text-gray-950 bg-yellow-50 px-2 border border-yellow-200 rounded">
                {driver.carPlate}
              </span>
            </div>
          </div>

          <div className="border-t border-gray-200/60 pt-4">
            <button 
              onClick={onLogPaymentClick}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-all focus:ring-2 focus:ring-blue-500/55"
            >
              <DollarSign className="w-4 h-4 shrink-0" /> Log Payment / Issue Arrears
            </button>
          </div>
        </div>

        {/* Column 2: Invoices Schedule */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-500" />
              Dynamic Billing & Rental Schedule
            </h5>
            <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Last 6 Billing Periods</span>
          </div>

          <div className="border border-gray-200/80 rounded-xl overflow-hidden shadow-sm bg-white divide-y divide-gray-100">
            {billingSchedule.map((inv) => (
              <div key={inv.id} className="p-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors text-xs">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${
                    inv.status === 'PAID' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                    inv.status === 'OVERDUE' ? 'bg-red-50 text-red-650 border border-red-100 animate-pulse' :
                    'bg-amber-50 text-amber-600 border border-amber-100'
                  }`}>
                    <Calendar className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="font-bold text-gray-800 block">{inv.cycleLabel}</span>
                    <span className="text-gray-400 font-mono text-[11px]">Due: {inv.dueDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="font-mono font-extrabold text-gray-900">{formatCurrency(inv.amount)}</span>
                  <span className={`px-2.5 py-1 rounded-full font-black text-[10px] tracking-wider shrink-0 ${
                    inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' :
                    inv.status === 'OVERDUE' ? 'bg-red-100 text-red-800' :
                    'bg-amber-100 text-amber-800'
                  }`}>
                    {inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Transaction Feed & Drag-and-Drop Receipt Box */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 border-t border-gray-200/60 pt-6">
        
        {/* Live Payments Feed */}
        <div className="lg:col-span-2 space-y-4">
          <h5 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-500" />
            Live Payment Transactions & Timelines
          </h5>

          {driver.paymentHistory.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-400 text-xs italic">
              No historical payment logs located. Expand driver with new receipts.
            </div>
          ) : (
            <div className="relative border-l border-gray-200 pl-4 ml-3 space-y-6">
              {driver.paymentHistory.map((pt, index) => {
                const isUploadedIdx = `tx-manual-${pt.id}` || pt.id;
                const uploadedData = receipts[pt.id] || receipts[`tx-manual-${pt.id}`];
                
                return (
                  <div key={pt.id || index} className="relative text-xs">
                    {/* Tiny bullet */}
                    <span className="absolute -left-7 top-1 w-3 h-3 rounded-full bg-blue-600 border-2 border-white ring-2 ring-blue-105" />
                    
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/60 hover:border-gray-300 hover:shadow-sm transition-all flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-extrabold text-base text-gray-950">
                            {formatCurrency(pt.amount)}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-gray-200 text-gray-700 font-mono uppercase text-[9px] font-bold">
                            {pt.method || 'Cash / Bank'}
                          </span>
                        </div>
                        <p className="text-gray-400 font-medium font-mono mt-1 text-[11px]">
                          Timestamp: {new Date(pt.date).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })} at {new Date(pt.date).toLocaleTimeString('en-MY')}
                        </p>
                      </div>

                      {/* Display Receipt Attachments */}
                      <div className="flex items-center gap-3 self-end sm:self-auto">
                        {uploadedData ? (
                          <div className="flex items-center gap-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 p-2 rounded-lg pr-3">
                            {uploadedData.previewUrl.startsWith('data:image') ? (
                              <img 
                                src={uploadedData.previewUrl} 
                                alt="receipt-preview" 
                                className="w-8 h-8 rounded border border-emerald-300 object-cover shrink-0 cursor-pointer hover:scale-125 transition-transform" 
                                referrerPolicy="no-referrer"
                                onClick={() => {
                                  // Opens receipt preview in basic simulated lightbox
                                  const win = window.open();
                                  if (win) {
                                    win.document.write(`<img src="${uploadedData.previewUrl}" style="max-width:100%; max-height:100vh; margin:auto; display:block;" />`);
                                  }
                                }}
                              />
                            ) : (
                              <File className="w-5 h-5 text-emerald-600 shrink-0" />
                            )}
                            <div className="truncate max-w-[120px]">
                              <span className="font-bold underline text-[10px] block truncate" title={uploadedData.name}>{uploadedData.name}</span>
                              <span className="text-[9px] text-gray-400 block font-mono font-semibold">{uploadedData.size}</span>
                            </div>
                            <button 
                              type="button"
                              onClick={() => handleRemoveReceipt(pt.id || `tx-manual-${pt.id}`)}
                              className="text-red-500 hover:text-red-700 p-1 min-w-[30px] min-h-[30px]"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => {
                              fileInputRef.current?.click();
                              // Bind TX to file input if needed
                            }}
                            className="bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 rounded-lg px-2.5 py-1.5 font-bold flex items-center gap-1 shrink-0 cursor-pointer outline-none min-h-[36px]"
                          >
                            <Upload className="w-3.5 h-3.5" /> Bind Receipt
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* receipt drop uploader */}
        <div className="space-y-4">
          <h5 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Upload className="w-4 h-4 text-gray-500" />
            Receipt Dropbox
          </h5>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer hover:border-blue-400 group relative border-2 border-dashed rounded-2xl p-6 text-center transition-all min-h-[160px] flex flex-col justify-center items-center shadow-inner
              ${isDragging ? 'border-blue-500 bg-blue-50/50 scale-[1.01]' : 'border-gray-200 bg-gray-50/20'}`}
          >
            <input 
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            
            <div className="p-3 bg-white shadow-md border border-gray-100 rounded-xl mb-3 text-gray-400 group-hover:text-blue-500 transform group-hover:scale-110 transition-transform">
              <Upload className="w-5 h-5" />
            </div>

            <span className="text-xs text-gray-700 font-bold block mb-1">Drag receipts here or click</span>
            <span className="text-[10px] text-gray-400 font-medium">JPEG, PNG, or PDF up to 5MB</span>
            
            {isDragging && (
              <div className="absolute inset-0 bg-blue-50/90 backdrop-blur-sm rounded-2xl flex items-center justify-center font-bold text-blue-650 text-xs">
                Release to Upload receipt proof!
              </div>
            )}
          </div>

          {Object.keys(receipts).length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
              <span className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wider block">Uploaded proofs ({Object.keys(receipts).length})</span>
              <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1 no-scrollbar">
                {Object.entries(receipts).map(([id, rawR]) => {
                  const r = rawR as { name: string; size: string; previewUrl: string };
                  return (
                    <div key={id} className="flex items-center justify-between p-2 rounded bg-white border border-gray-200 text-[11px]">
                      <div className="flex items-center gap-2 truncate max-w-[170px]">
                        <File className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="truncate font-semibold text-gray-700">{r.name}</span>
                      </div>
                    <button 
                      type="button" 
                      onClick={() => handleRemoveReceipt(id)} 
                      className="text-red-500 hover:text-red-700 font-bold"
                    >
                      Delete
                    </button>
                  </div>
                )})}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
