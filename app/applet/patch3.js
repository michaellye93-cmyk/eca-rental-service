const fs = require('fs');
let content = fs.readFileSync('components/BankReconciliation.tsx', 'utf8');
content = content.replace('className={}>Bank Statement Audit', 'className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === \\'BANK_STATEMENT\\' ? \\'bg-blue-600 text-[#ffffff]\\' : \\'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50\\'}`}>Bank Statement Audit');
content = content.replace('className={}>Unsolved Transactions', 'className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${viewMode === \\'SYSTEM_UNSOLVED\\' ? \\'bg-amber-600 text-[#ffffff]\\' : \\'bg-[#ffffff] text-[#4b5563] border border-[#e5e7eb] hover:bg-gray-50\\'}`}>Unsolved Transactions');
fs.writeFileSync('components/BankReconciliation.tsx', content);
