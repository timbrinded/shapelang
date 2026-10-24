# D2 (d) for NUM1: divmod_ok loses its remainder bound r < 1+m.
# divmod is abstracted as d; add and mul are the demo's own.
import Base
import ./old/main.bend as Num
import ./old/PROOF.bend as P

def Old(-d: Nat -> Nat -> (Nat & Nat)) -> Type:
  @+n: Nat -> @+m: Nat -> &q: Nat -> &r: Nat -> {(q, r) == d(n, 1n+m) : Nat & Nat} & {True{} == (r < 1n+m : Nat) : Bool} & {n == Num.add(r, Num.mul(q, 1n+m)) : Nat}

def New(-d: Nat -> Nat -> (Nat & Nat)) -> Type:
  @+n: Nat -> @+m: Nat -> &q: Nat -> &r: Nat -> {(q, r) == d(n, 1n+m) : Nat & Nat} & {n == Num.add(r, Num.mul(q, 1n+m)) : Nat}

def proj(-d: Nat -> Nat -> (Nat & Nat), -n: Nat, -m: Nat,
  w: &q: Nat -> &r: Nat -> {(q, r) == d(n, 1n+m) : Nat & Nat} & {True{} == (r < 1n+m : Nat) : Bool} & {n == Num.add(r, Num.mul(q, 1n+m)) : Nat})
  -> &q: Nat -> &r: Nat -> {(q, r) == d(n, 1n+m) : Nat & Nat} & {n == Num.add(r, Num.mul(q, 1n+m)) : Nat}:
  (q, r, dq, le, eq) = w
  (q, r, dq, eq)

# old -> new, for every d: provable
def old_new(-d: Nat -> Nat -> (Nat & Nat), h: Old(d)) -> New(d):
  +n => +m => proj(d, n, m, h(n, m))

# new -> old, for every d: refuted by d(n, k) = (0n, n)
def bad(n: Nat, k: Nat) -> (Nat & Nat):
  (0n, n)

def bad_new() -> New(n => k => bad(n, k)):
  +n => +m => (0n, n, {==}, P.add_zero(n))

def snd2(p: Nat & Nat) -> Nat:
  (a, b) = p
  b

def disc(n: Nat) -> Type:
  match n:
    case 0n:
      Unit
    case 1n+p:
      Empty

def bool_disc(b: Bool) -> Type:
  match b:
    case True{}:
      Unit
    case False{}:
      Empty

def clash(r: Nat, -q: Nat, dq: {(q, r) == (0n, 1n) : Nat & Nat}, le: {True{} == (r < 1n : Nat) : Bool}) -> Empty:
  match r:
    case 0n:
      %Equal.cong(Nat & Nat, Nat, p => snd2(p), (q, 0n), (0n, 1n), dq) : disc(_)
      Unit{}
    case 1n+p:
      match p:
        case 0n:
          %le : bool_disc(_)
          Unit{}
        case 1n+k:
          %le : bool_disc(_)
          Unit{}

def use(w: &q: Nat -> &r: Nat -> {(q, r) == (0n, 1n) : Nat & Nat} & {True{} == (r < 1n : Nat) : Bool} & {1n == Num.add(r, Num.mul(q, 1n)) : Nat}) -> Empty:
  (q, r, dq, le, eq) = w
  clash(r, q, dq, le)

def not_new_old(H: @-d: (Nat -> Nat -> (Nat & Nat)) -> New(d) -> Old(d)) -> Empty:
  use(H(n => k => bad(n, k), bad_new())(1n, 0n))
