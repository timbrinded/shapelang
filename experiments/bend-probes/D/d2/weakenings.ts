// @ts-nocheck -- research script, run with bun; Bend's checker is loaded untyped at runtime.
// D2: seeded law weakenings on copies of Bend's demos. For each one:
//   (a) the gate (bend PROOF.bend) with the weakened LAWS/code and the proof unchanged
//   (b) the gate after the minimal proof edit an agent would make (and --verdict)
//   (c) the deterministic law-set diff (d2/lawdiff.ts) between the demo and (b)
// Implication proofs (d) live in d2/implications/ and run separately.
//
//   bun d2/weakenings.ts <bend-clone> <work-dir> > weakenings.json

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { lawDiff } from "./lawdiff.ts";

const CLONE = process.argv[2];
const WORK = process.argv[3];
const S = "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad";
const BEND = process.env.BEND ?? S + "/bendexp/bendc/bend";
const LEAN = process.env.LEAN_BIN ?? S + "/lean/lean-4.34.0-linux/bin";

type Edit = { file: string; old?: string; new?: string; content?: string; remove?: boolean };
type W = {
  id: string;
  demo: string;
  kind: string;
  desc: string;
  edits: Edit[]; // the weakening (LAWS.bend or the code)
  proofEdits?: Edit[]; // the minimal proof edit
  semantic: boolean; // a change of meaning (not a deletion/rename/move)
  control?: boolean; // not a weakening: an equivalent restatement or a refactor
};

const read = (demo: string, f: string) =>
  fs.readFileSync(path.join(CLONE, "demos", demo, f), "utf8");
// the text of a block from a start marker up to (not including) an end marker or EOF
function block(demo: string, f: string, start: string, end?: string): string {
  const s = read(demo, f);
  const i = s.indexOf(start);
  if (i < 0) throw new Error("no " + start + " in " + demo + "/" + f);
  const j = end === undefined ? s.length : s.indexOf(end, i + start.length);
  if (j < 0) throw new Error("no " + end + " in " + demo + "/" + f);
  return s.slice(i, j);
}

// ---- proof_insertion_sort --------------------------------------------------
const IS = "proof_insertion_sort";
const IS_SORTED_LAW = `law sort_sorted:
  for +xs: List<&2, Nat>
  Sort.Sorted(Sort.sort(xs))`;
const IS_PERM_LAW = `law sort_perm:
  for +x  : Nat
  for +xs : List<&2, Nat>
  {Sort.count(x, Sort.sort(xs)) == Sort.count(x, xs) : Nat}`;
const IS_SORTED_FILL = block(IS, "PROOF.bend", "def Laws.sort_sorted(xs):", "\n\n# Permutation");
const IS_PERM_FILL = block(IS, "PROOF.bend", "def Laws.sort_perm(x, xs):");
const IS_PERM_SECTION = block(IS, "PROOF.bend", "# Permutation\n");
const IS_SORTED_SECTION = block(IS, "PROOF.bend", "# Sortedness\n", "# Permutation\n");
// the old sortedness proof kept as a typed lemma
const SORTED_ALL = IS_SORTED_FILL.replace(
  "def Laws.sort_sorted(xs):",
  "def sorted_all(+xs: List<&2, Nat>) -> Sort.Sorted(Sort.sort(xs)):"
).replace("Laws.sort_sorted(t)", "sorted_all(t)");
const PERM_EQ = IS_PERM_FILL.replace(
  "def Laws.sort_perm(x, xs):",
  "def perm_eq(+x: Nat, +xs: List<&2, Nat>) -> {Sort.count(x, Sort.sort(xs)) == Sort.count(x, xs) : Nat}:"
).replace("%Laws.sort_perm(x, t)", "%perm_eq(x, t)");

// ---- app_win_is_bug_2d -----------------------------------------------------
const WIN = "app_win_is_bug_2d";
const WIN_WIN_FILL = block(
  WIN,
  "PROOF.bend",
  "def Laws.you_cant_win(moves):",
  "\n\ndef Laws.never_on_flag"
);
const WIN_FLAG_FILL = block(WIN, "PROOF.bend", "def Laws.never_on_flag(moves):");

