# D2 (d) for IS6: sort_perm weakened from count equality to count(x, sort xs) <= count(x, xs).
# The sort is abstracted as s; count is the demo's own (old/main.bend).
import Base
import ./old/main.bend as Sort
import ./old/LAWS.bend as L
import ./old/PROOF.bend as P

def PermEq(-s: List<&2, Nat> -> List<&2, Nat>) -> Type:
  @+x: Nat -> @+xs: List<&2, Nat> -> {Sort.count(x, s(xs)) == Sort.count(x, xs) : Nat}

def PermLe(-s: List<&2, Nat> -> List<&2, Nat>) -> Type:
  @+x: Nat -> @+xs: List<&2, Nat> -> {Nat.is_le(Sort.count(x, s(xs)), Sort.count(x, xs)) == True{} : Bool}

def le_refl(+n: Nat) -> {Nat.is_le(n, n) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

# old -> new, for every s: provable
def old_new(-s: List<&2, Nat> -> List<&2, Nat>, h: PermEq(s)) -> PermLe(s):
  +x => +xs =>
    %Equal.sym(Nat, Sort.count(x, s(xs)), Sort.count(x, xs), h(x, xs)) : {Nat.is_le(_, Sort.count(x, xs)) == True{} : Bool}
    le_refl(Sort.count(x, xs))

# new -> old, for every s: refuted by a sort that drops everything
def nil_sort(xs: List<&2, Nat>) -> List<&2, Nat>:
  Nil{}

def le_zero(n: Nat) -> {Nat.is_le(0n, n) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      {==}

def nil_new() -> PermLe(xs => nil_sort(xs)):
  +x => +xs => le_zero(Sort.count(x, xs))

def disc(n: Nat) -> Type:
  match n:
    case 0n:
      Unit
    case 1n+p:
      Empty

def not_new_old(H: @-s: (List<&2, Nat> -> List<&2, Nat>) -> PermLe(s) -> PermEq(s)) -> Empty:
  %H(xs => nil_sort(xs), nil_new())(0n, [0n]) : disc(_)
  Unit{}

# the same implication about the demo's own sort is provable, and says nothing:
# the old law is a theorem, so anything implies it
def concrete_new_old(h: PermLe(xs => Sort.sort(xs))) -> PermEq(xs => Sort.sort(xs)):
  +x => +xs => L.sort_perm(x, xs)
