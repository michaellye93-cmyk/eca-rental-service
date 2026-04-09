import { createClient } from '@supabase/supabase-js';

// Your Supabase Project URL
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase Configuration Missing! Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
}

// Use placeholders only if missing to prevent crash during build, but requests will fail
const finalUrl = supabaseUrl || "https://placeholder-project.supabase.co";
const finalKey = supabaseKey || 'placeholder-key';

export const supabase = createClient(finalUrl, finalKey);
