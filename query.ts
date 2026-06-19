import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://gsuvwamrgencwrhtzqyo.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzdXZ3YW1yZ2VuY3dyaHR6cXlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMDIzNzgsImV4cCI6MjA4Mzg3ODM3OH0.fzQF0hD95IsZte8muAxuaj44yWD3lyxgSapGofIdem8');

async function check() {
  const { data, error } = await supabase.from('drivers').select('*').limit(1);
  console.log(data, error);
}
check();
