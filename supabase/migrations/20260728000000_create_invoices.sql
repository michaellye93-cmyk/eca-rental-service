-- Drop view if invoices was previously created as a view
DROP VIEW IF EXISTS public.invoices CASCADE;

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.invoices (
    id TEXT PRIMARY KEY,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE,
    cycle_index INTEGER NOT NULL,
    due_date DATE NOT NULL,
    amount NUMERIC NOT NULL,
    amount_paid NUMERIC NOT NULL DEFAULT 0,
    remaining_balance NUMERIC NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PAID', 'PARTIAL', 'UNPAID', 'CANCELLED', 'FUTURE')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists before recreating
DROP POLICY IF EXISTS "Enable all access for all users" ON public.invoices;
CREATE POLICY "Enable all access for all users" ON public.invoices FOR ALL USING (true) WITH CHECK (true);
