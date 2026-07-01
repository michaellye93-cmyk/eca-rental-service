import fs from 'fs';
let s = fs.readFileSync('supabase_schema_update.sql', 'utf8');
console.log(s.substring(0, 1000));
