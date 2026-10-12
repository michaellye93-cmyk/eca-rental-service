import test from 'node:test';
import assert from 'node:assert/strict';
import { extractStatement } from '../supabase/functions/reconcile-statement/openai.ts';

const statement = () => ({
  summary: { beginning_balance: 100, total_deposits_amount: 50, total_deposits_count: 1,
    total_withdrawals_amount: 0, total_withdrawals_count: 0, ending_balance: 150 },
  transactions: [{ trans_date: '2026-09-01', display_date: '01-09-2026', branch_description: '',
    sender_name: 'TEST PAYER', reference_1: 'TEST', reference_2: '', ref_num: '',
    amount_dr: null, amount_cr: 50, balance: 150, amount: 50, reference: 'TEST' }],
});
const pdf = () => new File(['%PDF-1.7\ntest'], 'statement.pdf', { type: 'application/pdf' });
const completed = (value = statement()) => new Response(JSON.stringify({ status: 'completed', output: [
  { type: 'reasoning', summary: [] },
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
] }));

test('PDF extraction uses the Responses API, server authorization and strict output schema', async () => {
  const result = await extractStatement(pdf(), { apiKey: 'test-secret', model: 'test-model', fetch: async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'test-model');
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    const file = body.input[0].content.find((part: any) => part.type === 'input_file');
    assert.match(file.file_data, /^data:application\/pdf;base64,/);
    assert.equal(file.filename, 'statement.pdf');
    assert.ok(init?.signal);
    return completed();
  } });
  assert.deepEqual(result, statement());
});

test('image extraction uses an input_image rather than PDF input', async () => {
  await extractStatement(new File(['image'], 'scan.png', { type: 'image/png' }), {
    apiKey: 'test-secret', fetch: async (_url, init) => {
      const content = JSON.parse(String(init?.body)).input[0].content;
      assert.equal(content[0].type, 'input_image');
      assert.match(content[0].image_url, /^data:image\/png;base64,/);
      return completed();
    },
  });
});

for (const [label, file, key, pattern] of [
  ['missing key', pdf(), '', /OPENAI_API_KEY/],
  ['empty file', new File([], 'empty.pdf', { type: 'application/pdf' }), 'test', /empty/i],
  ['oversized file', new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' }), 'test', /2MB/],
  ['unsupported file', new File(['hello'], 'code.html', { type: 'text/html' }), 'test', /PDF|supported/],
] as const) {
  test(`rejects ${label} before contacting OpenAI`, async () => {
    await assert.rejects(extractStatement(file, { apiKey: key, fetch: async () => {
      assert.fail('Must not contact OpenAI');
    } }), pattern);
  });
}

test('upstream errors do not disclose raw provider messages or secrets', async () => {
  await assert.rejects(extractStatement(pdf(), { apiKey: 'test-secret', fetch: async () =>
    new Response('private bank statement test-secret', { status: 429 }) }), (error: Error) => {
    assert.match(error.message, /429/);
    assert.doesNotMatch(error.message, /private|test-secret/);
    return true;
  });
});

for (const [label, response, pattern] of [
  ['incomplete output', { status: 'incomplete', output: [] }, /incomplete/i],
  ['refusal', { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private' }] }] }, /declined/i],
  ['missing text', { status: 'completed', output: [] }, /no statement/i],
  ['invalid JSON', { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }] }, /invalid/i],
] as const) {
  test(`rejects ${label}`, async () => {
    await assert.rejects(extractStatement(pdf(), { apiKey: 'test', fetch: async () =>
      new Response(JSON.stringify(response)) }), pattern);
  });
}

for (const [label, mutate] of [
  ['invalid date', (s: any) => { s.transactions[0].trans_date = '2026-02-30'; }],
  ['debit row', (s: any) => { s.transactions[0].amount_dr = 25; }],
  ['conflicting amount', (s: any) => { s.transactions[0].amount = 500; }],
  ['string money', (s: any) => { s.transactions[0].amount_cr = '50'; }],
  ['missing field', (s: any) => { delete s.transactions[0].sender_name; }],
] as const) {
  test(`rejects ${label} before reconciliation`, async () => {
    const value = statement(); mutate(value);
    await assert.rejects(extractStatement(pdf(), { apiKey: 'test', fetch: async () => completed(value) }), /invalid/i);
  });
}

test('empty deposits and missing summary values are valid, not fabricated', async () => {
  const value = { summary: Object.fromEntries(Object.keys(statement().summary).map(k => [k, null])), transactions: [] };
  assert.deepEqual(await extractStatement(pdf(), { apiKey: 'test', fetch: async () => completed(value as any) }), value);
});
