import type { ExtractedBankStatement } from './extract.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const validDate = (value: string) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  return Boolean(date && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value);
};
const validMoney = (value: number) => Number.isFinite(value) && value >= 0 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;

export async function handleBankExtraction(request: Request, deps: {
  authenticate: (request: Request) => Promise<{ id: string } | null>;
  financeAccess: (userId: string) => Promise<boolean>;
  extract: (file: File) => Promise<ExtractedBankStatement>;
}): Promise<Response> {
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return response({ error: 'POST required' }, 405);
  try {
    const user = await deps.authenticate(request);
    if (!user || !(await deps.financeAccess(user.id))) return response({ error: 'Admin access required' }, 403);
    const file = (await request.formData()).get('file');
    if (!(file instanceof File) || file.size === 0 || file.size > 15_000_000 || !/\.(pdf|png|jpe?g)$/i.test(file.name)) {
      throw new Error('Upload a PDF or image bank statement under 15 MB');
    }
    const result = await deps.extract(file);
    if (!Array.isArray(result.rows) || !result.rows.length || !validMoney(result.total_debits) || !validMoney(result.total_credits) || result.control_totals_present !== true) {
      throw new Error('Extraction requires transactions and printed statement control totals');
    }
    let debits = 0;
    let credits = 0;
    const sources = new Set<number>();
    const rows = result.rows.map((row) => {
      if (!row || !Number.isInteger(row.source_row) || row.source_row < 1 || sources.has(row.source_row) || !validDate(row.transaction_date) || typeof row.description !== 'string' || !row.description.trim() || !validMoney(row.debit) || !validMoney(row.credit) || (row.debit > 0 && row.credit > 0) || (row.debit === 0 && row.credit === 0)) {
        throw new Error('Malformed extraction row');
      }
      sources.add(row.source_row);
      debits += row.debit;
      credits += row.credit;
      return {
        source_row: row.source_row,
        transaction_date: row.transaction_date,
        description: row.description,
        reference: row.reference == null ? null : String(row.reference),
        debit: row.debit,
        credit: row.credit,
      };
    });
    if (Math.round(debits * 100) !== Math.round(result.total_debits * 100) || Math.round(credits * 100) !== Math.round(result.total_credits * 100)) {
      throw new Error('Extraction control totals do not match rows');
    }
    return response({ rows, total_debits: result.total_debits, total_credits: result.total_credits, control_totals_present: true });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Bank extraction failed' }, 400);
  }
}
