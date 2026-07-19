const fs = require('fs');
let code = fs.readFileSync('./components/AnalyticsView.tsx', 'utf8');

// 1. Remove inflowViewMode
code = code.replace(/const \[inflowViewMode, setInflowViewMode\] = useState<.*?>(.*?);/, '');

// 2. Replace allWeeklyFinancials useMemo block
const oldMemoStart = `const allWeeklyFinancials = useMemo(() => {`;
const oldMemoEnd = `return weeks;
  }, [drivers, inflowViewMode]);`;
const memoEndRegex = /return weeks;\s*\}, \[drivers, inflowViewMode\]\);/;

const newMemo = `const allWeeklyFinancials = useMemo(() => {
    const weeks: any[] = [];
    const todayRef = new Date();
    todayRef.setHours(0,0,0,0);
    
    // Setup 12-Week Buckets
    const currentDay = todayRef.getDay(); 
    const diff = todayRef.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
    const currentMonday = new Date(todayRef);
    currentMonday.setDate(diff);

    for (let i = 0; i < 12; i++) {
        const startOfWeek = new Date(currentMonday);
        startOfWeek.setDate(currentMonday.getDate() - (i * 7));
        startOfWeek.setHours(0,0,0,0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23,59,59,999);

        weeks.push({
            id: i,
            start: startOfWeek,
            end: endOfWeek,
            label: \`\${startOfWeek.getDate()}/\${startOfWeek.getMonth()+1} - \${endOfWeek.getDate()}/\${endOfWeek.getMonth()+1}\`,
            fullLabel: \`\${startOfWeek.toLocaleDateString('en-MY')} - \${endOfWeek.toLocaleDateString('en-MY')}\`,
            expected: 0,
            performanceCollected: 0,
            cashFlowCollected: 0,
            activeDriverCount: 0,
            details: [] as any[]
        });
    }

    // Process Each Driver
    drivers.forEach(d => {
        const contractStart = new Date(d.contractStartDate + 'T00:00:00');
        let effectiveEnd: Date;
        
        if (d.contractEndDate) {
            effectiveEnd = new Date(d.contractEndDate + 'T23:59:59.999');
        } else {
            let durationDays = d.contractDuration * (d.rentalCycle === 'MONTHLY' ? 30 : 7);
            effectiveEnd = new Date(contractStart);
            effectiveEnd.setDate(effectiveEnd.getDate() + durationDays);
            effectiveEnd.setHours(23,59,59,999);
        }

        if (d.isDelisted && d.delistDate) {
             const delistDate = new Date(d.delistDate + 'T23:59:59.999');
             if (delistDate < effectiveEnd) {
                 effectiveEnd = delistDate;
             }
        }

        // PERFORMANCE LOGIC (Accrual)
        let paymentPool = d.paymentHistory 
            ? d.paymentHistory.reduce((sum, p) => sum + p.amount + (p.serviceClaim || 0), 0) 
            : 0;

        let invoiceDate = new Date(contractStart);
        let safetyCounter = 0;
        const maxCycles = 500; 

        while (invoiceDate <= effectiveEnd && safetyCounter < maxCycles) {
            if (invoiceDate > weeks[0].end) break;
            const invoiceAmount = d.rentalCycle === 'MONTHLY' ? (d.rentalRate * 12 / 52) : d.rentalRate;
            
            let paidForThisInvoice = 0;
            if (paymentPool >= invoiceAmount - 0.01) {
                paidForThisInvoice = invoiceAmount;
                paymentPool -= invoiceAmount;
            } else if (paymentPool > 0) {
                paidForThisInvoice = paymentPool;
                paymentPool = 0;
            }

            const weekIndex = weeks.findIndex(w => invoiceDate >= w.start && invoiceDate <= w.end);
            
            if (weekIndex !== -1) {
                const week = weeks[weekIndex];
                week.expected += invoiceAmount;
                week.performanceCollected += paidForThisInvoice;
                week.activeDriverCount++;

                let detail = week.details.find((x: any) => x.id === d.id);
                if (!detail) {
                    detail = {
                        id: d.id,
                        name: d.name,
                        plate: d.carPlate,
                        cycle: d.rentalCycle,
                        expected: 0,
                        performancePaid: 0,
                        cashFlowPaid: 0,
                        isActive: true,
                        contractEnded: false
                    };
                    week.details.push(detail);
                }
                detail.expected += invoiceAmount;
                detail.performancePaid += paidForThisInvoice;
            }

            if (d.rentalCycle === 'MONTHLY') invoiceDate.setMonth(invoiceDate.getMonth() + 1);
            else invoiceDate.setDate(invoiceDate.getDate() + 7);
            safetyCounter++;
        }

        // CASH FLOW LOGIC (Bank Deposits)
        if (d.paymentHistory) {
            d.paymentHistory.forEach(p => {
                const pDate = new Date(p.date + 'T00:00:00');
                const weekIndex = weeks.findIndex(w => pDate >= w.start && pDate <= w.end);
                
                if (weekIndex !== -1) {
                    weeks[weekIndex].cashFlowCollected += p.amount + (p.serviceClaim || 0);
                    
                    let detail = weeks[weekIndex].details.find((x: any) => x.id === d.id);
                    if (!detail) {
                        detail = {
                            id: d.id,
                            name: d.name,
                            plate: d.carPlate,
                            cycle: d.rentalCycle,
                            expected: 0,
                            performancePaid: 0,
                            cashFlowPaid: 0,
                            isActive: true,
                            contractEnded: false
                        };
                        weeks[weekIndex].details.push(detail);
                    }
                    detail.cashFlowPaid += p.amount + (p.serviceClaim || 0);
                }
            });
        }
    });

    weeks.forEach(week => {
        week.variance = week.performanceCollected - week.expected;
        week.rate = week.expected > 0 ? (week.performanceCollected / week.expected) * 100 : 0;
        // Sort by performance deficit
        week.details.sort((a: any, b: any) => (b.expected - b.performancePaid) - (a.expected - a.performancePaid));
    });

    return weeks;
  }, [drivers]);`;

