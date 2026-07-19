const fs = require('fs');
let code = fs.readFileSync('./components/AnalyticsView.tsx', 'utf8');

const target1 = `const invoiceAmount = d.rentalCycle === 'MONTHLY' ? (d.rentalRate * 12 / 52) : d.rentalRate;`;
const replace1 = `const invoiceAmount = d.rentalRate;`;

code = code.replace(target1, replace1); // Assuming there's only one instance now since we removed the other block earlier

fs.writeFileSync('./components/AnalyticsView.tsx', code);
console.log("Done");
