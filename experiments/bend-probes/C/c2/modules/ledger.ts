// A U32 ledger. Account 0 is the fee account; every transfer moves `amount` to
// the receiver and a fee from the sender to the fee account.
export const U32_MAX = 0xffff_ffff;
export const FEE_ACCOUNT = 0;
export const FEE_BPS = 30;
export const MIN_FEE = 1;

export type TransferResult =
  | { ok: true; balances: number[] }
  | { ok: false; reason: string; balances: number[] };

export function feeFor(amount: number): number {
  if (amount === 0) {
    return 0;
  }
  return MIN_FEE + Math.floor((amount * FEE_BPS) / 10_000);
}

function isAccount(balances: readonly number[], account: number): boolean {
  return Number.isInteger(account) && account >= 0 && account < balances.length;
}

function reject(balances: readonly number[], reason: string): TransferResult {
  return { ok: false, reason, balances: balances.slice() };
}

function move(balances: number[], from: number, to: number, amount: number): void {
  balances[from] = balances[from]! - amount;
  balances[to] = balances[to]! + amount;
}

export function transfer(
  balances: readonly number[],
  from: number,
  to: number,
  amount: number
): TransferResult {
  if (!isAccount(balances, from) || !isAccount(balances, to)) {
    return reject(balances, "unknown account");
  }
  const fee = feeFor(amount);
  if (balances[from]! < amount + fee) {
    return reject(balances, "insufficient funds");
  }
  const next = balances.slice();
  move(next, from, to, amount);
  move(next, from, FEE_ACCOUNT, fee);
  if (next[to]! > U32_MAX || next[FEE_ACCOUNT]! > U32_MAX) {
    return reject(balances, "balance overflow");
  }
  return { ok: true, balances: next };
}
