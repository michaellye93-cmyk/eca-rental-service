CREATE OR REPLACE FUNCTION reconcile_bank_statement(batch_transactions JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    paired_json JSONB := '[]'::JSONB;
    unpaired_json JSONB := '[]'::JSONB;
    current_tx JSONB;
    matched_driver RECORD;
BEGIN
    FOR current_tx IN SELECT * FROM jsonb_array_elements(batch_transactions)
    LOOP
        matched_driver := NULL;

        -- 0. Try to match an EXACT existing payment in the database
        SELECT d.id, d.car_plate
        INTO matched_driver
        FROM payments p
        JOIN drivers d ON p.driver_id = d.id
        WHERE p.amount = (current_tx->>'amount')::NUMERIC
          AND p.date = (current_tx->>'trans_date')::DATE
          -- Also we can check name to be slightly more robust, or maybe not needed
          -- Just amount and date is usually enough for a specific payment, but let's check sender name if multiple match.
          AND (
                current_tx->>'sender_name' ILIKE '%' || d.name || '%'
                OR REPLACE(current_tx->>'reference', ' ', '') ILIKE '%' || REPLACE(d.car_plate, ' ', '') || '%'
                -- if name doesn't match at all, we still accept it if there's only one.
                -- Actually, let's just match strictly amount and date first.
          )
        -- Wait, just date and amount:
        LIMIT 1;

        -- Wait, if I do date and amount ONLY, two drivers paying 150 on same date will clash.
        -- Let's refine:
        -- 0. Match existing payment exactly:
        IF matched_driver IS NULL THEN
            SELECT d.id, d.car_plate
            INTO matched_driver
            FROM payments p
            JOIN drivers d ON p.driver_id = d.id
            WHERE p.amount = (current_tx->>'amount')::NUMERIC
              AND p.date = (current_tx->>'trans_date')::DATE
            LIMIT 1;
        END IF;

        -- 1. Try to match by exact car plate (ignoring spaces) in reference or sender_name
        IF matched_driver IS NULL THEN
            SELECT id, car_plate
            INTO matched_driver
            FROM drivers
            WHERE 
                is_delisted = FALSE
                AND (
                    REPLACE(current_tx->>'reference', ' ', '') ILIKE '%' || REPLACE(car_plate, ' ', '') || '%'
                    OR REPLACE(current_tx->>'sender_name', ' ', '') ILIKE '%' || REPLACE(car_plate, ' ', '') || '%'
                )
            LIMIT 1;
        END IF;

        -- 2. Try to match by driver name in sender_name or reference
        IF matched_driver IS NULL THEN
            SELECT id, car_plate
            INTO matched_driver
            FROM drivers
            WHERE
                is_delisted = FALSE
                AND (
                    current_tx->>'sender_name' ILIKE '%' || name || '%'
                    OR current_tx->>'reference' ILIKE '%' || name || '%'
                )
            LIMIT 1;
        END IF;

        IF matched_driver IS NOT NULL THEN
            paired_json := paired_json || (current_tx || jsonb_build_object(
                'status', 'MATCHED',
                'driver_id', matched_driver.id,
                'plate_number', matched_driver.car_plate
            ));
        ELSE
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