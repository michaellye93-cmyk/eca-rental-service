const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://gsuvwamrgencwrhtzqyo.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('drivers').select('name, car_plate');
  console.log(data);
}
run();