// ---- proof_numerics --------------------------------------------------------
const NUM = "proof_numerics";
const NUM_COMM_FILL = block(
  NUM,
  "PROOF.bend",
  "def Laws.add_comm(a, b):",
  "\n\ndef Laws.add_assoc"
);
const NUM_DIST_FILL = block(NUM, "PROOF.bend", "def Laws.mul_dist(a, b, c):", "\n\n# Division");
const NUM_DIV_FILL = block(NUM, "PROOF.bend", "def Laws.divmod_ok(n, m):");

// ---- pure_par_sort / proof_typed_eval / io_http_server -----------------------
const PS = "pure_par_sort";
const PS_SORT_FILL = block(PS, "PROOF.bend", "def Laws.sort_leaves(d, s, t):");
const TE = "proof_typed_eval";
const TE_SOUND_FILL = block(TE, "PROOF.bend", "def Laws.opt_sound(t, e):");
const HTTP = "io_http_server";

const ws: W[] = [
  // ---------------- insertion sort
  {
    id: "IS1-delete",
    demo: IS,
    kind: "delete law",
    semantic: false,
    desc: "delete sort_perm",
    edits: [
      {
        file: "LAWS.bend",
        old:
          "\n# LAW: sort permutes its input: every value x occurs in sort(xs) as\n# often as it occurs in xs\n" +
          IS_PERM_LAW +
          "\n",
        new: "\n"
      }
    ],
    proofEdits: [{ file: "PROOF.bend", old: IS_PERM_FILL, new: "" }]
  },
  {
    id: "IS2-rename",
    demo: IS,
    kind: "rename law+proof",
    semantic: false,
    desc: "rename sort_sorted to sort_ascends",
    edits: [{ file: "LAWS.bend", old: "law sort_sorted:", new: "law sort_ascends:" }],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: IS_SORTED_FILL,
        new: IS_SORTED_FILL.replaceAll("Laws.sort_sorted", "Laws.sort_ascends")
      }
    ]
  },
  {
    id: "IS3-length",
    demo: IS,
    kind: "weaken conclusion",
    semantic: true,
    desc: "sortedness -> length preservation",
    edits: [
      {
        file: "LAWS.bend",
        old: IS_SORTED_LAW,
        new: `law sort_sorted:
  for +xs: List<&2, Nat>
  {List.length(&2, Nat, Sort.sort(xs)) == List.length(&2, Nat, xs) : Nat}`
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: IS_SORTED_FILL,
        new: `def ins_len.fin(+x: Nat, h: Nat, -t: List<&2, Nat>, rec: {1n+List.length(&2, Nat, t) == List.length(&2, Nat, Sort.insert(x, t)) : Nat}, c: Or(Sort.LE(x, h), Sort.LE(h, x)))
  -> {1n+1n+List.length(&2, Nat, t) == List.length(&2, Nat, Sort.dec(x, h, t, Sort.insert(x, t), c)) : Nat}:
  match c:
    case Inl{e}:
      {==}
    case Inr{e}:
      %rec : {1n+1n+List.length(&2, Nat, t) == 1n+_ : Nat}
      {==}

def ins_len(+x: Nat, +xs: List<&2, Nat>) -> {1n+List.length(&2, Nat, xs) == List.length(&2, Nat, Sort.insert(x, xs)) : Nat}:
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      ins_len.fin(x, h, t, ins_len(x, t), Sort.le_case(x, h))

def Laws.sort_sorted(xs):
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      %ins_len(h, Sort.sort(t)) : {_ == 1n+List.length(&2, Nat, t) : Nat}
      %Laws.sort_sorted(t) : {1n+List.length(&2, Nat, Sort.sort(t)) == 1n+_ : Nat}
      {==}`
      }
    ]
  },
  {
    id: "IS4-precond",
    demo: IS,
    kind: "narrow domain (precondition)",
    semantic: true,
    desc: "sort_sorted only for already-sorted inputs",
    edits: [
      {
        file: "LAWS.bend",
        old: IS_SORTED_LAW,
        new: `law sort_sorted:
  for +xs: List<&2, Nat>
  for h: Sort.Sorted(xs)
  Sort.Sorted(Sort.sort(xs))`
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: IS_SORTED_FILL,
        new: SORTED_ALL + "\n\ndef Laws.sort_sorted(xs, h):\n  sorted_all(xs)"
      }
    ]
  },
  {
    id: "IS5-trivial",
    demo: IS,
    kind: "trivially true body",
    semantic: true,
    desc: "sort_perm becomes count(x,xs) == count(x,xs)",
    edits: [
      {
        file: "LAWS.bend",
        old: "{Sort.count(x, Sort.sort(xs)) == Sort.count(x, xs) : Nat}",
        new: "{Sort.count(x, xs) == Sort.count(x, xs) : Nat}"
      }
    ],
    proofEdits: [
      { file: "PROOF.bend", old: IS_PERM_FILL, new: "def Laws.sort_perm(x, xs):\n  {==}\n" }
    ]
  },
  {
    id: "IS6-le",
    demo: IS,
    kind: "weaken conclusion",
    semantic: true,
    desc: "sort_perm: count equality -> count(x, sort xs) <= count(x, xs)",
    edits: [
      {
        file: "LAWS.bend",
        old: "{Sort.count(x, Sort.sort(xs)) == Sort.count(x, xs) : Nat}",
        new: "{Nat.is_le(Sort.count(x, Sort.sort(xs)), Sort.count(x, xs)) == True{} : Bool}"
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: IS_PERM_FILL,
        new:
          PERM_EQ +
          `
def le_refl(+n: Nat) -> {Nat.is_le(n, n) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

def Laws.sort_perm(x, xs):
  %Equal.sym(Nat, Sort.count(x, Sort.sort(xs)), Sort.count(x, xs), perm_eq(x, xs)) : {Nat.is_le(_, Sort.count(x, xs)) == True{} : Bool}
  le_refl(Sort.count(x, xs))
`
      }
    ]
  },
  {
    id: "IS7-defSorted",
    demo: IS,
    kind: "def change (spec helper)",
    semantic: true,
    desc: "Sorted.from in main.bend becomes Unit; LAWS.bend untouched",
    edits: [
      {
        file: "main.bend",
        old: `def Sorted.from(lo: Nat, xs: List<&2, Nat>) -> Type:
  match xs:
    case Nil{}:
      Unit
    case h <> t:
      (LE(lo, h) & Sorted.from(h, t))`,
        new: `def Sorted.from(lo: Nat, xs: List<&2, Nat>) -> Type:
  Unit`
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: IS_SORTED_SECTION,
        new: "# Sortedness\n# ----------\n\ndef Laws.sort_sorted(xs):\n  Unit{}\n\n"
      }
    ]
  },
  {
    id: "IS8-defCount",
    demo: IS,
    kind: "def change (spec helper)",
    semantic: true,
    desc: "count in main.bend returns 0n; LAWS.bend untouched",
    edits: [
      {
        file: "main.bend",
        old: `def count(+x: Nat, xs: List<&2, Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case h <> t:
      bump(Cmp.is_eq(Nat.cmp(x, h)), count(x, t))`,
        new: `def count(+x: Nat, xs: List<&2, Nat>) -> Nat:
  0n`
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: IS_PERM_SECTION,
        new: "# Permutation\n# -----------\n\ndef Laws.sort_perm(x, xs):\n  {==}\n"
      }
    ]
  },
  {
    id: "IS9-move",
    demo: IS,
    kind: "move law out of PROOF's imports",
    semantic: false,
    desc: "sort_perm moved to LAWS_MORE.bend, which PROOF.bend does not import",
    edits: [
      {
        file: "LAWS.bend",
        old:
          "\n# LAW: sort permutes its input: every value x occurs in sort(xs) as\n# often as it occurs in xs\n" +
          IS_PERM_LAW +
          "\n",
        new: "\n"
      },
      {
        file: "LAWS_MORE.bend",
        content:
          "import Base\nimport ./main.bend as Sort\n\n# LAW: sort permutes its input\n" +
          IS_PERM_LAW +
          "\n"
      }
    ],
    proofEdits: [{ file: "PROOF.bend", old: IS_PERM_FILL, new: "" }]
  },
  {
    id: "IS10-pairs",
    demo: IS,
    kind: "narrow domain (instantiate)",
    semantic: true,
    desc: "sort_sorted only for two-element lists",
    edits: [
      {
        file: "LAWS.bend",
        old: IS_SORTED_LAW,
        new: `law sort_sorted:
  for +a: Nat
  for +b: Nat
  Sort.Sorted(Sort.sort([a, b]))`
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: IS_SORTED_FILL,
        new: SORTED_ALL + "\n\ndef Laws.sort_sorted(a, b):\n  sorted_all([a, b])"
      }
    ]
  },

  // ---------------- win is bug
  {
    id: "WIN1-delete",
    demo: WIN,
    kind: "delete law",
    semantic: false,
    desc: "delete never_on_flag",
    edits: [
      {
        file: "LAWS.bend",
        old: block(WIN, "LAWS.bend", "\n# LAW: the player never stands on the flag"),
        new: "\n"
      }
    ],
    proofEdits: [{ file: "PROOF.bend", old: WIN_FLAG_FILL, new: "" }]
  },
  {
    id: "WIN2-onemove",
    demo: WIN,
    kind: "narrow domain (instantiate)",
    semantic: true,
    desc: "you_cant_win only for one-move sequences",
    edits: [
      {
        file: "LAWS.bend",
        old: "law you_cant_win:\n  for moves: List<Game.Move>\n  board = Game.replay(Game.start(), moves)",
        new: "law you_cant_win:\n  for m: Game.Move\n  board = Game.replay(Game.start(), [m])"
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: WIN_WIN_FILL,
        new:
          WIN_WIN_FILL.replace(
            "def Laws.you_cant_win(moves):",
            "def cant_win_all(moves: List<Game.Move>) -> {Game.is_won(Game.replay(Game.start(), moves)) == False{} : Bool}:"
          ) + "\n\ndef Laws.you_cant_win(m):\n  cant_win_all([m])"
      }
    ]
  },
  {
    id: "WIN3-trivial",
    demo: WIN,
    kind: "trivially true body",
    semantic: true,
    desc: "never_on_flag becomes at_flag(board) == at_flag(board)",
    edits: [
      {
        file: "LAWS.bend",
        old: "{Game.at_flag(board) == False{} : Bool}",
        new: "{Game.at_flag(board) == Game.at_flag(board) : Bool}"
      }
    ],
    proofEdits: [
      { file: "PROOF.bend", old: WIN_FLAG_FILL, new: "def Laws.never_on_flag(moves):\n  {==}\n" }
    ]
  },
  {
    id: "WIN4-defIsWon",
    demo: WIN,
    kind: "def change (law's def)",
    semantic: true,
    desc: "is_won in main.bend always answers False{}; LAWS.bend untouched",
    edits: [
      {
        file: "main.bend",
        old: "def is_won(g: Game) -> Bool:\n  Game{x, y, w} = g\n  w",
        new: "def is_won(g: Game) -> Bool:\n  False{}"
      }
    ]
  },

  // ---------------- numerics
  {
    id: "NUM1-dropBound",
    demo: NUM,
    kind: "weaken conclusion",
    semantic: true,
    desc: "divmod_ok drops the remainder bound r < 1+m",
    edits: [
      {
        file: "LAWS.bend",
        old: " & {True{} == (r < 1n+m : Nat) : Bool} & {n == Num.add",
        new: " & {n == Num.add"
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: NUM_DIV_FILL,
        new:
          NUM_DIV_FILL.replace(
            "def Laws.divmod_ok(n, m):",
            "def divmod_full(+n: Nat, +m: Nat) -> Ok(n, m, Num.divmod(n, 1n+m)):"
          ).replace("Laws.divmod_ok(p, m)", "divmod_full(p, m)") +
          `
def drop_bound(-n: Nat, -m: Nat, w: Ok(n, m, Num.divmod(n, 1n+m)))
  -> &q: Nat -> &r: Nat -> {(q, r) == Num.divmod(n, 1n+m) : Nat & Nat} & {n == Num.add(r, Num.mul(q, 1n+m)) : Nat}:
  (q, r, dq, le, eq) = w
  (q, r, dq, eq)

def Laws.divmod_ok(n, m):
  drop_bound(n, m, divmod_full(n, m))
`
      }
    ]
  },
  {
    id: "NUM2-zero",
    demo: NUM,
    kind: "narrow domain (instantiate)",
    semantic: true,
    desc: "add_comm only for b = 0",
    edits: [
      {
        file: "LAWS.bend",
        old: "law add_comm:\n  for  a: Nat\n  for +b: Nat\n  {Num.add(a, b) == Num.add(b, a) : Nat}",
        new: "law add_comm:\n  for  a: Nat\n  {Num.add(a, 0n) == Num.add(0n, a) : Nat}"
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: NUM_COMM_FILL,
        new: "def Laws.add_comm(a):\n  Equal.sym(Nat, a, Num.add(a, 0n), add_zero(a))"
      }
    ]
  },
  {
    id: "NUM3-delete",
    demo: NUM,
    kind: "delete law",
    semantic: false,
    desc: "delete mul_dist",
    edits: [
      {
        file: "LAWS.bend",
        old: block(NUM, "LAWS.bend", "# LAW: mul distributes", "# LAW: divmod"),
        new: ""
      }
    ],
    proofEdits: [{ file: "PROOF.bend", old: NUM_DIST_FILL, new: "" }]
  },
  {
    id: "NUM4-swap",
    demo: NUM,
    kind: "control: equivalent restatement",
    semantic: true,
    control: true,
    desc: "add_comm with its sides swapped",
    edits: [
      {
        file: "LAWS.bend",
        old: "{Num.add(a, b) == Num.add(b, a) : Nat}",
        new: "{Num.add(b, a) == Num.add(a, b) : Nat}"
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: NUM_COMM_FILL,
        new:
          NUM_COMM_FILL.replace(
            "def Laws.add_comm(a, b):",
            "def add_comm_old(a: Nat, +b: Nat) -> {Num.add(a, b) == Num.add(b, a) : Nat}:"
          ).replace("%Laws.add_comm(p, b)", "%add_comm_old(p, b)") +
          "\n\ndef Laws.add_comm(a, b):\n  Equal.sym(Nat, Num.add(a, b), Num.add(b, a), add_comm_old(a, b))"
      }
    ]
  },
  {
    id: "NUM5-outOfDomain",
    demo: NUM,
    kind: "control: code change outside the laws' domain",
    semantic: true,
    control: true,
    desc: "divmod by 0n answers (0n, 0n) instead of (0n, n); no law constrains d = 0",
    edits: [
      {
        file: "main.bend",
        old: "    case 0n:\n      (0n, n)\n    case 1n+m:\n      divmod.go(n, m)",
        new: "    case 0n:\n      (0n, 0n)\n    case 1n+m:\n      divmod.go(n, m)"
      }
    ]
  },

  // ---------------- par sort
  {
    id: "PS1-depth0",
    demo: PS,
    kind: "narrow domain (instantiate)",
    semantic: true,
    desc: "sort_leaves only for depth-0 trees",
    edits: [
      {
        file: "LAWS.bend",
        old: "law sort_leaves:\n  for +d: Nat\n  for s: Bool\n  for +t: Sort.Tree(d)\n  {Sort.sum(d, t) == Sort.sum(d, Sort.sort(d, s, t)) : Nat}",
        new: "law sort_leaves:\n  for s: Bool\n  for +t: Sort.Tree(0n)\n  {Sort.sum(0n, t) == Sort.sum(0n, Sort.sort(0n, s, t)) : Nat}"
      }
    ],
    proofEdits: [
      { file: "PROOF.bend", old: PS_SORT_FILL, new: "def Laws.sort_leaves(s, t):\n  {==}\n" }
    ]
  },
  {
    id: "PS2-rename",
    demo: PS,
    kind: "rename law+proof",
    semantic: false,
    desc: "rename mix_leaves to mix_sum",
    edits: [{ file: "LAWS.bend", old: "law mix_leaves:", new: "law mix_sum:" }],
    proofEdits: [{ file: "PROOF.bend", old: "Laws.mix_leaves", new: "Laws.mix_sum" }]
  },

  // ---------------- typed eval
  {
    id: "TE1-demote",
    demo: TE,
    kind: "delete law (kept as lemma)",
    semantic: false,
    desc: "opt_complete deleted from LAWS.bend; its proof kept as a lemma",
    edits: [
      {
        file: "LAWS.bend",
        old: block(TE, "LAWS.bend", "\n# LAW: the optimizer computes every program"),
        new: "\n"
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: "def Laws.opt_complete(t, e):",
        new: "def opt_complete_l(-t: TE.Ty, e: TE.Expr<t>) -> {TE.lit(t, TE.eval(t, e)) == TE.opt(t, e) : TE.Expr<t>}:"
      },
      { file: "PROOF.bend", old: "Laws.opt_complete(", new: "opt_complete_l(" }
    ]
  },
  {
    id: "TE2-numOnly",
    demo: TE,
    kind: "narrow domain (instantiate)",
    semantic: true,
    desc: "opt_sound only at type TNum",
    edits: [
      {
        file: "LAWS.bend",
        old: "law opt_sound:\n  for  t: TE.Ty\n  for  e: TE.Expr<t>\n  {TE.eval(t, TE.opt(t, e)) == TE.eval(t, e) : TE.Val(t)}",
        new: "law opt_sound:\n  for  e: TE.Expr<TE.TNum{}>\n  {TE.eval(TE.TNum{}, TE.opt(TE.TNum{}, e)) == TE.eval(TE.TNum{}, e) : TE.Val(TE.TNum{})}"
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: TE_SOUND_FILL,
        new:
          TE_SOUND_FILL.replace(
            "def Laws.opt_sound(t, e):",
            "def opt_sound_all(t: TE.Ty, e: TE.Expr<t>) -> {TE.eval(t, TE.opt(t, e)) == TE.eval(t, e) : TE.Val(t)}:"
          ) + "\ndef Laws.opt_sound(e):\n  opt_sound_all(TE.TNum{}, e)\n"
      }
    ]
  },

  // ---------------- http server
  {
    id: "H1-noBlank",
    demo: HTTP,
    kind: "weaken conclusion",
    semantic: true,
    desc: "page_after_blank no longer requires the blank line before the page",
    edits: [
      {
        file: "LAWS.bend",
        old: '{head ++ ("\\r\\n\\r\\n" ++ page) == Srv.http_response(page) : String}',
        new: "{head ++ page == Srv.http_response(page) : String}"
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: '("HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nConnection: close", {==})',
        new: '("HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nConnection: close\\r\\n\\r\\n", {==})'
      }
    ]
  },

  // ---------------- triangle
  {
    id: "TRI1-isSome",
    demo: "app_triangle_2d",
    kind: "weaken conclusion",
    semantic: true,
    desc: "click_inside: the count becomes n+1 -> the frame does not quit",
    edits: [
      {
        file: "LAWS.bend",
        old: "  {App.Tri.event(Mouse{x, y, button, True{}}, n) == Some{(n + 1 : U32)}\n    : Maybe<U32>}",
        new: "  {Maybe.is_some(&1, U32, App.Tri.event(Mouse{x, y, button, True{}}, n)) == True{} : Bool}"
      }
    ],
    proofEdits: [
      {
        file: "PROOF.bend",
        old: block(
          "app_triangle_2d",
          "PROOF.bend",
          "def Laws.click_inside(",
          "\n\ndef Laws.click_outside"
        ),
        new: "def Laws.click_inside(x, y, button, n, hit):\n  {==}"
      }
    ]
  },

  // ---------------- controls on the win demo
  {
    id: "WIN5-unfold",
    demo: WIN,
    kind: "control: equivalent restatement",
    semantic: true,
    control: true,
    desc: "replay(start(), moves) written as run(moves, start())",
    edits: [
      {
        file: "LAWS.bend",
        old: "law you_cant_win:\n  for moves: List<Game.Move>\n  board = Game.replay(Game.start(), moves)",
        new: "law you_cant_win:\n  for moves: List<Game.Move>\n  board = Game.run(moves, Game.start())"
      }
    ]
  },
  {
    id: "WIN6-refactor",
    demo: WIN,
    kind: "control: refactor under a law",
    semantic: false,
    control: true,
    desc: "drawn() uses the literal 7n for map_h() - 1",
    edits: [
      {
        file: "main.bend",
        old: "def drawn() -> String:\n  grid(Nat.sub(map_h(), 1n))",
        new: "def drawn() -> String:\n  grid(7n)"
      }
    ]
  }
];

