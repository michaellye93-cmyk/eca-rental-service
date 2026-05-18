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
        -- 1. Match 'amount' to 'weekly_rate'
        -- 2. Prioritize oldest 'last_pay_date'
        -- 3. Exclude already used drivers in this loop
        SELECT id, car_plate, last_pay_date
        INTO matched_driver
        FROM drivers
        WHERE weekly_rate = (current_tx->>'amount')::NUMERIC
          AND NOT id = ANY(used_driver_ids)
          AND is_delisted = FALSE
        ORDER BY last_pay_date ASC NULLS FIRST
        LIMIT 1;

        IF FOUND THEN
            -- Add to paired
            paired_json := paired_json || jsonb_build_object(
                'status', 'MATCHED',
                'trans_date', current_tx->>'trans_date',
                'amount', current_tx->>'amount',
                'sender_name', current_tx->>'sender_name',
                'reference', current_tx->>'reference',
                'driver_id', matched_driver.id,
                'plate_number', matched_driver.car_plate
            );
            used_driver_ids := used_driver_ids || matched_driver.id;
        ELSE
            -- Add to unpaired
            unpaired_json := unpaired_json || jsonb_build_object(
                'status', 'UNMATCHED',
                'trans_date', current_tx->>'trans_date',
                'amount', current_tx->>'amount',
                'sender_name', current_tx->>'sender_name',
                'reference', current_tx->>'reference',
                'plate_number', 'UNKNOWN'
            );
        END IF;

    END LOOP;

    RETURN jsonb_build_object(
        'paired_transactions', paired_json,
        'unpaired_transactions', unpaired_json
    );
END;
$$;
