-- --- DATABASE REPAIR SCRIPT ---
-- INSTRUCTIONS:
-- 1. Go to your Supabase Dashboard > SQL Editor.
-- 2. Create a new query.
-- 3. Paste ALL content below, and click "Run" (bottom right).
-- This will ensure both fleet_snapshots and payment_method column exist,
-- and force Supabase to flush and reload its schema cache to fix the error.

-- 1. Create fleet_snapshots if it does not exist
CREATE TABLE IF NOT EXISTS public.fleet_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  snapshot_date date UNIQUE NOT NULL,
  good_count integer NOT NULL DEFAULT 0,
  mid_count integer NOT NULL DEFAULT 0,
  bad_count integer NOT NULL DEFAULT 0
);

-- 2. Add payment_method column to payments if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'payments' 
          AND column_name = 'payment_method'
    ) THEN
        ALTER TABLE public.payments ADD COLUMN payment_method text DEFAULT 'BANK TRANSFER';
    END IF;
END $$;

-- Ensure RLS is active on fleet_snapshots
ALTER TABLE public.fleet_snapshots ENABLE ROW LEVEL SECURITY;

-- Create policy for public access if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'fleet_snapshots' 
          AND policyname = 'Enable all access for fleet_snapshots'
    ) THEN
        CREATE POLICY "Enable all access for fleet_snapshots" ON public.fleet_snapshots FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 3. FORCE SUPABASE SCHEMA CACHE RELOAD CORES
NOTIFY pgrst, 'reload schema';
