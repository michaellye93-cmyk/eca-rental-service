import type { Driver } from './types';
export type ReportPageReader = (table: 'drivers' | 'payments', from: number, to: number, driverIds?: string[]) => Promise<Record<string, unknown>[]>;

/** Callers supply a SELECT-only reader. No partial result escapes if any page fails. */
export async function loadTerminationDrivers(read: ReportPageReader): Promise<Driver[]> {
  const all = async (table: 'drivers' | 'payments', driverIds?: string[]) => {
    const records: Record<string, unknown>[] = [];
    const ids = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const page = await read(table, from, from + 999, driverIds);
      for (const row of page) {
        if (!row.id || ids.has(String(row.id))) throw new Error('Records changed during loading. Refresh the report.');
        ids.add(String(row.id));
        records.push(row);
      }
      if (page.length < 1000) return records;
    }
  };
  const accounts = (await all('drivers')).filter(d => d.is_delisted !== true);
  if (!accounts.length) return [];
  const ledger: Record<string, unknown>[] = [];
  // Bound URL size for larger fleets while preserving every active account's full history.
  for (let from = 0; from < accounts.length; from += 100) ledger.push(...await all('payments', accounts.slice(from, from + 100).map(d => String(d.id))));
  const grouped = new Map<string, Driver['paymentHistory']>();
  for (const p of ledger) {
    const id = String(p.driver_id);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push({ id: String(p.id), date: String(p.date), amount: Number(p.amount), serviceClaim: Number(p.service_claim ?? 0), paymentMethod: p.payment_method as Driver['paymentHistory'][number]['paymentMethod'] });
  }
  return accounts.map(d => {
    const paymentHistory = grouped.get(String(d.id)) || [];
    return { id: String(d.id), name: String(d.name ?? ''), nric: '', carPlate: String(d.car_plate ?? ''),
      contractStartDate: String(d.contract_start_date ?? ''), contractEndDate: d.contract_end_date ? String(d.contract_end_date) : undefined,
      contractDuration: Number(d.contract_duration_weeks), rentalRate: Number(d.rental_rate), rentalCycle: (d.rental_cycle || 'WEEKLY') as Driver['rentalCycle'],
      isDelisted: d.is_delisted === true, paymentHistory,
      totalAmountPaid: paymentHistory.reduce((sum, p) => sum + p.amount + (p.serviceClaim || 0), 0) };
  });
}
