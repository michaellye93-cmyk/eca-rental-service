import fs from 'fs';

const filePath = 'components/AdminDashboard.tsx';
let code = fs.readFileSync(filePath, 'utf8');
const lines = code.split(/\r?\n/);

console.log("Analyzing layout tags from 1730 to 2170:");
let depth = 0;
let tags : string[] = [];

for (let i = 1731; i < 2170; i++) {
    const line = lines[i];
    // Simple tag scanner for <div> <div ...> </div> <> </>
    // We can list line by line the matches
    const matches = line.match(/<div[^>]*>|<\/div>|<React\.Fragment[^>]*>|<\/React\.Fragment>|<Fragment[^>]*>|<\/Fragment>|<(?:\s*)>|<\/(\s*)>/g);
    if (matches) {
        console.log(`Line ${i + 1}: ${line.trim()}`);
        console.log(`       MATCHES: ${JSON.stringify(matches)}`);
    }
}
