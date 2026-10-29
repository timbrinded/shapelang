import Kernel.Facts
/-! Laws (model §5, A.5): R*, Req(c, kind) with the judgment closure through Refs° [D4],
applicability, usability (reasons in the order stale, expired, assumption, weak,
producer-changed, A.5.4.1 [D9]), force, Sat with final two-person judgments [D11, A.16.12],
the total law reason (A.5.4.3), introducedness through record cones with the counterexample
clause (A.7.3.3 [D4]), and E-provider-missing (A.5.2.13, A.5.2.17 [D27]). Executable layer. -/
namespace Shape

open Std

abbrev Pair := String × String

def isFunctionKind (k : String) : Bool := k == "function" || k == "method"

def Ctx.hasProj (c : Ctx) (x p : String) : Bool := (c.mh.digest x p).isSome

/-- Functions of a component reachable from x through Refs° (A.5.3.4 [D4]). -/
partial def Ctx.refsReach (c : Ctx) (x : String) : List String :=
  let rec go (stack : List String) (seen : List String) : List String :=
    match stack with
    | [] => seen
    | y :: rest =>
      if seen.contains y then go rest seen
      else go (((c.refsG.get? y).getD []) ++ rest) (y :: seen)
  (go ((c.refsG.get? x).getD []) []).filter (· != x)

def Ctx.marked (c : Ctx) (x : String) : Bool := (c.mh.markers x).any (·.2 > 0)

/-- Req(c, kind) from c and M_h (A.5.3.4, A.15.15, A.16.20). -/
def Ctx.reqOf (c : Ctx) (cl : Claim) (isJ : Bool) (proj : String) : List Pair :=
  let W := c.Wh
  let atP (x p : String) : Pair := if c.hasProj x p then (x, p) else (x, "file")
  let tgt : List Pair := match cl.op with
    | .law on _ => on.flatMap fun t =>
      if strPrefix "unit " t then
        let uq := dropChars 5 t
        match W.bind1 uq with
        | none => []
        | some x =>
          if proj == "trust" then
            (if (c.mh.descendants x).any c.marked then [(x, "unit")] else [])
          else if !isJ then [atP x "unit"]
          else
            let k := (W.unitsBy.get? uq).map (·.comp)
            let compIds := match k with | some kq => W.compCode kq c.mh | none => []
            let fns := (c.refsReach x).filter fun y =>
              compIds.contains y && ((c.mh.info? y).map (fun i => isFunctionKind i.kind)).getD false
            atP x proj :: fns.map (atP · proj)
      else if strPrefix "component " t then
        let k := dropChars 10 t
        let ids := W.compCode k c.mh
        if proj == "trust" then
          ids.filterMap fun x => if c.marked x then some (x, if idIsFile x then "own" else "unit") else none
        else
          let p := if isJ then proj else "unit"
          let syms := ids.filter fun x => !idIsFile x && c.hasProj x p &&
            (match c.mh.parent x with
             | some par => idIsFile par || !c.hasProj par p || !ids.contains par
             | none => true)
          syms.map (fun x => (x, p)) ++ (if p == "unit" then (ids.filter idIsFile).map (fun f => (f, "own")) else [])
      else if strPrefix "code " t then
        let x := dropChars 5 t
        [atP x "unit"]
      else []
    | _ => []
  let hosted : List Pair := match cl.op with
    | .law _ (.hosted r) => [(r, "closure")]
    | _ => []
  sortOnL (fun p => [p.1, p.2]) (uniq (tgt ++ hosted))

/-! ### Record evaluation -/

structure RecEval where
  record : Record
  dir : String
  isJ : Bool
  applicable : Bool
  partialCite : Bool
  reason : Option String
  force : Option String
  self : Bool
  headOnly : Bool
  judge : String
  /-- the record's fingerprint moved (stale), whatever reason it holds -/
  staleR : Bool
  /-- a test or proof, or a judgment whose judge is eligible for the claim (A.6.3.3) -/
  judgeOk : Bool := true
deriving Inhabited

