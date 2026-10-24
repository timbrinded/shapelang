#!/usr/bin/env python3
"""A5 mutants: implementation edits to each demo's main.bend (never LAWS.bend or
PROOF.bend, never the spec-only defs the laws are stated with).

kind "mutant": an edit expected to change behaviour (the oracle decides whether
it did and whether a law became false).
kind "refactor": an edit intended to preserve the behaviour of every def the
laws mention (the oracle confirms equivalence).
Each edit is (old, new); old must occur exactly once in main.bend.
"""

M = []

def mut(i, demo, desc, *edits, kind="mutant"):
    M.append({"id": i, "demo": demo, "kind": kind, "desc": desc, "edits": list(edits)})

def ref(i, demo, desc, *edits):
    mut(i, demo, desc, *edits, kind="refactor")

IS = "proof_insertion_sort"
mut("IS-m01", IS, "dec Inl: swap the order of x and h", ("      x <> h <> t\n", "      h <> x <> t\n"))
mut("IS-m02", IS, "dec Inr: drop x (keep the unmodified tail)", ("      h <> r\n", "      h <> t\n"))
mut("IS-m03", IS, "dec Inl: drop h", ("      x <> h <> t\n", "      x <> t\n"))
mut("IS-m04", IS, "sort: insert into the unsorted tail", ("      insert(h, sort(t))\n", "      insert(h, t)\n"))
mut("IS-m05", IS, "sort: cons the head without inserting", ("      insert(h, sort(t))\n", "      h <> sort(t)\n"))
mut("IS-m06", IS, "insert Nil: answer Nil (drop x)", ("    case Nil{}:\n      [x]\n", "    case Nil{}:\n      Nil{}\n"))
mut("IS-m07", IS, "insert Nil: answer [x, x]", ("    case Nil{}:\n      [x]\n", "    case Nil{}:\n      [x, x]\n"))
mut("IS-m08", IS, "insert: compare (h, x) instead of (x, h)", ("le_case(x, h))\n", "le_case(h, x))\n"))
mut("IS-m09", IS, "dec: swap the two branches", ("    case Inl{e}:\n      x <> h <> t\n    case Inr{e}:\n      h <> r\n", "    case Inl{e}:\n      h <> r\n    case Inr{e}:\n      x <> h <> t\n"))
mut("IS-m10", IS, "le_case: answer Inl where Inr was (1n+a vs 0n)", ("    case 1n+a 0n:\n      Inr{Unit{}}\n", "    case 1n+a 0n:\n      Inl{Unit{}}\n"))
mut("IS-m11", IS, "sort: recurse on a non-smaller argument", ("      insert(h, sort(t))\n", "      sort(insert(h, t))\n"))
ref("IS-r01", IS, "rename dec's parameters t, r to rest, ins", ("def dec(x: Nat, h: Nat, t: List<&2, Nat>, r: List<&2, Nat>, c: Or(LE(x, h), LE(h, x))) -> List<&2, Nat>:\n  match c:\n    case Inl{e}:\n      x <> h <> t\n    case Inr{e}:\n      h <> r\n", "def dec(x: Nat, h: Nat, rest: List<&2, Nat>, ins: List<&2, Nat>, c: Or(LE(x, h), LE(h, x))) -> List<&2, Nat>:\n  match c:\n    case Inl{e}:\n      x <> h <> rest\n    case Inr{e}:\n      h <> ins\n"))
ref("IS-r02", IS, "le_case: reorder the three cases", ("    case 0n b:\n      Inl{Unit{}}\n    case 1n+a 0n:\n      Inr{Unit{}}\n    case 1n+a 1n+b:\n      le_case(a, b)\n", "    case 1n+a 1n+b:\n      le_case(a, b)\n    case 1n+a 0n:\n      Inr{Unit{}}\n    case 0n b:\n      Inl{Unit{}}\n"))
ref("IS-r03", IS, "extract insert's Nil answer into a helper single(x)", ("def insert(+x: Nat, +xs: List<&2, Nat>) -> List<&2, Nat>:\n  match xs:\n    case Nil{}:\n      [x]\n", "def single(x: Nat) -> List<&2, Nat>:\n  [x]\n\ndef insert(+x: Nat, +xs: List<&2, Nat>) -> List<&2, Nat>:\n  match xs:\n    case Nil{}:\n      single(x)\n"))
ref("IS-r04", IS, "sort: write Nil{} as []", ("    case Nil{}:\n      Nil{}\n    case h <> t:\n      insert(h, sort(t))\n", "    case Nil{}:\n      []\n    case h <> t:\n      insert(h, sort(t))\n"))
ref("IS-r05", IS, "dec: swap the order of its last two parameters (internal signature change)", ("def dec(x: Nat, h: Nat, t: List<&2, Nat>, r: List<&2, Nat>, c: Or(LE(x, h), LE(h, x))) -> List<&2, Nat>:", "def dec(x: Nat, h: Nat, t: List<&2, Nat>, c: Or(LE(x, h), LE(h, x)), r: List<&2, Nat>) -> List<&2, Nat>:"), ("      dec(x, h, t, insert(x, t), le_case(x, h))\n", "      dec(x, h, t, le_case(x, h), insert(x, t))\n"))

