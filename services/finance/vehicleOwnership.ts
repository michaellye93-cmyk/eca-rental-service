/**
 * Vehicle Master "Ownership type" is a fixed choice (Michael, 21 Oct 2026): Monthly Vehicle Costs splits the month's
 * total into Car Owner against the company types by this exact value (monthlyCostByOwnership), so free text would
 * leave a mistyped car outside both sides. Car Owner: the car belongs to someone else and ECA runs it. Company HP:
 * a company car still under hire purchase (its instalment comes from Vehicle loans). Company: a company car paid off
 * or bought cash.
 */
export const OWNERSHIP_TYPES = ['Car Owner', 'Company HP', 'Company'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** The dropdown choices: the fixed list, plus the car's saved value when it is not in the list, so an old record is not changed silently. */
export const ownershipChoices = (current: string): string[] =>
  current && !(OWNERSHIP_TYPES as readonly string[]).includes(current) ? [...OWNERSHIP_TYPES, current] : [...OWNERSHIP_TYPES];
