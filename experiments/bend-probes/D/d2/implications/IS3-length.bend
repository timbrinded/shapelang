# D2 (d) for IS3: sort_sorted (sortedness) replaced by length preservation, sort_perm kept.
# The sort is abstracted as s. Only new -> old is attempted: the identity keeps both
# new laws (length and counts) and breaks sortedness. old -> new needs "equal counts
# imply equal length", which was not attempted within the effort bound.
import Base
import ./old/main.bend as Sort

def OldSet(-s: List<&2, Nat> -> List<&2, Nat>) -> Type:
  (@+xs: List<&2, Nat> -> Sort.Sorted(s(xs)))
  & (@+x: Nat -> @+xs: List<&2, Nat> -> {Sort.count(x, s(xs)) == Sort.count(x, xs) : Nat})

def NewSet(-s: List<&2, Nat> -> List<&2, Nat>) -> Type:
  (@+xs: List<&2, Nat> -> {List.length(&2, Nat, s(xs)) == List.length(&2, Nat, xs) : Nat})
  & (@+x: Nat -> @+xs: List<&2, Nat> -> {Sort.count(x, s(xs)) == Sort.count(x, xs) : Nat})

def ident(xs: List<&2, Nat>) -> List<&2, Nat>:
  xs

def id_new() -> NewSet(xs => ident(xs)):
  (+xs => {==}, +x => +xs => {==})

def unsorted(w: Sort.Sorted([1n, 0n])) -> Empty:
  (a, b) = w
  (c, d) = b
  match c:

def first(-s: List<&2, Nat> -> List<&2, Nat>, o: OldSet(s)) -> @+xs: List<&2, Nat> -> Sort.Sorted(s(xs)):
  (a, b) = o
  a

def not_new_old(H: @-s: (List<&2, Nat> -> List<&2, Nat>) -> NewSet(s) -> OldSet(s)) -> Empty:
  unsorted(first(xs => ident(xs), H(xs => ident(xs), id_new()))([1n, 0n]))