function apply(dir: string, edits: Edit[]): string[] {
  const errs: string[] = [];
  for (const e of edits) {
    const p = path.join(dir, e.file);
    if (e.content !== undefined) {
      fs.writeFileSync(p, e.content);
      continue;
    }
    if (e.remove) {
      fs.rmSync(p);
      continue;
    }
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(e.old as string)) {
      errs.push("edit not found in " + e.file + ": " + (e.old as string).slice(0, 60));
      continue;
    }
    fs.writeFileSync(p, s.split(e.old as string).join(e.new as string));
  }
  return errs;
}

function gate(dir: string, verdict = false): { code: number | null; out: string } {
  const env = { ...process.env, BEND_NO_TELEMETRY: "1", PATH: LEAN + ":" + process.env.PATH };
  const r = spawnSync(BEND, verdict ? ["PROOF.bend", "--verdict"] : ["PROOF.bend"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 600000,
    env
  });
  return {
    code: r.status,
    out: ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").slice(0, 6).join("\n")
  };
}

const only = process.argv[4];
const results = [];
const baseline: Record<string, number | null> = {};
for (const d of new Set(ws.map((w) => w.demo)))
  baseline[d] = gate(path.join(CLONE, "demos", d)).code;
for (const w of ws) {
  if (only !== undefined && !w.id.startsWith(only)) continue;
  const src = path.join(CLONE, "demos", w.demo);
  const a = path.join(WORK, w.id, "a");
  const b = path.join(WORK, w.id, "b");
  fs.rmSync(path.join(WORK, w.id), { recursive: true, force: true });
  fs.mkdirSync(a, { recursive: true });
  fs.cpSync(src, a, { recursive: true });
  const errA = apply(a, w.edits);
  const ga = gate(a);
  fs.cpSync(a, b, { recursive: true });
  const errB = apply(b, w.proofEdits ?? []);
  const gb = w.proofEdits === undefined ? ga : gate(b);
  const vb = gate(b, true);
  const diff = await lawDiff(src, b);
  const proofLines = (d: string) =>
    fs.readFileSync(path.join(d, "PROOF.bend"), "utf8").split("\n").length;
  results.push({
    id: w.id,
    demo: w.demo,
    demoGateBaseline: baseline[w.demo],
    kind: w.kind,
    desc: w.desc,
    semantic: w.semantic,
    control: w.control ?? false,
    editErrors: [...errA, ...errB],
    gateUnchangedProof: ga,
    gateAfterProofEdit: gb,
    verdictAfterProofEdit: vb,
    proofEdited: w.proofEdits !== undefined,
    proofLinesDelta: proofLines(b) - proofLines(src),
    diff
  });
  process.stderr.write(
    `${w.id}: a=${ga.code} b=${gb.code} verdict=${vb.code} book=${JSON.stringify((diff.book as any).flagged)} closure=${JSON.stringify((diff.book as any).closureFlagged)} dir=${JSON.stringify((diff.dir as any).flagged)} ${errA.concat(errB).join(";")}\n`
  );
}
console.log(JSON.stringify(results, null, 1));
