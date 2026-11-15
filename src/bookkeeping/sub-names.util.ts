/** step2 (2026-11-15): "Walmart - Maintenance" — what a sub-name of a name is called. */
export const subNameOf = (parent: string, category: string): string =>
  `${parent} - ${category}`.slice(0, 191);
