const fs = require('fs');
let code = fs.readFileSync('./components/ExpandedDriverDetails.tsx', 'utf8');

code = code.replace(/new Date\(pt\.date\)/g, "new Date(pt.date + 'T00:00:00')");

fs.writeFileSync('./components/ExpandedDriverDetails.tsx', code);
console.log("Patched ExpandedDriverDetails.tsx dates");
