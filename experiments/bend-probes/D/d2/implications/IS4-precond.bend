# D2 (d) for IS4: sort_sorted gains the precondition Sorted(xs).
# The sort is abstracted as s; Sorted is the demo's own.
import Base
import ./old/main.bend as Sort

def Old(-s: List<&2, Nat> -> List<&2, Nat>) -> Type:
  @+xs: List<&2, Nat> -> Sort.Sorted(s(xs))

def New(-s: List<&2, Nat> -> List<&2, Nat>) -> Type:
  @+xs: List<&2, Nat> -> @h: Sort.Sorted(xs) -> Sort.Sorted(s(xs))

# old -> new, for every s: provable
def old_new(-s: List<&2, Nat> -> List<&2, Nat>, o: Old(s)) -> New(s):
  +xs => h => o(xs)

# new -> old, for every s: refuted by the identity, which keeps an unsorted list unsorted
def ident(xs: List<&2, Nat>) -> List<&2, Nat>:
  xs

def id_new() -> New(xs => ident(xs)):
  +xs => h => h

def unsorted(w: Sort.Sorted([1n, 0n])) -> Empty:
  (a, b) = w
  (c, d) = b
  match c:

def not_new_old(H: @-s: (List<&2, Nat> -> List<&2, Nat>) -> New(s) -> Old(s)) -> Empty:
  unsorted(H(xs => ident(xs), id_new())([1n, 0n]))