TE = "proof_typed_eval"
mut("TE-m01", TE, "fold_add: answer the right literal only", ("      Num{Nat.add(x, y), {==}}\n", "      Num{y, {==}}\n"))
mut("TE-m02", TE, "fold_add: off by one", ("      Num{Nat.add(x, y), {==}}\n", "      Num{Nat.add(x, 1n+y), {==}}\n"))
mut("TE-m03", TE, "fold_zero: negate the test", ("      Bit{is_zero(n), {==}}\n", "      Bit{Bool.not(is_zero(n)), {==}}\n"))
mut("TE-m04", TE, "fold_if: swap the literal branches", ("    case Bit{True{}, _}:\n      a\n    case Bit{False{}, _}:\n      b\n", "    case Bit{True{}, _}:\n      b\n    case Bit{False{}, _}:\n      a\n"))
mut("TE-m05", TE, "fold_if: swap branches in the non-literal case", ("    case c:\n      If{c, a, b}\n", "    case c:\n      If{c, b, a}\n"))
mut("TE-m06", TE, "opt Add: do not optimise the right operand", ("      fold_add(opt(TNum{}, a), opt(TNum{}, b))\n", "      fold_add(opt(TNum{}, a), b)\n"))
mut("TE-m07", TE, "opt If: swap the optimised branches", ("      fold_if(t, opt(TBool{}, c), opt(t, a), opt(t, b))\n", "      fold_if(t, opt(TBool{}, c), opt(t, b), opt(t, a))\n"))
mut("TE-m08", TE, "opt IsZero: rebuild IsZero instead of folding", ("      fold_zero(opt(TNum{}, a))\n", "      IsZero{opt(TNum{}, a), {==}}\n"))
mut("TE-m09", TE, "opt Num: off by one", ("    case Num{n, eq}:\n      Num{n, eq}\n    case Bit{b, eq}:\n      Bit{b, eq}\n    case Add{a, b, eq}:\n      %eq : Expr<_>\n      fold_add", "    case Num{n, eq}:\n      Num{1n+n, eq}\n    case Bit{b, eq}:\n      Bit{b, eq}\n    case Add{a, b, eq}:\n      %eq : Expr<_>\n      fold_add"))
mut("TE-m10", TE, "fold_add: swap operands in the non-literal case", ("    case a b:\n      Add{a, b, {==}}\n", "    case a b:\n      Add{b, a, {==}}\n"))
ref("TE-r01", TE, "fold_add: rename x, y to u, v", ("    case Num{x, _} Num{y, _}:\n      Num{Nat.add(x, y), {==}}\n", "    case Num{u, _} Num{v, _}:\n      Num{Nat.add(u, v), {==}}\n"))
ref("TE-r02", TE, "fold_if: reorder the literal cases", ("    case Bit{True{}, _}:\n      a\n    case Bit{False{}, _}:\n      b\n", "    case Bit{False{}, _}:\n      b\n    case Bit{True{}, _}:\n      a\n"))
ref("TE-r03", TE, "fold_add: commute the addition", ("      Num{Nat.add(x, y), {==}}\n", "      Num{Nat.add(y, x), {==}}\n"))
ref("TE-r04", TE, "opt If: extract a helper opt_if", ("# the optimizer: folds every subterm, then the node above it\n", "def opt_if(-t: Ty, c: Expr<TBool{}>, a: Expr<t>, b: Expr<t>) -> Expr<t>:\n  fold_if(t, c, a, b)\n\n# the optimizer: folds every subterm, then the node above it\n"), ("      fold_if(t, opt(TBool{}, c), opt(t, a), opt(t, b))\n", "      opt_if(t, opt(TBool{}, c), opt(t, a), opt(t, b))\n"))

