# Port of fixtures/skills/review/root-cause-grouping/base/range.ts.
# TS `number` is ported as Nat (see REPORT.md for the U32 alternative).

import Base

type Range is Data:
  Range{start: Nat, end: Nat}

def range_start(r: Range) -> Nat:
  Range{s, e} = r
  s

def range_end(r: Range) -> Nat:
  Range{s, e} = r
  e

# export function normalizeRange(start, end) { return { start, end }; }
def normalizeRange(start: Nat, end: Nat) -> Range:
  Range{start, end}
