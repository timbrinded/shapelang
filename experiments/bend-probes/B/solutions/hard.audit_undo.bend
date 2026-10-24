# An access-control service keeps an audit log of Grant and Revoke
# actions. The log is a rope: a leaf holds one action, a node holds two
# halves and caches the number of actions under them, so the count is
# O(1) and the halves replay in parallel. undo(log, k) drops the last k
# actions: the right half first, what is left of k off the left half.
# LAW: two undos are one undo of the summed count, and undo keeps the
# cached counts true.

import Base

type Act is Data:
  Grant{p: Nat}
  Revoke{p: Nat}

type Log is Data:
  Emp{}
  One{e: Act}
  Cat{n: Nat, l: Log, r: Log}

# the cached count of actions
def size(t: Log) -> Nat:
  match t:
    case Emp{}:
      0n
    case One{e}:
      1n
    case Cat{n, l, r}:
      n

# joins two logs; an empty half is dropped
def cat.go(+l: Log, +r: Log) -> Log:
  match r:
    case Emp{}:
      l
    case r:
      Cat{Nat.add(size(l), size(r)), l, r}

def cat(+l: Log, +r: Log) -> Log:
  match l:
    case Emp{}:
      r
    case l:
      cat.go(l, r)

# drops the last k actions
def undo(t: Log, +k: Nat) -> Log:
  match t:
    case Emp{}:
      Emp{}
    case One{e}:
      match k:
        case 0n:
          One{e}
        case 1n+p:
          Emp{}
    case Cat{n, l, +r}:
      cat(undo(l, Nat.sub(k, size(r))), undo(r, k))

# every node caches the count of its halves
def WF(t: Log) -> Type:
  match t:
    case Emp{}:
      Unit
    case One{e}:
      Unit
    case Cat{n, l, r}:
      {Nat.add(size(l), size(r)) == n : Nat} & WF(l) & WF(r)

# LAW: undoing b actions, then a more, is undoing a+b actions
law undo_undo:
  for +t: Log
  for +a: Nat
  for +b: Nat
  for w: WF(t)
  {undo(undo(t, b), a) == undo(t, Nat.add(a, b)) : Log}

# LAW: undo keeps the cached counts true
law undo_wf:
  for +t: Log
  for +k: Nat
  for w: WF(t)
  WF(undo(t, k))


# ---- lemmas ----

law l_add_zero:
  for +x: Nat
  {x == Nat.add(x, 0n) : Nat}

def l_add_zero(x):
  match x:
    case 0n:
      {==}
    case 1n+p:
      %l_add_zero(p) : {1n+p == 1n+_ : Nat}
      {==}

law l_add_succ:
  for +x: Nat
  for +y: Nat
  {1n+Nat.add(x, y) == Nat.add(x, 1n+y) : Nat}

def l_add_succ(x, y):
  match x:
    case 0n:
      {==}
    case 1n+p:
      %l_add_succ(p, y) : {2n+Nat.add(p, y) == 1n+_ : Nat}
      {==}

law l_sub_zero:
  for +x: Nat
  {x == Nat.sub(x, 0n) : Nat}

def l_sub_zero(x):
  match x:
    case 0n:
      {==}
    case 1n+p:
      {==}

# (a - (s - b)) + (b - s) == (a + b) - s
law l_arith:
  for +b: Nat
  for +s: Nat
  for +a: Nat
  {Nat.add(Nat.sub(a, Nat.sub(s, b)), Nat.sub(b, s)) == Nat.sub(Nat.add(a, b), s) : Nat}

def l_arith(b, s, a):
  match b s:
    case 0n 0n:
      match a:
        case 0n:
          {==}
        case 1n+p:
          {==}
    case 1n+bp 0n:
      match a:
        case 0n:
          {==}
        case 1n+p:
          {==}
    case 0n 1n+sp:
      %l_add_zero(Nat.sub(a, 1n+sp)) : {_ == Nat.sub(Nat.add(a, 0n), 1n+sp) : Nat}
      %l_add_zero(a) : {Nat.sub(a, 1n+sp) == Nat.sub(_, 1n+sp) : Nat}
      {==}
    case 1n+bp 1n+sp:
      %l_add_succ(a, bp) : {Nat.add(Nat.sub(a, Nat.sub(sp, bp)), Nat.sub(bp, sp)) == Nat.sub(_, 1n+sp) : Nat}
      %l_arith(bp, sp, a) : {Nat.add(Nat.sub(a, Nat.sub(sp, bp)), Nat.sub(bp, sp)) == _ : Nat}
      {==}

