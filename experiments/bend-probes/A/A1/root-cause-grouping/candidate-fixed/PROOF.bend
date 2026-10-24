# The base proofs of preserves_start / preserves_end, unchanged, plus
# proofs of the metric laws written against a normalizer that keeps
# both endpoints. The same file checks candidate-fixed (the control).

import Base
import ./main.bend as R
import ./LAWS.bend as Laws

def Laws.preserves_start(start, end):
  {==}

def Laws.preserves_end(start, end):
  {==}

# helper lemmas on Base's Nat, stated {simple == complex} so a rewrite
# replaces the complex side
def sub_add(s: Nat, k: Nat) -> {k == Nat.sub(Nat.add(s, k), s) : Nat}:
  match s:
    case 0n:
      match k:
        case 0n:
          {==}
        case 1n+q:
          {==}
    case 1n+p:
      sub_add(p, k)

def add_one(n: Nat) -> {Nat.add(n, 1n) == 1n+n : Nat}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      %add_one(p) : {1n+Nat.add(p, 1n) == 1n+_ : Nat}
      {==}

def ge_refl(n: Nat) -> {True{} == Nat.is_ge(n, n) : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      ge_refl(p)

def le_refl(n: Nat) -> {Nat.is_le(n, n) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

def le_add(s: Nat, k: Nat) -> {Nat.is_le(s, Nat.add(s, k)) == True{} : Bool}:
  match s:
    case 0n:
      match k:
        case 0n:
          {==}
        case 1n+q:
          {==}
    case 1n+p:
      le_add(p, k)

def ge_add(s: Nat, k: Nat) -> {True{} == Nat.is_ge(Nat.add(s, k), s) : Bool}:
  match s:
    case 0n:
      match k:
        case 0n:
          {==}
        case 1n+q:
          {==}
    case 1n+p:
      ge_add(p, k)

def ge_succ_add(s: Nat, k: Nat) -> {True{} == Nat.is_ge(1n+Nat.add(s, k), s) : Bool}:
  match s:
    case 0n:
      {==}
    case 1n+p:
      ge_succ_add(p, k)

def gt_succ(n: Nat) -> {Nat.is_le(1n+n, n) == False{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      gt_succ(p)

def Laws.size_inclusive(start, k):
  %sub_add(start, k) : {Nat.add(_, 1n) == 1n+k : Nat}
  add_one(k)

def Laws.includes_start(start, k):
  %ge_refl(start) : {Bool.and(_, Nat.is_le(start, Nat.add(start, k))) == True{} : Bool}
  le_add(start, k)

def Laws.includes_end(start, k):
  %ge_add(start, k) : {Bool.and(_, Nat.is_le(Nat.add(start, k), Nat.add(start, k))) == True{} : Bool}
  le_refl(Nat.add(start, k))

def Laws.excludes_after_end(start, k):
  %ge_succ_add(start, k) : {Bool.and(_, Nat.is_le(1n+Nat.add(start, k), Nat.add(start, k))) == False{} : Bool}
  gt_succ(Nat.add(start, k))
