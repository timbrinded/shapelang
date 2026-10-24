# Port of fixtures/skills/review/root-cause-grouping/candidate/{range,metrics}.ts.
# TS `number` is ported as Nat: `end - 1` is Nat.sub (truncating at 0n).

import Base

type Range is Data:
  Range{start: Nat, end: Nat}

def range_start(r: Range) -> Nat:
  Range{s, e} = r
  s

def range_end(r: Range) -> Nat:
  Range{s, e} = r
  e

# range.ts: return { start, end: end - 1 };
def normalizeRange(start: Nat, end: Nat) -> Range:
  Range{start, Nat.sub(end, 1n)}

# metrics.ts: range.end - range.start + 1
# (Bend cannot destructure a computed value in place, so the body that
# reads `range` is its own def, as the guide prescribes)
def size_of(r: Range) -> Nat:
  Range{s, e} = r
  Nat.add(Nat.sub(e, s), 1n)

def inclusiveSize(start: Nat, end: Nat) -> Nat:
  size_of(normalizeRange(start, end))

# metrics.ts: value >= range.start && value <= range.end
def includes_in(r: Range, +value: Nat) -> Bool:
  Range{s, e} = r
  Nat.is_ge(value, s) && Nat.is_le(value, e)

def includesValue(start: Nat, end: Nat, +value: Nat) -> Bool:
  includes_in(normalizeRange(start, end), value)
