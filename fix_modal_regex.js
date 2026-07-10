import fs from 'fs';
let content = fs.readFileSync('./components/BankReconciliation.tsx', 'utf8');

const replacement = `
      {isCashDepositModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 print:hidden">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col border border-gray-200">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
              <h2 className="text-xl font-bold text-gray-900">Cash Deposit Payments - {selectedMonth || 'All Time'}</h2>
              <button onClick={() => setIsCashDepositModalOpen(false)} className="text-gray-400 hover:text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-full p-2 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto bg-white flex-1">
               <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse bg-white">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="p-4 font-bold border-b border-gray-200 w-32">Date</th>
                        <th className="p-4 font-bold border-b border-gray-200">Driver Name</th>
                        <th className="p-4 font-bold border-b border-gray-200 w-32">Plate Number</th>
                        <th className="p-4 font-bold border-b border-gray-200 text-right w-32">Amount (RM)</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-gray-100">
                      {cashDeposits.length === 0 ? (
                        <tr><td colSpan={4} className="p-8 text-center text-gray-500 text-base italic">No cash deposit records found for this month.</td></tr>
                      ) : cashDeposits.map((dep, idx) => (
                        <tr key={dep.id + idx} className="hover:bg-blue-50/50 transition-colors">
                            <td className="p-4 font-semibold text-gray-900">{dep.date}</td>
                            <td className="p-4 font-bold text-gray-800 uppercase">{dep.driverName}</td>
                            <td className="p-4 font-mono text-gray-600 font-medium">{dep.plateNumber}</td>
                            <td className="p-4 font-bold text-right text-teal-700">{Number(dep.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
               </div>
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button 
                onClick={() => setIsCashDepositModalOpen(false)}
                className="px-6 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default BankReconciliation;`;

// Let's replace the last </div>  );};export default BankReconciliation; with our modal + the ending
content = content.replace(/<\/div>\s*<\/div>\s*\);\s*\};\s*export default BankReconciliation;$/, replacement);

fs.writeFileSync('./components/BankReconciliation.tsx', content);
