import Kernel.Coverage
/-! `derive` (model §1, A.7.8): obligations, errors, exceptions, answers, severity, groups,
verdict and the core output (records §5). Every input collection is canonicalised first
(`Input.canon`), which is what makes the output permutation-invariant (T1). -/
namespace Shape

/-! ### Errors -/

def providerMissing (i : Input) : List (String × String) :=
  let e := i.env
  match e.base with
  | none => []
  | some Sb =>
    if !hasBase e then [] else
    Sb.provs.flatMap fun p =>
      if p.identity.isNone then [] else
      let mine := i.records.filter (fun r => r.provider == some p.q && r.authenticated)
      let obs := if p.produces.contains .observation && !mine.any (·.kind == .observation) then [("E-provider-missing", "provider " ++ p.q)] else []
      let decided := (e.head.claims.filter (fun c => c.isLaw && decidesLaw p c)).filter fun c =>
        (p.produces.contains .test || p.produces.contains .proof) &&
        !mine.any (fun r => r.claimFp == some c.fp && !fpMoved e (polStar i) c r)
      obs ++ decided.map (fun c => ("E-provider-missing", "provider " ++ p.q ++ " " ++ c.fp))

def exceptionErrors (i : Input) : List (String × String) :=
  i.headExcs.flatMap fun x =>
    let finalT := x.targetClaims.any (fun fp => i.env.head.claims.any (fun c => c.fp == fp && c.tier == .final))
    let tooLong := decide (x.expires > i.env.now + 365 * 86400)
    if finalT || tooLong then [("E-exception", "exception " ++ x.q)] else []

def errLt (a b : String × String) : Bool := strLt a.1 b.1 || (a.1 == b.1 && strLt a.2 b.2)

def errorsOf (i : Input) : List (String × String) :=
  let e := i.env
  sortBy errLt ((conductErrors e ++ structErrors e ++ providerMissing i ++ exceptionErrors i).foldr
    (fun x acc => if acc.contains x then acc else x :: acc) [])

/-! ### Raw obligations -/

def rawObs (i : Input) : List Ob :=
  let e := i.env
  effContras e i.records i.baseRecords ++ structContras e i.records i.baseRecords ++
    conductContras e i.records i.baseRecords ++ lawObs i ++ loosenObs i ++ coverageObs e i.records

/-! ### Exceptions (A.4.6) -/

def unitSelCovers (e : Env) (sel : String) (u : URef) : Bool :=
  if sel == "*" then true
  else if sel == "ungoverned" then u == .ungov
  else if strPrefix "component " sel then compOf e.head u == some (dropChars 10 sel)
  else if strPrefix "unit " sel then u == .unit (dropChars 5 sel)
  else u == .unit sel || compOf e.head u == some sel

def excAttributed (e : Env) (o : Ob) (k : String) : Bool :=
  match o.subject with
  | .codeAtom x _ => compOfId e.head e.mh x == some k
  | .unitAtom u _ => compOf e.head (.unit u) == some k
  | .fromTo a _ => a == k
  | .nodes ns => ns.contains k
  | .null => o.family == .law && o.affected.all (fun x => compOfId e.head e.mh x == some k)
  | .item _ => false

def excSubjOk (e : Env) (x : Exc) (o : Ob) : Bool :=
  match x.subjects with
  | none => true
  | some ss =>
    let inSel (y : String) := ss.any fun s => match s with
      | .code id => id == y
      | .unitSel sel => unitSelCovers e sel (att e.head e.mh y)
      | .pair _ _ => false
    match o.subject with
    | .codeAtom c _ => inSel c
    | .unitAtom u _ => ss.any (fun s => match s with | .unitSel sel => unitSelCovers e sel (.unit u) | _ => false)
    | .fromTo a b => ss.any (fun s => match s with | .pair p q => p == a && q == b | _ => false)
    | .null => o.family == .law && o.affected.all inSel
    | _ => false

def excMatchesClaim (e : Env) (x : Exc) (o : Ob) (fp : String) : Bool :=
  x.waives.contains o.kind.name && (x.targetClaims.contains fp || x.targetComp.any (excAttributed e o)) &&
    excSubjOk e x o

/-- The active exception matching every excluding claim, if any (never final, loosening
    or coverage). -/
def matchedBy (i : Input) (o : Ob) : Option String :=
  if o.tier == .final || !(o.kind == .contradiction || o.kind == .unestablished) || o.excl.isEmpty then none else
  let active := i.headExcs.filter (fun x => decide (i.env.now < x.expires))
  if o.excl.all (fun fp => active.any (fun x => excMatchesClaim i.env x o fp)) then
    (active.find? (fun x => o.excl.any (excMatchesClaim i.env x o))).map (·.q)
  else none