NU = "proof_numerics"
mut("NU-m01", NU, "add: drop the successor", ("      1n+add(p, b)\n", "      add(p, b)\n"))
mut("NU-m02", NU, "add: base case answers 1n+b", ("    case 0n:\n      b\n", "    case 0n:\n      1n+b\n"))
mut("NU-m03", NU, "mul: add p instead of b", ("      add(b, mul(p, b))\n", "      add(p, mul(p, b))\n"))
mut("NU-m03b", NU, "mul: add 1n instead of b (well-formed variant of NU-m03, which reused p and broke affinity)", ("      add(b, mul(p, b))\n", "      add(1n, mul(p, b))\n"))
mut("NU-m04", NU, "mul: base case answers b", ("    case 0n:\n      0n\n    case 1n+p:\n      add(b, mul(p, b))\n", "    case 0n:\n      b\n    case 1n+p:\n      add(b, mul(p, b))\n"))
mut("NU-m05", NU, "divmod.wrap: do not bump the remainder", ("      (q, 1n+r)\n", "      (q, r)\n"))
mut("NU-m06", NU, "divmod.wrap: swap the branches", ("    case True{}:\n      (q, 1n+r)\n    case False{}:\n      (1n+q, 0n)\n", "    case True{}:\n      (1n+q, 0n)\n    case False{}:\n      (q, 1n+r)\n"))
mut("NU-m07", NU, "divmod.step: < becomes <=", ("  divmod.wrap((r < m : Nat), q, r)\n", "  divmod.wrap((r <= m : Nat), q, r)\n"))
mut("NU-m08", NU, "divmod.go: base answers (0n, 1n)", ("    case 0n:\n      (0n, 0n)\n", "    case 0n:\n      (0n, 1n)\n"))
mut("NU-m09", NU, "divmod by 0n answers (0n, 0n)", ("    case 0n:\n      (0n, n)\n", "    case 0n:\n      (0n, 0n)\n"))
mut("NU-m10", NU, "divmod: divide by m + 2", ("      divmod.go(n, m)\n", "      divmod.go(n, 1n+m)\n"))
ref("NU-r01", NU, "add: rename p to k", ("    case 1n+p:\n      1n+add(p, b)\n", "    case 1n+k:\n      1n+add(k, b)\n"))
ref("NU-r02", NU, "mul: commute the addition", ("      add(b, mul(p, b))\n", "      add(mul(p, b), b)\n"))
ref("NU-r03", NU, "divmod.wrap: reorder cases", ("    case True{}:\n      (q, 1n+r)\n    case False{}:\n      (1n+q, 0n)\n", "    case False{}:\n      (1n+q, 0n)\n    case True{}:\n      (q, 1n+r)\n"))
ref("NU-r04", NU, "add: accumulate (tail-recursive) instead of 1n+add", ("      1n+add(p, b)\n", "      add(p, 1n+b)\n"))
ref("NU-r05", NU, "divmod.step: operator sugar to a Base call", ("  divmod.wrap((r < m : Nat), q, r)\n", "  divmod.wrap(Nat.is_lt(r, m), q, r)\n"))

PS = "pure_par_sum"
mut("PS-m01", PS, "sum: leaf answers 1n+i", ("    case 0n:\n      i\n", "    case 0n:\n      1n+i\n"))
mut("PS-m02", PS, "sum: right half starts one later", ("sum(p, Nat.add(pow2(p), i))", "sum(p, Nat.add(pow2(p), 1n+i))"))
mut("PS-m03", PS, "sum: right half starts at i (no offset)", ("sum(p, Nat.add(pow2(p), i))", "sum(p, i)"))
mut("PS-m04", PS, "pow2: h + 1 instead of h + h", ("      Nat.add(h, h)\n", "      Nat.add(h, 1n)\n"))
mut("PS-m05", PS, "pow2: base 2n", ("    case 0n:\n      1n\n", "    case 0n:\n      2n\n"))
mut("PS-m06", PS, "sum: answer only the left half", ("      Nat.add(a, b)\n", "      a\n"))
ref("PS-r01", PS, "sum: swap the parallel let", ("      a b = sum(p, i) sum(p, Nat.add(pow2(p), i))\n      Nat.add(a, b)\n", "      b a = sum(p, Nat.add(pow2(p), i)) sum(p, i)\n      Nat.add(a, b)\n"))
ref("PS-r02", PS, "sum: commute the final addition", ("      Nat.add(a, b)\n", "      Nat.add(b, a)\n"))
ref("PS-r03", PS, "sum: commute the offset addition", ("sum(p, Nat.add(pow2(p), i))", "sum(p, Nat.add(i, pow2(p)))"))