structure LawEval where
  claim : Claim
  tier : Tier
  req : Req
  reqTest : List Pair
  reqJudg : List Pair
  bindingReq : List Pair
  vacuous : Bool
  sat : Bool
  soundContra : Option RecEval
  heurContras : List RecEval
  reason : Option String
  evals : List RecEval
  introU : Bool
  introC : Bool
  pcFinest : List String
  pcProviders : List String
deriving Inhabited

def ceOk (ce : Option J) : Bool :=
  match ce with
  | some (.obj kvs) => ["seed", "inputs", "assertion"].all (fun k => kvs.any (·.1 == k))
  | _ => false

def levelOfKind (k : RecKind) : Level :=
  match k with | .proof => .proven | .test => .tested | _ => .declared

def Ctx.claimByFp (c : Ctx) (fp : String) : Option Claim :=
  match c.hClaims.get? fp with
  | some x => some x
  | none => c.bClaims.get? fp

/-- r.claim ⊒ c (supports flow stronger to weaker, A.5.3.5). A base claim's heirs are at least
    as strict as it (h ⊒ ρc_b), the other direction, so only its renamed NF counts here. -/
def Ctx.claimGeq (c : Ctx) (rfp : String) (cl : Claim) : Bool :=
  rfp == cl.fp ||
  ((c.bClaims.get? rfp).map (fun bc => (renameClaim (rhoKeys c.rho.map) bc).fp == cl.fp)).getD false ||
  ((c.impliesC.get? rfp).getD []).contains cl.fp ||
  (match c.claimByFp rfp with
   | some rc => cl.isLaw && c.opGeq rc cl
   | none => false)

/-- c ⊒ r.claim (contradicts flow weaker to stronger). -/
def Ctx.claimLeq (c : Ctx) (rfp : String) (cl : Claim) : Bool :=
  rfp == cl.fp || ((c.heirs.get? rfp).getD []).contains cl.fp ||
  ((c.impliesC.get? cl.fp).getD []).contains rfp ||
  (match c.claimByFp rfp with
   | some rc => cl.isLaw && c.opGeq cl rc
   | none => false)

/-- cone(r) (A.5.4.4): code ∪ deps closed under descendants, Calls°, Refs° and same-provider,
    same-revision proof records. -/
