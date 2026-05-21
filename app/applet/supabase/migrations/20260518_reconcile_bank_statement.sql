CREATE OR REPLACE FUNCTION reconcile_bank_statement(batch_transactions JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    transaction RECORD;
    matched_driver RECORD;
    paired_json JSONB := '[]'::JSONB;
    unpaired_json JSONB := '[]'::JSONB;
    used_driver_ids UUID[] := '{}'; -- Track matched drivers in this loop
    current_tx JSONB;
BEGIN
    FOR current_tx IN SELECT * FROM jsonb_array_elements(batch_transactions)
    LOOP
        -- Find a matching driver based on the exact amount
        -- 1. Match 'amount' to 'rental_rate'
        -- 2. Exclude already used drivers in this loop
        SELECT id, car_plate
        INTO matched_driver
        FROM drivers
        WHERE rental_rate = (current_tx->>'amount')::NUMERIC
          AND NOT id = ANY(used_driver_ids)
          AND is_delisted = FALSE
        ORDER BY contract_start_date ASC NULLS FIRST
        LIMIT 1;

        IF FOUND THEN
            -- Add to paired
            paired_json := paired_json || (current_tx || jsonb_build_object(
                'status', 'MATCHED',
                'driver_id', matched_driver.id,
                'plate_number', matched_driver.car_plate
            ));
            used_driver_ids := used_driver_ids || matched_driver.id;
        ELSE
            -- Add to unpaired
            unpaired_json := unpaired_json || (current_tx || jsonb_build_object(
                'status', 'UNMATCHED',
                'plate_number', 'UNKNOWN'
            ));
        END IF;

    END LOOP;

    RETURN jsonb_build_object(
        'paired_transactions', paired_json,
        'unpaired_transactions', unpaired_json
    );
END;
$$;
