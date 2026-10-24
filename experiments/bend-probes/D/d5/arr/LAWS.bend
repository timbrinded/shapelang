import Base
import ./main.bend as M

# LAW: writing a does not change what mark reads from b
law mark_reads_b:
  for a: Array<U32>
  for b: Array<U32>
  {M.second(M.mark(a, b)) == M.first(b) : U32}
