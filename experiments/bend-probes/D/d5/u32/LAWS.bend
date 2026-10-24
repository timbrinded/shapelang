import Base
import ./main.bend as M

# LAW: add is commutative
law add_comm:
  for a: U32
  for b: U32
  {M.add(a, b) == M.add(b, a) : U32}

# LAW: adding zero changes nothing
law add_zero:
  for a: U32
  {M.add(a, 0) == a : U32}
