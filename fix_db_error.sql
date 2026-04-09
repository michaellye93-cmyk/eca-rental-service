/*
  FIX FOR ERROR: 2BP01: cannot drop function cleanup_ghost_invoices() because other objects depend on it

  INSTRUCTIONS:
  1. Go to Supabase Dashboard > SQL Editor.
  2. Paste this code and run it.
  
  EXPLANATION:
  This script forcefully removes the broken triggers and functions that are causing errors when you update drivers.
  The 'CASCADE' keyword ensures that any dependent triggers (like 'tr_cleanup_ghost_invoices') are also removed.
*/

-- Drop the specific trigger causing the dependency error
DROP TRIGGER IF EXISTS tr_cleanup_ghost_invoices ON public.drivers;

-- Drop the other potential trigger
DROP TRIGGER IF EXISTS on_driver_update ON public.drivers;

-- Drop the function and cascade to any other dependencies
DROP FUNCTION IF EXISTS cleanup_ghost_invoices() CASCADE;
