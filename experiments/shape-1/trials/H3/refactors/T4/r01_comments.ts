// Ledger over four fixed accounts with non-negative integer balances.
// Every function is pure: ledgers are values and are never modified.

export type AccountId = "alice" | "bob" | "carol" | "fee";

/** All accounts in a fixed order (the fee account last). */
export const ACCOUNTS: readonly AccountId[] = ["alice", "bob", "carol", "fee"];

/** Fees are credited here. */
export const FEE_ACCOUNT: AccountId = "fee";

export interface Ledger {
  readonly alice: number;
  readonly bob: number;
  readonly carol: number;
  readonly fee: number;
}

export interface TransferResult {
  /** Whether the transfer was applied. */
  readonly ok: boolean;
  /** The new ledger, or the unchanged input when the transfer failed. */
  readonly ledger: Ledger;
}

export function balance(ledger: Ledger, id: AccountId): number {
  return ledger[id];
}

/** Sum over all four accounts, fees included. */
export function total(ledger: Ledger): number {
  let sum = 0;
  for (const id of ACCOUNTS) {
    sum += balance(ledger, id);
  }
  return sum;
}

/** Free between an account and itself; otherwise 1% rounded down, at least 1. */
export function feeFor(from: AccountId, to: AccountId, amount: number): number {
  if (from === to) {
    return 0;
  }
  return Math.max(1, Math.floor(amount / 100));
}

function setBalance(ledger: Ledger, id: AccountId, value: number): Ledger {
  return { ...ledger, [id]: value };
}

// Re-reads the balance it updates, so updates to the same account compose.
function adjust(ledger: Ledger, id: AccountId, delta: number): Ledger {
  return setBalance(ledger, id, balance(ledger, id) + delta);
}

function rejected(ledger: Ledger): TransferResult {
  return { ok: false, ledger };
}

/** Sender pays amount + fee; receiver gains amount; the fee account gains fee. */
export function transfer(
  ledger: Ledger,
  from: AccountId,
  to: AccountId,
  amount: number,
): TransferResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    return rejected(ledger);
  }

  const fee = feeFor(from, to, amount);
  if (balance(ledger, from) < amount + fee) {
    return rejected(ledger);
  }
  if (from === to) {
    return { ok: true, ledger };
  }

  let next = adjust(ledger, from, -(amount + fee));
  next = adjust(next, to, amount);
  next = adjust(next, FEE_ACCOUNT, fee);
  return { ok: true, ledger: next };
}
