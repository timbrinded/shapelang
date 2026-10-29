import Kernel.Loosen
/-! `derive` (model §1, A.7.8): obligations of every kind, bindings and groups (A.7.2), exceptions
(A.4.6), answers and exception answers (A.7.6), the two-person final-loosening re-run of tier*
(A.6.2.3, A.16.13), producer-change acceptance (A.5.4.6), severity (A.7.5, A.16.24), dischargers
(A.16.27), budget (A.10.3), debt (A.7.7), health (A.16.30) and the complete core output
(records §5, A.12.10, A.16.31). Executable layer. -/
namespace Shape

open Std

/-! ### Small encoders -/

def disJ (act by_ : String) (agentSafe : Bool) (eligible : List String) (creates : J := .null) : J :=
  .obj [("act", .str act), ("by", .str by_), ("agentSafe", .bool agentSafe), ("eligible", jstrsJ eligible),
        ("creates", creates)]

def causesJ (cs : List (String × String)) : J :=
  .arr (cs.map fun (t, i) => .obj [("type", .str t), ("id", .str i)])

def kerrJ (e : KErr) : J :=
  .obj [("code", .str e.code), ("subject", .str e.subject), ("causes", causesJ e.causes), ("dischargers", e.dischargers)]

def errKey (e : KErr) : List String := [e.code, e.subject]

/-! ### Answers (A.7.6) -/

structure Ans where
  actor : String
  refs : List String
  source : String
  deriving Inhabited

def Ctx.answers (c : Ctx) : List Ans :=
  if c.mode == .preview then [] else
  let fromRecs := (c.records.filter fun r => r.kind == .judgment && r.result == .approves && r.authenticated &&
      (r.aboutChange.map (c.inp.changeIds.contains ·)).getD false && r.judge.isSome).map fun r =>
    ({ actor := r.judge.getD "", refs := r.refs, source := r.id } : Ans)
  let fromRev := if c.hasRelay then [] else c.inp.reviews.filterMap fun rv =>
    match rv.actor with
    | some a =>
      let toks := (splitChar ' ' (trimS rv.line)).filter (· != "")
      match toks with
      | "shape" :: "approve" :: refs =>
        if (match rv.change with | some ch => c.inp.changeIds.contains ch | none => true) then
          some ({ actor := a, refs := refs, source := rv.ref } : Ans)
        else none
      | _ => none
    | none => none
  fromRecs ++ fromRev

def isBindingRef (r : String) : Bool :=
  strPrefix "bd:" r && r.length ≥ 19 && (dropChars 3 r).toList.all (fun ch => ch.isDigit || ('a' ≤ ch && ch ≤ 'f'))

/-! ### The obligation set of one pass -/

structure Pass where
  obs : List Ob := []
  laws : List LawEval := []
  cov : CovResult := {}
  errors : List KErr := []
  deriving Inhabited

def Ctx.reqRows (c : Ctx) (ps : List Pair) : List CodeRow :=
  ps.map fun p => (p.1, p.2, c.mb.digest p.1 p.2, c.mh.digest p.1 p.2)

def Ctx.lawObs (c : Ctx) (le : LawEval) : List Ob :=
  let cl := le.claim
  let reqIds := sortStrs (le.bindingReq.map (·.1))
  let rows := c.reqRows le.bindingReq
  let contra := match le.soundContra with
    | some e => some (e, "sound")
    | none => le.heurContras.head?.map (fun e => (e, "heuristic"))
  let co : List Ob := match contra with
    | some (e, f) =>
      [{ kind := "contradiction", key := obKey "contradiction" (some cl.fp) .null, claim := some cl, subject := .null,
         force := some f, tier := le.tier, owner := c.ownerStar cl, introduced := le.introC,
         affected := reqIds, code := rows, witness := [e.record.id],
         counterexample := e.record.counterexample.getD .null,
         causes := [("record", e.record.id), ("claim", cl.fp)], excluding := [cl], isLaw := true, reqIds := reqIds }]
    | none => []
  let un : List Ob :=
    if le.sat || le.soundContra.isSome then [] else
    let reason := le.reason.getD "missing"
    let pc := reason == "producer-changed"
    let holder := (le.evals.filter (fun e => e.judgeOk && (e.applicable || e.partialCite) && e.reason == some reason)).map (·.record.id)
    let holder1 := (sortStrs holder).head?
    let pcRows : List CodeRow := if pc then le.pcFinest.map (fun x => (x, "own", c.mb.digest x "own", c.mh.digest x "own")) else []
    [{ kind := "unestablished", key := obKey "unestablished" (some cl.fp) .null, claim := some cl, subject := .null,
       reason := some reason, tier := le.tier, owner := c.ownerStar cl, introduced := le.introU,
       affected := sortStrs (reqIds ++ (if pc then le.pcFinest else [])), code := rows ++ pcRows,
       causes := (holder1.map (fun h => [("record", h)])).getD [], excluding := [cl], isLaw := true, reqIds := reqIds,
       pcReqDelta := pc && le.bindingReq.any (fun p => c.delta.pairIn p.1 p.2),
       tokens := if pc then le.pcFinest.map ("p:" ++ ·) else [] }]
  co ++ un

