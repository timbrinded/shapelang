import Kernel.Parse
/-! DRT triage helper (not part of the kernel): prints the Lean kernel's raw obligations with the
internals the core output hides (affected, code rows, delta, excluding claims, answerable,
mechanical, unmetFinal), the law evaluation per record (recFor, usability reason, contradiction
force, R*), the loosening parts and the uncovered identities with their unmet (claim, channel)
pairs. Built as an extra executable in a scratch copy of the kernel project:
`kobdump case.json`. -/
open Shape

def js (s : String) : J := .str s
def optS : Option String → J | some s => .str s | none => .null
def rowJ (r : CodeRow) : J := .arr [js r.1, js r.2.1, optS r.2.2.1, optS r.2.2.2]
def reasonJ : Option Reason → J | some r => js r.name | none => .null

def obInternals (o : Ob) : J :=
  .obj [("key", js o.key), ("kind", js o.kind.name), ("claim", optS o.claimFp), ("subject", o.subject.toJ),
        ("tier", js o.tier.name), ("owner", js o.owner), ("introduced", .bool o.introduced),
        ("reason", reasonJ o.reason), ("force", match o.force with | some f => js f.name | none => .null),
        ("questions", .arr (o.questions.map js)), ("affected", .arr (o.affected.map js)),
        ("code", .arr (o.code.map rowJ)), ("delta", .arr (o.delta.map js)), ("witness", .arr (o.witness.map js)),
        ("excl", .arr (o.excl.map js)), ("exclOwners", .arr (o.exclOwners.map js)),
        ("exploited", match o.exploited with | some b => .bool b | none => .null),
        ("answerable", .bool o.answerable), ("mechanical", .bool o.mechanical),
        ("unmetFinal", .arr (o.unmetFinal.map js)), ("reqInDelta", .bool o.reqInDelta), ("binding", js o.binding)]

def reqJ' (r : Req) : J :=
  .obj [("level", js r.level.name), ("judged", .bool r.judged), ("pins", .arr (r.pins.map js)), ("proj", js r.proj)]

def lawEval (i : Input) (c : Claim) : J :=
  let e := i.env
  let pol := polStar i
  .obj [("fp", js c.fp), ("ids", .arr (c.ids.map js)), ("reqStar", reqJ' (reqStar e pol c)),
        ("req", .arr ((lawReq i c).map (fun p => .arr [js p.1, js p.2]))),
        ("sat", .bool (lawSat i c)), ("soundContra", .bool (lawSoundContra i c)),
        ("records", .arr (i.records.filterMap fun r =>
          if r.claimFp == some c.fp then
            some (.obj [("id", js r.id), ("kind", js (match r.kind with | .test => "test" | .proof => "proof" | .judgment => "judgment" | .observation => "observation" | .equivalence => "equivalence")),
              ("recFor", .bool (recFor e pol c r)), ("usab", reasonJ (usab e pol c r)),
              ("fpMoved", .bool (fpMoved e pol c r)), ("reqCited", .bool (reqCited e pol c r)), ("revTied", .bool (revTied e r)),
              ("isPC", .bool (isPC e r)), ("assumption", .bool (hasAssumption e c r)), ("weak", .bool (isWeak e pol c r)),
              ("expired", .bool (isExpired e pol c r)),
              ("contraForce", match lawContraForce e pol c r with | some f => js f.name | none => .null),
              ("judge", optS r.judge), ("auth", .bool r.authenticated)])
          else none))]

def partJ (p : LPart) : J :=
  .obj [("subject", js p.subject), ("question", js p.question), ("tier", js p.tier.name), ("owner", js p.owner),
        ("delta", .arr (p.delta.map js)), ("affected", .arr (p.affected.map js)), ("exploited", .bool p.exploited),
        ("realise", .arr (p.realise.map fun r => .arr [js r.1, js r.2.show]))]

def main (args : List String) : IO UInt32 := do
  let text ← match args with
    | path :: _ => IO.FS.readFile path
    | [] => (← IO.getStdin).readToEnd
  match J.parse text >>= parseInput with
  | .error msg => IO.println ((J.obj [("error", js msg)]).jcs); return 2
  | .ok inp =>
    let i := inp.canon
    let e := i.env
    let raw := rawObs i
    let parts := match e.base with
      | some Sb => if hasBase e then l1Parts e Sb ++ l2Parts e Sb i.records ++ l3Parts e i.records Sb ++ l4Parts e Sb ++ l7Parts i Sb else []
      | none => []
    let unc := (uncovered e i.records).map fun p =>
      J.obj [("id", js p.1), ("unmet", .arr (p.2.map fun q => .arr [js q.1.fp, js q.2.str]))]
    IO.println ((J.obj [("errors", .arr ((errorsOf i).map fun x => .arr [js x.1, js x.2])),
      ("raw", .arr (raw.map obInternals)),
      ("discharged", .arr ((raw.filter (discharged i raw)).map (fun o => js o.key))),
      ("laws", .arr ((e.head.claims.filter (·.isLaw)).map (lawEval i))),
      ("parts", .arr (parts.map partJ)),
      ("uncovered", .arr unc), ("coverageSet", .arr ((coverageSet e i.records).map js)),
      ("authors", .arr (e.authors.map js))]).jcs)
    return 0
