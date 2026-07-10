import fs from 'fs';
let content = fs.readFileSync('./components/BankReconciliation.tsx', 'utf8');

// 1. Add view mode
content = content.replace(
  "const [viewMode, setViewMode] = useState<'BANK_STATEMENT' | 'SYSTEM_UNSOLVED' | 'MANUAL_MATCH'>('BANK_STATEMENT');",
  "const [viewMode, setViewMode] = useState<'BANK_STATEMENT' | 'SYSTEM_UNSOLVED' | 'MANUAL_MATCH' | 'CASH_DEPOSIT'>('BANK_STATEMENT');"
);

// 2. Add button
const buttonTarget = "<button onClick={() => setViewMode('MANUAL_MATCH')}";
const buttonReplacement = "<button onClick={() => setViewMode('CASH_DEPOSIT')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === 'CASH_DEPOSIT' ? 'bg-teal-600 text-[#ffffff]' : 'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50'}`}>Cash Deposits</button>\n                " + buttonTarget;
content = content.replace(buttonTarget, buttonReplacement);

// 3. Extract cash deposit data and sort
const cashDepositDataCode = `
  // Calculate cash deposits
  const cashDeposits = React.useMemo(() => {
    const deposits = [];
    drivers.forEach(driver => {
      (driver.paymentHistory || []).forEach(pay => {
        if (pay.paymentMethod === 'CASH DEPOSIT') {
          deposits.push({
            driverName: driver.name,
            plateNumber: driver.carPlate,
            date: pay.date,
            amount: pay.amount,
            id: pay.id
          });
        }
      });
    });
    // sort by date descending
    return deposits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [drivers]);
`;

// Insert the memo code right after the state declarations (e.g. after selectedSysTxId)
const stateTarget = "const [selectedSysTxId, setSelectedSysTxId] = useState<string | null>(null);";
content = content.replace(stateTarget, stateTarget + cashDepositDataCode);

// 4. Add the view mode rendering
const viewTarget = "{viewMode === 'MANUAL_MATCH' && (";
const viewReplacement = `
{viewMode === 'CASH_DEPOSIT' && (
                  <div className="mt-4">
                      <h3 className="font-bold text-teal-900 text-sm mb-4">Cash Deposit Payments (System)</h3>
                      <p className="text-gray-600 text-xs mb-4">
                        This view shows all internal recorded payments that were marked as "Cash Deposit". Use this for quick reference during internal checks.
                      </p>
                      <div className="max-h-[500px] overflow-y-auto border border-gray-200 rounded-sm">
                      <table className="w-full text-left border-collapse bg-white">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="p-3 font-bold border-b border-gray-200">Date</th>
                            <th className="p-3 font-bold border-b border-gray-200">Driver Name</th>
                            <th className="p-3 font-bold border-b border-gray-200">Plate Number</th>
                            <th className="p-3 font-bold border-b border-gray-200 text-right">Amount (RM)</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm">
                          {cashDeposits.length === 0 ? (
                            <tr><td colSpan={4} className="p-4 text-center text-gray-500 italic">No cash deposit records found</td></tr>
                          ) : cashDeposits.map((dep, idx) => (
                            <tr key={dep.id + idx} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="p-3 font-medium text-gray-900">{dep.date}</td>
                                <td className="p-3 font-bold text-gray-800 uppercase">{dep.driverName}</td>
                                <td className="p-3 font-mono text-gray-600">{dep.plateNumber}</td>
                                <td className="p-3 font-bold text-right text-teal-700">{Number(dep.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                  </div>
                )}
                
                {viewMode === 'MANUAL_MATCH' && (`;
content = content.replace(viewTarget, viewReplacement);

fs.writeFileSync('./components/BankReconciliation.tsx', content);
