# Machine-checked refutations: each law below is false for the candidate,
# so no PROOF.bend can ever fill it. Each def turns the universally
# quantified law into Empty by instantiating it at a counterexample.
# Not a gate file: `bend REFUTE.bend --check-only` must print ALL PROOFS CHECK.

import Base
import ./main.bend as R

# 0n for zero, Unit otherwise: rewriting a clash {1n == 0n} through it
# turns Empty into Unit
def disc(n: Nat) -> Type:
  match n:
    case 0n:
      Empty
    case 1n+p:
      Unit

def bdisc(b: Bool) -> Type:
  match b:
    case False{}:
      Empty
    case True{}:
      Unit

# preserves_end at start = 0n, end = 1n: range_end is 0n, not 1n
def refute_preserves_end(h: @start: Nat -> @end: Nat -> {R.range_end(R.normalizeRange(start, end)) == end : Nat}) -> Empty:
  e = Equal.sym(Nat, 0n, 1n, h(0n, 1n))
  %e : disc(_)
  Unit{}

# size_inclusive at start = 0n, k = 1n: inclusiveSize(0n, 1n) is 1n, not 2n
def refute_size_inclusive(h: @start: Nat -> @k: Nat -> {R.inclusiveSize(start, Nat.add(start, k)) == 1n+k : Nat}) -> Empty:
  e = Equal.sym(Nat, 1n, 2n, h(0n, 1n))
  %e : disc(Nat.sub(_, 1n))
  Unit{}

# includes_end at start = 0n, k = 1n: includesValue(0n, 1n, 1n) is False
def refute_includes_end(h: @start: Nat -> @k: Nat -> {R.includesValue(start, Nat.add(start, k), Nat.add(start, k)) == True{} : Bool}) -> Empty:
  e = Equal.sym(Bool, False{}, True{}, h(0n, 1n))
  %e : bdisc(_)
  Unit{}

# includes_start at start = 1n, k = 0n: includesValue(1n, 1n, 1n) is False
def refute_includes_start(h: @start: Nat -> @k: Nat -> {R.includesValue(start, Nat.add(start, k), start) == True{} : Bool}) -> Empty:
  e = Equal.sym(Bool, False{}, True{}, h(1n, 0n))
  %e : bdisc(_)
  Unit{}

# The one metric law the candidate still satisfies: excludes_after_end.
# Its base proof does not check against the candidate (PROOF.bend fails
# on it), but a new proof does: the original failure was proof
# brittleness, not a false law.
def gt2(n: Nat) -> {Nat.is_le(2n+n, n) == False{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      gt2(p)

def le_pred(n: Nat) -> {Nat.is_le(1n+n, Nat.sub(n, 1n)) == False{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      match p:
        case 0n:
          {==}
        case 1n+q:
          gt2(1n+q)

def ge_succ_add(s: Nat, k: Nat) -> {True{} == Nat.is_ge(1n+Nat.add(s, k), s) : Bool}:
  match s:
    case 0n:
      {==}
    case 1n+p:
      ge_succ_add(p, k)

def candidate_excludes_after_end(+start: Nat, +k: Nat) -> {R.includesValue(start, Nat.add(start, k), 1n+Nat.add(start, k)) == False{} : Bool}:
  %ge_succ_add(start, k) : {Bool.and(_, Nat.is_le(1n+Nat.add(start, k), Nat.sub(Nat.add(start, k), 1n))) == False{} : Bool}
  le_pred(Nat.add(start, k))
