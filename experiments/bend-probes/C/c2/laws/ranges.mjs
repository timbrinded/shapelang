// Laws for c2/modules/ranges.ts. Every technique checks the same laws through
// check(mod, input), where input is a list of {start, end} with U32 endpoints.
export const U32_MAX = 0xffff_ffff;

function covered(ranges, value) {
  return ranges.some((r) => Math.min(r.start, r.end) <= value && value <= Math.max(r.start, r.end));
}

// Returns null when every law holds, otherwise the name of a violated law.
export function check(mod, input) {
  const copy = input.map((r) => ({ start: r.start, end: r.end }));
  for (const r of input) {
    const n = mod.normalize(r);
    if (!(n.start <= n.end)) return "normalize orders endpoints";
    const a = [n.start, n.end].sort((x, y) => x - y);
    const b = [r.start, r.end].sort((x, y) => x - y);
    if (a[0] !== b[0] || a[1] !== b[1]) return "normalize preserves endpoints";
  }
  const out = mod.merge(input);
  if (!Array.isArray(out)) return "merge returns a list";
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (!(Number.isInteger(r.start) && Number.isInteger(r.end) && r.start <= r.end))
      return "merged ranges are normalized";
    if (i > 0 && !(out[i - 1].end + 1 < r.start))
      return "merged ranges are sorted, disjoint and non-adjacent";
  }
  // Coverage changes only at range boundaries, so probing every boundary of
  // input and output (and its neighbours) decides set equality exactly.
  const probes = new Set();
  for (const r of [...input, ...out]) {
    for (const v of [r.start - 1, r.start, r.start + 1, r.end - 1, r.end, r.end + 1]) probes.add(v);
  }
  for (const v of probes) {
    if (covered(out, v) !== covered(input, v)) return "merge preserves the covered set";
    if (mod.contains(out, v) !== covered(out, v)) return "contains agrees with inclusive coverage";
  }
  for (let i = 0; i < input.length; i++) {
    if (input[i].start !== copy[i].start || input[i].end !== copy[i].end)
      return "merge does not modify its input";
  }
  return null;
}

export function arbitrary(fc) {
  const u32 = fc.nat({ max: U32_MAX });
  return fc.array(fc.record({ start: u32, end: u32 }), { maxLength: 16 });
}

// Every list over `items` of length 0..maxLength, shortest first.
export function* listsOver(items, maxLength) {
  for (let length = 0; length <= maxLength; length++) {
    const index = Array.from({ length }, () => 0);
    while (true) {
      yield index.map((i) => items[i]);
      let k = length - 1;
      while (k >= 0 && index[k] === items.length - 1) index[k--] = 0;
      if (k < 0) break;
      index[k]++;
    }
  }
}

function rangesOver(values) {
  const out = [];
  for (const start of values) for (const end of values) out.push({ start, end });
  return out;
}

const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

// Small scope: endpoints 0..5, lists up to length 4.
export function* smallScope() {
  yield* listsOver(rangesOver(range(0, 5)), 4);
}

export const BOUNDARY = [
  0,
  1,
  9,
  10,
  11,
  99,
  100,
  2 ** 31 - 2,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 32 - 2,
  U32_MAX
];

// Large scope: endpoints 0..7 with lists up to length 4, then boundary values
// with lists up to length 3.
export function* largeScope() {
  yield* listsOver(rangesOver(range(0, 7)), 4);
  yield* listsOver(rangesOver(BOUNDARY), 3);
}

export function bigArbitrary(fc) {
  const u32 = fc.oneof(
    fc.nat({ max: U32_MAX }),
    fc.constantFrom(...BOUNDARY),
    fc.nat({ max: 200 })
  );
  return fc.array(fc.record({ start: u32, end: u32 }), { maxLength: 64 });
}
