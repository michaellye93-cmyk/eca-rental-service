import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBankExtraction } from '../supabase/functions/finance-extract-bank-statement/handler.ts';

const file = () => new File(['statement'], 'statement.pdf', { type: 'application/pdf' });
test('denies anonymous and staff requests before calling the provider', async () => {
  for (const user of [null, { id: 'staff' }]) { let extracted = false; const response = await handleBankExtraction(new Request('http://test', { method: 'POST', body: (() => { const form = new FormData(); form.append('file', file()); return form; })() }), { authenticate: async () => user, financeAccess: async () => false, extract: async () => { extracted = true; return { rows: [], total_debits: 0, total_credits: 0, control_totals_present: true }; } }); assert.equal(response.status, 403); assert.equal(extracted, false); }
});

test('preserves debit and credit rows only when authenticated finance access and controls agree', async () => {
  const response = await handleBankExtraction(new Request('http://test', { method: 'POST', body: (() => { const form = new FormData(); form.append('file', file()); return form; })() }), { authenticate: async () => ({ id: 'admin' }), financeAccess: async () => true, extract: async () => ({ rows: [{ source_row: 1, transaction_date: '2026-08-01', description: 'Debit', reference: null, debit: 10, credit: 0 }, { source_row: 2, transaction_date: '2026-08-02', description: 'Credit', reference: 'R', debit: 0, credit: 20 }], total_debits: 10, total_credits: 20, control_totals_present: true }) });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).rows.map((row: any) => [row.debit, row.credit]), [[10, 0], [0, 20]]);
});

test('rejects malformed extraction and mismatched control totals', async () => {
  const request = () => { const form = new FormData(); form.append('file', file()); return new Request('http://test', { method: 'POST', body: form }); };
  const auth = { authenticate: async () => ({ id: 'admin' }), financeAccess: async () => true };
  assert.equal((await handleBankExtraction(request(), { ...auth, extract: async () => ({ rows: [{ nope: true }], total_debits: 0, total_credits: 0, control_totals_present: true }) as any })).status, 400);
  assert.equal((await handleBankExtraction(request(), { ...auth, extract: async () => ({ rows: [{ source_row: 1, transaction_date: '2026-08-01', description: 'D', reference: null, debit: 1, credit: 0 }], total_debits: 2, total_credits: 0, control_totals_present: true }) })).status, 400);
});

test('rejects impossible dates and extraction without printed control totals', async () => {
  const request = () => { const form = new FormData(); form.append('file', file()); return new Request('http://test', { method: 'POST', body: form }); };
  const auth = { authenticate: async () => ({ id: 'admin' }), financeAccess: async () => true };
  assert.equal((await handleBankExtraction(request(), { ...auth, extract: async () => ({ rows: [{ source_row: 1, transaction_date: '2026-02-31', description: 'D', reference: null, debit: 1, credit: 0 }], total_debits: 1, total_credits: 0, control_totals_present: true }) })).status, 400);
  assert.equal((await handleBankExtraction(request(), { ...auth, extract: async () => ({ rows: [{ source_row: 1, transaction_date: '2026-08-01', description: 'D', reference: null, debit: 1, credit: 0 }], total_debits: 1, total_credits: 0, control_totals_present: false }) })).status, 400);
});

test('rejects duplicate source rows, empty statements and sub-cent extraction', async () => {
  const row = { source_row: 1, transaction_date: '2026-08-01', description: 'D', reference: null, debit: 1, credit: 0 };
  for (const rows of [[], [row, row], [{ ...row, source_row: 0 }], [{ ...row, debit: 1.001 }]]) {
    const form = new FormData(); form.append('file', file());
    const response = await handleBankExtraction(new Request('http://test', { method: 'POST', body: form }), {
      authenticate: async () => ({ id: 'admin' }), financeAccess: async () => true,
      extract: async () => ({ rows, total_debits: rows.reduce((sum, item) => sum + item.debit, 0), total_credits: 0, control_totals_present: true }),
    });
    assert.equal(response.status, 400);
  }
});

test('rejects unsupported methods before authentication or extraction', async () => {
  const unexpected = async (): Promise<never> => { throw new Error('Must not be called'); };
  const response = await handleBankExtraction(new Request('http://test'), { authenticate: unexpected, financeAccess: unexpected, extract: unexpected });
  assert.equal(response.status, 405);
});
