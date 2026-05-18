const https = require('https');
const fs = require('fs');

const envObj = {};
fs.readFileSync('.env', 'utf-8').split('\n').filter(Boolean).forEach(line => {
  const [k, ...v] = line.split('=');
  envObj[k.trim()] = v.join('=').trim();
});

https.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${envObj.GEMINI_API_KEY}`, (res) => {
  let d = '';
  res.on('data', chunk => d+=chunk);
  res.on('end', () => console.log(JSON.parse(d).models.map(m => m.name)));
});