partial def Ctx.cone (c : Ctx) (r : Record) : List String :=
  let start := (r.code ++ r.deps).map (·.id)
  let rec close (stack : List String) (seen : List String) : List String :=
    match stack with
    | [] => seen
    | y :: rest =>
      if seen.contains y then close rest seen
      else
        let next := if c.mh.has y then
            (c.mh.descendants y).filter (· != y) ++ (((c.calls.get? y).getD []).map (·.1)) ++ ((c.refsG.get? y).getD [])
          else []
        close (next ++ rest) (y :: seen)
  let rec fix (fuel : Nat) (cur : List String) : List String :=
    match fuel with
    | 0 => cur
    | fuel + 1 =>
      let more := (c.records.filter fun r' => r'.kind == .proof && r.kind == .proof && r'.id != r.id &&
          r'.provider == r.provider && r'.revision == r.revision && r'.code.any (fun ci => cur.contains ci.id)).flatMap
        (fun r' => (r'.code ++ r'.deps).map (·.id))
      let new := more.filter (fun y => !cur.contains y)
      if new.isEmpty then cur else fix fuel (close new cur)
  fix (c.records.length + 1) (close start [])

def Ctx.meetsDelta (c : Ctx) (ids : List String) : Bool := ids.any (c.delta.inDelta ·)

/-- Does a boundary of the world's shape at x allow hatch kind k? -/
def worldAllows (w : World) (x k : String) : Bool :=
  (w.att x).all fun u => match w.compOfU u with
    | some kq => match w.comps.get? kq with
      | some cp => cp.boundary && cp.allows.contains k
      | none => false
    | none => false

/-- An undeclared assumption in a test or proof (A.5.4.4, A.16.14 [D11]). -/
def Ctx.assumptionUndeclared (c : Ctx) (r : Record) (t : Tier) (req : List Pair) : Bool :=
  let cone := c.cone r
  let hatchM : List (String × String) := cone.flatMap fun x =>
    (c.mh.markers x).filterMap fun (k, n) => if n > 0 then some (x, k) else none
  let hatchA : List (String × String) := (r.assumptions.filter (·.2 == "hatch")).filterMap fun (i, _) =>
    match (splitChar '/' i).reverse with
    | k :: rest@(_ :: _) => some ("/".intercalate rest.reverse, k)
    | _ => none
  let hatches := hatchM ++ hatchA
  let named := (r.assumptions.filter (·.2 == "named")).map (·.1)
  let tools := (r.assumptions.filter (·.2 == "tool")).map (·.1)
  let final := t == .final
  let baseW : Option World := if c.mode == .audit then some c.Wh else c.Wb
  let hatchBad := hatches.any fun (x, k) =>
    final ||
    (let lang := ((c.mh.info? x).map (·.lang)).getD (idLang x)
     !(c.head.hatches.any (fun h => h.1 == k && h.2 == lang)) ||
     !(worldAllows c.Wh x k && (match baseW with | some w => worldAllows w x k | none => false)))
  let namedBad := !named.isEmpty && (final ||
    (let meets := cone ++ req.map (·.1)
     let allowed := match baseW with
       | some w => (w.S.comps.filter (fun (k : Comp) => k.boundary && (w.compCode k.q c.mh).any (meets.contains ·))).flatMap
           (fun (k : Comp) => k.assumes)
       | none => []
     named.any (fun n => !allowed.contains n)))
  let toolBad := !tools.isEmpty &&
    (let trusted := match r.provider.bind c.prov? with
       | some g => g.trusts.map (fun (n, v) => n ++ "@" ++ v)
       | none => []
     tools.any (fun tl => !trusted.contains (String.ofList (tl.toList.map (fun ch => if ch == ' ' then '@' else ch)))))
  hatchBad || namedBad || toolBad

def Ctx.lawEQ (c : Ctx) (cl : Claim) (t : Tier) : EQ := { tier := t, owner := c.ownerStar cl, noAgent := false, final := t == .final }

/-- An act of this change unless a persisted judgment of an earlier change (A.16.4(b)). -/
def Ctx.actOfChange (c : Ctx) (r : Record) : Bool :=
  !(r.persistedBase && (match r.aboutChange with | some ch => !c.inp.changeIds.contains ch | none => true))

def Ctx.evalLaw (c : Ctx) (cl : Claim) (pcAccepted : List String := []) : LawEval := Id.run do
  let t := c.tierStar cl
  let req := c.reqStar cl t
  let reqTest := c.reqOf cl false (if req.proj == "trust" then "trust" else "unit")
  let reqJudg := c.reqOf cl true req.proj
  let bindingReq := if req.level != .none && req.level.rank ≥ 1 then reqTest else if req.judged then reqJudg else reqTest
  let vacuous := bindingReq.isEmpty
  let tp := c.pol.tier t
  let mut evals : List RecEval := []
  for r in c.records do
    let isJ := r.kind == .judgment
    if !(r.kind == .test || r.kind == .proof || (isJ && r.claimFp.isSome)) then continue
    let some rfp := r.claimFp | continue
    let dir0 := match r.result with
      | .supports => "supports" | .contradicts => "contradicts" | _ => "inconclusive"
    let dir := if !isJ && dir0 == "contradicts" && !ceOk r.counterexample then "inconclusive" else dir0
    let related := if dir == "contradicts" then c.claimLeq rfp cl else c.claimGeq rfp cl
    if !related then continue
    let g := r.provider.bind c.prov?
    let headOnly := !isJ && (g.map (·.base.isNone)).getD true
    let req0 := if isJ then reqJudg else reqTest
    let cited := if isJ then r.code else r.code ++ r.deps
    let partialCite := req0.any (fun p => !cited.any (fun ci => ci.id == p.1 && ci.proj == p.2))
    -- stale (A.5.4.1)
    let digestsMoved := (cited ++ r.harness).any (fun ci => !c.digestEq c.mh ci.id ci.proj ci.digest)
    -- a revision-tied record not at head is reused only through deps complete, which needs a
    -- deps field (A.5.4.1, A.5.2.8, A.12.5.2)
    let revTied := !isJ && r.revision != c.inp.headRev && !(((g.map (·.depsCompleteB)).getD false) && r.hasDeps)
    let mut reason : Option String := if digestsMoved || revTied || partialCite then some "stale" else none
    -- judge eligibility
    let mut judgeOk := true
    let mut self := false
    let judge := r.judge.getD ""
    if isJ then
      match c.eligible (c.lawEQ cl t) judge (c.actOfChange r) with
      | some s => self := s
      | none => judgeOk := false
      if !r.authenticated then judgeOk := false
      if reason.isNone && c.now - r.time > (tp.maxAge : Int) * 86400 then reason := some "expired"
    if !isJ && reason.isNone && c.assumptionUndeclared r t req0 then reason := some "assumption"
    if reason.isNone then
      if isJ then
        -- pins by sort (A.16.44): actor pins constrain claim judgments only
        let actorPins := req.pins.filter (fun p => c.gov.actors.any (·.q == p))
        if !req.judged || (!actorPins.isEmpty && !actorPins.contains judge) then reason := some "weak"
      else
        -- establishing force needs a base- and head-declared provider that decides the law
        -- (A.6.2.6(b): decides intersected; MODEL §5.1)
        let est := (g.map (·.establishes)).getD false
        let decides := (g.map (fun g => decidesClaim g.decidesB cl)).getD false
        let lvl := if est && decides then levelOfKind r.kind else .declared
        -- provider pins constrain tests and proofs only
        let provPins := req.pins.filter (fun p => c.provs.any (·.q == p))
        let pinned := !provPins.isEmpty && !provPins.contains (r.provider.getD "")
        if lvl.rank < req.level.rank || req.level == .none || pinned then reason := some "weak"
    let pcRaw := ((c.pcRec.get? r.id).getD false) && !(pcAccepted.contains (r.provider.getD ""))
    -- force
    let mut force : Option String := none
    if dir == "contradicts" && !partialCite && judgeOk && reason != some "stale" && reason != some "expired" then
      if isJ then force := some "sound"
      else if ceOk r.counterexample then
        force := some (if (g.map (·.presenceA)).getD false then "sound" else "heuristic")
    if reason.isNone && pcRaw && dir != "inconclusive" && (dir == "supports" || force.isSome) then
      reason := some "producer-changed"
    -- head-only providers and inconclusive records hold no reason (A.5.1.3, A.5.4.1)
    if headOnly || dir == "inconclusive" then reason := none
    evals := evals ++ [{ record := r, dir := dir, isJ := isJ, applicable := !partialCite && judgeOk,
                          partialCite := partialCite, reason := reason, force := force, self := self,
                          headOnly := headOnly, judge := judge, staleR := digestsMoved || revTied || partialCite,
                          judgeOk := judgeOk }]
  let evs := sortOn (·.record.id) evals
  -- final laws: contradicting and supporting judgments need two distinct persons (A.6.3.4)
  let final := t == .final
  let twoOk (es : List RecEval) : Bool :=
    c.twoPersons (es.map (·.judge)) [c.ownerStar cl, c.gov.owner]
  let contraJ := evs.filter (fun e => e.isJ && e.force == some "sound")
  let soundContra := evs.find? (fun e => e.force == some "sound" && (!e.isJ || !final || twoOk contraJ))
  let heurContras := evs.filter (fun e => e.force == some "heuristic")
  let usableSupport := evs.filter (fun e => e.dir == "supports" && e.applicable && e.reason.isNone && !e.headOnly)
  let supJ := usableSupport.filter (·.isJ)
  let sat := vacuous || (soundContra.isNone &&
    (req.level == .declared ||
     usableSupport.any (fun e => !e.isJ) ||
     (req.judged && !supJ.isEmpty && (!final || twoOk supJ))))
  let mut reason : Option String := none
  if !sat && soundContra.isNone then
    reason := some "missing"
    -- a record holds a reason only if its judge is eligible; it applies or only omits part of
    -- Req (stale) (A.5.4.3, A.16.42)
    let holders := evs.filter (fun e => e.judgeOk && (e.applicable || e.partialCite))
    for o in ["assumption", "weak", "producer-changed", "expired", "stale"] do
      if holders.any (·.reason == some o) then
        reason := some o
        break
  -- introducedness (A.7.3.3 [D4])
  let reqMeets := bindingReq.any (fun p => c.delta.pairIn p.1 p.2)
  let holdersOf (rs : String) := evs.filter (fun e => e.judgeOk && (e.applicable || e.partialCite) && e.reason == some rs)
  let reasonCone := match reason with
    | some rs => (holdersOf rs).any (fun e => c.meetsDelta (c.cone e.record))
    | none => false
  let introU := c.hasBase && (reqMeets || reasonCone || reason == some "producer-changed")
  let contraRec := match soundContra with
    | some e => some e
    | none => heurContras.head?
  let introC := c.hasBase && match contraRec with
    | none => false
    | some e =>
      (reqMeets || c.meetsDelta (c.cone e.record)) &&
      !(c.baseRecords.any fun br =>
          br.kind == e.record.kind && br.provider == e.record.provider && e.record.provider.isSome &&
          (match br.provider.bind c.prov? with | some g => g.base.isSome | none => false) &&
          br.result == .contradicts && (br.claimFp.map (fun f => c.claimLeq f cl)).getD false &&
          (if e.isJ then br.id == e.record.id else
            match br.counterexample, e.record.counterexample with
            | some a, some b => (a.getD "assertion").jcs == (b.getD "assertion").jcs && (a.getD "inputs").jcs == (b.getD "inputs").jcs
            | _, _ => false))
  -- producer-change additions (A.7.2.2, A.16.19)
  let pcEvals := evs.filter (·.reason == some "producer-changed")
  let pcFinest := sortStrs (pcEvals.flatMap fun e => match e.record.provider.bind c.prov? with
    | some g => implFinest c.mh c.delta g e.record
    | none => [])
  return { claim := cl, tier := t, req := req, reqTest := reqTest, reqJudg := reqJudg, bindingReq := bindingReq,
           vacuous := vacuous, sat := sat, soundContra := soundContra, heurContras := heurContras, reason := reason,
           evals := evs, introU := introU, introC := introC, pcFinest := pcFinest,
           pcProviders := sortStrs (pcEvals.filterMap (·.record.provider)) }

/-! ### E-provider-missing (A.5.2.13, A.5.2.17) -/

def Ctx.providerMissing (c : Ctx) (laws : List LawEval) : List KErr := Id.run do
  let mut errs : List KErr := []
  if !c.hasBase then return errs
  for g in c.provs do
    let some b := g.base | continue
    if !g.authenticated then continue
    let mine := c.records.filter (fun r => r.provider == some g.q && r.authenticated)
    if b.produces.contains .observation && !g.channelsB.isEmpty then
      if !mine.any (fun r => r.kind == .observation && (r.revision == c.inp.headRev || g.depsCompleteB)) then
        errs := errs ++ [{ code := "E-provider-missing", subject := "provider " ++ g.q,
                           causes := [("provider", g.q)], dischargers := rerunDis }]
    if b.produces.contains .test || b.produces.contains .proof then
      for l in laws do
        if !decidesClaim b.decides l.claim then continue
        let ok := l.evals.any fun e =>
          e.record.provider == some g.q && e.record.authenticated && !e.staleR
        if !ok then
          errs := errs ++ [{ code := "E-provider-missing", subject := "provider " ++ g.q ++ " claim " ++ l.claim.firstId,
                             causes := [("provider", g.q), ("claim", l.claim.fp)], dischargers := rerunDis }]
  return errs

def Ctx.manifestMissing (c : Ctx) : List KErr :=
  match c.manifestIdentity with
  | some _ =>
    if !c.mh.authenticated || (c.hasBase && !c.mb.authenticated) then
      [{ code := "E-provider-missing", subject := "manifest", causes := [], dischargers := rerunDis }]
    else []
  | none => []

end Shape
