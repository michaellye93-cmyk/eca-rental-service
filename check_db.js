import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gsuvwamrgencwrhtzqyo.supabase.co';
const supabaseKey = 'REMOVED_PUBLIC_API_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('drivers').select('*').limit(1);
  console.log(data);
  console.log(error);
}
check();
