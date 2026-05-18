const https = require('https');
const fs = require('fs');

const envObj = {};
fs.readFileSync('.env', 'utf-8').split('\n').filter(Boolean).forEach(line => {
  const [k, ...v] = line.split('=');
  envObj[k.trim()] = v.join('=').trim();
});

const req = https.request('https://gsuvwamrgencwrhtzqyo.supabase.co/functions/v1/reconcile-statement', { 
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + envObj.VITE_SUPABASE_ANON_KEY
  }
}, (res) => {
  console.log('STATUS: ' + res.statusCode);
  console.log('HEADERS: ', res.headers);
  let d = '';
  res.on('data', chunk => d+=chunk);
  res.on('end', () => console.log(d));
});

req.on('error', e => console.error(e));
req.end();
