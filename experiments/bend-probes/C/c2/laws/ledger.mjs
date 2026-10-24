// Laws for c2/modules/ledger.ts. Input: {balances, from, to, amount}; account 0
// is the fee account (the laws fix this independently of the module).
import { listsOver } from "./ranges.mjs";

export const U32_MAX = 0xffff_ffff;
const FEE = 0;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function check(mod, { balances, from, to, amount }) {
  const before = balances.slice();
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < before.length;
  const res = mod.transfer(balances, from, to, amount);
  if (!same(balances, before)) return "transfer does not modify its input";
  const after = res.balances;
  if (!Array.isArray(after) || after.length !== before.length)
    return "the account set is preserved";
  for (let i = 0; i < after.length; i++) {
    const b = after[i];
    if (!(Number.isInteger(b) && b >= 0 && b <= U32_MAX))
      return "balances stay within U32 (no negative balance)";
  }
  if (sum(after) !== sum(before)) return "total balance is conserved";
  if (res.ok !== true) {
    if (!same(after, before)) return "a rejected transfer changes nothing";
  } else {
    if (!valid(from) || !valid(to)) return "transfers naming an unknown account are rejected";
    for (let i = 0; i < after.length; i++) {
      if (i !== from && i !== to && i !== FEE && after[i] !== before[i])
        return "untouched accounts are unchanged";
    }
    if (to !== from && to !== FEE && after[to] !== before[to] + amount)
      return "the receiver gets exactly amount";
    if (from !== FEE && to !== FEE && amount > 0 && !(after[FEE] > before[FEE])) {
      return "a positive transfer credits a positive fee to the fee account";
    }
    if (from === to && from !== FEE && after[from] !== before[from] - (after[FEE] - before[FEE])) {
      return "a self-transfer costs exactly the fee";
    }
  }
  const ample = 2 * amount + 1;
  if (
    valid(from) &&
    valid(to) &&
    res.ok !== true &&
    before[from] >= ample &&
    before[to] + ample <= U32_MAX &&
    before[FEE] + ample <= U32_MAX
  ) {
    return "a transfer with ample funds and headroom succeeds";
  }
  return null;
}

export function arbitrary(fc) {
  const u32 = fc.nat({ max: U32_MAX });
  return fc.record({
    balances: fc.array(u32, { minLength: 1, maxLength: 8 }),
    from: fc.nat({ max: 9 }),
    to: fc.nat({ max: 9 }),
    amount: u32
  });
}

const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

function* cases(values, maxAccounts, indices, amounts) {
  for (const balances of listsOver(values, maxAccounts)) {
    if (balances.length === 0) continue;
    for (const from of indices)
      for (const to of indices)
        for (const amount of amounts) {
          yield { balances, from, to, amount };
        }
  }
}

// Small scope: balances, account indices and amounts in 0..5, up to 4 accounts.
export function* smallScope() {
  yield* cases(range(0, 5), 4, range(0, 5), range(0, 5));
}

export const BOUNDARY = [
  0,
  1,
  2,
  3,
  333,
  334,
  2 ** 31 - 2,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 32 - 3,
  2 ** 32 - 2,
  U32_MAX
];

export function* largeScope() {
  yield* cases(range(0, 9), 4, range(0, 4), range(0, 9));
  yield* cases(BOUNDARY, 3, range(0, 3), BOUNDARY);
}

export function bigArbitrary(fc) {
  const v = fc.oneof(fc.nat({ max: U32_MAX }), fc.constantFrom(...BOUNDARY), fc.nat({ max: 1000 }));
  return fc.record({
    balances: fc.array(v, { minLength: 1, maxLength: 12 }),
    from: fc.nat({ max: 12 }),
    to: fc.nat({ max: 12 }),
    amount: v
  });
}