/-! ### Answers (A.7.6) -/

def answerRecs (i : Input) : List Record :=
  i.records.filter (fun r => r.kind == .judgment && r.result == .approves &&
    r.aboutChange.any (i.env.changeIds.contains ·))

def refHits (ref : String) (o : Ob) : Bool := decide (ref.length ≥ 19) && strPrefix ref o.binding

def namesOb (all : List Ob) (a : Record) (o : Ob) : Bool :=
  a.refs.any (fun rf => refHits rf o && (sortStrs ((all.filter (refHits rf)).map (·.key))).length == 1)

def eligibleAnswerers (i : Input) (all : List Ob) (o : Ob) (owner : String) (noAgent persons : Bool) : List String :=
  let S := govS i.env
  sortStrs (((answerRecs i).filter (fun a => namesOb all a o)).filterMap fun a =>
    a.judge.bind fun j =>
      if eligible i.env (polStar i) o.tier owner noAgent j a.authenticated && (!persons || isPerson S j) then some j else none)

/-- Every answer item of o has an eligible answer (A.7.6.5). -/
def answerItemsOk (i : Input) (all : List Ob) (o : Ob) : Bool :=
  let S := govS i.env
  match o.kind with
  | .loosening =>
    if o.tier == .final then
      let js1 := eligibleAnswerers i all o o.owner true true
      let js2 := eligibleAnswerers i all o S.owner true true
      js1.any (fun a => js2.any (fun b => a != b))
    else !(eligibleAnswerers i all o o.owner true false).isEmpty
  | .contradiction => o.force == some .heuristic && !(eligibleAnswerers i all o o.owner false false).isEmpty
  | .unestablished => o.reason == some .producerChanged && !(eligibleAnswerers i all o o.owner true false).isEmpty
  | .coverage =>
    let fin := o.tier == .final
    !(eligibleAnswerers i all o o.owner fin fin).isEmpty &&
      o.unmetFinal.all (fun ow => !(eligibleAnswerers i all o ow true true).isEmpty)

def discharged (i : Input) (all : List Ob) (o : Ob) : Bool := o.answerable && answerItemsOk i all o

/-- An exception answer: an eligible non-agent for each excluding claim's owner* (A.4.6.6). -/
def excAnswered (i : Input) (all : List Ob) (o : Ob) : Bool :=
  !o.exclOwners.isEmpty && o.exclOwners.all (fun ow => !(eligibleAnswerers i all o ow true false).isEmpty)

/-! ### Severity (A.7.5) -/

def blockClass : ObKind → String
  | .unestablished => "unestablished" | .coverage => "coverage" | .loosening => "latent-loosening"
  | .contradiction => ""

def sevOf (i : Input) (matched exAns : Bool) (o : Ob) : Severity :=
  if o.kind == .contradiction && o.force == some .sound && o.tier == .final then .blocking
  else if o.kind == .loosening && o.tier == .final then .blocking
  else if o.kind == .coverage && !o.unmetFinal.isEmpty then .blocking
  else if matched && (!o.introduced || exAns) then .owed
  else if hasBase i.env && !o.introduced then .owed
  else if o.kind == .contradiction then (if o.force == some .sound then .blocking else .owed)
  else if o.kind == .loosening && o.exploited == some true then .blocking
  else if o.kind == .unestablished && o.reason == some .producerChanged && o.reqInDelta then .blocking
  else if ((polStar i).tier o.tier).blocks.contains (blockClass o.kind) then .blocking
  else .owed

/-! ### Derivation -/

/-- Severity and exception of an open obligation; `exception` is set when the matched
    exception takes effect (debt, rule 5). -/
def finalize (i : Input) (raw : List Ob) (o : Ob) : Ob :=
  let m := matchedBy i o
  let exAns := m.isSome && excAnswered i raw o
  { o with severity := sevOf i m.isSome exAns o,
           exception := if m.isSome && (!o.introduced || exAns) then m else none }

/-- The open obligations, with severity and matched exception. -/
def deriveObs (inp : Input) : List Ob :=
  let i := inp.canon
  let raw := rawObs i
  (raw.filter (fun o => !discharged i raw o)).map (finalize i raw)

def answeredObs (inp : Input) : List Ob :=
  let i := inp.canon
  let raw := rawObs i
  raw.filter (discharged i raw)

/-- Matched, introduced obligations that an exception answer turned into debt (A.7.6.7). -/
def exceptionAnswered (inp : Input) : List Ob :=
  let i := inp.canon
  let raw := rawObs i
  raw.filter (fun o => !discharged i raw o && (matchedBy i o).isSome && o.introduced && excAnswered i raw o)

