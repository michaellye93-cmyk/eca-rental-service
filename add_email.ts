import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

async function addEmail() {
  const { error } = await supabase.rpc('execute_sql', { 
      sql_query: "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS email text;"
  });
  console.log('Result rpc:', error);
}
addEmail();
