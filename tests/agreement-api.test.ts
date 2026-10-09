import test from 'node:test';
import assert from 'node:assert/strict';
import { agreementApi } from '../services/agreements/api.ts';
import { defaultTemplate, emptyCompany } from '../services/agreements/template.ts';

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: { message: string } | null };

/** Stands in for supabase.from(...): records each call in the chain and answers with `result` once awaited. */
function fakeClient(result: Result) {
  const calls: Call[] = [];
  const builder: any = new Proxy({}, {
    get(_target, method: string) {
      if (method === 'then') return (resolve: (value: Result) => void) => resolve(result);
      return (...args: unknown[]) => { calls.push({ method, args }); return builder; };
    },
  });
  return { client: { from: (table: string) => { calls.push({ method: 'from', args: [table] }); return builder; } }, calls };
}

test('saved templates and company details are read; a type never saved uses the built-in draft', async () => {
  const saved = { title: 'Fixture Sewa Beli', sections: [{ id: 'a', title: 'Only', layout: 'clauses', body: 'Text' }] };
  const { client, calls } = fakeClient({ data: [{ key: 'template:SEWABELI', value: saved }, { key: 'company', value: { company_name: 'Fixture Co' } }], error: null });
  const settings = await agreementApi(client).load();
  assert.deepEqual(calls.slice(0, 2), [{ method: 'from', args: ['agreement_settings'] }, { method: 'select', args: ['key, value'] }]);
  assert.equal(settings.templates.SEWABELI.title, 'Fixture Sewa Beli');
  assert.equal(settings.templates.SEWA_BIASA.title, defaultTemplate('SEWA_BIASA').title);
  assert.deepEqual(settings.builtIn, { SEWA_BIASA: true, SEWABELI: false });
  assert.equal(settings.company.company_name, 'Fixture Co');
  assert.equal(settings.company.company_address, '');
});

test('a template is saved under its type and reset by removing it', async () => {
  const saved = fakeClient({ data: null, error: null });
  await agreementApi(saved.client).saveTemplate('SEWA_BIASA', defaultTemplate('SEWA_BIASA'));
  assert.equal(saved.calls[1].method, 'upsert');
  assert.equal((saved.calls[1].args[0] as { key: string }).key, 'template:SEWA_BIASA');
  const reset = fakeClient({ data: null, error: null });
  await agreementApi(reset.client).resetTemplate('SEWABELI');
  assert.deepEqual(reset.calls.map(c => c.method), ['from', 'delete', 'eq']);
  assert.deepEqual(reset.calls[2].args, ['key', 'template:SEWABELI']);
});

test('a refusal from the database is reported in its own words', async () => {
  const refused = fakeClient({ data: null, error: { message: 'new row violates row-level security policy' } });
  await assert.rejects(agreementApi(refused.client).saveCompany(emptyCompany()), /row-level security/);
});
