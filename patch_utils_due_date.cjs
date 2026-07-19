const fs = require('fs');
let code = fs.readFileSync('./utils.ts', 'utf8');

const oldStr = "dueDate: invoiceDate.toISOString().split('T')[0],";
const newStr = "dueDate: `${invoiceDate.getFullYear()}-${String(invoiceDate.getMonth() + 1).padStart(2, '0')}-${String(invoiceDate.getDate()).padStart(2, '0')}`,";

if (code.includes(oldStr)) {
    code = code.replace(oldStr, newStr);
    fs.writeFileSync('./utils.ts', code);
    console.log("Patched dueDate in utils.ts");
} else {
    console.log("Could not find dueDate target in utils.ts");
}
