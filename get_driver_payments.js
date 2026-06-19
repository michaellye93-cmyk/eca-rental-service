import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gsuvwamrgencwrhtzqyo.supabase.co',
  'REMOVED_PUBLIC_API_KEY'
);

async function run() {
  const { data: drivers, error } = await supabase.from('drivers').select('*');
  if (error) {
    console.error('Error fetching drivers:', error);
    return;
  }
  
  console.log('Fetched', drivers.length, 'drivers.');
  for (const driver of drivers) {
    if (driver.payment_history && driver.payment_history.length > 0) {
      console.log(`Driver: ${driver.name} (Plate: ${driver.car_plate})`);
      driver.payment_history.forEach(p => {
        console.log(`  Payment: Date: ${p.date || p.trans_date}, Amt: ${p.amount}, Method: ${p.paymentMethod || p.p_method || p.payment_method}`);
      });
    }
  }
}

run();
