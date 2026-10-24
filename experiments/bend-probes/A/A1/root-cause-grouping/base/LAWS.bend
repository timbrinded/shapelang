# Laws derived only from contract.md ("Range endpoints are inclusive.
# Normalization preserves both supplied endpoints.") and the Shape model
# (RangeNormalizer.normalizeRange).

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
