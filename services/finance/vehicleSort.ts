export type VehicleSortKey = 'contribution' | 'business';
export type VehicleSort = { key: VehicleSortKey; direction: 'asc' | 'desc' } | null;

// Contribution opens on the most profitable vehicles, Business opens A to Z; clicking the
// same header again flips it, and only one column is sorted at a time.
const firstDirection: Record<VehicleSortKey, 'asc' | 'desc'> = { contribution: 'desc', business: 'asc' };

export function nextVehicleSort(current: VehicleSort, key: VehicleSortKey): Exclude<VehicleSort, null> {
  if (current?.key !== key) return { key, direction: firstDirection[key] };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

export function sortVehicles<T extends { contribution: number; business_unit: string }>(rows: readonly T[], sort: VehicleSort): T[] {
  if (!sort) return [...rows];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      if (sort.key === 'business') {
        const business = left.row.business_unit.localeCompare(right.row.business_unit, 'en', { sensitivity: 'base' });
        if (business !== 0) return sign * business;
        // Within a business, the most profitable cars come first whichever way the businesses run.
        const contribution = right.row.contribution - left.row.contribution;
        if (contribution !== 0) return contribution;
      } else {
        const contribution = left.row.contribution - right.row.contribution;
        if (contribution !== 0) return sign * contribution;
      }
      return left.index - right.index;
    })
    .map(({ row }) => row);
}
