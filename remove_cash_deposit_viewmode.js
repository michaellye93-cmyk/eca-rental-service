import fs from 'fs';
let content = fs.readFileSync('./components/BankReconciliation.tsx', 'utf8');

// Remove viewMode value
content = content.replace(
  "useState<'BANK_STATEMENT' | 'SYSTEM_UNSOLVED' | 'MANUAL_MATCH' | 'CASH_DEPOSIT'>",
  "useState<'BANK_STATEMENT' | 'SYSTEM_UNSOLVED' | 'MANUAL_MATCH'>"
);

// Remove button
content = content.replace(
  /<button onClick=\{\(\) => setViewMode\('CASH_DEPOSIT'\)\}.+?<\/button>\n\s*/g,
  ""
);

// Remove block
const blockRegex = /\{viewMode === 'CASH_DEPOSIT' && \(\s*<div className="mt-4">[\s\S]*?<\/div>\s*\)\}\s*/g;
content = content.replace(blockRegex, "");

fs.writeFileSync('./components/BankReconciliation.tsx', content);