law l_cat_emp:
  for +x: Log
  {x == cat(x, Emp{}) : Log}

def l_cat_emp(x):
  match x:
    case Emp{}:
      {==}
    case One{e}:
      {==}
    case Cat{n, l, r}:
      {==}

law l_size_cat:
  for +l: Log
  for +r: Log
  {size(cat(l, r)) == Nat.add(size(l), size(r)) : Nat}

def l_size_cat(l, r):
  match l:
    case Emp{}:
      {==}
    case One{e}:
      match r:
        case Emp{}:
          {==}
        case One{f}:
          {==}
        case Cat{m, rl, rr}:
          {==}
    case Cat{n, ll, lr}:
      match r:
        case Emp{}:
          l_add_zero(n)
        case One{f}:
          {==}
        case Cat{m, rl, rr}:
          {==}

law l_cat_wf:
  for +l: Log
  for +r: Log
  for wl: WF(l)
  for wr: WF(r)
  WF(cat(l, r))

def l_cat_wf(l, r, wl, wr):
  match l:
    case Emp{}:
      wr
    case One{e}:
      match r:
        case Emp{}:
          wl
        case One{f}:
          ({==}, wl, wr)
        case Cat{m, rl, rr}:
          ({==}, wl, wr)
    case Cat{n, ll, lr}:
      match r:
        case Emp{}:
          wl
        case One{f}:
          ({==}, wl, wr)
        case Cat{m, rl, rr}:
          ({==}, wl, wr)

law l_undo_cat:
  for +l: Log
  for +r: Log
  for +k: Nat
  {undo(cat(l, r), k) == cat(undo(l, Nat.sub(k, size(r))), undo(r, k)) : Log}

def l_undo_cat(l, r, k):
  match l:
    case Emp{}:
      {==}
    case One{e}:
      match r:
        case Emp{}:
          %l_cat_emp(undo(One{e}, Nat.sub(k, 0n))) : {undo(One{e}, k) == _ : Log}
          %l_sub_zero(k) : {undo(One{e}, k) == undo(One{e}, _) : Log}
          {==}
        case One{f}:
          {==}
        case Cat{m, rl, rr}:
          {==}
    case Cat{n, ll, lr}:
      match r:
        case Emp{}:
          %l_cat_emp(undo(Cat{n, ll, lr}, Nat.sub(k, 0n))) : {undo(Cat{n, ll, lr}, k) == _ : Log}
          %l_sub_zero(k) : {undo(Cat{n, ll, lr}, k) == undo(Cat{n, ll, lr}, _) : Log}
          {==}
        case One{f}:
          {==}
        case Cat{m, rl, rr}:
          {==}

law l_size_undo:
  for +t: Log
  for +k: Nat
  for w: WF(t)
  {size(undo(t, k)) == Nat.sub(size(t), k) : Nat}

def l_size_undo(t, k, w):
  match t:
    case Emp{}:
      {==}
    case One{e}:
      match k:
        case 0n:
          {==}
        case 1n+p:
          {==}
    case Cat{n, l, r}:
      (eq, wl, wr) = w
      %eq : {size(cat(undo(l, Nat.sub(k, size(r))), undo(r, k))) == Nat.sub(_, k) : Nat}
      %l_arith(size(r), k, size(l)) : {size(cat(undo(l, Nat.sub(k, size(r))), undo(r, k))) == _ : Nat}
      %l_size_undo(r, k, wr) : {size(cat(undo(l, Nat.sub(k, size(r))), undo(r, k))) == Nat.add(Nat.sub(size(l), Nat.sub(k, size(r))), _) : Nat}
      %l_size_undo(l, Nat.sub(k, size(r)), wl) : {size(cat(undo(l, Nat.sub(k, size(r))), undo(r, k))) == Nat.add(_, size(undo(r, k))) : Nat}
      %l_size_cat(undo(l, Nat.sub(k, size(r))), undo(r, k)) : {size(cat(undo(l, Nat.sub(k, size(r))), undo(r, k))) == _ : Nat}
      {==}

