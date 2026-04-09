-- Create a view to simulate invoices based on driver contracts
-- This is required for external audit scripts that expect an 'invoices' table.

CREATE OR REPLACE VIEW public.invoices AS
SELECT
    d.id || '-' || generate_series AS id, -- Unique ID for the invoice
    d.id AS driver_id,
    d.rental_rate AS amount,
    CASE
        WHEN d.rental_cycle = 'MONTHLY' THEN d.contract_start_date + (generate_series * INTERVAL '1 month')
        ELSE d.contract_start_date + (generate_series * INTERVAL '1 week')
    END AS due_date,
    'unpaid' AS status, -- Default status, logic to determine paid/unpaid is complex in a view without joining payments
    d.created_at
FROM
    public.drivers d,
    generate_series(0, d.contract_duration_weeks - 1) AS generate_series;

-- Grant access to the view
GRANT SELECT ON public.invoices TO authenticated;
GRANT SELECT ON public.invoices TO service_role;
