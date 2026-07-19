const fs = require('fs');
let code = fs.readFileSync('./components/AnalyticsView.tsx', 'utf8');
const oldMemoEnd = `return weeks;
  }, [drivers, inflowViewMode]);`;
console.log(code.indexOf(oldMemoEnd));
