// The fee schedule: free between an account and itself, otherwise one per
// cent of the amount, rounded down, and never less than 1.

/** The fee for `amount` when sender and receiver are the same (`self`) or not. */
export function scheduleFee(self: boolean, amount: number): number {
  return self ? 0 : Math.max(1, Math.floor(amount / 100));
}
