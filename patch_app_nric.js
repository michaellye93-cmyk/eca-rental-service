import fs from 'fs';
let code = fs.readFileSync('./App.tsx', 'utf8');

const target = `  const handleDriverLogin = (nric: string) => {
    const driver = drivers.find(d => d.nric === nric);`;

const replace = `  const handleDriverLogin = (nric: string) => {
    const cleanedLoginNric = nric.replace(/\\D/g, '');
    const driver = drivers.find(d => (d.nric || '').replace(/\\D/g, '') === cleanedLoginNric);`;

code = code.replace(target, replace);
fs.writeFileSync('./App.tsx', code);
