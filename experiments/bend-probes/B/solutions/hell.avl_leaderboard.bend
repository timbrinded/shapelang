# A high-score board keeps its scores in an AVL tree: a binary search
# tree whose insert rotates a node when one side grows two levels
# taller than the other. Scores may repeat; build folds a list of
# scores into a tree and to_list reads them back in order. LAWS: insert
# keeps the search order and adds exactly one score, so build yields an
# ordered tree with the same scores, multiplicities and size as its
# list, and to_list of an ordered tree is sorted and keeps every count.

import Base

type Tree is Data:
  Leaf{}
  Node{l: Tree, k: Nat, r: Tree}

def max(a: Nat, b: Nat) -> Nat:
  match a b:
    case 0n b:
      b
    case 1n+a 0n:
      1n+a
    case 1n+a 1n+b:
      1n+max(a, b)

def height(t: Tree) -> Nat:
  match t:
    case Leaf{}:
      0n
    case Node{l, k, r}:
      1n+max(height(l), height(r))

# LE(a, b): a <= b, as a type: Unit when it holds, Empty when it fails
def LE(a: Nat, b: Nat) -> Data:
  match a b:
    case 0n b:
      Unit
    case 1n+a 0n:
      Empty
    case 1n+a 1n+b:
      LE(a, b)

# the verdict of a comparison, with its evidence
def le_case(x: Nat, k: Nat) -> Or(LE(x, k), LE(k, x)):
  match x k:
    case 0n b:
      Inl{Unit{}}
    case 1n+a 0n:
      Inr{Unit{}}
    case 1n+a 1n+b:
      le_case(a, b)

# the left child becomes the root
def rot_r(l: Tree, k: Nat, r: Tree) -> Tree:
  match l:
    case Leaf{}:
      Node{Leaf{}, k, r}
    case Node{ll, lk, lr}:
      Node{ll, lk, Node{lr, k, r}}

# the right child becomes the root
def rot_l(l: Tree, k: Nat, r: Tree) -> Tree:
  match r:
    case Leaf{}:
      Node{l, k, Leaf{}}
    case Node{rl, rk, rr}:
      Node{Node{l, k, rl}, rk, rr}

# the left child is two levels taller; c compares its own two sides,
# and a taller inner side is rotated out first
def fix_l(ll: Tree, lk: Nat, lr: Tree, k: Nat, r: Tree, c: Cmp) -> Tree:
  match c:
    case LT{}:
      rot_r(rot_l(ll, lk, lr), k, r)
    case c:
      rot_r(Node{ll, lk, lr}, k, r)

def fix_r(l: Tree, k: Nat, rl: Tree, rk: Nat, rr: Tree, c: Cmp) -> Tree:
  match c:
    case GT{}:
      rot_l(l, k, rot_r(rl, rk, rr))
    case c:
      rot_l(l, k, Node{rl, rk, rr})

# c compares height(l) with 1n+height(r): GT means l is two levels taller
def bal_l(l: Tree, k: Nat, r: Tree, c: Cmp) -> Tree:
  match l c:
    case Node{+ll, lk, +lr} GT{}:
      fix_l(ll, lk, lr, k, r, Nat.cmp(height(ll), height(lr)))
    case l c:
      Node{l, k, r}

def bal_r(l: Tree, k: Nat, r: Tree, c: Cmp) -> Tree:
  match r c:
    case Node{+rl, rk, +rr} GT{}:
      fix_r(l, k, rl, rk, rr, Nat.cmp(height(rl), height(rr)))
    case r c:
      Node{l, k, r}

# x goes left when x <= k, else right; il and ir insert it there
def ins.go(-x: Nat, +l: Tree, k: Nat, +r: Tree, c: Or(LE(x, k), LE(k, x)), il: Unit -> Tree, ir: Unit -> Tree) -> Tree:
  match c:
    case Inl{e}:
      +l2 = il(Unit{})
      bal_l(l2, k, r, Nat.cmp(height(l2), 1n+height(r)))
    case Inr{e}:
      +r2 = ir(Unit{})
      bal_r(l, k, r2, Nat.cmp(height(r2), 1n+height(l)))

