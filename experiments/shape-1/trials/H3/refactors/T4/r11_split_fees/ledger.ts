// A ledger of a fixed set of accounts. Balances are non-negative integers.
// Ledgers are immutable values. The fee schedule lives in fees.ts.

import { scheduleFee } from "./fees.ts";

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

/** The fee for moving `amount` from `from` to `to` (see fees.ts). */
export function feeFor(from: AccountId, to: AccountId, amount: number): number {
  return scheduleFee(from === to, amount);
}

function setBalance(ledger: Ledger, id: AccountId, value: number): Ledger {
  return { ...ledger, [id]: value };
}

// Adds delta to one account, reading the balance it updates.
function adjust(ledger: Ledger, id: AccountId, delta: number): Ledger {
  return setBalance(ledger, id, balance(ledger, id) + delta);
}

function rejected(ledger: Ledger): TransferResult {
  return { ok: false, ledger };
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
