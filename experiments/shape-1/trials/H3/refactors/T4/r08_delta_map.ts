// A ledger of a fixed set of accounts. Balances are non-negative integers.
// Ledgers are immutable values: every operation returns a new ledger and
// never modifies its input.

export type AccountId = "alice" | "bob" | "carol" | "fee";

/** Every account, in a fixed order. */
export const ACCOUNTS: readonly AccountId[] = ["alice", "bob", "carol", "fee"];

/** The account that collects transfer fees. */
export const FEE_ACCOUNT: AccountId = "fee";

export interface Ledger {
  readonly alice: number;
  readonly bob: number;
  readonly carol: number;
  readonly fee: number;
}

export interface TransferResult {
  /** True when the transfer was applied. */
  readonly ok: boolean;
  /** The ledger after the transfer, or the input ledger when ok is false. */
  readonly ledger: Ledger;
}

/** The balance of one account. */
export function balance(ledger: Ledger, id: AccountId): number {
  return ledger[id];
}

/** The sum of every balance, the fee account included. */
export function total(ledger: Ledger): number {
  let sum = 0;
  for (const id of ACCOUNTS) {
    sum += balance(ledger, id);
  }
  return sum;
}

/** The fee: nothing for a self-transfer, otherwise max(1, floor(amount / 100)). */
export function feeFor(from: AccountId, to: AccountId, amount: number): number {
  if (from === to) {
    return 0;
  }
  return Math.max(1, Math.floor(amount / 100));
}

/** Applies per-account deltas; deltas for the same account add up. */
function applyDeltas(ledger: Ledger, deltas: readonly (readonly [AccountId, number])[]): Ledger {
  const sums: Record<AccountId, number> = { alice: 0, bob: 0, carol: 0, fee: 0 };
  for (const [id, d] of deltas) {
    sums[id] += d;
  }
  return {
    alice: ledger.alice + sums.alice,
    bob: ledger.bob + sums.bob,
    carol: ledger.carol + sums.carol,
    fee: ledger.fee + sums.fee,
  };
}

/**
 * Moves `amount` from `from` to `to`, charging `feeFor(from, to, amount)` to
 * the sender and crediting it to the fee account.
 */
export function transfer(
  ledger: Ledger,
  from: AccountId,
  to: AccountId,
  amount: number,
): TransferResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, ledger };
  }
  const fee = feeFor(from, to, amount);
  if (balance(ledger, from) < amount + fee) {
    return { ok: false, ledger };
  }
  if (from === to) {
    return { ok: true, ledger };
  }
  const next = applyDeltas(ledger, [
    [from, -(amount + fee)],
    [to, amount],
    [FEE_ACCOUNT, fee],
  ]);
  return { ok: true, ledger: next };
}