def insert(+x: Nat, +t: Tree) -> Tree:
  match t:
    case Leaf{}:
      Node{Leaf{}, x, Leaf{}}
    case Node{+l, +k, +r}:
      ins.go(x, l, k, r, le_case(x, k), u => insert(x, l), u => insert(x, r))

def build(xs: List<&2, Nat>) -> Tree:
  match xs:
    case Nil{}:
      Leaf{}
    case h <> t:
      insert(h, build(t))

# Bst(lo, hi, t): every score of t lies in lo..hi and the tree is ordered
def Bst(lo: Nat, hi: Nat, t: Tree) -> Type:
  match t:
    case Leaf{}:
      Unit
    case Node{l, k, r}:
      (LE(lo, k) & LE(k, hi) & Bst(lo, k, l) & Bst(k, hi, r))

# every score of the list is at most top
def InRange(top: Nat, xs: List<&2, Nat>) -> Type:
  match xs:
    case Nil{}:
      Unit
    case h <> t:
      (LE(h, top) & InRange(top, t))

def bump(b: Bool, n: Nat) -> Nat:
  match b:
    case True{}:
      1n+n
    case False{}:
      n

# how many times y occurs in the tree
def count(+y: Nat, t: Tree) -> Nat:
  match t:
    case Leaf{}:
      0n
    case Node{l, k, r}:
      Nat.add(count(y, l), bump(Cmp.is_eq(Nat.cmp(y, k)), count(y, r)))

