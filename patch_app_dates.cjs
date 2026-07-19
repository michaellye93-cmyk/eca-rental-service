const fs = require('fs');
let code = fs.readFileSync('./App.tsx', 'utf8');

code = code.replace(/new Date\(b\.date\)/g, "new Date(b.date + 'T00:00:00')");
code = code.replace(/new Date\(a\.date\)/g, "new Date(a.date + 'T00:00:00')");

fs.writeFileSync('./App.tsx', code);
console.log("Patched App.tsx dates");
