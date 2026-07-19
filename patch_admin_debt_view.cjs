const fs = require('fs');
let code = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

// 1. Add back the tab button
const driverListTab = `<button onClick={() => setViewMode('DRIVER_LIST')}`;
const debtTabBtn = `<button onClick={() => setViewMode('DEBT_COLLECTION')} className={\`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap \${viewMode === 'DEBT_COLLECTION' ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}\`}><TrendingDown className="w-4 h-4" /> Collection</button>\n              `;

if (!code.includes("DEBT_COLLECTION')}") && code.includes(driverListTab)) {
    code = code.replace(driverListTab, debtTabBtn + driverListTab);
}

// 2. Add back the view rendering
const reconcileView = `          ) : viewMode === 'RECONCILE' && userRole === 'admin' ? (
             <div className="p-6 bg-gray-50/50">
               <BankReconciliation drivers={driverData.filter(d => !d.isDelisted)} />
             </div>`;
             
const debtView = `          ) : viewMode === 'DEBT_COLLECTION' && userRole === 'admin' ? (
             <div className="p-6 bg-gray-50/50">
               <DebtCollectionView drivers={driverData.filter(d => !d.isDelisted)} onLogPayment={(driver) => {
                 setLiveDriverForPayment(driver);
                 setIsPaymentModalOpen(true);
               }} />
             </div>`;

if (!code.includes("DebtCollectionView drivers") && code.includes(reconcileView)) {
    code = code.replace(reconcileView, debtView + '\n' + reconcileView);
}

fs.writeFileSync('./components/AdminDashboard.tsx', code);
console.log("Patched AdminDashboard to add DebtCollectionView back");
