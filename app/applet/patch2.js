const fs = require('fs');
let content = fs.readFileSync('components/BankReconciliation.tsx', 'utf8');

const anchor1 = `{/* Summary Table */}`;
const replacement1 = `
               {viewMode === 'BANK_STATEMENT' && (
                 <>
               {/* Summary Table */}`;

const anchor2 = `               </table>
               
               <div className="mt-6 text-[9px] text-[#999] font-medium border-t border-[#eee] pt-2">`;

const replacement2 = `               </table>
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
               
               <div className="mt-6 text-[9px] text-[#999] font-medium border-t border-[#eee] pt-2">`;

content = content.replace(anchor1, replacement1);
content = content.replace(anchor2, replacement2);

fs.writeFileSync('components/BankReconciliation.tsx', content);