def Ctx.loosenObs (c : Ctx) (lr : LResult) : List Ob :=
  let subjects := sortStrs (lr.parts.map (·.subject))
  let qOrd (q : String) : Nat := match q with
    | "L0" => 0 | "L1" => 1 | "L3" => 3 | "L4" => 4 | "L6" => 6 | _ => 7
  subjects.map fun s =>
    let ps := sortWith (fun a b => qOrd a.question < qOrd b.question) (lr.parts.filter (·.subject == s))
    let t := if !c.readable then Tier.critical else c.subjTier s
    let owner := if !c.readable then c.head.owner else c.subjOwner s
    let affected := sortStrs (ps.flatMap (·.affected))
    let ce := ((ps.filter (fun p => !p.counterexample.isNull)).head?.map (·.counterexample)).getD .null
    { kind := "loosening", key := obKey "loosening" none (.str s), claim := c.bClaims.get? s, subject := .str s,
      questions := some (sortStrs (ps.map (·.question))), tier := t, owner := owner, introduced := c.hasBase,
      affected := affected, code := c.finestRows affected, delta := sortStrs (ps.flatMap (·.delta)),
      support := sortStrs (ps.flatMap (·.realised)), counterexample := ce,
      exploited := some (ps.any (·.exploited)), causes := [("base-claim", s)], parts := ps,
      tokens := ["b:" ++ s] }

def Ctx.coverageObs (c : Ctx) (cr : CovResult) : List Ob :=
  let depRows (xs : List String) : List CodeRow := xs.map (fun d => (d, "own", c.mb.digest d "own", c.mh.digest d "own"))
  -- A.7.4.4: an obligation whose tier is below normal is health only, never raised
  let cov := (cr.obligations.filter (fun k => k.tier.rank ≥ Tier.normal.rank)).map fun k =>
    let delta := sortStrs (k.unmet.map (fun u => u.2.1 ++ " " ++ u.2.2.1))
    let depChanged := k.depCode.filter (c.delta.inDelta ·)
    ({ kind := "coverage", key := obKey "coverage" none (.str k.subject), subject := .str k.subject,
       tier := k.tier, owner := k.owner, introduced := c.hasBase, affected := k.uncovered,
       code := c.finestRows k.uncovered ++ depRows depChanged, delta := delta,
       causes := k.uncovered.map (fun x => ("code", x)), isCoverage := true, covComp := k.comp,
       covUnmet := k.unmetClaims, covFinal := k.finalClaims } : Ob)
  let voc := cr.vocab.map fun v =>
    ({ kind := "coverage", key := obKey "coverage" none (.str v.subject), subject := .str v.subject,
       tier := v.tier, owner := c.gov.owner, introduced := c.hasBase, affected := sortStrs v.sites,
       code := c.finestRows v.sites, support := sortStrs (v.facts.map (·.fid)),
       causes := (sortStrs (v.facts.map (·.fid))).map (fun f => ("fact", f)), isVocab := true } : Ob)
  cov ++ voc

def Ctx.exceptionErrors (c : Ctx) : List KErr :=
  c.head.excs.filterMap fun x =>
    let finalT := x.targetClaims.any (fun fp => ((c.hClaims.get? fp).map (·.tier == .final)).getD false)
    let tooLong := decide (x.expires > c.now + 365 * 86400)
    let sigmaLaw := x.subjects.isSome && x.targetClaims.any (fun fp => ((c.hClaims.get? fp).map (·.isLaw)).getD false)
    let unknown := x.targetClaims.isEmpty && x.targetComp.isNone
    if finalT || tooLong || sigmaLaw || unknown then some { code := "E-exception", subject := "exception " ++ x.q } else none

def ufRoot (fuel : Nat) (p : Array Nat) (i : Nat) : Nat :=
  match fuel with
  | 0 => i
  | fuel + 1 => let j := p.getD i i; if j == i then i else ufRoot fuel p j

def Ctx.pass (c : Ctx) (lr : LResult) (pcAcc : List (String × List String)) : Pass := Id.run do
  let reported := c.baseReported
  let lowerFps := c.baseLowerFps
  let newF := c.factNew reported lowerFps
  let tierOf (cl : Claim) : Tier := c.tierStar cl ((lr.haOf.get? cl.fp).getD [])
  let eff := c.evalEffects newF
  let st := c.evalStructure newF tierOf
  let low := c.evalLower tierOf
  let laws := (c.head.claims.filter (·.isLaw)).map fun cl =>
    c.evalLaw cl (((pcAcc.find? (·.1 == cl.fp)).map (·.2)).getD [])
  let lawO := laws.flatMap c.lawObs
  let cov := c.coverage
  let obs := eff.obs ++ st.obs ++ low ++ lawO ++ c.loosenObs lr ++ c.coverageObs cov
  let obs := obs.map fun o => { o with introduced := c.hasBase && o.introduced }
  let obs := obs.map fun o => { o with binding := bindingOf o.key o.affected o.code o.delta }
  -- groups (A.7.2.3): shared support facts, affected finest changes, provider-change identities,
  -- base items named in causes
  let tokensOf (o : Ob) : List String :=
    o.support.map ("f:" ++ ·) ++ (o.affected.filter (c.delta.finest.contains ·)).map ("x:" ++ ·) ++ o.tokens
  let arr := obs.toArray
  let mut parent : Array Nat := Array.range arr.size
  let mut owner : HashMap String Nat := {}
  for i in [0:arr.size] do
    for t in tokensOf (arr.getD i default) do
      match owner.get? t with
      | none => owner := owner.insert t i
      | some j =>
        let a := ufRoot arr.size parent i
        let b := ufRoot arr.size parent j
        if a != b then parent := parent.set! (max a b) (min a b)
  let roots := (List.range arr.size).map (ufRoot arr.size parent)
  let keysOf (r : Nat) : List String := ((List.range arr.size).filter (fun i => roots.getD i i == r)).map (fun i => (arr.getD i default).key)
  let obs := (List.range arr.size).map fun i =>
    let o := arr.getD i default
    { o with group := groupId (keysOf (roots.getD i i)) }
  let errs := eff.errors ++ st.errors ++ c.providerMissing laws ++ c.manifestMissing ++ c.exceptionErrors
  return { obs := obs, laws := laws, cov := cov, errors := errs }

