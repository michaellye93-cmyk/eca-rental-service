const fs = require('fs');
let code = fs.readFileSync('./utils.ts', 'utf8');

// Convert string dates to local time by appending T00:00:00
code = code.replace(/new Date\(driver\.contractStartDate\)/g, "new Date(driver.contractStartDate + 'T00:00:00')");
code = code.replace(/new Date\(driver\.contractEndDate\)/g, "new Date(driver.contractEndDate + 'T00:00:00')");
code = code.replace(/new Date\(driver\.delistDate\)/g, "new Date(driver.delistDate + 'T00:00:00')");
code = code.replace(/new Date\(p\.date\)/g, "new Date(p.date + 'T00:00:00')");
code = code.replace(/new Date\(recentPayments\[i\]\.date\)/g, "new Date(recentPayments[i].date + 'T00:00:00')");
code = code.replace(/new Date\(recentPayments\[i\+1\]\.date\)/g, "new Date(recentPayments[i+1].date + 'T00:00:00')");
code = code.replace(/new Date\(a\.date\)/g, "new Date(a.date + 'T00:00:00')");
code = code.replace(/new Date\(b\.date\)/g, "new Date(b.date + 'T00:00:00')");

fs.writeFileSync('./utils.ts', code);
console.log("Patched utils.ts dates");
