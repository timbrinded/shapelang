# Laws derived only from contract.md ("Range endpoints are inclusive.
# Normalization preserves both supplied endpoints.") and the Shape model
# (RangeNormalizer.normalizeRange, RangeMetrics.inclusiveSize,
# RangeMetrics.includesValue). The first two are the base laws verbatim.
# A range [s, s + k] is written with its length offset k so that every
# law is unconditional. A parameter is + when a proof spends it twice.

import Base
import ./main.bend as R

# LAW: normalization preserves the supplied start endpoint
law preserves_start:
  for start: Nat
  for end: Nat
  {R.range_start(R.normalizeRange(start, end)) == start : Nat}

# LAW: normalization preserves the supplied end endpoint
law preserves_end:
  for start: Nat
  for end: Nat
  {R.range_end(R.normalizeRange(start, end)) == end : Nat}

# LAW: endpoints are inclusive, so [s, s + k] has k + 1 members
law size_inclusive:
  for +start: Nat
  for +k: Nat
  {R.inclusiveSize(start, Nat.add(start, k)) == 1n+k : Nat}

# LAW: endpoints are inclusive: the start is a member
law includes_start:
  for +start: Nat
  for +k: Nat
  {R.includesValue(start, Nat.add(start, k), start) == True{} : Bool}

# LAW: endpoints are inclusive: the end is a member
law includes_end:
  for +start: Nat
  for +k: Nat
  {R.includesValue(start, Nat.add(start, k), Nat.add(start, k)) == True{} : Bool}

# LAW: nothing past the end is a member
law excludes_after_end:
  for +start: Nat
  for +k: Nat
  {R.includesValue(start, Nat.add(start, k), 1n+Nat.add(start, k)) == False{} : Bool}
