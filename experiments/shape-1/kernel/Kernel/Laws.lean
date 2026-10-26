import Kernel.Facts
/-! Evidence and laws (model §5, A.5): requirement R*, Req, usability (freshness), force,
satisfaction and the unestablished reason. -/
namespace Shape

/-! ### Policy* (A.6.2.6) -/

def tpStar (b h : TierPol) : TierPol :=
  { floor := levelMax b.floor h.floor, blocks := sortStrs (b.blocks ++ h.blocks),
    maxAge := min b.maxAge h.maxAge, judges := h.judges.filter (b.judges.contains ·) }

def polStar (i : Input) : Policy :=
  match i.basePolicy with
  | some bp =>
    if hasBase i.env then
      { low := tpStar bp.low i.headPolicy.low, normal := tpStar bp.normal i.headPolicy.normal,
        critical := tpStar bp.critical i.headPolicy.critical,
        budget := match bp.budget, i.headPolicy.budget with
          | some a, some b => some (min a b)
          | some a, none => some a
          | none, b => b }
    else i.headPolicy
  | none => i.headPolicy

/-! ### Actors and eligibility (A.6.3) -/

def actorOf (S : Esf) (q : String) : Option Actor := S.actors.find? (·.q == q)
def isAgent (S : Esf) (q : String) : Bool := ((actorOf S q).map (·.kind == "agent")).getD false
def isPerson (S : Esf) (q : String) : Bool := ((actorOf S q).map (·.kind == "person")).getD false

def personsOf (S : Esf) (q : String) : List String :=
  let rec go (fuel : Nat) (q : String) : List String :=
    match fuel with
    | 0 => []
    | fuel + 1 => match actorOf S q with
      | some a => if a.kind == "person" then [a.q] else if a.kind == "team" then a.members.flatMap (go fuel) else []
      | none => []
  sortStrs (go (S.actors.length + 1) q)

def judgesAllow (S : Esf) (tp : TierPol) (owner j : String) : Bool :=
  (tp.judges.contains "owner" && (personsOf S owner).contains j) ||
  (tp.judges.contains "agents" && isAgent S j) ||
  tp.judges.any (fun a => a != "owner" && a != "agents" && (a == j || (personsOf S a).contains j))

/-- The self fallback (A.6.3.3): the only base person eligible by role, for non-final items. -/
def selfFallback (e : Env) (tp : TierPol) (t : Tier) (owner j : String) : Bool :=
  let S := govS e
  isPerson S j && t != .final && !e.unmappedBot &&
    ((S.actors.filter (fun a => a.kind == "person" && judgesAllow S tp owner a.q)).map (·.q)) == [j]

def eligible (e : Env) (pol : Policy) (t : Tier) (owner : String) (noAgent : Bool) (j : String) (auth : Bool) : Bool :=
  let S := govS e
  let tp := pol.tier t
  auth && (actorOf S j).isSome && judgesAllow S tp owner j && !(noAgent && isAgent S j) &&
    (!e.authors.contains j || selfFallback e tp t owner j)

/-! ### Requirement R* (A.5.3.1, A.5.3.3) -/

def isInformal (c : Claim) : Bool := match c.op with | .law _ (.text _) => true | _ => false

def reqStrict (a b : Req) : Req :=
  { level := levelMax a.level b.level, judged := a.judged && b.judged, pins := sortStrs (a.pins ++ b.pins),
    proj := if a.proj == b.proj then a.proj else "unit" }

def reqStar (e : Env) (pol : Policy) (c : Claim) : Req :=
  let r0 := c.req.getD ⟨.declared, false, [], "unit"⟩
  let r1 := match (baseSame e c).findSome? (·.req) with
    | some rb => reqStrict r0 rb
    | none => r0
  if isInformal c then { r1 with level := .none, judged := true }
  else { r1 with level := levelMax r1.level (pol.tier (tierStar e c)).floor }

/-! ### Req (A.5.3.4) -/

def lawTargets (c : Claim) : List String := match c.op with | .law on _ => on | _ => []
def lawHosted (c : Claim) : Option String := match c.op with | .law _ (.hosted r) => some r | _ => none

