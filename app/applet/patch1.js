const fs = require('fs');
let content = fs.readFileSync('components/BankReconciliation.tsx', 'utf8');
content = content.replace(
  '<div className="flex justify-end pt-2">',
  `<div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center justify-between cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => setViewMode('SYSTEM_UNSOLVED')} >
               <div>
                 <h3 className="text-amber-800 font-semibold text-sm uppercase tracking-wider mb-1">System Unsolved</h3>
                 <span className="text-4xl font-bold text-amber-600">{result.unsolved_system_transactions?.length || 0}</span>
              </div>
              <AlertCircle className="w-12 h-12 text-amber-300" />
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <div className="flex gap-2">
                <button onClick={() => setViewMode('BANK_STATEMENT')} className={\`px-4 py-2 text-sm font-medium rounded-lg transition-colors \${viewMode === 'BANK_STATEMENT' ? 'bg-blue-600 text-[#ffffff]' : 'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50'}\`}>Bank Statement Audit</button>
                <button onClick={() => setViewMode('SYSTEM_UNSOLVED')} className={\`px-4 py-2 text-sm font-medium rounded-lg transition-colors \${viewMode === 'SYSTEM_UNSOLVED' ? 'bg-amber-600 text-[#ffffff]' : 'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50'}\`}>Unsolved Transactions ({result.unsolved_system_transactions?.length || 0})</button>
            </div>
            <div className="flex gap-2">`
);
fs.writeFileSync('components/BankReconciliation.tsx', content);
