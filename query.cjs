const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase.from('payments').select('id, amount, date, created_at, driver_id');
  console.log("Total Payments:", data ? data.length : 0);
  if (data) {
     const p350 = data.filter(d => d.amount === 350);
     console.log("Payments of 350:", p350);
     const p200 = data.filter(d => d.amount === 200);
     console.log("Payments of 200:", p200);
     const p450 = data.filter(d => d.amount === 450);
     console.log("Payments of 450 near May 30:", p450.filter(d => d.date.includes('05-30') || d.date.includes('05-31')));
  }
}
check();
