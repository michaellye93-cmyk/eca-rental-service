import fs from 'fs';
let content = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

const oldGood = '<span className="text-5xl font-black text-emerald-600 my-2 font-sans">{goodDriversCount}</span>';
const newGood = '<span className="text-5xl font-black text-emerald-600 mt-2 mb-0 font-sans">{activeFleetCount ? Math.round((goodDriversCount / activeFleetCount) * 100) : 0}%</span>\n                    <span className="text-sm font-bold text-gray-400 mb-2">{goodDriversCount} drivers</span>';
content = content.replace(oldGood, newGood);

const oldMid = '<span className="text-5xl font-black text-amber-500 my-2 font-sans">{midDriversCount}</span>';
const newMid = '<span className="text-5xl font-black text-amber-500 mt-2 mb-0 font-sans">{activeFleetCount ? Math.round((midDriversCount / activeFleetCount) * 100) : 0}%</span>\n                    <span className="text-sm font-bold text-gray-400 mb-2">{midDriversCount} drivers</span>';
content = content.replace(oldMid, newMid);

const oldBad = '<span className="text-5xl font-black text-rose-600 my-2 font-sans">{badDriversCount}</span>';
const newBad = '<span className="text-5xl font-black text-rose-600 mt-2 mb-0 font-sans">{activeFleetCount ? Math.round((badDriversCount / activeFleetCount) * 100) : 0}%</span>\n                    <span className="text-sm font-bold text-gray-400 mb-2">{badDriversCount} drivers</span>';
content = content.replace(oldBad, newBad);

fs.writeFileSync('./components/AdminDashboard.tsx', content);
