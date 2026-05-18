const https = require('https');

https.request('https://gsuvwamrgencwrhtzqyo.supabase.co/functions/v1/reconcile-statement', { method: 'OPTIONS' }, (res) => {
  console.log('STATUS: ' + res.statusCode);
  console.log('HEADERS: ', res.headers);
  res.on('data', d => console.log(d.toString()));
}).end();