# how many times y occurs in the list
def tally(+y: Nat, xs: List<&2, Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case h <> t:
      bump(Cmp.is_eq(Nat.cmp(y, h)), tally(y, t))

# the scores in order, in front of acc
def to_list(t: Tree, acc: List<&2, Nat>) -> List<&2, Nat>:
  match t:
    case Leaf{}:
      acc
    case Node{l, k, r}:
      to_list(l, k <> to_list(r, acc))

# Sorted.from(lo, xs): every element is at least lo and the list ascends
def Sorted.from(lo: Nat, xs: List<&2, Nat>) -> Type:
  match xs:
    case Nil{}:
      Unit
    case h <> t:
      (LE(lo, h) & Sorted.from(h, t))

def size(t: Tree) -> Nat:
  match t:
    case Leaf{}:
      0n
    case Node{l, k, r}:
      Nat.add(size(l), 1n+size(r))

def len(xs: List<&2, Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case h <> t:
      1n+len(t)

# LAW: insert keeps the tree ordered within its bounds
law insert_ord:
  for +x: Nat
  for +t: Tree
  for +lo: Nat
  for +hi: Nat
  Bst(lo, hi, t) -> LE(lo, x) -> LE(x, hi) -> Bst(lo, hi, insert(x, t))

# LAW: insert adds one occurrence of x and keeps every other count
law insert_count:
  for +y: Nat
  for +x: Nat
  for +t: Tree
  {bump(Cmp.is_eq(Nat.cmp(y, x)), count(y, t)) == count(y, insert(x, t)) : Nat}

# LAW: a board built from scores at most top is ordered within 0..top
law build_ord:
  for +top: Nat
  for +xs: List<&2, Nat>
  for ok: InRange(top, xs)
  Bst(0n, top, build(xs))

# LAW: the board holds each score as many times as the list does
law build_count:
  for +y: Nat
  for +xs: List<&2, Nat>
  {count(y, build(xs)) == tally(y, xs) : Nat}

# LAW: the board lists its scores in ascending order
law to_list_sorted:
  for +top: Nat
  for +t: Tree
  for b: Bst(0n, top, t)
  Sorted.from(0n, to_list(t, Nil{}))

# LAW: the listing holds each score as many times as the tree does
law to_list_count:
  for +y: Nat
  for +t: Tree
  for +acc: List<&2, Nat>
  {Nat.add(count(y, t), tally(y, acc)) == tally(y, to_list(t, acc)) : Nat}

# LAW: the board holds as many scores as its list
law build_size:
  for +xs: List<&2, Nat>
  {size(build(xs)) == len(xs) : Nat}


# ===== PROOFS =====

law le_refl:
  for +a: Nat
  LE(a, a)

def le_refl(a):
  match a:
    case 0n:
      Unit{}
    case 1n+p:
      le_refl(p)

law le_trans:
  for +a: Nat
  for +b: Nat
  for +c: Nat
  LE(a, b) -> LE(b, c) -> LE(a, c)

def le_trans(a, b, c):
  match a b c:
    case 0n _ _:
      ab => bc => Unit{}
    case 1n+ap 0n _:
      ab => bc => Empty.absurd(LE(a, c), ab)
    case 1n+ap 1n+bp 0n:
      ab => bc => Empty.absurd(LE(a, c), bc)
    case 1n+ap 1n+bp 1n+cp:
      le_trans(ap, bp, cp)

law rot_r_ord:
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for +lo: Nat
  for +hi: Nat
  for b: Bst(lo, hi, Node{l, k, r})
  Bst(lo, hi, rot_r(l, k, r))

def rot_r_ord(l, k, r, lo, hi, b):
  match l:
    case Leaf{}:
      b
    case Node{ll, lk, lr}:
      (e1, +e2, bl, br) = b
      (f1, +f2, bll, blr) = bl
      (f1, le_trans(lk, k, hi, f2, e2), bll, (f2, e2, blr, br))

law rot_l_ord:
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for +lo: Nat
  for +hi: Nat
  for b: Bst(lo, hi, Node{l, k, r})
  Bst(lo, hi, rot_l(l, k, r))

def rot_l_ord(l, k, r, lo, hi, b):
  match r:
    case Leaf{}:
      b
    case Node{rl, rk, rr}:
      (+e1, e2, bl, br) = b
      (+g1, g2, brl, brr) = br
      (le_trans(lo, k, rk, e1, g1), g2, (e1, g1, bl, brl), brr)

law fix_l_ord:
  for +ll: Tree
  for +lk: Nat
  for +lr: Tree
  for +k: Nat
  for +r: Tree
  for +lo: Nat
  for +hi: Nat
  for c: Cmp
  for b: Bst(lo, hi, Node{Node{ll, lk, lr}, k, r})
  Bst(lo, hi, fix_l(ll, lk, lr, k, r, c))

def fix_l_ord(ll, lk, lr, k, r, lo, hi, c, b):
  match c:
    case LT{}:
      (e1, e2, bl, br) = b
      rot_r_ord(rot_l(ll, lk, lr), k, r, lo, hi, (e1, e2, rot_l_ord(ll, lk, lr, lo, k, bl), br))
    case EQ{}:
      rot_r_ord(Node{ll, lk, lr}, k, r, lo, hi, b)
    case GT{}:
      rot_r_ord(Node{ll, lk, lr}, k, r, lo, hi, b)

law fix_r_ord:
  for +l: Tree
  for +k: Nat
  for +rl: Tree
  for +rk: Nat
  for +rr: Tree
  for +lo: Nat
  for +hi: Nat
  for c: Cmp
  for b: Bst(lo, hi, Node{l, k, Node{rl, rk, rr}})
  Bst(lo, hi, fix_r(l, k, rl, rk, rr, c))

def fix_r_ord(l, k, rl, rk, rr, lo, hi, c, b):
  match c:
    case GT{}:
      (e1, e2, bl, br) = b
      rot_l_ord(l, k, rot_r(rl, rk, rr), lo, hi, (e1, e2, bl, rot_r_ord(rl, rk, rr, k, hi, br)))
    case EQ{}:
      rot_l_ord(l, k, Node{rl, rk, rr}, lo, hi, b)
    case LT{}:
      rot_l_ord(l, k, Node{rl, rk, rr}, lo, hi, b)

law bal_l_ord:
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for +lo: Nat
  for +hi: Nat
  for c: Cmp
  for b: Bst(lo, hi, Node{l, k, r})
  Bst(lo, hi, bal_l(l, k, r, c))

def bal_l_ord(l, k, r, lo, hi, c, b):
  match l c:
    case Leaf{} _:
      b
    case Node{ll, lk, lr} GT{}:
      fix_l_ord(ll, lk, lr, k, r, lo, hi, Nat.cmp(height(ll), height(lr)), b)
    case Node{ll, lk, lr} EQ{}:
      b
    case Node{ll, lk, lr} LT{}:
      b

law bal_r_ord:
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for +lo: Nat
  for +hi: Nat
  for c: Cmp
  for b: Bst(lo, hi, Node{l, k, r})
  Bst(lo, hi, bal_r(l, k, r, c))

def bal_r_ord(l, k, r, lo, hi, c, b):
  match r c:
    case Leaf{} _:
      b
    case Node{rl, rk, rr} GT{}:
      fix_r_ord(l, k, rl, rk, rr, lo, hi, Nat.cmp(height(rl), height(rr)), b)
    case Node{rl, rk, rr} EQ{}:
      b
    case Node{rl, rk, rr} LT{}:
      b

law ins_go_ord:
  for +x: Nat
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for +lo: Nat
  for +hi: Nat
  for c: Or(LE(x, k), LE(k, x))
  for il: Unit -> Tree
  for ir: Unit -> Tree
  for hl: Bst(lo, k, l) -> LE(lo, x) -> LE(x, k) -> Bst(lo, k, il(Unit{}))
  for hr: Bst(k, hi, r) -> LE(k, x) -> LE(x, hi) -> Bst(k, hi, ir(Unit{}))
  for b: Bst(lo, hi, Node{l, k, r})
  for e1: LE(lo, x)
  for e2: LE(x, hi)
  Bst(lo, hi, ins.go(x, l, k, r, c, il, ir))

def ins_go_ord(x, l, k, r, lo, hi, c, il, ir, hl, hr, b, e1, e2):
  match c:
    case Inl{e}:
      (ek1, ek2, bl, br) = b
      +l2 = il(Unit{})
      bal_l_ord(l2, k, r, lo, hi, Nat.cmp(height(l2), 1n+height(r)), (ek1, ek2, hl(bl, e1, e), br))
    case Inr{e}:
      (ek1, ek2, bl, br) = b
      +r2 = ir(Unit{})
      bal_r_ord(l, k, r2, lo, hi, Nat.cmp(height(r2), 1n+height(l)), (ek1, ek2, bl, hr(br, e, e2)))

def insert_ord(x, t, lo, hi, b, e1, e2):
  match t:
    case Leaf{}:
      (e1, e2, Unit{}, Unit{})
    case Node{l, k, r}:
      ins_go_ord(x, l, k, r, lo, hi, le_case(x, k), u => insert(x, l), u => insert(x, r), insert_ord(x, l, lo, k), insert_ord(x, r, k, hi), b, e1, e2)

def build_ord(top, xs, ok):
  match xs:
    case Nil{}:
      Unit{}
    case h <> t:
      (eh, okt) = ok
      insert_ord(h, build(t), 0n, top, build_ord(top, t, okt), Unit{}, eh)

law sorted_weaken:
  for +lo: Nat
  for +hi: Nat
  for +xs: List<&2, Nat>
  for e: LE(lo, hi)
  for s: Sorted.from(hi, xs)
  Sorted.from(lo, xs)

def sorted_weaken(lo, hi, xs, e, s):
  match xs:
    case Nil{}:
      Unit{}
    case h <> t:
      (eh, st) = s
      (le_trans(lo, hi, h, e, eh), st)

law to_list_sorted_go:
  for +t: Tree
  for +lo: Nat
  for +hi: Nat
  for +acc: List<&2, Nat>
  for b: Bst(lo, hi, t)
  for s: Sorted.from(hi, acc)
  for e: LE(lo, hi)
  Sorted.from(lo, to_list(t, acc))

def to_list_sorted_go(t, lo, hi, acc, b, s, e):
  match t:
    case Leaf{}:
      sorted_weaken(lo, hi, acc, e, s)
    case Node{l, k, r}:
      (ek1, ek2, bl, br) = b
      to_list_sorted_go(l, lo, k, k <> to_list(r, acc), bl, (le_refl(k), to_list_sorted_go(r, k, hi, acc, br, s, ek2)), ek1)

def to_list_sorted(top, t, b):
  to_list_sorted_go(t, 0n, top, Nil{}, b, Unit{}, Unit{})

law add_succ:
  for +a: Nat
  for +c: Nat
  {1n+Nat.add(a, c) == Nat.add(a, 1n+c) : Nat}

def add_succ(a, c):
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_succ(p, c) : {1n+1n+Nat.add(p, c) == 1n+_ : Nat}
      {==}

law assoc_bump:
  for +A: Nat
  for +p: Bool
  for +B: Nat
  for +C: Nat
  {Nat.add(Nat.add(A, bump(p, B)), C) == Nat.add(A, bump(p, Nat.add(B, C))) : Nat}

def assoc_bump(A, p, B, C):
  match A:
    case 0n:
      match p:
        case True{}:
          {==}
        case False{}:
          {==}
    case 1n+a:
      %assoc_bump(a, p, B, C) : {1n+Nat.add(Nat.add(a, bump(p, B)), C) == 1n+_ : Nat}
      {==}

law assoc_bump_sym:
  for +A: Nat
  for +p: Bool
  for +B: Nat
  for +C: Nat
  {Nat.add(A, bump(p, Nat.add(B, C))) == Nat.add(Nat.add(A, bump(p, B)), C) : Nat}

def assoc_bump_sym(A, p, B, C):
  match A:
    case 0n:
      match p:
        case True{}:
          {==}
        case False{}:
          {==}
    case 1n+a:
      %assoc_bump_sym(a, p, B, C) : {1n+Nat.add(a, bump(p, Nat.add(B, C))) == 1n+_ : Nat}
      {==}

law bump_add:
  for +p: Bool
  for +A: Nat
  for +C: Nat
  {bump(p, Nat.add(A, C)) == Nat.add(bump(p, A), C) : Nat}

def bump_add(p, A, C):
  match p:
    case True{}:
      {==}
    case False{}:
      {==}

law succ_inner:
  for +A: Nat
  for +q: Bool
  for +C: Nat
  {1n+Nat.add(A, bump(q, C)) == Nat.add(A, bump(q, 1n+C)) : Nat}

def succ_inner(A, q, C):
  match q:
    case True{}:
      add_succ(A, 1n+C)
    case False{}:
      add_succ(A, C)

law swap3:
  for +p: Bool
  for +A: Nat
  for +q: Bool
  for +C: Nat
  {bump(p, Nat.add(A, bump(q, C))) == Nat.add(A, bump(q, bump(p, C))) : Nat}

def swap3(p, A, q, C):
  match p:
    case True{}:
      succ_inner(A, q, C)
    case False{}:
      {==}

law rot_r_count:
  for +y: Nat
  for +l: Tree
  for +k: Nat
  for +r: Tree
  {count(y, Node{l, k, r}) == count(y, rot_r(l, k, r)) : Nat}

def rot_r_count(y, l, k, r):
  match l:
    case Leaf{}:
      {==}
    case Node{ll, lk, lr}:
      assoc_bump(count(y, ll), Cmp.is_eq(Nat.cmp(y, lk)), count(y, lr), bump(Cmp.is_eq(Nat.cmp(y, k)), count(y, r)))

law rot_l_count:
  for +y: Nat
  for +l: Tree
  for +k: Nat
  for +r: Tree
  {count(y, Node{l, k, r}) == count(y, rot_l(l, k, r)) : Nat}

def rot_l_count(y, l, k, r):
  match r:
    case Leaf{}:
      {==}
    case Node{rl, rk, rr}:
      assoc_bump_sym(count(y, l), Cmp.is_eq(Nat.cmp(y, k)), count(y, rl), bump(Cmp.is_eq(Nat.cmp(y, rk)), count(y, rr)))

law fix_l_count:
  for +y: Nat
  for +ll: Tree
  for +lk: Nat
  for +lr: Tree
  for +k: Nat
  for +r: Tree
  for c: Cmp
  {count(y, Node{Node{ll, lk, lr}, k, r}) == count(y, fix_l(ll, lk, lr, k, r, c)) : Nat}

def fix_l_count(y, ll, lk, lr, k, r, c):
  match c:
    case LT{}:
      %rot_r_count(y, rot_l(ll, lk, lr), k, r) : {count(y, Node{Node{ll, lk, lr}, k, r}) == _ : Nat}
      %rot_l_count(y, ll, lk, lr) : {count(y, Node{Node{ll, lk, lr}, k, r}) == Nat.add(_, bump(Cmp.is_eq(Nat.cmp(y, k)), count(y, r))) : Nat}
      {==}
    case EQ{}:
      rot_r_count(y, Node{ll, lk, lr}, k, r)
    case GT{}:
      rot_r_count(y, Node{ll, lk, lr}, k, r)

law fix_r_count:
  for +y: Nat
  for +l: Tree
  for +k: Nat
  for +rl: Tree
  for +rk: Nat
  for +rr: Tree
  for c: Cmp
  {count(y, Node{l, k, Node{rl, rk, rr}}) == count(y, fix_r(l, k, rl, rk, rr, c)) : Nat}

def fix_r_count(y, l, k, rl, rk, rr, c):
  match c:
    case GT{}:
      %rot_l_count(y, l, k, rot_r(rl, rk, rr)) : {count(y, Node{l, k, Node{rl, rk, rr}}) == _ : Nat}
      %rot_r_count(y, rl, rk, rr) : {count(y, Node{l, k, Node{rl, rk, rr}}) == Nat.add(count(y, l), bump(Cmp.is_eq(Nat.cmp(y, k)), _)) : Nat}
      {==}
    case EQ{}:
      rot_l_count(y, l, k, Node{rl, rk, rr})
    case LT{}:
      rot_l_count(y, l, k, Node{rl, rk, rr})

law bal_l_count:
  for +y: Nat
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for c: Cmp
  {count(y, Node{l, k, r}) == count(y, bal_l(l, k, r, c)) : Nat}

def bal_l_count(y, l, k, r, c):
  match l c:
    case Leaf{} _:
      {==}
    case Node{ll, lk, lr} GT{}:
      fix_l_count(y, ll, lk, lr, k, r, Nat.cmp(height(ll), height(lr)))
    case Node{ll, lk, lr} EQ{}:
      {==}
    case Node{ll, lk, lr} LT{}:
      {==}

law bal_r_count:
  for +y: Nat
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for c: Cmp
  {count(y, Node{l, k, r}) == count(y, bal_r(l, k, r, c)) : Nat}

def bal_r_count(y, l, k, r, c):
  match r c:
    case Leaf{} _:
      {==}
    case Node{rl, rk, rr} GT{}:
      fix_r_count(y, l, k, rl, rk, rr, Nat.cmp(height(rl), height(rr)))
    case Node{rl, rk, rr} EQ{}:
      {==}
    case Node{rl, rk, rr} LT{}:
      {==}

law ins_go_count:
  for +y: Nat
  for +x: Nat
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for c: Or(LE(x, k), LE(k, x))
  for il: Unit -> Tree
  for ir: Unit -> Tree
  for hl: {bump(Cmp.is_eq(Nat.cmp(y, x)), count(y, l)) == count(y, il(Unit{})) : Nat}
  for hr: {bump(Cmp.is_eq(Nat.cmp(y, x)), count(y, r)) == count(y, ir(Unit{})) : Nat}
  {bump(Cmp.is_eq(Nat.cmp(y, x)), count(y, Node{l, k, r})) == count(y, ins.go(x, l, k, r, c, il, ir)) : Nat}

def ins_go_count(y, x, l, k, r, c, il, ir, hl, hr):
  match c:
    case Inl{e}:
      +l2 = il(Unit{})
      %bal_l_count(y, l2, k, r, Nat.cmp(height(l2), 1n+height(r))) : {bump(Cmp.is_eq(Nat.cmp(y, x)), count(y, Node{l, k, r})) == _ : Nat}
      %hl : {bump(Cmp.is_eq(Nat.cmp(y, x)), count(y, Node{l, k, r})) == Nat.add(_, bump(Cmp.is_eq(Nat.cmp(y, k)), count(y, r))) : Nat}
      bump_add(Cmp.is_eq(Nat.cmp(y, x)), count(y, l), bump(Cmp.is_eq(Nat.cmp(y, k)), count(y, r)))
    case Inr{e}:
      +r2 = ir(Unit{})
      %bal_r_count(y, l, k, r2, Nat.cmp(height(r2), 1n+height(l))) : {bump(Cmp.is_eq(Nat.cmp(y, x)), count(y, Node{l, k, r})) == _ : Nat}
      %hr : {bump(Cmp.is_eq(Nat.cmp(y, x)), count(y, Node{l, k, r})) == Nat.add(count(y, l), bump(Cmp.is_eq(Nat.cmp(y, k)), _)) : Nat}
      swap3(Cmp.is_eq(Nat.cmp(y, x)), count(y, l), Cmp.is_eq(Nat.cmp(y, k)), count(y, r))

def insert_count(y, x, t):
  match t:
    case Leaf{}:
      {==}
    case Node{l, k, r}:
      ins_go_count(y, x, l, k, r, le_case(x, k), u => insert(x, l), u => insert(x, r), insert_count(y, x, l), insert_count(y, x, r))

def build_count(y, xs):
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      %build_count(y, t) : {count(y, insert(h, build(t))) == bump(Cmp.is_eq(Nat.cmp(y, h)), _) : Nat}
      %insert_count(y, h, build(t)) : {_ == bump(Cmp.is_eq(Nat.cmp(y, h)), count(y, build(t))) : Nat}
      {==}

def to_list_count(y, t, acc):
  match t:
    case Leaf{}:
      {==}
    case Node{l, k, r}:
      %to_list_count(y, l, k <> to_list(r, acc)) : {Nat.add(count(y, Node{l, k, r}), tally(y, acc)) == _ : Nat}
      %to_list_count(y, r, acc) : {Nat.add(count(y, Node{l, k, r}), tally(y, acc)) == Nat.add(count(y, l), bump(Cmp.is_eq(Nat.cmp(y, k)), _)) : Nat}
      assoc_bump(count(y, l), Cmp.is_eq(Nat.cmp(y, k)), count(y, r), tally(y, acc))

law rot_r_size:
  for +l: Tree
  for +k: Nat
  for +r: Tree
  {size(Node{l, k, r}) == size(rot_r(l, k, r)) : Nat}

def rot_r_size(l, k, r):
  match l:
    case Leaf{}:
      {==}
    case Node{ll, lk, lr}:
      assoc_bump(size(ll), True{}, size(lr), 1n+size(r))

law rot_l_size:
  for +l: Tree
  for +k: Nat
  for +r: Tree
  {size(Node{l, k, r}) == size(rot_l(l, k, r)) : Nat}

def rot_l_size(l, k, r):
  match r:
    case Leaf{}:
      {==}
    case Node{rl, rk, rr}:
      assoc_bump_sym(size(l), True{}, size(rl), 1n+size(rr))

law fix_l_size:
  for +ll: Tree
  for +lk: Nat
  for +lr: Tree
  for +k: Nat
  for +r: Tree
  for c: Cmp
  {size(Node{Node{ll, lk, lr}, k, r}) == size(fix_l(ll, lk, lr, k, r, c)) : Nat}

def fix_l_size(ll, lk, lr, k, r, c):
  match c:
    case LT{}:
      %rot_r_size(rot_l(ll, lk, lr), k, r) : {size(Node{Node{ll, lk, lr}, k, r}) == _ : Nat}
      %rot_l_size(ll, lk, lr) : {size(Node{Node{ll, lk, lr}, k, r}) == Nat.add(_, 1n+size(r)) : Nat}
      {==}
    case EQ{}:
      rot_r_size(Node{ll, lk, lr}, k, r)
    case GT{}:
      rot_r_size(Node{ll, lk, lr}, k, r)

law fix_r_size:
  for +l: Tree
  for +k: Nat
  for +rl: Tree
  for +rk: Nat
  for +rr: Tree
  for c: Cmp
  {size(Node{l, k, Node{rl, rk, rr}}) == size(fix_r(l, k, rl, rk, rr, c)) : Nat}

def fix_r_size(l, k, rl, rk, rr, c):
  match c:
    case GT{}:
      %rot_l_size(l, k, rot_r(rl, rk, rr)) : {size(Node{l, k, Node{rl, rk, rr}}) == _ : Nat}
      %rot_r_size(rl, rk, rr) : {size(Node{l, k, Node{rl, rk, rr}}) == Nat.add(size(l), 1n+_) : Nat}
      {==}
    case EQ{}:
      rot_l_size(l, k, Node{rl, rk, rr})
    case LT{}:
      rot_l_size(l, k, Node{rl, rk, rr})

law bal_l_size:
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for c: Cmp
  {size(Node{l, k, r}) == size(bal_l(l, k, r, c)) : Nat}

def bal_l_size(l, k, r, c):
  match l c:
    case Leaf{} _:
      {==}
    case Node{ll, lk, lr} GT{}:
      fix_l_size(ll, lk, lr, k, r, Nat.cmp(height(ll), height(lr)))
    case Node{ll, lk, lr} EQ{}:
      {==}
    case Node{ll, lk, lr} LT{}:
      {==}

law bal_r_size:
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for c: Cmp
  {size(Node{l, k, r}) == size(bal_r(l, k, r, c)) : Nat}

def bal_r_size(l, k, r, c):
  match r c:
    case Leaf{} _:
      {==}
    case Node{rl, rk, rr} GT{}:
      fix_r_size(l, k, rl, rk, rr, Nat.cmp(height(rl), height(rr)))
    case Node{rl, rk, rr} EQ{}:
      {==}
    case Node{rl, rk, rr} LT{}:
      {==}

law ins_go_size:
  for +x: Nat
  for +l: Tree
  for +k: Nat
  for +r: Tree
  for c: Or(LE(x, k), LE(k, x))
  for il: Unit -> Tree
  for ir: Unit -> Tree
  for hl: {1n+size(l) == size(il(Unit{})) : Nat}
  for hr: {1n+size(r) == size(ir(Unit{})) : Nat}
  {1n+size(Node{l, k, r}) == size(ins.go(x, l, k, r, c, il, ir)) : Nat}

def ins_go_size(x, l, k, r, c, il, ir, hl, hr):
  match c:
    case Inl{e}:
      +l2 = il(Unit{})
      %bal_l_size(l2, k, r, Nat.cmp(height(l2), 1n+height(r))) : {1n+size(Node{l, k, r}) == _ : Nat}
      %hl : {1n+size(Node{l, k, r}) == Nat.add(_, 1n+size(r)) : Nat}
      {==}
    case Inr{e}:
      +r2 = ir(Unit{})
      %bal_r_size(l, k, r2, Nat.cmp(height(r2), 1n+height(l))) : {1n+size(Node{l, k, r}) == _ : Nat}
      %hr : {1n+size(Node{l, k, r}) == Nat.add(size(l), 1n+_) : Nat}
      add_succ(size(l), 1n+size(r))

law insert_size:
  for +x: Nat
  for +t: Tree
  {1n+size(t) == size(insert(x, t)) : Nat}

def insert_size(x, t):
  match t:
    case Leaf{}:
      {==}
    case Node{l, k, r}:
      ins_go_size(x, l, k, r, le_case(x, k), u => insert(x, l), u => insert(x, r), insert_size(x, l), insert_size(x, r))

def build_size(xs):
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      %build_size(t) : {size(insert(h, build(t))) == 1n+_ : Nat}
      %insert_size(h, build(t)) : {_ == 1n+size(build(t)) : Nat}
      {==}
