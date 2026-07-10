import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gsuvwamrgencwrhtzqyo.supabase.co';
const supabaseKey = 'REMOVED_PUBLIC_API_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('drivers').update({ name: 'test' }).eq('id', 'bb2098aa-0d1f-4ab7-9ea2-727c346644af');
  console.log(error);
}
check();
 