const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const envObj = {};
fs.readFileSync('.env', 'utf-8').split('\n').filter(Boolean).forEach(line => {
  const [k, ...v] = line.split('=');
  envObj[k.trim()] = v.join('=').trim();
});

const boundary = '----WebKitFormBoundary' + crypto.randomBytes(8).toString('hex');

const postData = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\n`),
  Buffer.from('Hello world this is a test file'),
  Buffer.from(`\r\n--${boundary}--\r\n`)
]);

const options = {
  method: 'POST',
  host: 'gsuvwamrgencwrhtzqyo.supabase.co',
  path: '/functions/v1/reconcile-statement',
  headers: {
    'Authorization': 'Bearer ' + envObj.VITE_SUPABASE_ANON_KEY,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': postData.length
  }
};

const req = https.request(options, (res) => {
  console.log('STATUS: ' + res.statusCode);
  let d = '';
  res.on('data', chunk => d+=chunk);
  res.on('end', () => console.log(d));
});

req.on('error', e => console.error(e));
req.write(postData);
req.end();
