const fs = require('fs');
let code = fs.readFileSync('./components/AnalyticsView.tsx', 'utf8');

const uiStart = `{/* --- WEEKLY INFLOW MONITORING (Merged from main tabs & Paginated) --- */}`;
const uiEnd = `{/* Charts and Claims split row */}`;

const startIndex = code.indexOf(uiStart);
const endIndex = code.indexOf(uiEnd);

if (startIndex !== -1 && endIndex !== -1) {
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
                    formatter={(value) => formatCurrency(value)}
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
                    name="Performance" 
                    stroke="#2563EB" 
                    strokeWidth={3} 
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6, stroke: '#1D4ED8', strokeWidth: 2 }}
                />
                <Line 
                    type="monotone" 
                    dataKey="cashFlowCollected" 
                    name="Cash InFlow" 
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
    code = code.substring(0, startIndex) + newUI + code.substring(endIndex);
    fs.writeFileSync('./components/AnalyticsView.tsx', code);
    console.log("Successfully patched UI");
} else {
    console.log("Could not find start or end index:", startIndex, endIndex);
}
