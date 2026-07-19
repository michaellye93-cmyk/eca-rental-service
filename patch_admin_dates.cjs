const fs = require('fs');
let code = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

code = code.replace(/new Date\(formData\.contractStartDate\)/g, "new Date(formData.contractStartDate + 'T00:00:00')");
code = code.replace(/new Date\(formData\.contractEndDate\)/g, "new Date(formData.contractEndDate + 'T00:00:00')");
code = code.replace(/new Date\(dateStr\)/g, "new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'))");
code = code.replace(/new Date\(lastPayment\.date\)/g, "new Date(lastPayment.date + 'T00:00:00')");
code = code.replace(/new Date\(d\.contractStartDate\)/g, "new Date(d.contractStartDate + 'T00:00:00')");
code = code.replace(/new Date\(payment\.date\)/g, "new Date(payment.date + 'T00:00:00')");
code = code.replace(/new Date\(driver\.contractStartDate\)/g, "new Date(driver.contractStartDate + 'T00:00:00')");
code = code.replace(/new Date\(driver\.delistDate\)/g, "new Date(driver.delistDate + 'T00:00:00')");
code = code.replace(/new Date\(tx\.date\)/g, "new Date(tx.date + 'T00:00:00')");
code = code.replace(/new Date\(inv\.dueDate\)/g, "new Date(inv.dueDate + 'T00:00:00')");

fs.writeFileSync('./components/AdminDashboard.tsx', code);
console.log("Patched AdminDashboard.tsx dates");
