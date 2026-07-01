import fs from 'fs';
let content = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');
const lines = content.split('\n');

// Verify what we are moving
const toMove = lines.slice(2099, 2321);
console.log("First line to move:", toMove[0]);
console.log("Last line to move:", toMove[toMove.length - 1]);

// Remove them
lines.splice(2099, 2321 - 2099);

const insertIndex = lines.findIndex(l => l.includes('{/* Arrears/Week/Collection Modals - unchanged */}'));
console.log("Insert index:", insertIndex);

lines.splice(insertIndex, 0, ...toMove);

fs.writeFileSync('./components/AdminDashboard.tsx', lines.join('\n'));
console.log("Done");
