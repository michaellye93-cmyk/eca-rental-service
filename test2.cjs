const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const key = env.split('VITE_SUPABASE_ANON_KEY=')[1].split('\n')[0];
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://gsuvwamrgencwrhtzqyo.supabase.co', key, {auth: {persistSession: false}});

async function run() {
  const { data, error } = await supabase.from('drivers').select('name, car_plate').ilike('name', '%SUNTHAR%');
  console.log('Driver by name:', data, error);
}
run();
