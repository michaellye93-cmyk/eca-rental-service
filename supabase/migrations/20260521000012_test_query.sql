CREATE OR REPLACE FUNCTION test_get_drivers()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN (SELECT jsonb_agg(d) FROM public.drivers d);
END;
$$;