/-! ### Exceptions (A.4.6) -/

def Ctx.unitSelHas (c : Ctx) (sel x : String) : Bool :=
  let u := c.Wh.att1 x
  if sel == "*" then true
  else if sel == "ungoverned" then u == .ungov
  else if strPrefix "component " sel then c.Wh.compOfU u == some (dropChars 10 sel)
  else if strPrefix "unit " sel then u == .unit (dropChars 5 sel)
  else if strPrefix "code " sel then x == srcRefId (dropChars 5 sel) || x == dropChars 5 sel
  else u == .unit sel

def Ctx.inSigma (c : Ctx) (ss : List ExcSubj) (x : String) : Bool :=
  ss.any fun s => match s with
    | .code id => id == x || srcRefId id == x
    | .unitSel sel => c.unitSelHas sel x
    | .pair _ _ => false

def Ctx.attributedTo (c : Ctx) (o : Ob) (k : String) : Bool :=
  let code := c.Wh.compCode k c.mh
  if o.isLaw then !o.reqIds.isEmpty && o.reqIds.all (code.contains ·) else
  match o.subject with
  | .obj kvs =>
    match kvs.find? (·.1 == "code"), kvs.find? (·.1 == "from"), kvs.find? (·.1 == "nodes"), kvs.find? (·.1 == "unit") with
    | some (_, .str x), _, _, _ => code.contains x
    | _, some (_, .str a), _, _ => a == k
    | _, _, some (_, .arr ns), _ => ns.any (fun n => n.str? == some k)
    | _, _, _, some (_, .str u) => (c.Wh.unitsBy.get? u).map (·.comp) == some k
    | _, _, _, _ => false
  | _ => false

def Ctx.excMatches (c : Ctx) (x : Exc) (o : Ob) (cl : Claim) : Bool :=
  x.waives.contains o.kind && decide (c.now < x.expires) &&
  (x.targetClaims.contains cl.fp ||
   (match x.targetComp with
    | some k => cl.tier != .final && c.attributedTo o k
    | none => false)) &&
  (match x.subjects with
   | none => true
   | some ss =>
     if o.isLaw then !o.reqIds.isEmpty && o.reqIds.all (c.inSigma ss)
     else match o.subject with
       | .obj kvs =>
         match kvs.find? (·.1 == "code"), kvs.find? (·.1 == "from"), kvs.find? (·.1 == "to") with
         | some (_, .str y), _, _ => c.inSigma ss y
         | _, some (_, .str a), some (_, .str b) => ss.any (fun s => match s with | .pair p q => p == a && q == b | _ => false)
         | _, _, _ => false
       | _ => false)

/-- Every excluding claim matched by an active exception (never tier*(o) final). Returns the
    matching exceptions, sorted by id. -/
def Ctx.matchedBy (c : Ctx) (o : Ob) : List Exc :=
  if o.tier == .final || !(o.kind == "contradiction" || o.kind == "unestablished") then [] else
  let excl := if o.excluding.isEmpty then o.claim.toList else o.excluding
  if excl.isEmpty then [] else
  if excl.all (fun cl => c.head.excs.any (fun x => c.excMatches x o cl)) then
    sortOn (·.q) (c.head.excs.filter (fun x => excl.any (c.excMatches x o)))
  else []

def earliest (xs : List Exc) : Option Exc :=
  minWith? (fun a b => a.expires < b.expires || (a.expires == b.expires && strLt a.q b.q)) xs

/-! ### Answer items (A.7.6.5–6, A.6.3.4, A.16.12) -/

/-- The answers naming o: refs expanding to the unique obligation whose binding begins with them. -/
def answersNaming (all : List Ob) (as : List Ans) (o : Ob) : List Ans :=
  as.filter fun a => a.refs.any fun r =>
    isBindingRef r && strPrefix r o.binding && (all.filter (fun m => strPrefix r m.binding)).length == 1

structure AnsRes where
  ok : Bool
  self : Bool
  sources : List String
  /-- the actors whose answers the self fallback made eligible (A.16.30, A.16.43) -/
  selfActors : List String := []
  deriving Inhabited

/-- Items with eligible answerers; final items need two persons (one of each required actor). -/
def Ctx.itemsOk (c : Ctx) (as : List Ans) (t : Tier) (items : List (String × Bool)) (finalOwners : List String) : AnsRes := Id.run do
  let mut self := false
  let mut selfActors : List String := []
  let mut srcs : List String := []
  for (owner, noAgent) in items do
    let q : EQ := { tier := t, owner := owner, noAgent := noAgent, final := false }
    let hits := as.filter (fun a => (c.eligible q a.actor).isSome)
    if hits.isEmpty then return { ok := false, self := false, sources := [] }
    if hits.any (fun a => c.eligible q a.actor == some true) && !hits.any (fun a => c.eligible q a.actor == some false) then
      self := true
      selfActors := selfActors ++ (hits.filter (fun a => c.eligible q a.actor == some true)).map (·.actor)
    srcs := srcs ++ hits.map (·.source)
  if !finalOwners.isEmpty then
    -- two distinct eligible persons covering every required actor, no agent, no fallback
    let elig := as.filter fun a => finalOwners.any fun ow =>
      c.eligible { tier := .final, owner := ow, noAgent := true, final := true } a.actor == some false
    if !c.twoPersons (elig.map (·.actor)) finalOwners then return { ok := false, self := false, sources := [] }
    srcs := srcs ++ elig.map (·.source)
  return { ok := true, self := self, sources := sortStrs srcs, selfActors := sortStrs selfActors }

