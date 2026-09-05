import test from 'node:test';
import assert from 'node:assert/strict';
import { extractGeminiStatement } from '../supabase/functions/reconcile-statement/gemini.ts';

const file = () => new File(['%PDF-1.7\ntest'], 'statement.pdf', { type: 'application/pdf' });
const response = (data: unknown) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }],
}));

test('Gemini keeps original model, prompt format and inline PDF using the existing server key', async () => {
  const result = await extractGeminiStatement(file(), { apiKey: 'existing-key', fetch: async (url, init) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'existing-key');
    assert.doesNotMatch(String(url), /existing-key/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.response_mime_type, 'application/json');
    assert.equal(body.contents[0].parts[1].inline_data.mime_type, 'application/pdf');
    assert.equal(atob(body.contents[0].parts[1].inline_data.data), '%PDF-1.7\ntest');
    return response({ summary: { ending_balance: 150 }, transactions: [{ amount: 50 }] });
  } });
  assert.deepEqual(result, { summary: { ending_balance: 150 }, transactions: [{ amount: 50 }] });
});

test('Gemini retains legacy array responses', async () => {
  assert.deepEqual(await extractGeminiStatement(file(), { apiKey: 'test', fetch: async () => response([{ amount: 50 }]) }),
    { summary: null, transactions: [{ amount: 50 }] });
});

test('missing Gemini key fails without making a network request', async () => {
  await assert.rejects(extractGeminiStatement(file(), { fetch: async () => { assert.fail('No request expected'); } }), /GEMINI_API_KEY/);
});

test('Gemini error response does not leak request data', async () => {
  await assert.rejects(extractGeminiStatement(file(), { apiKey: 'existing-key', fetch: async () =>
    new Response('private data existing-key', { status: 403 }) }), (error: Error) => {
      assert.match(error.message, /403/); assert.doesNotMatch(error.message, /private|existing-key/); return true;
    });
});
