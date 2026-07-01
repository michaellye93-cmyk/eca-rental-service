import fs from 'fs';
let s = fs.readFileSync('supabase_schema_update.sql', 'utf8');
console.log('Before match:', s.includes('END$$;'));
s = s.replace(/END\$\$;/, `    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drivers' AND column_name = 'email') THEN\n        ALTER TABLE public.drivers ADD COLUMN email text;\n    END IF;\nEND$$;`);
console.log('After match:', s.includes('email'));
fs.writeFileSync('supabase_schema_update.sql', s);