def Ctx.answerItems (c : Ctx) (o : Ob) (as : List Ans) : AnsRes :=
  let fin := o.tier == .final
  let shapeO := c.gov.owner
  match o.kind with
  | "loosening" =>
    if fin then c.itemsOk as o.tier [] [o.owner, shapeO]
    else c.itemsOk as o.tier [(o.owner, true)] []
  | "contradiction" =>
    if o.force != some "heuristic" then { ok := false, self := false, sources := [] } else
    match o.claim with
    | some cl => if fin then c.itemsOk as o.tier [] [c.ownerStar cl, shapeO] else c.itemsOk as o.tier [(c.ownerStar cl, false)] []
    | none => { ok := false, self := false, sources := [] }
  | "unestablished" =>
    if o.reason != some "producer-changed" then { ok := false, self := false, sources := [] } else
    match o.claim with
    | some cl => if fin then c.itemsOk as o.tier [] [c.ownerStar cl, shapeO] else c.itemsOk as o.tier [(c.ownerStar cl, true)] []
    | none => { ok := false, self := false, sources := [] }
  | "coverage" =>
    if o.isVocab then c.itemsOk as o.tier [(shapeO, false)] []
    else
      let kOwner := o.owner
      let nonFinal := (o.covUnmet.filter (fun f => !o.covFinal.contains f)).filterMap (c.hClaims.get? ·)
      let items := (if o.covFinal.isEmpty then [(kOwner, false)] else []) ++ nonFinal.map (fun cl => (c.ownerStar cl, false))
      let finals := if o.covFinal.isEmpty then [] else
        sortStrs (o.covFinal.filterMap (fun f => (c.hClaims.get? f).map c.ownerStar) ++ [kOwner, shapeO])
      c.itemsOk as o.tier items finals
  | _ => { ok := false, self := false, sources := [] }

def Ctx.exceptionAnswer (c : Ctx) (o : Ob) (as : List Ans) : AnsRes :=
  let excl := if o.excluding.isEmpty then o.claim.toList else o.excluding
  c.itemsOk as o.tier (excl.map (fun cl => (c.ownerStar cl, true))) []

def answerable (o : Ob) : Bool :=
  o.kind == "loosening" || o.kind == "coverage" ||
  (o.kind == "contradiction" && o.force == some "heuristic") ||
  (o.kind == "unestablished" && o.reason == some "producer-changed")

/-! ### Severity (A.7.5.1, A.16.24) -/

def Ctx.severity (c : Ctx) (o : Ob) (matched excAns : Bool) : String × Nat :=
  if o.kind == "contradiction" && o.force == some "sound" && o.introduced && o.tier == .final then ("blocking", 2)
  else if o.kind == "loosening" && (o.questions.getD []).contains "L0" then ("blocking", 3)
  else if o.kind == "loosening" && o.tier == .final then ("blocking", 4)
  else if o.isCoverage && !o.covFinal.isEmpty then ("blocking", 4)
  else if matched && (!o.introduced || excAns) then ("owed", 5)
  else if !o.introduced then ("owed", 6)
  else if o.kind == "contradiction" then (if o.force == some "sound" then "blocking" else "owed", 7)
  else if o.kind == "loosening" && o.exploited == some true then ("blocking", 8)
  else if o.kind == "unestablished" && o.reason == some "producer-changed" && o.pcReqDelta then ("blocking", 8)
  else
    let blocks := (c.pol.tier o.tier).blocks
    let k := if o.kind == "loosening" then "latent-loosening" else o.kind
    (if blocks.contains k then "blocking" else "owed", 9)

/-! ### Dischargers (A.16.27) -/

def Ctx.agentsListed (c : Ctx) (t : Tier) : Bool := t != .final && (c.pol.tier t).judges.contains "agents"

def Ctx.createsFor (c : Ctx) (o : Ob) : J :=
  match o.claim with
  | none => .null
  | some cl =>
    if ((c.heirOf.get? cl.fp).getD []).isEmpty then .null else
    let fin := o.tier == .final
    .obj [("kind", .str "loosening"), ("tier", .str o.tier.name), ("answers", .num (if fin then 2 else 1)),
          ("owners", jstrsJ ([c.ownerStar cl] ++ (if fin then [c.gov.owner] else [])))]

def Ctx.eligFor (c : Ctx) (t : Tier) (owner : String) (noAgent : Bool) : List String :=
  c.eligibleNow { tier := t, owner := owner, noAgent := noAgent, final := t == .final }

