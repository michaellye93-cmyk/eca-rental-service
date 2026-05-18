import fs from 'fs';

const envObj = {};
fs.readFileSync('.env', 'utf-8').split('\n').filter(Boolean).forEach(line => {
  const [k, ...v] = line.split('=');
  envObj[k.trim()] = v.join('=').trim();
});

const key = envObj.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + key)
  .then(res => res.json())
  .then(data => {
    console.log(data.models.map(m => m.name));
  });
