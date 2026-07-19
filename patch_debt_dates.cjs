const fs = require('fs');
let code = fs.readFileSync('./components/DebtCollectionView.tsx', 'utf8');

// Replace `new Date()` (no args)
code = code.replace(/new Date\(\)/g, 'new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }))');

fs.writeFileSync('./components/DebtCollectionView.tsx', code);
console.log("Patched DebtCollectionView.tsx dates");
