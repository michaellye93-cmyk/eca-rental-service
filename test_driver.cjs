const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function test() {
  const { data, error } = await supabase.from('drivers').select('*').ilike('name', '%NOOR HAZREEL%');
  console.log(JSON.stringify(data, null, 2));
  if (data && data.length > 0) {
    const { data: p } = await supabase.from('payments').select('*').eq('driver_id', data[0].id).order('date', {ascending: false});
    console.log(JSON.stringify(p, null, 2));
  }
}
test();
