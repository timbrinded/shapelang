# D2 (d) control NUM4: add_comm with its sides swapped. Equivalent: both directions
# are provable for every abstract add f.
import Base

def Old(-f: Nat -> Nat -> Nat) -> Type:
  @a: Nat -> @+b: Nat -> {f(a, b) == f(b, a) : Nat}

def New(-f: Nat -> Nat -> Nat) -> Type:
  @a: Nat -> @+b: Nat -> {f(b, a) == f(a, b) : Nat}

def old_new(-f: Nat -> Nat -> Nat, h: Old(f)) -> New(f):
  a => +b => Equal.sym(Nat, f(a, b), f(b, a), h(a, b))

def new_old(-f: Nat -> Nat -> Nat, h: New(f)) -> Old(f):
  a => +b => Equal.sym(Nat, f(b, a), f(a, b), h(a, b))