const startIndex = code.indexOf(oldMemoStart);
const endIndex = code.indexOf(oldMemoEnd);
if (startIndex !== -1 && endIndex !== -1) {
    code = code.substring(0, startIndex) + newMemo + code.substring(endIndex + oldMemoEnd.length);
} else {
    console.error("Could not find allWeeklyFinancials");
}

// 3. Remove pagination and replace UI
const uiStart = `      {/* --- WEEKLY INFLOW MONITORING (Merged from main tabs & Paginated) --- */}`;
const uiStartIndex = code.indexOf(uiStart);
if (uiStartIndex === -1) {
    console.error("Could not find UI block");
} else {
    // We will slice the file until the end of the div
    // Find the end of this div block.
    // We know it's before: {/* Modal for details */}
    const uiEnd = `      {/* Modal for details */}`;
    const uiEndIndex = code.indexOf(uiEnd);
    
    if (uiEndIndex !== -1) {
        const newUI = `      {/* --- WEEKLY INFLOW MONITORING (Line Chart) --- */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 gap-4">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-blue-600" /> Weekly Inflow Analysis
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">Tracking Expected Rental vs Performance vs Cash Flow over the last 12 weeks</p>
          </div>
        </div>

        <div className="p-6">
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...allWeeklyFinancials].reverse()} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis 
                    dataKey="label" 
                    tick={{ fontSize: 11, fill: '#6B7280', fontWeight: 'bold' }} 
                    axisLine={false} 
                    tickLine={false}
                    dy={10}
                />
                <YAxis 
                    tickFormatter={(value) => \`RM \${(value / 1000).toFixed(1)}k\`}
                    tick={{ fontSize: 11, fill: '#6B7280', fontWeight: 'bold' }}
                    axisLine={false}
                    tickLine={false}
                    dx={-10}
                />
                <Tooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    labelStyle={{ fontWeight: 'bold', color: '#374151', marginBottom: '8px' }}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #E5E7EB', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend 
                    wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold' }}
                    iconType="circle"
                />
                <Line 
                    type="monotone" 
                    dataKey="expected" 
                    name="Expected Rental" 
                    stroke="#9CA3AF" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    activeDot={{ r: 6 }} 
                />
                <Line 
                    type="monotone" 
                    dataKey="performanceCollected" 
                    name="Performance (Accrual)" 
                    stroke="#2563EB" 
                    strokeWidth={3} 
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6, stroke: '#1D4ED8', strokeWidth: 2 }}
                />
                <Line 
                    type="monotone" 
                    dataKey="cashFlowCollected" 
                    name="Cash InFlow (Bank)" 
                    stroke="#10B981" 
                    strokeWidth={3} 
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6, stroke: '#059669', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
`;
        code = code.substring(0, uiStartIndex) + newUI + code.substring(uiEndIndex);
    }
}

// 4. Remove pagination variables
code = code.replace(/const weeksPerPage = 8;\s*const paginatedWeeks = useMemo\(\(\) => \{[\s\S]*?\}, \[allWeeklyFinancials, currentPage\]\);\s*const totalPages = Math\.ceil\(allWeeklyFinancials\.length \/ weeksPerPage\);/, '');

fs.writeFileSync('./components/AnalyticsView.tsx', code);
console.log("Done");
