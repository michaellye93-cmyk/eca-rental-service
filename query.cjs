const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const key = env.split('VITE_SUPABASE_ANON_KEY=')[1].split('\n')[0];
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://gsuvwamrgencwrhtzqyo.supabase.co', key);
async function run() {
  const { data, error } = await supabase.from('drivers').select('*');
  console.log(data.filter(d => d.car_plate.includes('YY') || d.car_plate.includes('MALAYSIA')));
}
run();