def marked (e : Env) (x : String) : Bool := e.mh.any (fun me => me.id == x && me.markers.any (·.2 > 0))

def markedOrDesc (e : Env) (x : String) : Bool :=
  marked e x || (mIds e.mh).any (fun y => y != x && (ancestors e.mh y).contains x && marked e y)

def compCode (e : Env) (k : String) : List String := (mIds e.mh).filter (fun x => compOfId e.head e.mh x == some k)

def reqPairs (e : Env) (c : Claim) (rk : RecKind) (proj : String) : List (String × String) :=
  let isJ := rk == .judgment
  let tgt := (lawTargets c).flatMap fun t =>
    if strPrefix "unit " t then
      let uq := dropChars 5 t
      match (e.head.units.find? (·.q == uq)).bind (unitBind e.head e.mh) with
      | some x =>
        if isJ && proj == "trust" then (if markedOrDesc e x then [(x, "unit")] else [])
        else [(x, if isJ then proj else "unit")]
      | none => []
    else if strPrefix "component " t then
      let k := dropChars 10 t
      let ids := compCode e k
      if isJ && proj == "trust" then
        ids.filterMap (fun x => if marked e x then some (x, if idIsFile x then "own" else "unit") else none)
      else
        let p := if isJ then proj else "unit"
        let syms := ids.filter (fun x => !idIsFile x && (mDigest e.mh x p).isSome &&
          (match parentOf e.mh x with
           | some par => idIsFile par || (mDigest e.mh par p).isNone
           | none => true))
        syms.map (fun x => (x, p)) ++ (if p == "unit" then (ids.filter idIsFile).map (fun f => (f, "own")) else [])
    else if strPrefix "code " t then
      let x := dropChars 5 t
      [(x, if idIsFile x then "file" else "unit")]
    else []
  let hosted := match lawHosted c with
    | some r => [(r, "closure")]
    | none => []
  canon (tgt ++ hosted)

/-! ### Usability (A.5.4) -/

def citeFresh (e : Env) (cs : Cite) : Bool := mDigest e.mh cs.id cs.proj == some cs.digest

def reqCited (e : Env) (pol : Policy) (c : Claim) (r : Record) : Bool :=
  (reqPairs e c r.kind (reqStar e pol c).proj).all (fun p => r.code.any (fun cs => cs.id == p.1 && cs.proj == p.2))

def provDepsComplete (e : Env) : Option String → Bool
  | some q => match bothProv e q with
    | some (b, h) => b.depsComplete && h.depsComplete
    | none => false
  | none => false

def revTied (e : Env) (r : Record) : Bool :=
  (r.kind == .test || r.kind == .proof || r.kind == .observation) && !(provDepsComplete e r.provider && !r.deps.isEmpty)

/-- A fingerprint of the record no longer matches: a cited or dependency digest moved, Req
    grew beyond its citations, or a revision-tied record is not at head. -/
def fpMoved (e : Env) (pol : Policy) (c : Claim) (r : Record) : Bool :=
  !(r.code ++ r.deps).all (citeFresh e) || !reqCited e pol c r || (revTied e r && r.revision != e.headRev)

def isExpired (e : Env) (pol : Policy) (c : Claim) (r : Record) : Bool :=
  r.kind == .judgment && decide (e.now - r.time > ((pol.tier (tierStar e c)).maxAge : Int) * 86400)

def isPC (e : Env) (r : Record) : Bool :=
  (match r.provider with
   | some q => (implPathsU e q).any (fun g => (mIds e.mh ++ deletedIds e).any (fun x => inDelta e x && globMatch g (idPath x)))
   | none => false) || r.harness.any (fun h => inDelta e h.id)

def cone (e : Env) (r : Record) : List String :=
  let roots := (r.code ++ r.deps).map (·.id)
  (mIds e.mh).filter (fun x => (ancestors e.mh x).any (roots.contains ·))

def boundaryAllows (S : Esf) (m : List MEntry) (x h : String) : Bool :=
  match compOfId S m x with
  | some k => (S.comps.find? (·.q == k)).any (fun c => c.boundary && c.allows.contains h)
  | none => false

