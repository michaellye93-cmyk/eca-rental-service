const fs = require('fs');
let code = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

// 1. Remove 'CARS' from viewMode type definition
code = code.replace(/useState<'ACTIVE' \| 'DELISTED' \| 'CARS' \| 'DEBT_COLLECTION' \| 'ANALYTICS' \| 'RECONCILE' \| 'DRIVER_LIST'>/,
                    "useState<'ACTIVE' | 'DELISTED' | 'DEBT_COLLECTION' | 'ANALYTICS' | 'RECONCILE' | 'DRIVER_LIST'>");

// 2. Remove the Fleet Management tab button
const btnStart = `<button onClick={() => setViewMode('CARS')}`;
const btnEnd = `Fleet Management</button>`;
const btnStartIndex = code.indexOf(btnStart);
if (btnStartIndex !== -1) {
    const btnEndIndex = code.indexOf(btnEnd, btnStartIndex) + btnEnd.length;
    code = code.substring(0, btnStartIndex) + code.substring(btnEndIndex);
} else {
    console.log("Could not find Fleet Management button");
}

// 3. Remove the CARS view rendering block
const viewStartStr = `{viewMode === 'CARS' ? (
             /* --- CARS VIEW --- */`;
const viewStartIndex = code.indexOf(viewStartStr);

if (viewStartIndex !== -1) {
    // Find where the next view mode starts: `) : viewMode === 'ANALYTICS'`
    const nextViewStr = `          ) : viewMode === 'ANALYTICS'`;
    const nextViewIndex = code.indexOf(nextViewStr, viewStartIndex);
    
    if (nextViewIndex !== -1) {
        code = code.substring(0, viewStartIndex) + `{viewMode === 'ANALYTICS'` + code.substring(nextViewIndex + nextViewStr.length);
    } else {
        console.log("Could not find next view analytics");
    }
} else {
    console.log("Could not find CARS view rendering");
}

fs.writeFileSync('./components/AdminDashboard.tsx', code);
console.log("Done");
