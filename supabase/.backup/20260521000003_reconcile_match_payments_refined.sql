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

        -- 0. Match an ALREADY EXISTING payment by amount & date (with name fallback)
        SELECT d.id, d.car_plate
        INTO matched_driver
        FROM payments p
        JOIN drivers d ON p.driver_id = d.id
        WHERE p.amount = (current_tx->>'amount')::NUMERIC
          AND p.date = (current_tx->>'trans_date')::DATE
        ORDER BY
            CASE WHEN current_tx->>'sender_name' ILIKE '%' || d.name || '%' THEN 0 ELSE 1 END ASC
        LIMIT 1;

        -- 1. If not found in payments, Try to match by exact car plate
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

        -- 2. If STILL not found, Try to match by driver name
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

        -- 3. Check for matching Rental rate as absolute fallback if no text matches?
        -- Wait, if they just paid their rental rate amount perfectly but no name.
        IF matched_driver IS NULL THEN
            SELECT id, car_plate
            INTO matched_driver
            FROM drivers
            WHERE
                is_delisted = FALSE
                AND rental_rate = (current_tx->>'amount')::NUMERIC
                AND rental_rate > 0
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