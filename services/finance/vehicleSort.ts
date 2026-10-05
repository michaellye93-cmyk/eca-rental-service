export type ContributionSort = 'asc' | 'desc' | null;

// First click shows the most profitable vehicles; each later click flips the order.
export const nextContributionSort = (current: ContributionSort): Exclude<ContributionSort, null> =>
  current === 'desc' ? 'asc' : 'desc';

export function sortByContribution<T extends { contribution: number }>(rows: readonly T[], direction: ContributionSort): T[] {
  if (!direction) return [...rows];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const comparison = left.row.contribution - right.row.contribution;
      if (comparison !== 0) return direction === 'asc' ? comparison : -comparison;
      return left.index - right.index;
    })
    .map(({ row }) => row);
}
