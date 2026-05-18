const FormData = require('form-data');
const fs = require('fs');
const https = require('https');

const envObj = {};
fs.readFileSync('.env', 'utf-8').split('\n').filter(Boolean).forEach(line => {
  const [k, ...v] = line.split('=');
  envObj[k.trim()] = v.join('=').trim();
});

const form = new FormData();
form.append('file', fs.createReadStream('test.cjs'));

const options = {
  method: 'POST',
  host: 'gsuvwamrgencwrhtzqyo.supabase.co',
  path: '/functions/v1/reconcile-statement',
  headers: {
    'Authorization': 'Bearer ' + envObj.VITE_SUPABASE_ANON_KEY.replace('\r', ''),
    ...form.getHeaders()
  }
};

const req = https.request(options, (res) => {
  console.log('STATUS: ' + res.statusCode);
  console.log('HEADERS: ', res.headers);
  let d = '';
  res.on('data', chunk => d+=chunk);
  res.on('end', () => console.log(d));
});

form.pipe(req);
