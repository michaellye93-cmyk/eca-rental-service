const fs = require('fs');
let code = fs.readFileSync('./components/AnalyticsView.tsx', 'utf8');

// Replace local date constructs for contractStart, pDate, etc.
// 1. contractStart
code = code.replace(/const contractStart = new Date\(d\.contractStartDate \+ 'T00:00:00'\);/g, 
"const contractStart = new Date(d.contractStartDate + 'T00:00:00Z');");

// 2. effectiveEnd (d.contractEndDate + 'T23:59:59.999')
code = code.replace(/effectiveEnd = new Date\(d\.contractEndDate \+ 'T23:59:59\.999'\);/g, 
"effectiveEnd = new Date(d.contractEndDate + 'T23:59:59.999Z');");

// 3. effectiveEnd from contractStart
code = code.replace(/effectiveEnd\.setDate\(effectiveEnd\.getDate\(\) \+ durationDays\);/g, 
"effectiveEnd.setUTCDate(effectiveEnd.getUTCDate() + durationDays);");
code = code.replace(/effectiveEnd\.setHours\(23,59,59,999\);/g, 
"effectiveEnd.setUTCHours(23,59,59,999);");

// 4. delistDate
code = code.replace(/const delistDate = new Date\(d\.delistDate \+ 'T23:59:59\.999'\);/g, 
"const delistDate = new Date(d.delistDate + 'T23:59:59.999Z');");

// 5. invoiceDate
code = code.replace(/if \(d\.rentalCycle === 'MONTHLY'\) invoiceDate\.setMonth\(invoiceDate\.getMonth\(\) \+ 1\);/g, 
"if (d.rentalCycle === 'MONTHLY') invoiceDate.setUTCMonth(invoiceDate.getUTCMonth() + 1);");
code = code.replace(/else invoiceDate\.setDate\(invoiceDate\.getDate\(\) \+ 7\);/g, 
"else invoiceDate.setUTCDate(invoiceDate.getUTCDate() + 7);");

// 6. pDate
code = code.replace(/const pDate = new Date\(p\.date \+ 'T00:00:00'\);/g, 
"const pDate = new Date(p.date + 'T00:00:00Z');");

fs.writeFileSync('./components/AnalyticsView.tsx', code);
console.log("Patched UTC dates");
