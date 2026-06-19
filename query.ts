import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://gsuvwamrgencwrhtzqyo.supabase.co', 'REMOVED_PUBLIC_API_KEY');

async function check() {
  const { data, error } = await supabase.from('drivers').select('*').limit(1);
  console.log(data, error);
}
check();
