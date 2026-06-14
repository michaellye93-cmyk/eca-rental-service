CREATE OR REPLACE FUNCTION public.reconcile_bank_statement(batch_transactions JSONB)
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
    match_reason TEXT;
    normalized_ref TEXT;
    normalized_sender TEXT;
BEGIN
    SELECT MIN((tx->>'trans_date')::DATE), MAX((tx->>'trans_date')::DATE)
    INTO min_date, max_date
    FROM jsonb_array_elements(batch_transactions) AS tx;

    -- Handle empty transaction batch
    IF min_date IS NULL OR max_date IS NULL THEN
        RETURN jsonb_build_object(
            'paired_transactions', '[]'::JSONB,
            'unpaired_transactions', '[]'::JSONB,
            'unsolved_system_transactions', '[]'::JSONB
        );
    END IF;

    -- 1. Analyze system payments vs bank statement to find Unsolved (recorded in system but not in bank statement)
    FOR sys_pay IN 
        SELECT p.id, p.amount, p.date as trans_date, d.name as driver_name, d.car_plate as plate_number, COALESCE(p.payment_method, 'BANK TRANSFER') as p_method
        FROM public.payments p
        JOIN public.drivers d ON p.driver_id = d.id
        WHERE p.date >= (min_date - INTERVAL '3 days')::DATE AND p.date <= (max_date + INTERVAL '3 days')::DATE
    LOOP
        bank_found := FALSE;
        FOR current_tx IN SELECT * FROM jsonb_array_elements(batch_transactions)
        LOOP
            -- Check if bank amount equals system amount AND date is within +/- 2 days (robust to timezones/clearing delays)
            IF (current_tx->>'amount')::NUMERIC = sys_pay.amount 
               AND ABS(EXTRACT(epoch FROM (sys_pay.trans_date - (current_tx->>'trans_date')::DATE)) / 86400) <= 2 THEN
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
                'payment_method', sys_pay.p_method,
                'status', 'SYSTEM_UNSOLVED'
            );
        END IF;
    END LOOP;

    -- 2. Match each transaction in the bank statement to a driver record
    FOR current_tx IN SELECT * FROM jsonb_array_elements(batch_transactions)
    LOOP
        matched_driver := NULL;
        match_reason := '';

        -- Normalize transaction text for matching
        normalized_ref := UPPER(REPLACE(REPLACE(COALESCE(current_tx->>'reference', '') || ' ' || COALESCE(current_tx->>'reference_1', '') || ' ' || COALESCE(current_tx->>'reference_2', ''), ' ', ''), '-', ''));
        normalized_sender := UPPER(REPLACE(REPLACE(COALESCE(current_tx->>'sender_name', ''), ' ', ''), '-', ''));

        -- A. STRONGEST: Match by exact, spacing-insensitive car plate
        SELECT id, car_plate, name
        INTO matched_driver
        FROM public.drivers
        WHERE 
            LENGTH(REPLACE(REPLACE(car_plate, ' ', ''), '-', '')) > 2
            AND (
                normalized_ref ILIKE '%' || REPLACE(REPLACE(car_plate, ' ', ''), '-', '') || '%'
                OR normalized_sender ILIKE '%' || REPLACE(REPLACE(car_plate, ' ', ''), '-', '') || '%'
            )
        ORDER BY is_delisted ASC, LENGTH(car_plate) DESC
        LIMIT 1;

        IF matched_driver IS NOT NULL THEN
            match_reason := 'PLATE';
        END IF;

        -- B. HIGH: Bidirectional Name matching (checks if driver name is inside bank statement properties, OR vice-versa)
        IF matched_driver IS NULL THEN
            SELECT id, car_plate, name
            INTO matched_driver
            FROM public.drivers
            WHERE
                LENGTH(TRIM(name)) > 3
                AND (
                    (LENGTH(TRIM(COALESCE(current_tx->>'sender_name', ''))) > 3 AND (
                        UPPER(COALESCE(current_tx->>'sender_name', '')) ILIKE '%' || UPPER(TRIM(name)) || '%'
                        OR UPPER(TRIM(name)) ILIKE '%' || UPPER(COALESCE(current_tx->>'sender_name', '')) || '%'
                    ))
                    OR 
                    (LENGTH(TRIM(COALESCE(current_tx->>'reference', ''))) > 3 AND (
                        UPPER(COALESCE(current_tx->>'reference', '')) ILIKE '%' || UPPER(TRIM(name)) || '%'
                        OR UPPER(TRIM(name)) ILIKE '%' || UPPER(COALESCE(current_tx->>'reference', '')) || '%'
                    ))
                )
            ORDER BY is_delisted ASC, LENGTH(name) DESC
            LIMIT 1;

            IF matched_driver IS NOT NULL THEN
                match_reason := 'NAME';
            END IF;
        END IF;

        -- C. CASH DEPOSIT / CDM: Match specifically for cash deposits using date & exact amount from payments table
        IF matched_driver IS NULL AND 
           (
             UPPER(COALESCE(current_tx->>'sender_name', '')) ILIKE '%CASH DEPOSIT%' OR 
             UPPER(COALESCE(current_tx->>'reference', '')) ILIKE '%CASH DEPOSIT%' OR 
             UPPER(COALESCE(current_tx->>'sender_name', '')) ILIKE '%CDM%' OR
             UPPER(COALESCE(current_tx->>'reference', '')) ILIKE '%CDM%' OR
             UPPER(COALESCE(current_tx->>'reference_1', '')) ILIKE '%CDM%'
           )
        THEN
            SELECT d.id, d.car_plate, d.name
            INTO matched_driver
            FROM public.drivers d
            JOIN public.payments p ON p.driver_id = d.id
            WHERE p.payment_method = 'CASH DEPOSIT'
              AND p.amount = (current_tx->>'amount')::NUMERIC
              AND ABS(EXTRACT(epoch FROM (p.date - (current_tx->>'trans_date')::DATE)) / 86400) <= 3
            ORDER BY d.is_delisted ASC
            LIMIT 1;
            
            IF matched_driver IS NOT NULL THEN
                match_reason := 'CASH_DEPOSIT_MATCH';
            END IF;
        END IF;

        -- D. FALLBACK MATCH: Match using exact amount and date (+/- 3 days)
        -- Covers case where driver's name is truncated or extremely modified in transfer description
        IF matched_driver IS NULL THEN
            SELECT d.id, d.car_plate, d.name
            INTO matched_driver
            FROM public.drivers d
            JOIN public.payments p ON p.driver_id = d.id
            WHERE p.amount = (current_tx->>'amount')::NUMERIC
              AND ABS(EXTRACT(epoch FROM (p.date - (current_tx->>'trans_date')::DATE)) / 86400) <= 3
            ORDER BY d.is_delisted ASC
            LIMIT 1;

            IF matched_driver IS NOT NULL THEN
                match_reason := 'FALLBACK_AMOUNT_DATE';
            END IF;
        END IF;

        -- FINAL: Assign to paired or unpaired list
        IF matched_driver IS NOT NULL THEN
            paired_json := paired_json || (current_tx || jsonb_build_object(
                'status', 'MATCHED',
                'driver_id', matched_driver.id,
                'plate_number', matched_driver.car_plate,
                'matched_by', match_reason,
                'matched_driver_name', matched_driver.name
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
