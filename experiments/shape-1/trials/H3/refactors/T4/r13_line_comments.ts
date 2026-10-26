// Ledger of four fixed accounts; balances are non-negative integers.
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

/**
 * The fee charged for moving `amount` from `from` to `to`: nothing for a
 * self-transfer, otherwise max(1, floor(amount / 100)).
 */
export function feeFor(from: AccountId, to: AccountId, amount: number): number {
  if (from === to) {
    return 0;
  }
  return Math.max(1, Math.floor(amount / 100));
}

function setBalance(ledger: Ledger, id: AccountId, value: number): Ledger {
  return { ...ledger, [id]: value };
}

// Adds delta to one account. It re-reads the balance it updates, so two
// updates of the same account (sender or receiver is the fee account) compose.
function adjust(ledger: Ledger, id: AccountId, delta: number): Ledger {
  return setBalance(ledger, id, balance(ledger, id) + delta);
}

function rejected(ledger: Ledger): TransferResult {
  return { ok: false, ledger };
}

/**
 * Moves `amount` from `from` to `to`, charging `feeFor(from, to, amount)` to
 * the sender and crediting it to the fee account.
 *
 * Fails, returning the input ledger unchanged, when the amount is not a
 * positive integer or when the sender's balance cannot cover the amount plus
 * the fee. A self-transfer that succeeds changes nothing.
 */
export function transfer(
  ledger: Ledger,
  from: AccountId,
  to: AccountId,
  amount: number,
): TransferResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    return rejected(ledger);
  }

  // the sender pays the fee on top of the amount
  const fee = feeFor(from, to, amount);
  if (balance(ledger, from) < amount + fee) {
    return rejected(ledger);
  }
  if (from === to) {
    return { ok: true, ledger };
  }

  // three independent adjustments, each reading the current balance
  let next = adjust(ledger, from, -(amount + fee));
  next = adjust(next, to, amount);
  next = adjust(next, FEE_ACCOUNT, fee);
  return { ok: true, ledger: next };
}
