const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const key = env.split('VITE_SUPABASE_ANON_KEY=')[1].split('\n')[0];
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://gsuvwamrgencwrhtzqyo.supabase.co', key, {auth: {persistSession: false}});

async function run() {
  const batch = [{
    amount: 600,
    trans_date: "2026-03-01",
    sender_name: "EXAMPLE TEST DRIVER",
    reference: "/ TEST 100",
    reference_1: "/ TEST 100",
    reference_2: "/ TEST 100"
  }];
  const { data, error } = await supabase.rpc('reconcile_bank_statement', { batch_transactions: batch });
  console.log('RPC result:', JSON.stringify(data, null, 2), error);
}
run();