def Ctx.dischargers (c : Ctx) (o : Ob) (le? : Option LawEval) : List J :=
  let fin := o.tier == .final
  let excl := if o.excluding.isEmpty then o.claim.toList else o.excluding
  let excElig := sortStrs ((excl.flatMap fun cl => c.eligFor o.tier (c.ownerStar cl) true).filter c.isPerson)
  let exc : List J := if fin then [] else [disJ "exception" "judges" false excElig]
  let editShape := disJ "edit-shape" "author" true [] (if o.isLaw then c.createsFor o else c.createsFor o)
  let claimOwner := (o.claim.map c.ownerStar).getD c.gov.owner
  match o.kind with
  | "contradiction" =>
    let base := [disJ "edit-code" "author" true []] ++ exc ++ [editShape]
    if o.force == some "heuristic" then
      [disJ "answer" "judges" (c.agentsListed o.tier) (c.eligFor o.tier claimOwner false)] ++ base
    else base
  | "unestablished" =>
    let lower := disJ "lower-requirement" "author" true [] (c.createsFor o)
    let judged := (le?.map (·.req.judged)).getD false
    let judgeD := disJ "judge" "judges" (c.agentsListed o.tier) (c.eligFor o.tier claimOwner false)
    let rerunOk := match o.claim with
      | some cl => c.provs.any fun g =>
        (decidesClaim g.decidesA cl) &&
        ((g.base.toList ++ g.head.toList).any fun p =>
          p.produces.contains .observation || p.produces.contains .test || (p.produces.contains .proof && !p.persist))
      | none => false
    let first : List J := match o.reason.getD "missing" with
      | "producer-changed" => [disJ "answer" "judges" false (c.eligFor o.tier claimOwner true)]
      | "assumption" => [disJ "edit-code" "author" true [], disJ "declare" "author" false [] (c.createsFor o)]
      | "expired" => [judgeD]
      | _ =>
        (if rerunOk then [disJ "rerun" "ci" true []] else if !judged then [disJ "provide" "author" true []] else []) ++
        (if judged then [judgeD] else [])
    first ++ exc ++ [lower]
  | "loosening" =>
    let hint := o.parts.any (·.hintUndecided)
    let l4u := o.parts.any (fun p => p.question == "L4" && p.answer == "undecided")
    let elig :=
      if fin then sortStrs ((c.roleUnder [] { tier := .final, owner := o.owner, noAgent := true, final := true }).filter
        (fun j => (c.eligible { tier := .final, owner := o.owner, noAgent := true, final := true } j).isSome))
      else (c.eligFor o.tier o.owner true).filter c.isPerson
    [disJ "revert" "author" true []] ++ (if hint then [disJ "add-was" "author" true []] else []) ++
      (if l4u then [disJ "provide" "ci" true []] else []) ++ [disJ "answer" "judges" false elig]
  | "coverage" =>
    if o.isVocab then
      [disJ "declare" "author" true [], disJ "answer" "judges" (c.agentsListed o.tier) (c.eligFor o.tier c.gov.owner false)]
    else
      let owners := [o.owner] ++ o.covUnmet.filterMap (fun f => (c.hClaims.get? f).map c.ownerStar)
      let noAg := !o.covFinal.isEmpty
      let elig := sortStrs ((owners.flatMap fun w => c.eligFor o.tier w noAg).filter (fun a => !noAg || c.isPerson a))
      [disJ "answer" "judges" (!noAg && c.agentsListed o.tier) elig, disJ "declare" "author" true [], disJ "provide" "author" true []]
  | _ => []

def firstAct (ds : List J) : String := ((ds.head?).map (·.strD "act")).getD ""

/-! ### Output -/

structure OutOb where
  ob : Ob
  severity : String
  rule : Nat
  dis : List J
  budget : String
  matched : List Exc
  excAnswered : Bool
  assignee : Option String := none
  deriving Inhabited

def obJ (o : OutOb) : J :=
  let ob := o.ob
  let exc : J := if o.rule == 5 then ((earliest o.matched).map (fun x => J.str x.q)).getD .null else .null
  .obj [("key", .str ob.key), ("kind", .str ob.kind), ("reason", optStrJ ob.reason),
    ("questions", match ob.questions with | some qs => jstrsJ qs | none => .null),
    ("introduced", .bool ob.introduced), ("severity", .str o.severity), ("tier", tierJ ob.tier),
    ("budget", .str o.budget), ("force", optStrJ ob.force), ("owner", .str ob.owner),
    ("assignee", optStrJ o.assignee), ("group", .str ob.group),
    ("claim", match ob.claim with | some cl => claimRefJ cl | none => .null),
    ("subject", ob.subject), ("witness", .arr (ob.witness.map .str)),
    ("facts", .obj (ob.facts.map fun (k, v) => (k, v))), ("counterexample", ob.counterexample),
    ("exploited", match ob.exploited with | some b => .bool b | none => .null),
    ("final", .bool (ob.tier == .final)), ("binding", .str ob.binding), ("exception", exc),
    ("dischargers", .arr o.dis), ("causes", causesJ ob.causes)]

def sevRank (s : String) : String := if s == "blocking" then "0" else "1"

/-- The fragment (A.11.2.2 [D23]): reasons the kernel does not answer. -/
def fragmentReasons (inp : Input) (lr : LResult) : List String :=
  (if (inp.options.getD "teeth").bool? == some true then ["options.teeth: the teeth report is outside the kernel fragment"] else []) ++
  (if (inp.options.getD "health").bool? == some false then ["options.health false: the health-less output is not fixed (A.16.30)"] else []) ++
  ((inp.head.claims ++ (inp.base.map (·.claims)).getD []).filterMap fun cl => match cl.op with
    | .other n => some ("claim op " ++ n ++ " is outside the kernel fragment")
    | _ => none) ++
  (if lr.cellsUndecided then ["cells: the product-automaton search exceeded 10^6 states (A.8.1.4)"] else [])

