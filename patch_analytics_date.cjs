const fs = require('fs');
let code = fs.readFileSync('./components/AnalyticsView.tsx', 'utf8');

// replace `new Date()` with `new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }))`
code = code.replace(/new Date\(\)/g, 'new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }))');

fs.writeFileSync('./components/AnalyticsView.tsx', code);
console.log("Analytics patched");
