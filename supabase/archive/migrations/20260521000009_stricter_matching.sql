CREATE OR REPLACE FUNCTION reconcile_bank_statement(batch_transactions JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    paired_json JSONB := '[]'::JSONB;
    unpaired_json JSONB := '[]'::JSONB;
    unsolved_system_json JSONB := '[]'::JSONB;
    current_tx JSONB;
    matched_driver RECORD;
    min_date DATE;
    max_date DATE;
    sys_pay RECORD;
    bank_found BOOLEAN;
BEGIN
    SELECT MIN((tx->>'trans_date')::DATE), MAX((tx->>'trans_date')::DATE)
    INTO min_date, max_date
    FROM jsonb_array_elements(batch_transactions) AS tx;

    FOR sys_pay IN 
        SELECT p.id, p.amount, p.date as trans_date, d.name as driver_name, d.car_plate as plate_number 
        FROM public.payments p
        JOIN public.drivers d ON p.driver_id = d.id
        WHERE p.date >= min_date AND p.date <= max_date
    LOOP
        bank_found := FALSE;
        FOR current_tx IN SELECT * FROM jsonb_array_elements(batch_transactions)
        LOOP
            IF (current_tx->>'amount')::NUMERIC = sys_pay.amount AND (current_tx->>'trans_date')::DATE = sys_pay.trans_date THEN
                bank_found := TRUE;
                EXIT;
            END IF;
        END LOOP;

        IF bank_found = FALSE THEN
            unsolved_system_json := unsolved_system_json || jsonb_build_object(
                'id', sys_pay.id,
                'amount', sys_pay.amount,
                'trans_date', sys_pay.trans_date,
                'driver_name', sys_pay.driver_name,
                'plate_number', sys_pay.plate_number,
                'status', 'SYSTEM_UNSOLVED'
            );
        END IF;
    END LOOP;

    FOR current_tx IN SELECT * FROM jsonb_array_elements(batch_transactions)
    LOOP
        matched_driver := NULL;

        -- 1. STRONGEST: Match by exact car plate in reference or sender_name (ignore spaces and dashes)
        SELECT id, car_plate
        INTO matched_driver
        FROM public.drivers
        WHERE 
            is_delisted = FALSE
            AND LENGTH(REPLACE(REPLACE(car_plate, ' ', ''), '-', '')) > 2
            AND (
                REPLACE(REPLACE(current_tx->>'reference', ' ', ''), '-', '') ILIKE '%' || REPLACE(REPLACE(car_plate, ' ', ''), '-', '') || '%'
                OR REPLACE(REPLACE(current_tx->>'sender_name', ' ', ''), '-', '') ILIKE '%' || REPLACE(REPLACE(car_plate, ' ', ''), '-', '') || '%'
                OR REPLACE(REPLACE(current_tx->>'reference_1', ' ', ''), '-', '') ILIKE '%' || REPLACE(REPLACE(car_plate, ' ', ''), '-', '') || '%'
                OR REPLACE(REPLACE(current_tx->>'reference_2', ' ', ''), '-', '') ILIKE '%' || REPLACE(REPLACE(car_plate, ' ', ''), '-', '') || '%'
            )
        ORDER BY LENGTH(car_plate) DESC
        LIMIT 1;

        -- 2. HIGH: Match by driver name in sender_name or reference
        IF matched_driver IS NULL THEN
            SELECT id, car_plate
            INTO matched_driver
            FROM public.drivers
            WHERE
                is_delisted = FALSE
                AND LENGTH(TRIM(name)) > 4
                AND (
                    (current_tx->>'sender_name') ILIKE '%' || TRIM(name) || '%'
                    OR (current_tx->>'reference') ILIKE '%' || TRIM(name) || '%'
                    OR TRIM(name) ILIKE '%' || (current_tx->>'sender_name') || '%'
                )
            ORDER BY LENGTH(name) DESC
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
        'unpaired_transactions', unpaired_json,
        'unsolved_system_transactions', unsolved_system_json
    );
END;
$$;
