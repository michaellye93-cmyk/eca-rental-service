const fs = require('fs');
let code = fs.readFileSync('types.ts', 'utf8');
code = code.replace(
  /status: 'PAID' \| 'PARTIAL' \| 'UNPAID';/,
  "status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'CANCELLED' | 'FUTURE';"
);
fs.writeFileSync('types.ts', code);
console.log("Patched types.ts");
