const fs = require('fs');

const files = [
    './App.tsx',
    './components/AdminDashboard.tsx',
    './components/ExpandedDriverDetails.tsx',
    './utils.ts'
];

files.forEach(file => {
    let code = fs.readFileSync(file, 'utf8');
    // Replace `new Date()` (no args)
    // Be careful with `new Date().toISOString()` - if we use the KL date, `.toISOString()` will output UTC string of that KL date, which might not be what's intended, but actually, if we want the date part, it's better to use `.toLocaleDateString('en-CA')` (returns YYYY-MM-DD).
    
    // Let's first check where `new Date().toISOString()` is used.
    
    code = code.replace(/new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/g, 'new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" })');
    
    // Then replace any remaining new Date()
    code = code.replace(/new Date\(\)/g, 'new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }))');
    
    fs.writeFileSync(file, code);
    console.log(file + " patched");
});
