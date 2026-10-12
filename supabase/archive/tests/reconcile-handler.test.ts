import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { extractStatement } from '../supabase/functions/reconcile-statement/openai.ts';

// Execute the actual Deno handler with only its runtime/remote service boundaries
// substituted. No network calls or production database operations are possible.
const source = readFileSync(new URL('../supabase/functions/reconcile-statement/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const summary = { beginning_balance: 100, total_deposits_amount: 50, total_deposits_count: 1,
  total_withdrawals_amount: 0, total_withdrawals_count: 0, ending_balance: 150 };
const deposit = { trans_date: '2026-09-01', display_date: '01-09-2026', branch_description: '',
  sender_name: 'TEST PAYER', reference_1: 'TEST123', reference_2: '', ref_num: '',
  amount_dr: null, amount_cr: 50, balance: 150, amount: 50, reference: 'TEST123' };
const drivers = [{ id: 'test-driver', name: 'TEST PAYER', car_plate: 'TEST123', is_delisted: false,
  paymentHistory: [{ id: 'test-payment', amount: 50, date: '2026-09-01', payment_method: 'BANK TRANSFER' }] }];

function handler(extract: typeof extractStatement, provider: string | undefined = 'openai', geminiExtract: any = async () => {
  assert.fail('Must not call Gemini when OpenAI is selected');
}) {
  let serve: (request: Request) => Promise<Response>;
  let reads = 0;
  const runtime = { env: { get: (key: string) => ({ AI_PROVIDER: provider === 'default' ? undefined : provider,
    GEMINI_API_KEY: 'existing-gemini-key', OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model',
    SUPABASE_URL: 'http://test.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only' }[key]) },
    serve: (callback: typeof serve) => { serve = callback; } };
  const createClient = () => ({ from: (table: string) => {
    assert.equal(table, 'drivers');
    return { select: async () => { reads++; return { data: structuredClone(drivers), error: null }; } };
  } });
  new Function('Deno', 'createClient', 'extractStatement', 'extractGeminiStatement', compiled)(runtime, createClient, extract, geminiExtract);
  return { request: (req: Request) => serve!(req), reads: () => reads };
}

test('PDF -> real OpenAI adapter -> original matching -> frontend response contract', async () => {
  const server = handler((file, options) => extractStatement(file, { ...options, fetch: async () => {
    assert.equal(options.apiKey, 'test-key');
    assert.equal(options.model, 'test-model');
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{
      type: 'output_text', text: JSON.stringify({ summary, transactions: [deposit] }),
    }] }] }));
  } }));
  const form = new FormData();
  form.append('file', new File(['%PDF-1.7\ntest'], 'statement.pdf', { type: 'application/pdf' }));
  const response = await server.request(new Request('http://test.invalid', { method: 'POST', body: form }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ['summary', 'paired_transactions', 'unpaired_transactions',
    'unsolved_system_transactions', 'all_transactions'].sort());
  assert.deepEqual(result.summary, summary);
  assert.equal(result.paired_transactions.length, 1);
  assert.equal(result.paired_transactions[0].driver_id, 'test-driver');
  assert.equal(result.paired_transactions[0].amount, 50);
  assert.equal(result.unpaired_transactions.length, 0);
  assert.equal(result.unsolved_system_transactions.length, 0);
  assert.equal(server.reads(), 1);
});

test('legacy JSON request keeps matching without calling OpenAI', async () => {
  const server = handler(async () => { assert.fail('JSON must not call OpenAI'); });
  const response = await server.request(new Request('http://test.invalid', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary, transactions: [deposit] }) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paired_transactions[0].driver_id, 'test-driver');
});

test('extraction failure stops before reading database and returns existing error format', async () => {
  const server = handler(async () => { throw new Error('OPENAI_API_KEY is missing'); });
  const form = new FormData(); form.append('file', new File(['test'], 'statement.pdf', { type: 'application/pdf' }));
  const response = await server.request(new Request('http://test.invalid', { method: 'POST', body: form }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /OPENAI_API_KEY/);
  assert.equal(server.reads(), 0);
});

test('CORS preflight does not call OpenAI or read the database', async () => {
  const server = handler(async () => { assert.fail('Preflight must not call OpenAI'); });
  const response = await server.request(new Request('http://test.invalid', { method: 'OPTIONS' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Access-Control-Allow-Methods')!, /POST/);
  assert.equal(server.reads(), 0);
});

test('default provider keeps Gemini and the existing Gemini key without calling OpenAI', async () => {
  const server = handler(async () => { assert.fail('Default must not call OpenAI'); }, 'default', async (_file: File, options: any) => {
    assert.equal(options.apiKey, 'existing-gemini-key');
    return { summary, transactions: [structuredClone(deposit)] };
  });
  const form = new FormData(); form.append('file', new File(['test'], 'statement.pdf', { type: 'application/pdf' }));
  const response = await server.request(new Request('http://test.invalid', { method: 'POST', body: form }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paired_transactions[0].driver_id, 'test-driver');
});

test('unknown provider fails instead of silently sending a statement to another provider', async () => {
  const server = handler(async () => { assert.fail('Must not extract'); }, 'typo');
  const form = new FormData(); form.append('file', new File(['test'], 'statement.pdf', { type: 'application/pdf' }));
  const response = await server.request(new Request('http://test.invalid', { method: 'POST', body: form }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /AI_PROVIDER/);
  assert.equal(server.reads(), 0);
});
