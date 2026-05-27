const fs = require('fs');

let content = fs.readFileSync('components/AdminDashboard.tsx', 'utf-8');

// First fix the table header
const targetHeaderRegex = /<th className="px-6 py-4 border-b border-gray-200">Staff \/ Grouping<\/th>/g;
content = content.replace(targetHeaderRegex, "");

// Then replace the render block
// From the return ( ... React.Fragment key={driver.id} to </React.Fragment>
const renderBlockRegex = /<tr id={`driver-row-\$\{driver\.id\}`[^]*?<\/React\.Fragment>/m;

// In Design Option 2 snippet from previous script, we wanted:
const newRenderBlock = `<tr id={\`driver-row-\$\{driver.id\}\`}>
                                         <td colSpan={4} className="p-3 bg-slate-50 border-b border-slate-200">
                                             <div className={\`bg-white p-4 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden group hover:shadow-md transition-shadow \${highlightedDriverId === driver.id ? 'ring-2 ring-orange-500 scale-[1.01]' : ''}\`}>
                                                 <div className={\`absolute left-0 top-0 bottom-0 w-1.5 \${m.status === 'GOOD' ? 'bg-emerald-500' : m.status === 'MID' ? 'bg-amber-500' : 'bg-rose-500'}\`}></div>
                                                 
                                                 <div className="flex items-start justify-between gap-4 pl-2">
                                                     <div className="flex items-start gap-4 flex-1">
                                                         <button onClick={(e) => { e.stopPropagation(); toggleRowExpand(driver.id); }} className="mt-1 w-8 h-8 rounded-full border border-slate-100 flex items-center justify-center hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-colors shrink-0 -ml-1 bg-slate-50/50">
                                                             <ChevronRight className={\`w-5 h-5 transform transition-transform duration-300 \${expandedDriverIds.includes(driver.id) ? 'rotate-90 text-blue-600' : ''}\`} />
                                                         </button>
                                                         <div>
                                                             <div className="flex items-center gap-2 flex-wrap">
                                                                 <h3 className="font-bold text-slate-900 text-[17px]">{driver.name}</h3>
                                                                 {!screenedDriverIds.includes(driver.id) && !driver.isDelisted && (
                                                                    <button type="button" onClick={(e) => { e.stopPropagation(); handleScreenDriver(driver.id); }} className="relative flex h-4 w-4 items-center justify-center cursor-pointer group/reddot shrink-0" title="Click to complete driver screening for today">
                                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600 border border-white hover:bg-rose-700 transition-all transform hover:scale-125 shadow-sm shadow-rose-600/40"></span>
                                                                    </button>
                                                                 )}
                                                                 {screenedDriverIds.includes(driver.id) && !driver.isDelisted && (
                                                                    <div className="text-emerald-500 shrink-0" title="Daily screening completed">
                                                                        <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                                                                    </div>
                                                                 )}
                                                                 {driver.debtTrend.isStreak && <span className="text-xl" title="3-Week Debt Streak">⚠️</span>}
                                                                 {v.isSlipping && <TrendingDown className="w-4 h-4 text-rose-500 animate-bounce" />}
                                                                 {v.isRecovering && <TrendingUp className="w-4 h-4 text-emerald-500" />}
                                                             </div>
                                                             <div className="flex items-center gap-3 mt-1 text-xs">
                                                                 <span className="font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{driver.carPlate}</span>
                                                                 <span className="flex items-center gap-1 font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100"><Calendar className="w-3 h-3" /> Due {nextDueStr}</span>
                                                             </div>
                                                             <div className="flex flex-wrap gap-1.5 mt-2.5">
                                                                 {driver.category && <span className={\`text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider rounded border \${driver.category === 'SEWABELI' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-orange-50 text-orange-700 border-orange-200'}\`}>{driver.category === 'SEWABELI' ? 'Sewabeli' : 'Sewa Biasa'}</span>}
                                                                 {driver.tags?.map((tag, i) => <span key={i} className="text-[10px] bg-slate-50 border border-slate-200 text-slate-500 px-2 py-0.5 rounded font-medium">{tag}</span>)}
                                                             </div>
                                                         </div>
                                                     </div>

                                                     <div className="flex flex-col items-center w-40 shrink-0 mt-1">
                                                          <span className={\`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest \${m.status === 'GOOD' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : m.status === 'MID' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}\`}>{m.status}</span>
                                                          <div className="text-[11px] font-bold text-slate-500 mt-2">{m.cyclesOwed > 0 ? \`\${m.cyclesOwed.toFixed(1)} \${cycleLabel} Owed\` : 'Up to date'}</div>
                                                     </div>

                                                     <div className="flex flex-col items-end w-56 shrink-0 border-l border-slate-100 pl-6 pr-2 gap-1.5 mt-1">
                                                         <div className="flex flex-col items-end w-full">
                                                             <div className="font-mono font-bold text-xl text-slate-900">
                                                                 {currentOutstanding > 0 ? <span className="text-rose-600">{formatCurrency(currentOutstanding)}</span> : <span className="text-emerald-600">PAID</span>}
                                                             </div>
                                                             {driver.debtTrend.direction !== 'FLAT' && (
                                                                 <div className={\`text-[10px] font-bold flex items-center \${driver.debtTrend.direction === 'UP' ? 'text-rose-600' : 'text-emerald-600'}\`}>
                                                                     {driver.debtTrend.direction === 'UP' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                                                                     {driver.debtTrend.direction === 'UP' ? '+' : '-'}{formatCurrency(driver.debtTrend.value)}
                                                                 </div>
                                                             )}
                                                         </div>
                                                         
                                                         {(currentOutstanding > 0 || baselineOutstanding > 0) && (
                                                             <div className="w-full mt-1.5 text-left">
                                                                 <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase mb-1">
                                                                     <span>{labelText}</span>
                                                                     <span className="font-mono">{valueText}</span>
                                                                 </div>
                                                                 <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                     <div className={\`h-full \${barColorClass}\`} style={{ width: \`\${Math.min(100, Math.max(0, progressPercent))}%\` }}></div>
                                                                 </div>
                                                             </div>
                                                         )}
                                                     </div>

                                                     <div className="flex flex-col gap-2 shrink-0 border-l border-slate-100 pl-5 h-full min-h-[90px] justify-center pt-1">
                                                          <div className={\`text-[10px] \${behaviorColor} font-bold text-center w-full\`}>{behaviorText}</div>
                                                          {lastPaymentDate ? <div className={\`text-[9px] font-bold flex items-center justify-center gap-1 mt-0.5 \${showLastPayWarning ? 'text-rose-600' : 'text-slate-400'}\`}>{showLastPayWarning && <AlertTriangle className="w-3 h-3" />}Last Pay: {formatDateShort(lastPaymentDate.toISOString())}</div> : <div className="text-[9px] text-slate-400 mt-0.5 text-center">No payment yet</div>}
                                                          <div className="flex items-center gap-2 mt-1.5">
                                                              <button onClick={() => handleOpenPaymentModal(driver)} className="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded-lg hover:bg-blue-700 shadow-sm flex items-center justify-center gap-1 transition-colors">
                                                                  <DollarSign className="w-3 h-3" /> Log Pay
                                                              </button>
                                                              <div className="flex justify-center gap-1.5 text-slate-400">
                                                                  <button onClick={() => handleOpenEditModal(driver)} className="hover:text-slate-600 p-1 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200"><Pencil className="w-3 h-3" /></button>
                                                                  {viewMode === 'ACTIVE' ? <button onClick={() => handleDelistClick(driver)} className="hover:text-rose-600 p-1 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200"><UserMinus className="w-3 h-3" /></button> : <button onClick={() => { if(window.confirm('Delete?')) onDeleteDriver(driver.id); }} className="hover:text-rose-600 p-1 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200"><Trash2 className="w-3 h-3" /></button>}
                                                              </div>
                                                          </div>
                                                     </div>
                                                 </div>
                                             </div>
                                         </td>
                                     </tr>
                                     {expandedDriverIds.includes(driver.id) && (
                                       <tr className="bg-gray-50/40">
                                         <td colSpan={4} className="px-6 py-5 border-b border-gray-200">
                                           <ExpandedDriverDetails 
                                             driver={driver} 
                                             onLogPaymentClick={() => handleOpenPaymentModal(driver)} 
                                           />
                                         </td>
                                       </tr>
                                     )}
                                   </React.Fragment>`;

if(content.match(renderBlockRegex)) {
    content = content.replace(renderBlockRegex, newRenderBlock);
    fs.writeFileSync('components/AdminDashboard.tsx', content);
    console.log("Success replacing render block");
} else {
    console.log("Regex not found", "Wait maybe we need a different regex");
}
