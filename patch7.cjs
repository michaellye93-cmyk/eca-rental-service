const fs = require('fs');

let content = fs.readFileSync('components/AdminDashboard.tsx', 'utf-8');

const targetHeaderRegex = /<th className="px-6 py-4 border-b border-gray-200">Staff \/ Grouping<\/th>/g;
content = content.replace(targetHeaderRegex, "");

fs.writeFileSync('components/AdminDashboard.tsx', content);
console.log("Deleted header");
