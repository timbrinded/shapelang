// Executable laws for fixtures/skills/review/root-cause-grouping, written from
// contract.md: "Range endpoints are inclusive. Normalization preserves both
// supplied endpoints."
export default function laws(fc, { normalizeRange, inclusiveSize, includesValue }) {
  const int = fc.integer({ min: -1_000_000, max: 1_000_000 });
  const ordered = fc
    .tuple(int, fc.integer({ min: 0, max: 64 }))
    .map(([start, length]) => [start, start + length]);
  return {
    "normalization preserves both supplied endpoints": fc.property(int, int, (start, end) => {
      const range = normalizeRange(start, end);
      return range.start === start && range.end === end;
    }),
    "both endpoints are included": fc.property(
      ordered,
      ([start, end]) => includesValue(start, end, start) && includesValue(start, end, end)
    ),
    "inclusiveSize counts exactly the included integers": fc.property(ordered, ([start, end]) => {
      let included = 0;
      for (let value = start - 2; value <= end + 2; value++) {
        if (includesValue(start, end, value)) included++;
      }
      return inclusiveSize(start, end) === included;
    }),
    "a one-point range has size 1": fc.property(int, (value) => inclusiveSize(value, value) === 1)
  };
}
