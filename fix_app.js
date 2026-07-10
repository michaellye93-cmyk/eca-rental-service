import fs from 'fs';
let content = fs.readFileSync('./App.tsx', 'utf8');
content = content.replace(
  "paymentMethod: 'BANK TRANSFER' | 'CASH DEPOSIT' = 'BANK TRANSFER'",
  "paymentMethod: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM' = 'BANK TRANSFER'"
);
content = content.replace(
  "paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT'",
  "paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM'"
);
fs.writeFileSync('./App.tsx', content);
