-- Migration: Create fleet_snapshots table
-- Date: 2026-05-26

CREATE TABLE IF NOT EXISTS public.fleet_snapshots (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  snapshot_date date UNIQUE NOT NULL,
  good_count integer NOT NULL DEFAULT 0,
  mid_count integer NOT NULL DEFAULT 0,
  bad_count integer NOT NULL DEFAULT 0
);

ALTER TABLE public.fleet_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename = 'fleet_snapshots' AND policyname = 'Enable all access for fleet_snapshots') THEN
        CREATE POLICY "Enable all access for fleet_snapshots" ON public.fleet_snapshots FOR ALL USING (true) WITH CHECK (true);
    END IF;
END
$$;