PO = "pure_par_sort"
mut("PO-m01", PO, "mix leaf: < becomes <=", ("Bool.xor(s, Nat.is_lt(y, x))", "Bool.xor(s, Nat.is_le(y, x))"))
mut("PO-m02", PO, "mix leaf: answer x on both sides", ("Bool.xor(s, Nat.is_lt(y, x)), x, y)", "Bool.xor(s, Nat.is_lt(y, x)), x, x)"))
mut("PO-m03", PO, "mix node: cross the halves (xl with yr)", ("      a b = mix(p, s, xl, yl) mix(p, s, xr, yr)\n", "      a b = mix(p, s, xl, yr) mix(p, s, xr, yl)\n"))
mut("PO-m04", PO, "flow: second half mixes with s, not Bool.not(s)", ("flow(p, s, mix(p, Bool.not(s), x, y))", "flow(p, s, mix(p, s, x, y))"))
mut("PO-m05", PO, "sort: both halves ascending", ("      a b = sort(p, True{}, x) sort(p, False{}, y)\n", "      a b = sort(p, True{}, x) sort(p, True{}, y)\n"))
mut("PO-m06", PO, "sort: skip the merge", ("      flow(1n+p, s, (a, b))\n", "      (a, b)\n"))
mut("PO-m07", PO, "flow leaf: answer 0n", ("    case 0n:\n      t\n    case 1n++p:\n      (+x, +y) = t\n", "    case 0n:\n      0n\n    case 1n++p:\n      (+x, +y) = t\n"))
mut("PO-m08", PO, "sort: merge the halves swapped", ("      flow(1n+p, s, (a, b))\n", "      flow(1n+p, s, (b, a))\n"))
mut("PO-m09", PO, "gen: odd child gets 2i", ("      a b = gen(p, 1n+Nat.double(i)) gen(p, Nat.double(i))\n", "      a b = gen(p, Nat.double(i)) gen(p, Nat.double(i))\n"))
ref("PO-r01", PO, "pick: reorder cases", ("    case True{}:\n      x\n    case False{}:\n      y\n", "    case False{}:\n      y\n    case True{}:\n      x\n"))
ref("PO-r02", PO, "mix: rename xl, xr to l1, r1", ("      (xl, xr) = x\n      (yl, yr) = y\n      a b = mix(p, s, xl, yl) mix(p, s, xr, yr)\n", "      (l1, r1) = x\n      (yl, yr) = y\n      a b = mix(p, s, l1, yl) mix(p, s, r1, yr)\n"))
ref("PO-r03", PO, "mix leaf: commute the xor", ("Bool.xor(s, Nat.is_lt(y, x))", "Bool.xor(Nat.is_lt(y, x), s)"))