def hatchDeclared (e : Env) (x h : String) : Bool :=
  boundaryAllows e.head e.mh x h && (match e.base with
    | some b => boundaryAllows b e.mh x h
    | none => true)

def namedDeclared (e : Env) (a : String) : Bool := (govS e).comps.any (fun c => c.boundary && c.assumes.contains a)

def toolDeclared (e : Env) (r : Record) (a : String) : Bool :=
  match r.provider with
  | some q => ((provB e q).map (fun p => p.trusts.contains a)).getD false
  | none => false

def hasAssumption (e : Env) (c : Claim) (r : Record) : Bool :=
  (r.kind == .test || r.kind == .proof) &&
  ((hatchFacts e).any (fun of => (cone e r).contains of.f.loc &&
      (!hatchDeclared e of.f.loc of.f.kind || (tierStar e c == .final && of.f.kind == "assume"))) ||
   r.assumptions.any (fun a => (a.2 == "named" && !namedDeclared e a.1) || (a.2 == "tool" && !toolDeclared e r a.1)))

def recLevel (e : Env) (r : Record) : Level :=
  match r.provider with
  | some q => if (bothProv e q).isSome then
      (match r.kind with | .test => .tested | .proof => .proven | _ => .declared) else .declared
  | none => .declared

def pinnedOut (e : Env) (pol : Policy) (c : Claim) (r : Record) : Bool :=
  let pins := (reqStar e pol c).pins
  !pins.isEmpty && !(match r.kind with
    | .judgment => r.judge.any (pins.contains ·)
    | _ => r.provider.any (pins.contains ·))

def isWeak (e : Env) (pol : Policy) (c : Claim) (r : Record) : Bool :=
  (match r.kind with
   | .test | .proof => decide ((recLevel e r).rank < (reqStar e pol c).level.rank)
   | .judgment => !(reqStar e pol c).judged
   | _ => true) || pinnedOut e pol c r

/-- The first usability reason (A.5.4.1), `none` when usable. -/
def usab (e : Env) (pol : Policy) (c : Claim) (r : Record) : Option Reason :=
  if fpMoved e pol c r then some .stale
  else if isExpired e pol c r then some .expired
  else if isPC e r then some .producerChanged
  else if hasAssumption e c r then some .assumption
  else if isWeak e pol c r then some .weak
  else none

/-! ### Applicability, force, satisfaction -/

def judgeOk (e : Env) (pol : Policy) (c : Claim) (r : Record) : Bool :=
  match r.judge with
  | some j => eligible e pol (tierStar e c) (ownerStar e c) false j r.authenticated
  | none => false

/-- r is a test, proof or claim judgment about c (equal NF), by an eligible judge. -/
def recFor (e : Env) (pol : Policy) (c : Claim) (r : Record) : Bool :=
  r.claimFp == some c.fp && (r.result == .supports || r.result == .contradicts) &&
  (match r.kind with
   | .test | .proof => true
   | .judgment => judgeOk e pol c r
   | _ => false)

/-- Contradiction force of a record against a law (A.5.5.1). -/
def lawContraForce (e : Env) (pol : Policy) (c : Claim) (r : Record) : Option Force :=
  if recFor e pol c r && r.result == .contradicts && !fpMoved e pol c r && !isExpired e pol c r then
    match r.kind with
    | .test | .proof => if r.counterexample then some (if presenceA e r.provider then .sound else .heuristic) else none
    | .judgment => some .sound
    | _ => none
  else none

def supportsUsable (e : Env) (pol : Policy) (c : Claim) (r : Record) : Bool :=
  recFor e pol c r && r.result == .supports && usab e pol c r == none

def lawSoundContra (i : Input) (c : Claim) : Bool :=
  i.records.any (fun r => lawContraForce i.env (polStar i) c r == some .sound)

def lawHeurContra (i : Input) (c : Claim) : Bool :=
  i.records.any (fun r => lawContraForce i.env (polStar i) c r == some .heuristic)