/-- Groups: components of shared support facts or shared affected finest changes. -/
def groupsOf (e : Env) (obs : List Ob) : List (String × String) :=
  let fin (o : Ob) := o.affected.filter (finest e)
  let linked (a b : Ob) := a.witness.any (b.witness.contains ·) || (fin a).any ((fin b).contains ·)
  let pairs := obs.flatMap (fun a => (obs.filter (linked a)).map (fun b => (a.key, b.key)))
  obs.map fun o => (o.key, groupId (reachSet pairs (fun _ => true) [o.key]))

/-! ### Core output (records §5) -/

def tierJ (t : Tier) : J := .str t.name

def obJ (o : Ob) : J :=
  .obj [("key", .str o.key), ("kind", .str o.kind.name),
        ("reason", match o.reason with | some r => .str r.name | none => .null),
        ("questions", if o.kind == .loosening then .arr (o.questions.map .str) else .null),
        ("introduced", .bool o.introduced), ("severity", .str o.severity.name), ("tier", tierJ o.tier),
        ("budget", .str (if o.mechanical then "mechanical" else "judgment")),
        ("force", match o.force with | some f => .str f.name | none => .null),
        ("owner", .str o.owner), ("group", .str o.group),
        ("claim", match o.claimFp with
          | some fp => .obj [("fp", .str fp), ("ids", .arr ((sortStrs o.claimIds).map .str)),
              ("tier", match o.claimTier with | some t => tierJ t | none => .null)]
          | none => .null),
        ("subject", o.subject.toJ), ("witness", .arr (o.witness.map .str)),
        ("exploited", match o.exploited with | some b => .bool b | none => .null),
        ("final", .bool (o.tier == .final)), ("binding", .str o.binding),
        ("exception", match o.exception with | some x => .str x | none => .null)]

def sevRank : Severity → Nat | .blocking => 0 | .owed => 1

def obLt (a b : Ob) : Bool :=
  let ka := (sevRank a.severity, a.kind.name, a.key)
  let kb := (sevRank b.severity, b.kind.name, b.key)
  decide (ka.1 < kb.1) || (ka.1 == kb.1 && (strLt ka.2.1 kb.2.1 || (ka.2.1 == kb.2.1 && strLt ka.2.2 kb.2.2)))

def dedupKey (obs : List Ob) : List Ob :=
  obs.foldl (fun acc o => if acc.any (·.key == o.key) then acc else acc ++ [o]) []

def verdictOf (errs : List (String × String)) (obs : List Ob) : String :=
  if !errs.isEmpty || obs.any (·.severity == .blocking) then "blocked"
  else if !obs.isEmpty then "owed" else "pass"

def ceilDiv (a b : Int) : Int := if b ≤ 0 then 0 else (a + b - 1) / b

/-- The core output document. -/
def deriveJ (inp : Input) : J :=
  let i := inp.canon
  let errs := errorsOf i
  let raw := rawObs i
  let gs := groupsOf i.env (dedupKey raw)
  let grp (o : Ob) : Ob := { o with group := ((gs.find? (·.1 == o.key)).map (·.2)).getD "" }
  let obs := sortBy obLt (dedupKey ((deriveObs inp).map grp))
  let ans := sortBy obLt (dedupKey ((answeredObs inp).map grp))
  let debt := obs.filter (fun o => o.exception.isSome && o.severity == .owed)
  .obj [("contract", .str "shape.check.output/v1"),
        ("mode", .str (if i.env.mode == .change then "change" else "audit")),
        ("verdict", .str (verdictOf errs (deriveObs inp))),
        ("errors", .arr (errs.map fun e => .obj [("code", .str e.1), ("subject", .str e.2)])),
        ("obligations", .arr (obs.map obJ)),
        ("answered", .arr ((ans.map fun o => .obj [("obligation", .str o.key), ("as", .str "discharge")]) ++
          ((sortBy obLt (dedupKey (exceptionAnswered inp))).map fun o =>
            .obj [("obligation", .str o.key), ("as", .str "exception-answer")]))),
        ("debt", .arr (debt.map fun o =>
          let exp := ((i.headExcs.find? (fun x => some x.q == o.exception)).map (·.expires)).getD 0
          .obj [("obligation", .str o.key), ("exception", optStrJ o.exception), ("owner", .str o.owner),
                ("expiresInDays", .num (ceilDiv (exp - i.env.now) 86400))]))]

def deriveText (inp : Input) : String := (deriveJ inp).jcs

end Shape
