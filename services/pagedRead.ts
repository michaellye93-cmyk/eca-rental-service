// Reads every row of a table, 1,000 at a time (the most Supabase returns per request).
// Each page is also ordered by id: rows sharing the sort column (e.g. payments on the same date) otherwise
// come back in no fixed order, so one could appear on two pages and another on none.
interface PagedQuery {
  order(column: string, options?: { ascending?: boolean }): PagedQuery;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

export async function readAllRows<T>(select: () => PagedQuery, column: string, ascending: boolean, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await select().order(column, { ascending }).order('id').range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) return rows;
  }
}
