const fs = require('fs');
let content = fs.readFileSync('components/BankReconciliation.tsx', 'utf8');

content = content.replace(/<div className="grid grid-cols-1 md:grid-cols-3 gap-4">[\s\S]*?<div className="flex justify-between pt-2">/, 
`<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

          <div className="flex justify-between pt-2">`
);

fs.writeFileSync('components/BankReconciliation.tsx', content);
