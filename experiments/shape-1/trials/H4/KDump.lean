import Kernel.Parse
/-! H4 helper (not part of the kernel): prints the Lean kernel's loosening parts for one kernel
case, with the counterexamples that `shapek`'s core output does not show: L1/L2/L4/L7 parts
(subject, question, delta, affected, realisable (identity, atom) pairs) and, per base structural
claim, the `l3Decide` verdict with its edge or completing set.
Run from experiments/shape-1/kernel: `lake env lean --run <path>/KDump.lean case.json`. -/
open Shape

def jstr (s : String) : J := .str s
def partJ (p : LPart) (realised : Bool) : J :=
  .obj [("subject", jstr p.subject), ("question", jstr p.question), ("delta", .arr (p.delta.map jstr)),
        ("affected", .arr (p.affected.map jstr)),
        ("realise", .arr (p.realise.map fun r => .arr [jstr r.1, jstr r.2.show])),
        ("realised", .bool realised)]
def edgeJ (ed : Edge) : J := .arr [jstr ed.1, jstr ed.2.1, jstr ed.2.2]
def verdictJ : L3Verdict → J
  | .heir => .obj [("verdict", jstr "heir")]
  | .ga => .obj [("verdict", jstr "ga")]
  | .edgeCex ed => .obj [("verdict", jstr "edgeCex"), ("cex", .arr [edgeJ ed])]
  | .searchCex P => .obj [("verdict", jstr "searchCex"), ("cex", .arr (P.map edgeJ))]
  | .budget => .obj [("verdict", jstr "budget")]
  | .exhausted => .obj [("verdict", jstr "exhausted")]

def main (args : List String) : IO UInt32 := do
  let text ← match args with
    | path :: _ => IO.FS.readFile path
    | [] => (← IO.getStdin).readToEnd
  match J.parse text >>= parseInput with
  | .error msg => IO.println ((J.obj [("error", jstr msg)]).jcs); return 2
  | .ok i =>
    let e := i.env
    match e.base with
    | none => IO.println ((J.obj [("parts", .arr []), ("l3", .arr [])]).jcs); return 0
    | some Sb =>
      let parts := l1Parts e Sb ++ l2Parts e Sb ++ l4Parts e Sb ++ l7Parts i Sb
      let heads := e.head.claims.filter (·.isStructUpper)
      let W := canon (declEdges e.head)
      let G := gaEdges (heads.map (·.op)) W (candEdges e.head)
      let l3 := (Sb.claims.filter (·.isStructUpper)).map fun cb =>
        J.obj [("subject", jstr cb.fp), ("decision", verdictJ (l3Decide (heads.map (·.op)) cb.op W G))]
      let pj := parts.map fun p => partJ p (p.realise.any (realised e i.records))
      IO.println ((J.obj [("parts", .arr pj), ("l3", .arr l3)]).jcs)
      return 0
