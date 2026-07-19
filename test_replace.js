const fs = require('fs');
const code = fs.readFileSync('./components/AnalyticsView.tsx', 'utf8');
console.log(code.indexOf('Weekly Inflow Analysis'));