law l_wf_dup.cat:
  for -n: Nat
  for +l: Log
  for +r: Log
  for eq: {Nat.add(size(l), size(r)) == n : Nat}
  for pl: WF(l) & WF(l)
  for pr: WF(r) & WF(r)
  WF(Cat{n, l, r}) & WF(Cat{n, l, r})

def l_wf_dup.cat(n, l, r, eq, pl, pr):
  (wl1, wl2) = pl
  (wr1, wr2) = pr
  %eq : ({Nat.add(size(l), size(r)) == _ : Nat} & WF(l) & WF(r)) & ({Nat.add(size(l), size(r)) == _ : Nat} & WF(l) & WF(r))
  (({==}, wl1, wr1), ({==}, wl2, wr2))

law l_wf_dup:
  for +t: Log
  for w: WF(t)
  WF(t) & WF(t)

def l_wf_dup(t, w):
  match t:
    case Emp{}:
      (Unit{}, Unit{})
    case One{e}:
      (Unit{}, Unit{})
    case Cat{n, l, r}:
      (eq, wl, wr) = w
      l_wf_dup.cat(n, l, r, eq, l_wf_dup(l, wl), l_wf_dup(r, wr))

law undo_undo.cat:
  for -n: Nat
  for +l: Log
  for +r: Log
  for +a: Nat
  for +b: Nat
  for ihl: {undo(undo(l, Nat.sub(b, size(r))), Nat.sub(a, Nat.sub(size(r), b))) == undo(l, Nat.add(Nat.sub(a, Nat.sub(size(r), b)), Nat.sub(b, size(r)))) : Log}
  for ihr: WF(r) -> {undo(undo(r, b), a) == undo(r, Nat.add(a, b)) : Log}
  for p: WF(r) & WF(r)
  {undo(undo(Cat{n, l, r}, b), a) == undo(Cat{n, l, r}, Nat.add(a, b)) : Log}

def undo_undo.cat(n, l, r, a, b, ihl, ihr, p):
  (wr1, wr2) = p
  %ihr(wr1) : {undo(undo(Cat{n, l, r}, b), a) == cat(undo(l, Nat.sub(Nat.add(a, b), size(r))), _) : Log}
  %l_arith(b, size(r), a) : {undo(undo(Cat{n, l, r}, b), a) == cat(undo(l, _), undo(undo(r, b), a)) : Log}
  %ihl : {undo(undo(Cat{n, l, r}, b), a) == cat(_, undo(undo(r, b), a)) : Log}
  %l_size_undo(r, b, wr2) : {undo(undo(Cat{n, l, r}, b), a) == cat(undo(undo(l, Nat.sub(b, size(r))), Nat.sub(a, _)), undo(undo(r, b), a)) : Log}
  %l_undo_cat(undo(l, Nat.sub(b, size(r))), undo(r, b), a) : {undo(undo(Cat{n, l, r}, b), a) == _ : Log}
  {==}

# ---- the laws ----

def undo_undo(t, a, b, w):
  match t:
    case Emp{}:
      {==}
    case One{e}:
      match a b:
        case 0n 0n:
          {==}
        case 0n 1n+q:
          {==}
        case 1n+p 0n:
          {==}
        case 1n+p 1n+q:
          {==}
    case Cat{n, l, r}:
      (eq, wl, wr0) = w
      undo_undo.cat(n, l, r, a, b, undo_undo(l, Nat.sub(a, Nat.sub(size(r), b)), Nat.sub(b, size(r)), wl), x => undo_undo(r, a, b, x), l_wf_dup(r, wr0))

def undo_wf(t, k, w):
  match t:
    case Emp{}:
      Unit{}
    case One{e}:
      match k:
        case 0n:
          Unit{}
        case 1n+p:
          Unit{}
    case Cat{n, l, r}:
      (eq, wl, wr) = w
      l_cat_wf(undo(l, Nat.sub(k, size(r))), undo(r, k), undo_wf(l, Nat.sub(k, size(r)), wl), undo_wf(r, k, wr))
