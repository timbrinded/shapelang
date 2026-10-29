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

function setBalance(ledger: Ledger, id: AccountId, value: number): Ledger {
  return { ...ledger, [id]: value };
}

// Adds delta to one account, reading the balance it updates.
function adjust(ledger: Ledger, id: AccountId, delta: number): Ledger {
  return setBalance(ledger, id, balance(ledger, id) + delta);
}

/**
 * Moves `amount` from `from` to `to`, charging `feeFor(from, to, amount)` to
 * the sender and crediting it to the fee account.
 */
export function transfer(
  ledger: Ledger,
  from: AccountId,
  to: AccountId,
  amount: number
): TransferResult {
  const valid = Number.isInteger(amount) && amount > 0;
  const fee = valid ? feeFor(from, to, amount) : 0;
  const cost = amount + fee;
  const covered = valid && balance(ledger, from) >= cost;
  if (!covered) {
    return { ok: false, ledger };
  }
  if (from === to) {
    return { ok: true, ledger };
  }
  const debited = adjust(ledger, from, -cost);
  const received = adjust(debited, to, amount);
  return { ok: true, ledger: adjust(received, FEE_ACCOUNT, fee) };
}
