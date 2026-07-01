const fs = require('fs');
let s = fs.readFileSync('supabase_schema_update.sql', 'utf8');
s = s.replace('END$$;', `    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drivers' AND column_name = 'email') THEN
        ALTER TABLE public.drivers ADD COLUMN email text;
    END IF;
END$$;`);
fs.writeFileSync('supabase_schema_update.sql', s);