WB = "app_win_is_bug_2d"
mut("WB-m01", WB, "room_w 3n -> 2n (smaller room)", ("def room_w() -> Nat:\n  3n\n", "def room_w() -> Nat:\n  2n\n"))
mut("WB-m02", WB, "flag_x 1n -> 8n (flag outside the room)", ("def flag_x() -> Nat:\n  1n\n", "def flag_x() -> Nat:\n  8n\n"))
mut("WB-m03", WB, "move: swap the wall branches", ("  pick(Game, wall(tx, ty), Game{x, y, w0}, Game{tx, ty, w0 || on_flag(tx, ty)})\n", "  pick(Game, wall(tx, ty), Game{tx, ty, w0 || on_flag(tx, ty)}, Game{x, y, w0})\n"))
mut("WB-m04", WB, "warp_up: no wrap at the top", ("    case 0n:\n      Nat.sub(map_h(), 1n)\n", "    case 0n:\n      0n\n"))
mut("WB-m05", WB, "warp_down: off-by-one wrap test", ("  pick(Nat, nat_eq(1n+y, map_h()), 0n, 1n+y)\n", "  pick(Nat, nat_eq(y, map_h()), 0n, 1n+y)\n"))
mut("WB-m06", WB, "on_flag: && becomes ||", ("  nat_eq(x, flag_x()) && nat_eq(y, flag_y())\n", "  nat_eq(x, flag_x()) || nat_eq(y, flag_y())\n"))
mut("WB-m07", WB, "east wall: <= room_h becomes < room_h (hole)", ("  east  = nat_eq(x, room_w()) && nat_le(y, room_h())\n", "  east  = nat_eq(x, room_w()) && nat_le(1n+y, room_h())\n"))
mut("WB-m08", WB, "move: test the current cell for a wall", ("  Game{x, y, +w0} = g\n  pick(Game, wall(tx, ty),", "  Game{+x, +y, +w0} = g\n  pick(Game, wall(x, y),"))
mut("WB-m09", WB, "step Up: warp down instead", ("      move(x0, warp_up(y0), Game{x0, y0, w})\n", "      move(x0, warp_down(y0), Game{x0, y0, w})\n"))
mut("WB-m10", WB, "run: ignore the moves", ("      run(ms, step(m, g))\n", "      run(ms, g)\n"))
mut("WB-m11", WB, "move: win flag toggles on any successful move", ("Game{tx, ty, w0 || on_flag(tx, ty)})\n", "Game{tx, ty, Bool.not(w0) || on_flag(tx, ty)})\n"))
mut("WB-m12", WB, "south wall: drop it", ("  south = nat_le(x, room_w()) && nat_eq(y, room_h())\n", "  south = False{}\n"))
mut("WB-m12b", WB, "south wall: drop it (well-formed variant of WB-m12, whose bare False{} could not be inferred)", ("  south = nat_le(x, room_w()) && nat_eq(y, room_h())\n", "  south = nat_le(x, room_w()) && False{}\n"))
ref("WB-r01", WB, "move: rename tx, ty to nx, ny", ("def move(+tx: Nat, +ty: Nat, g: Game) -> Game:\n  Game{x, y, +w0} = g\n  pick(Game, wall(tx, ty), Game{x, y, w0}, Game{tx, ty, w0 || on_flag(tx, ty)})\n", "def move(+nx: Nat, +ny: Nat, g: Game) -> Game:\n  Game{x, y, +w0} = g\n  pick(Game, wall(nx, ny), Game{x, y, w0}, Game{nx, ny, w0 || on_flag(nx, ny)})\n"))
ref("WB-r02", WB, "step: reorder the Up and Down cases", ("    case Up{}:\n      Game{+x0, +y0, w} = g\n      move(x0, warp_up(y0), Game{x0, y0, w})\n    case Down{}:\n      Game{+x0, +y0, w} = g\n      move(x0, warp_down(y0), Game{x0, y0, w})\n", "    case Down{}:\n      Game{+x0, +y0, w} = g\n      move(x0, warp_down(y0), Game{x0, y0, w})\n    case Up{}:\n      Game{+x0, +y0, w} = g\n      move(x0, warp_up(y0), Game{x0, y0, w})\n"))
ref("WB-r03", WB, "wall: reorder the disjunction", ("  (east || south) || (north || west)\n", "  (south || east) || (north || west)\n"))
ref("WB-r04", WB, "map_w as a closed sum 6n + 6n", ("def map_w() -> Nat:\n  12n\n", "def map_w() -> Nat:\n  Nat.add(6n, 6n)\n"))
ref("WB-r05", WB, "warp_right: inline pick as a helper match", ("def warp_right(+x: Nat) -> Nat:\n  pick(Nat, nat_eq(1n+x, map_w()), 0n, 1n+x)\n", "def wrap_or(c: Bool, +x: Nat) -> Nat:\n  match c:\n    case True{}:\n      0n\n    case False{}:\n      1n+x\n\ndef warp_right(+x: Nat) -> Nat:\n  wrap_or(nat_eq(1n+x, map_w()), x)\n"))

if __name__ == "__main__":
    import json, collections
    c = collections.Counter((m["demo"], m["kind"]) for m in M)
    for k, v in sorted(c.items()):
        print(k, v)
    print("mutants", sum(1 for m in M if m["kind"] == "mutant"), "refactors", sum(1 for m in M if m["kind"] == "refactor"))
