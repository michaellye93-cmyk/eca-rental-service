import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllRows } from '../services/pagedRead.ts';

type Row = { id: string; date: string };

// Mimics PostgREST over Postgres: rows are sorted by the requested columns, but rows that tie on every
// requested column come back in no fixed order, and that order can differ from one page request to the next.
function fakeTable(rows: Row[]) {
  let call = 0;
  return () => {
    const orders: { column: keyof Row; ascending: boolean }[] = [];
    const query = {
      order(column: string, options?: { ascending?: boolean }) {
        orders.push({ column: column as keyof Row, ascending: options?.ascending ?? true });
        return query;
      },
      range(from: number, to: number) {
        const salt = ++call;
        const scramble = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0) + salt * 7919) % 100003, salt);
        const sorted = [...rows].sort((a, b) => {
          for (const { column, ascending } of orders) {
            if (a[column] !== b[column]) return (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1);
          }
          return scramble(a.id) - scramble(b.id);
        });
        return Promise.resolve({ data: sorted.slice(from, to + 1), error: null });
      },
    };
    return query;
  };
}

test('reading a table in pages returns every row exactly once, even when many rows share the sort date', async () => {
  const rows: Row[] = Array.from({ length: 2500 }, (_, i) => ({ id: `p${String(i).padStart(4, '0')}`, date: `2026-06-0${(i % 3) + 1}` }));
  const read = await readAllRows<Row>(fakeTable(rows), 'date', false);
  assert.equal(read.length, rows.length);
  assert.deepEqual(new Set(read.map(r => r.id)), new Set(rows.map(r => r.id)));
  assert.deepEqual(read.map(r => r.date), [...rows.map(r => r.date)].sort().reverse());
});

test('reading stops after a short page and fails loudly on a database error', async () => {
  const rows: Row[] = [{ id: 'a', date: '2026-06-01' }, { id: 'b', date: '2026-06-02' }];
  assert.deepEqual((await readAllRows<Row>(fakeTable(rows), 'date', true)).map(r => r.id), ['a', 'b']);
  const failing = () => {
    const query = { order: () => query, range: () => Promise.resolve({ data: null, error: new Error('boom') }) };
    return query;
  };
  await assert.rejects(readAllRows(failing, 'date', false), /boom/);
});