/-- Sat(c) (A.5.3.7). -/
def lawSat (i : Input) (c : Claim) : Bool :=
  !lawSoundContra i c &&
    ((reqStar i.env (polStar i) c).level == .declared || i.records.any (supportsUsable i.env (polStar i) c))

def holdsReason (i : Input) (c : Claim) (rr : Reason) : Bool :=
  i.records.any (fun r => recFor i.env (polStar i) c r && usab i.env (polStar i) c r == some rr)

/-- The unestablished reason (A.5.4.3): first of producer-changed, assumption, weak,
    expired, stale held by some record for c, else missing. -/
def lawReason (i : Input) (c : Claim) : Reason :=
  if holdsReason i c .producerChanged then .producerChanged
  else if holdsReason i c .assumption then .assumption
  else if holdsReason i c .weak then .weak
  else if holdsReason i c .expired then .expired
  else if holdsReason i c .stale then .stale
  else .missing

/-! ### Law obligations -/

def decidesLaw (p : Prov) (c : Claim) : Bool :=
  match c.op with
  | .law _ (.schema n _ _) => p.decides.contains ("template " ++ n)
  | .law _ (.hosted r) => p.decides.contains ("statements " ++ idLang r)
  | _ => false

def hasDecider (e : Env) (c : Claim) : Bool :=
  e.head.provs.any (decidesLaw · c) || (match e.base with
    | some b => b.provs.any (decidesLaw · c)
    | none => false)

def lawKindFor (c : Claim) : RecKind := if isInformal c then .judgment else .test

def lawReq (i : Input) (c : Claim) : List (String × String) :=
  reqPairs i.env c (lawKindFor c) (reqStar i.env (polStar i) c).proj

def lawCode (i : Input) (c : Claim) : List CodeRow :=
  (lawReq i c).map (fun p => (p.1, p.2, if hasBase i.env then mDigest i.env.mb p.1 p.2 else none, mDigest i.env.mh p.1 p.2))

def lawReqInDelta (i : Input) (c : Claim) : Bool := (lawReq i c).any (fun p => inDelta i.env p.1)

def pcHarness (i : Input) (c : Claim) : List String :=
  (i.records.filter (fun r => recFor i.env (polStar i) c r && isPC i.env r)).flatMap
    (fun r => (r.harness.map (·.id)).filter (finest i.env))

def mkLawOb (i : Input) (c : Claim) (kind : ObKind) (force : Option Force) (reason : Option Reason) : Ob :=
  let req := lawReq i c
  let aff := sortStrs (req.map (·.1) ++ (if reason == some .producerChanged then pcHarness i c else []))
  let subj := Subj.null
  let mech := match kind, force, reason with
    | .contradiction, some .sound, _ => true
    | .unestablished, _, some .assumption => true
    | .unestablished, _, some r => (r == .missing || r == .weak || r == .stale) && hasDecider i.env c
    | _, _, _ => false
  { kind := kind, family := .law, key := obKey kind.name (some c.fp) subj, claimFp := some c.fp,
    claimIds := c.ids, claimTier := some c.tier, excl := [c.fp], exclOwners := [ownerStar i.env c],
    subject := subj, reason := reason, force := force,
    introduced := hasBase i.env && (lawReqInDelta i c || reason == some .producerChanged),
    tier := tierStar i.env c, owner := ownerStar i.env c, affected := aff, code := lawCode i c,
    answerable := (kind == .unestablished && reason == some .producerChanged) ||
      (kind == .contradiction && force == some .heuristic),
    mechanical := mech, reqInDelta := lawReqInDelta i c }

/-- At most one of a sound contradiction and unestablished per claim (T9). -/
def lawObsFor (i : Input) (c : Claim) : List Ob :=
  let sc := lawSoundContra i c
  let hc := !sc && lawHeurContra i c
  (if sc then [mkLawOb i c .contradiction (some .sound) none] else []) ++
  (if hc then [mkLawOb i c .contradiction (some .heuristic) none] else []) ++
  (if !sc && !lawSat i c then [mkLawOb i c .unestablished none (some (lawReason i c))] else [])

def lawObs (i : Input) : List Ob := (i.env.head.claims.filter (·.isLaw)).flatMap (lawObsFor i)

end Shape
