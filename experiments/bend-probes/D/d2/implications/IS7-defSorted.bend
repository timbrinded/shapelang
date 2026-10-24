# D2 (d) for IS7: Sorted.from in main.bend becomes Unit while LAWS.bend is unchanged.
# The same law text over the old and the new Sorted, with the sort abstracted as s.
import Base
import ./old/main.bend as O
import ./new/main.bend as N

def Old(-s: List<&2, Nat> -> List<&2, Nat>) -> Type:
  @+xs: List<&2, Nat> -> O.Sorted(s(xs))

def New(-s: List<&2, Nat> -> List<&2, Nat>) -> Type:
  @+xs: List<&2, Nat> -> N.Sorted(s(xs))

# old -> new, for every s: provable (the new predicate is Unit)
def old_new(-s: List<&2, Nat> -> List<&2, Nat>, o: Old(s)) -> New(s):
  +xs => Unit{}

# new -> old, for every s: refuted by the identity
def ident(xs: List<&2, Nat>) -> List<&2, Nat>:
  xs

def id_new() -> New(xs => ident(xs)):
  +xs => Unit{}

def unsorted(w: O.Sorted([1n, 0n])) -> Empty:
  (a, b) = w
  (c, d) = b
  match c:

def not_new_old(H: @-s: (List<&2, Nat> -> List<&2, Nat>) -> New(s) -> Old(s)) -> Empty:
  unsorted(H(xs => ident(xs), id_new())([1n, 0n]))
