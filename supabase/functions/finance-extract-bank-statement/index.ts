import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractBankStatementWithGemini } from './extract.ts';
import { handleBankExtraction } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL') ?? ''; const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
Deno.serve((request) => handleBankExtraction(request, { authenticate: async (request) => { const client = createClient(url, anon, { global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } } }); const { data } = await client.auth.getUser(); return data.user ? { id: data.user.id } : null; }, financeAccess: async () => { const client = createClient(url, anon, { global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } } }); const { data } = await client.rpc('finance_access'); return data === true; }, extract: (file) => extractBankStatementWithGemini(file, { apiKey: Deno.env.get('GEMINI_API_KEY'), model: Deno.env.get('GEMINI_MODEL') }) }));