def deriveAll (inp : Input) : J × Nat := Id.run do
  let c0 := (buildCtx inp).withHeirs
  let lr := c0.loosening
  let reasons := sortStrs (fragmentReasons inp lr)
  if !reasons.isEmpty then
    return (.obj [("contract", .str "shape.kernel.rejected/v1"), ("reasons", jstrsJ reasons)], 3)
  let as := c0.answers
  -- pass 1, then tier* after two-person final loosening answers (A.6.2.3, A.16.13)
  let p1 := c0.pass lr []
  let finalAnswered := (p1.obs.filter fun o => o.kind == "loosening" && o.tier == .final &&
      (c0.answerItems o (answersNaming p1.obs as o)).ok).filterMap (fun o => o.subject.str?)
  let c := if finalAnswered.isEmpty then c0 else { c0 with answeredFinal := finalAnswered.filter (c0.bClaims.contains ·) }
  let p2 := if finalAnswered.isEmpty then p1 else c.pass lr []
  -- producer-change acceptance (A.5.4.6): re-evaluate laws with the answered providers accepted
  let pcAcc : List (String × List String) := (p2.obs.filter fun o =>
      o.kind == "unestablished" && o.reason == some "producer-changed" &&
      (c.answerItems o (answersNaming p2.obs as o)).ok).filterMap fun o =>
    o.claim.map fun cl => (cl.fp, ((p2.laws.find? (·.claim.fp == cl.fp)).map (·.pcProviders)).getD [])
  let p3' := if pcAcc.isEmpty then p2 else c.pass lr pcAcc
  -- groups are computed before answers (A.7.2.3): over pass 2's obligation set, so a discharged
  -- producer-changed obligation still joins the group of the obligations it shares changes with
  let grpOf : HashMap String String := p2.obs.foldl (fun m o => m.insert o.key o.group) {}
  let p3 : Pass := { p3' with obs := p3'.obs.map fun o => { o with group := (grpOf.get? o.key).getD o.group } }
  let pcAnswered := pcAcc.map (·.1)
  -- answers against the obligations of pass 2 (refs expand over the pre-answer set)
  let allObs := p2.obs
  let mut outObs : List OutOb := []
  let mut answered : List J := []
  let mut selfUses : List String := []
  let mut inertCands : List Exc := c.head.excs.filter (fun x => decide (c.now < x.expires))
  let mut matchedAny : List String := []
  for o in p3.obs do
    let isPcRe := o.kind == "unestablished" && o.claim.any (fun cl => pcAnswered.contains cl.fp)
    let naming := answersNaming allObs as (if isPcRe then ((allObs.find? (·.key == o.key)).getD o) else o)
    let res := if answerable o then c.answerItems o naming else { ok := false, self := false, sources := [] }
    let m := c.matchedBy o
    if !m.isEmpty then matchedAny := matchedAny ++ m.map (·.q)
    if res.ok then
      answered := answered ++ [.obj [("obligation", .str o.key), ("records", jstrsJ res.sources), ("self", .bool res.self),
        ("exploited", match o.exploited with | some b => .bool b | none => .null), ("as", .str "discharge")]]
      if res.self then
        -- the answerers the self fallback made eligible, not every person naming o (A.16.30)
        selfUses := selfUses ++ res.selfActors.map (fun a => "answer " ++ o.key ++ " by " ++ a)
      continue
    let exA := if !m.isEmpty && o.introduced then c.exceptionAnswer o naming else { ok := false, self := false, sources := [] }
    if exA.ok then
      answered := answered ++ [.obj [("obligation", .str o.key), ("records", jstrsJ exA.sources), ("self", .bool false),
        ("exploited", match o.exploited with | some b => .bool b | none => .null), ("as", .str "exception-answer")]]
    let (sev, rule) := c.severity o (!m.isEmpty) exA.ok
    let le := p3.laws.find? (fun l => o.claim.any (fun cl => cl.fp == l.claim.fp))
    let ds := c.dischargers o le
    let act := firstAct ds
    let budget := if ["rerun", "provide", "edit-code", "add-was"].contains act then "mechanical" else "judgment"
    outObs := outObs ++ [{ ob := o, severity := sev, rule := rule, dis := ds, budget := budget, matched := m, excAnswered := exA.ok }]
  -- pc-answered laws now Sat: discharged
  for fp in pcAnswered do
    let key := obKey "unestablished" (some fp) .null
    if !(p3.obs.any (·.key == key)) then
      match p2.obs.find? (·.key == key) with
      | some o =>
        let naming := answersNaming allObs as o
        let res := c.answerItems o naming
        answered := answered ++ [.obj [("obligation", .str key), ("records", jstrsJ res.sources), ("self", .bool res.self),
          ("exploited", .null), ("as", .str "discharge")]]
        if res.self then
          selfUses := selfUses ++ res.selfActors.map (fun a => "answer " ++ key ++ " by " ++ a)
      | none => pure ()
  inertCands := inertCands.filter (fun x => !matchedAny.contains x.q)
  -- unanswered owed loosening and coverage (A.7.5.3)
  let unanswered := outObs.filter (fun o => o.severity == "owed" && (o.ob.kind == "loosening" || o.ob.kind == "coverage"))
  let unKeys := unanswered.map (·.ob.key)
  -- budget (A.10.3)
  let grpIds := sortStrs (outObs.map (·.ob.group))
  let grps := grpIds.filterMap fun g =>
    let os := outObs.filter (fun o => o.ob.group == g && !unKeys.contains o.ob.key)
    if !os.any (·.budget == "judgment") then none else
    some (g, os, os.any (·.severity == "blocking"), os.foldl (fun t o => tierMax t o.ob.tier) .low)
  let grpsS := sortWith (fun a b =>
      let ka := (if a.2.2.1 then 0 else 1, 4 - a.2.2.2.rank)
      let kb := (if b.2.2.1 then 0 else 1, 4 - b.2.2.2.rank)
      ka.1 < kb.1 || (ka.1 == kb.1 && (ka.2 < kb.2 || (ka.2 == kb.2 && strLt a.1 b.1)))) grps
  let agentOk := grpsS.filter fun (_, os, _, t) =>
    (c.pol.tier t).judges.contains "agents" && t != .final &&
    !os.any (fun o => o.ob.kind == "loosening" || (o.ob.introduced && !o.matched.isEmpty) ||
      o.ob.reason == some "producer-changed" || o.ob.tier == .final)
  let limit := c.pol.budget
  let taken := match limit with | some n => agentOk.take n | none => agentOk
  let overflow := match limit with | some n => (agentOk.drop n).map (·.1) | none => []
  let takenIds := taken.map (·.1)
  -- owed loosening and coverage lapse at merge, outside groups and budget (A.7.5.3, A.10.3):
  -- they are never assigned with a taken group
  let outObs2 := outObs.map fun o =>
    if takenIds.contains o.ob.group && o.budget == "judgment" && !unKeys.contains o.ob.key then
      { o with assignee := some "agents" } else o
  let outObs3 := sortWith (fun a b => lexStrLt [sevRank a.severity, a.ob.kind, a.ob.key] [sevRank b.severity, b.ob.kind, b.ob.key]) outObs2
  -- debt, preexisting (A.7.7, A.16.24(b))
  let debt := (outObs3.filter (·.rule == 5)).filterMap fun o =>
    (earliest o.matched).map fun x =>
      J.obj [("obligation", .str o.ob.key), ("exceptions", jstrsJ (o.matched.map (·.q))), ("exception", .str x.q),
             ("owner", .str x.owner), ("expiresInDays", .num (ceilDiv (x.expires - c.now) 86400))]
  let preexisting := (outObs3.filter (·.rule == 6)).map fun o => J.obj [("obligation", .str o.ob.key), ("owner", .str o.ob.owner)]
  -- errors: head shape errors from the elaborator plus the kernel's (A.10.1, A.15.1, A.16.24(c))
  let kernelCodes := ["E-conduct", "E-structure", "E-provider-missing", "E-exception", "E-unbound", "E-ambiguous", "E-was"]
  let excQs := c.head.excs.map (fun x => "exception " ++ x.q)
  let esfErrs : List KErr := inp.head.errors.filterMap fun e =>
    if kernelCodes.contains e.code && !(e.code == "E-exception" && !excQs.contains e.subject) then none
    else some { code := e.code, subject := e.subject, causes := e.causes, dischargers := e.dischargers }
  let allErrs := esfErrs ++ c.errors ++ p3.errors ++ lr.errors
  let errs := sortOnL errKey (allErrs.foldl (fun acc e => if acc.any (fun x => x.code == e.code && x.subject == e.subject) then acc else acc ++ [e]) [])
  -- verdict (A.10.2, A.16.24(a))
  let blocked := !errs.isEmpty || outObs3.any (·.severity == "blocking")
  let verdict := if blocked then "blocked" else if outObs3.isEmpty then "pass" else "owed"
  -- loosening rows (A.12.10.1, A.16.28)
  let rows := (sortOnL (fun p => [p.subject, p.question]) lr.parts).map fun p =>
    let t := if !c.readable then Tier.critical else c.subjTier p.subject
    J.obj [("question", .str p.question), ("subject", .str p.subject), ("answer", .str p.answer),
           ("exploited", .bool p.exploited), ("final", .bool (t == .final)), ("affected", jstrsJ p.affected),
           ("counterexample", p.counterexample), ("obligation", .str (obKey "loosening" none (.str p.subject)))]
  -- health (A.16.30)
  let cov := p3.cov
  let ungovN := (c.mh.order.filter (fun x => c.Wh.att1 x == .ungov)).length
  let declaredOnly := (sortOn (·.fp) (c.head.claims.filter (·.checkerDecided))).filterMap fun cl =>
    let chans := (c.footprint c.Wh cl).2
    if chans.any c.observable then none else
    let route := if c.provs.any (fun g => match g.base with
        | some b => chans.any (fun ch => channelCovered b.observes ch)
        | none => false) then "contradiction-only" else "declared-only"
    some (J.obj [("claim", .str cl.fp), ("route", .str route), ("tier", tierJ cl.tier)])
  let unansweredJ := (sortOn (·.ob.key) unanswered).map fun o =>
    J.obj [("key", .str o.ob.key), ("kind", .str o.ob.kind), ("subject", o.ob.subject),
           ("questions", match o.ob.questions with | some qs => jstrsJ qs | none => .null),
           ("tier", tierJ o.ob.tier), ("affected", jstrsJ o.ob.affected)]
  let unmapped := sortStrs ((c.facts.filter (fun f => f.observed && f.ty == "effect" && (c.Wh.resOf f.res).isNone)).map (·.res))
  let manifestUnauth := if c.manifestIdentity.isSome then [] else
    (if c.mh.present then ["manifest head"] else []) ++ (if c.hasBase && c.mb.present then ["manifest base"] else [])
  let idCount (id : String) := (c.provs.filter (fun g => g.identity == some id)).length
  let provUnauth := c.provs.filterMap fun g =>
    match g.identity with
    | none => some ("provider " ++ g.q)
    | some id => if idCount id > 1 then some ("provider " ++ g.q) else none
  let reviewName (rv : Review) : String := (rv.actor.getD rv.identity)
  let relay := c.hasRelay
  let reviewLines := if relay || c.mode == .preview then [] else c.inp.reviews
  let approveLines := reviewLines.filter fun rv => strPrefix "shape approve" (trimS rv.line)
  let judgeLines := reviewLines.filter fun rv => strPrefix "shape judge" (trimS rv.line) || strPrefix "shape reject" (trimS rv.line)
  let unauth := sortStrs (manifestUnauth ++ provUnauth ++ approveLines.map (fun rv => "review " ++ reviewName rv ++ ": " ++ trimS rv.line))
  let unrecorded := sortStrs (judgeLines.map (fun rv => "review " ++ reviewName rv ++ ": " ++ trimS rv.line))
  let rj06 := (inp.rejected.filter (fun r => r.strD "code" == "RJ06")).length
  let executesHead := sortStrs ((c.provs.filter fun g => (g.base.toList ++ g.head.toList).any fun p =>
    p.produces.contains .test || p.produces.contains .proof || p.produces.contains .equivalence).map (·.q))
  let baseObsMissing := c.hasBase && c.mode != .audit && c.inp.baseRecordsSupplied == 0 &&
    (c.base.map (fun b => b.provs.any (·.produces.contains .observation))).getD false
  let baseDefects := match inp.base with
    | some b => sortStrs (b.errors.map (fun e => e.code ++ " " ++ e.subject))
    | none => []
  -- final drift (A.7.7.2): preexisting sound contradictions whose tier*(o) is final (A.6.2.3: for
  -- code contradictions tier*(o) includes Lvl_b)
  let finalDrift := sortStrs ((outObs3.filter fun o => o.rule == 6 && o.ob.kind == "contradiction" &&
    o.ob.force == some "sound" && o.ob.tier == .final).map (·.ob.key))
  let lawsBase := (p3.laws.flatMap fun l => c.baseRecords.filterMap fun br =>
    if br.result == .contradicts && (br.claimFp.map (fun f => c.claimLeq f l.claim)).getD false &&
       (br.provider.bind c.prov? |>.map (·.base.isSome)).getD (br.kind == .judgment) then
      match br.counterexample with
      | some ce => some (J.obj [("claim", .str l.claim.fp), ("counterexample", ce)])
      | none => none
    else none)
  let lawsBaseS := sortWith (fun a b => lexStrLt [a.strD "claim", (a.getD "counterexample").jcs] [b.strD "claim", (b.getD "counterexample").jcs]) lawsBase
  let vacuous := sortStrs ((p3.laws.filter (·.vacuous)).map (·.claim.fp))
  -- a use of the self fallback is a judgment that acts in the run (A.16.43): it establishes the
  -- claim (supports, usable) or contradicts it with force (neither stale nor expired)
  let selfJ := (p3.laws.flatMap fun l => (l.evals.filter (fun e => e.isJ && e.self && e.applicable &&
      ((e.dir == "supports" && e.reason.isNone) || (e.dir == "contradicts" && e.force.isSome)))).map fun e =>
    "judgment " ++ l.claim.firstId ++ " by " ++ e.judge)
  let budgetJ := J.obj [("limit", match limit with | some n => .num n | none => .null), ("used", .num taken.length),
                        ("overflow", jstrsJ overflow)]
  let health := J.obj [
    ("coverage", .obj [("num", .num cov.covered), ("den", .num cov.set.length)]),
    ("unobservable", jstrsJ cov.unobservable), ("declaredOnly", .arr declaredOnly), ("unanswered", .arr unansweredJ),
    ("openAuthority", jstrsJ ((c.head.comps.filter (fun k => k.grants.isNone && !strPrefix "std::" k.q)).map (·.q))),
    ("ungoverned", .obj [("num", .num ungovN), ("den", .num c.mh.order.length)]),
    ("unmapped", jstrsJ unmapped), ("externalCalls", .num c.externalCalls), ("ungovernedCalls", .num c.ungovernedCalls),
    ("unanchored", .num c.unanchored), ("droppedEdges", .num c.droppedEdges), ("unauthenticated", jstrsJ unauth),
    ("unrecorded", jstrsJ unrecorded), ("rejected", .obj [("count", .num inp.rejected.length), ("rj06", .num rj06)]),
    ("executesHead", jstrsJ executesHead), ("baseObservations", .str (if baseObsMissing then "missing" else "present")),
    ("baseDefects", jstrsJ baseDefects), ("clockClamped", .bool inp.clockClamped), ("trustDebt", .num debt.length),
    ("finalDrift", jstrsJ finalDrift), ("lawsContradictedAtBase", .arr lawsBaseS),
    ("inertExceptions", jstrsJ (inertCands.map (·.q))), ("vacuousLaws", jstrsJ vacuous),
    ("budget", .obj [("limit", match limit with | some n => .num n | none => .null), ("used", .num taken.length),
                     ("overflow", .num overflow.length)]),
    ("self", jstrsJ (selfUses ++ selfJ)), ("preexisting", .num preexisting.length), ("renames", .num c.rho.renames.length),
    ("assumption", .str "dependency code and configuration data")]
  let renames := (sortOnL (fun r => [r.1, r.2.1]) c.rho.renames).map fun (b, h, r) =>
    J.obj [("base", .str b), ("head", .str h), ("rule", .str r)]
  let sortedAns := sortWith (fun a b => lexStrLt [a.strD "obligation", a.strD "as"] [b.strD "obligation", b.strD "as"]) answered
  let out := J.obj [
    ("contract", .str "shape.check.output/v1"), ("mode", .str inp.mode.name), ("inputDigest", .str inp.inputDigest),
    ("verdict", .str verdict), ("errors", .arr (errs.map kerrJ)),
    ("rejected", .arr (sortWith (fun a b => lexStrLt [a.strD "record", a.strD "code"] [b.strD "record", b.strD "code"]) inp.rejected)),
    ("obligations", .arr (outObs3.map obJ)), ("answered", .arr sortedAns), ("loosening", .arr rows),
    ("order", match lr.order with | some o => .str o | none => .null), ("renames", .arr renames),
    ("debt", .arr (sortWith (fun a b => strLt (a.strD "obligation") (b.strD "obligation")) debt)),
    ("preexisting", .arr (sortWith (fun a b => strLt (a.strD "obligation") (b.strD "obligation")) preexisting)),
    ("budget", budgetJ), ("health", health)]
  -- options.debug (not core output): binding preimages, for differential triage
  let out := if (inp.options.getD "debug").bool? == some true then
      match out with
      | .obj kvs => .obj (kvs ++ [("debug", .arr (outObs3.map fun o => J.obj [("key", .str o.ob.key),
          ("affected", jstrsJ o.ob.affected), ("delta", .arr (o.ob.delta.map .str)),
          ("code", .arr (o.ob.code.map fun r => .arr [.str r.1, .str r.2.1, optStrJ r.2.2.1, optStrJ r.2.2.2]))]))])
      | o => o
    else out
  return (out, if blocked then 1 else 0)

end Shape
