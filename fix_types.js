import fs from 'fs';
let content = fs.readFileSync('./types.ts', 'utf8');
content = content.replace(
  "paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT';",
  "paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM';"
);
fs.writeFileSync('./types.ts', content);
