import Kernel.Obligation
import Kernel.Struct
/-! Observed worlds and checker-decided contradictions (model §4.4, A.4.4, A.7.3).

* `obsFacts`: usable observation facts plus the head manifest's hatch facts.
* `effSubjects`/`mkEffContra`: authority and effect-forbid contradictions (one per
  `{code, atom}`, against the first excluding claim).
* `structContras`: edge, path and cycle forbids over the lifted component graph.
* `conductContras`: `effects complete` summaries. -/
namespace Shape

/-! ### Change, governance shape, providers -/

def hasBase (e : Env) : Bool := e.mode == .change && e.base.isSome

/-- The shape whose actors and identities govern the change (base; head in audit mode). -/
def govS (e : Env) : Esf := e.base.getD e.head

def provH (e : Env) (q : String) : Option Prov := e.head.provs.find? (·.q == q)
def provB (e : Env) (q : String) : Option Prov :=
  match e.base with
  | some b => b.provs.find? (·.q == q)
  | none => provH e q

def provDeclared (e : Env) : Option String → Bool
  | some q => (provH e q).isSome || (provB e q).isSome
  | none => false

/-- Contradiction and refutation force: presence base ∨ head (A.6.2.6 (a)). -/
def presenceA (e : Env) : Option String → Bool
  | some q => ((provH e q).map (·.presence)).getD false || ((provB e q).map (·.presence)).getD false
  | none => false

/-- Establishing force, coverage: declared in both (A.6.2.6 (b)). -/
def bothProv (e : Env) (q : String) : Option (Prov × Prov) :=
  match provB e q, provH e q with
  | some b, some h => some (b, h)
  | _, _ => none

def absenceB (e : Env) : Option String → Bool
  | some q => match bothProv e q with
    | some (b, h) => b.absence && h.absence
    | none => false
  | none => false

def observesB (e : Env) (q : String) (ch : String) : Bool :=
  match bothProv e q with
  | some (b, h) => b.observes.contains ch || h.observes.contains ch && b.observes.contains ch
  | none => false

def implPathsU (e : Env) (q : String) : List String :=
  ((provH e q).map (·.implPaths)).getD [] ++ ((provB e q).map (·.implPaths)).getD []

/-! ### Code delta -/

def changed (e : Env) (x : String) : Bool :=
  hasBase e && (!(e.mb.any (·.id == x)) ||
    (e.mh.filter (·.id == x)).any (fun me => match mDigest e.mb x me.proj with
      | some d => d != me.digest
      | none => false))

def deletedIds (e : Env) : List String :=
  if hasBase e then (mIds e.mb).filter (fun x => !(e.mh.any (·.id == x))) else []

def inDelta (e : Env) (x : String) : Bool := changed e x || (deletedIds e).contains x

/-- Finest changes: identities whose `own` digest is new or moved. -/
def finest (e : Env) (x : String) : Bool :=
  hasBase e && (mDigest e.mh x "own").isSome && mDigest e.mh x "own" != mDigest e.mb x "own"

def ownRow (e : Env) (x : String) : CodeRow := (x, "own", mDigest e.mb x "own", mDigest e.mh x "own")

def finestRows (e : Env) (xs : List String) : List CodeRow := (xs.filter (finest e)).map (ownRow e)

/-! ### Observed facts -/

structure OFact where
  f : Fact
  sound : Bool
  prov : String
deriving DecidableEq, Repr, Inhabited

def canonFact (f : Fact) : Fact := if f.ty == "effect" then { f with res := canonRC f.res } else f

def anchorEntry (m : List MEntry) (r : Record) (x : String) : Option OEntry :=
  (ancestors m x).findSome? (fun y => r.entries.find? (·.id == y))

def entryUsableIn (m : List MEntry) (en : OEntry) : Bool :=
  mDigest m en.id en.proj == some en.digest && en.deps.all (fun d => mDigest m d.id d.proj == some d.digest)

def recFacts (e : Env) (r : Record) : List OFact :=
  if r.kind == .observation && provDeclared e r.provider then
    r.facts.filterMap fun f => match anchorEntry e.mh r f.loc with
      | some en => if entryUsableIn e.mh en then some ⟨canonFact f, presenceA e r.provider, r.provider.getD ""⟩ else none
      | none => none
  else []

def hatchFacts (e : Env) : List OFact :=
  e.mh.flatMap fun me => me.markers.filterMap fun hn =>
    if hn.2 > 0 then some ⟨⟨"hatch", me.id, "", "", "", hn.1, hn.2⟩, true, "manifest"⟩ else none

/-- W_obs° (A.4.4.5): usable observation facts and the head manifest's hatch facts. -/
def obsFacts (e : Env) (rs : List Record) : List OFact := hatchFacts e ++ rs.flatMap (recFacts e)

def sameFact (a b : Fact) : Bool :=
  a.ty == b.ty && a.loc == b.loc && a.verb == b.verb && a.res == b.res && a.to == b.to && a.kind == b.kind

def baseMarkers (e : Env) (x h : String) : Nat :=
  (e.mb.filter (·.id == x)).foldl (fun acc me => max acc ((me.markers.find? (·.1 == h)).map (·.2) |>.getD 0)) 0

def baseReports (e : Env) (brs : List Record) (f : Fact) : Bool :=
  brs.any fun r => r.kind == .observation && r.facts.any fun g =>
    sameFact (canonFact g) f && decide (g.n ≥ f.n) &&
      (match anchorEntry e.mb r g.loc with
       | some en => entryUsableIn e.mb en
       | none => false)

/-- New facts (A.7.3.1). -/
def factNew (e : Env) (brs : List Record) (of : OFact) : Bool :=
  hasBase e && (if of.f.ty == "hatch" then decide (baseMarkers e of.f.loc of.f.kind < of.f.n)
                else changed e of.f.loc && !baseReports e brs of.f)

/-! ### Lifting -/

def resOf (S : Esf) (rc : String) : Option String :=
  let c := canonRC rc
  match S.res.filter (fun r => r.bind.any (fun b => canonRC b == c)) with
  | [r] => some r.q
  | _ => none

def liftAtom (S : Esf) (f : Fact) : Option Atom :=
  if f.ty == "hatch" then some ⟨if S.hatches.any (·.1 == f.kind) then f.kind else "Hatch", TRUST⟩
  else if f.ty == "effect" then (resOf S f.res).map (fun q => ⟨f.verb, q⟩)
  else none

/-! ### Tier*, owner* -/

def baseSame (e : Env) (c : Claim) : List Claim :=
  match e.base with
  | some b => if hasBase e then b.claims.filter (·.fp == c.fp) else []
  | none => []

def tierStar (e : Env) (c : Claim) : Tier := (baseSame e c).foldl (fun t b => tierMax t b.tier) c.tier

def ownerStar (e : Env) (c : Claim) : String :=
  match baseSame e c with
  | b :: _ => b.owner
  | [] => c.owner

/-! ### Authority and effect-forbid contradictions -/

/-- A declared summary atom at x: its violation is a coherence error (E-conduct), and
    "keys with one report no contradiction" (A.4.4.12). -/
def declaredAt (e : Env) (x : String) (b : Atom) : Bool :=
  e.head.claims.any fun c => match c.op with
    | .effectsUpper u C | .effectsLower u C =>
      C.contains b && ((e.head.units.find? (·.q == u)).bind (unitBind e.head e.mh)) == some x
    | _ => false

def effViol (e : Env) (of : OFact) : Option (String × Atom) :=
  match liftAtom e.head of.f with
  | some b => if permitted e.head (att e.head e.mh of.f.loc) b || declaredAt e of.f.loc b then none
              else some (of.f.loc, b)
  | none => none

def effSubjects (e : Env) (rs : List Record) : List (String × Atom) :=
  canon ((obsFacts e rs).filterMap (effViol e))

def exclCands (e : Env) (u : URef) (b : Atom) : List Claim :=
  e.head.claims.filter (forbidCovers e.head u b) ++
    (if inA e.head u b then [] else match compOf e.head u with
      | some k => authClaims e.head k
      | none => [])

def claimOrdLt (e : Env) (a b : Claim) : Bool :=
  let ra := (tierStar e a).rank
  let rb := (tierStar e b).rank
  decide (ra > rb) || (ra == rb && ((a.isForbid && !b.isForbid) || (a.isForbid == b.isForbid && strLt a.fp b.fp)))

/-- The first claim by (tier* descending, effect.forbid before authority, fp). -/
def pickFirst (e : Env) (cs : List Claim) : Option Claim :=
  cs.foldl (fun best c => match best with
    | none => some c
    | some b => if claimOrdLt e c b then some c else some b) none

def effCore (e : Env) (s : String × Atom) : Option Ob :=
  let cands := exclCands e (att e.head e.mh s.1) s.2
  match pickFirst e cands with
  | none => none
  | some c =>
    let subj := Subj.codeAtom s.1 s.2.show
    some { kind := .contradiction, family := .authority, key := obKey "contradiction" (some c.fp) subj,
           claimFp := some c.fp, claimIds := c.ids, claimTier := some c.tier,
           excl := cands.map (·.fp), exclOwners := cands.map (ownerStar e ·), subject := subj,
           tier := tierStar e c, owner := ownerStar e c, affected := [s.1], code := finestRows e [s.1] }

def effSupport (e : Env) (rs : List Record) (s : String × Atom) : List OFact :=
  (obsFacts e rs).filter (fun of => of.f.loc == s.1 && liftAtom e.head of.f == some s.2)

def effForce (e : Env) (rs : List Record) (s : String × Atom) : Force :=
  if (effSupport e rs s).any (·.sound) then .sound else .heuristic

def mkEffContra (e : Env) (rs brs : List Record) (s : String × Atom) : Option Ob :=
  (effCore e s).map fun o =>
    let sup := effSupport e rs s
    let force := effForce e rs s
    { o with force := some force, introduced := sup.any (factNew e brs),
             witness := sortStrs (sup.map (fun x => factId x.f)),
             answerable := force == .heuristic, mechanical := force == .sound }

def effContras (e : Env) (rs brs : List Record) : List Ob := (effSubjects e rs).filterMap (mkEffContra e rs brs)

/-! ### The lifted component graph -/

def compOfId (S : Esf) (m : List MEntry) (x : String) : Option String := compOf S (att S m x)

def kindTo (S : Esf) (k : String) : String :=
  ((S.kinds.find? (·.1 == k)).map (·.2.2)).getD "component"

/-- A lifted edge with the observed facts behind it (empty for declared edges). -/
structure LEdge where
  e : Edge
  facts : List OFact
deriving Repr, Inhabited

def liftEdge (S : Esf) (m : List MEntry) (of : OFact) : Option Edge :=
  if of.f.ty == "call" then
    match compOfId S m of.f.loc, compOfId S m of.f.to with
    | some a, some b => if a != b then some (a, "calls", b) else none
    | _, _ => none
  else if of.f.ty == "edge" && S.kinds.any (·.1 == of.f.kind) then
    match compOfId S m of.f.loc with
    | some a =>
      if kindTo S of.f.kind == "resource" then (resOf S of.f.to).map (fun r => (a, of.f.kind, r))
      else (compOfId S m of.f.to).bind (fun b => if a != b then some (a, of.f.kind, b) else none)
    | none => none
  else none

def declEdges (S : Esf) : List Edge :=
  S.claims.filterMap fun c => match c.op with
    | .edgeExists a k b => some (a, k, b)
    | _ => none

def obsEdges (e : Env) (rs : List Record) : List (Edge × OFact) :=
  (obsFacts e rs).filterMap fun of => (liftEdge e.head e.mh of).map (fun ed => (ed, of))

def evalEdges (e : Env) (rs : List Record) : List Edge := canon (declEdges e.head ++ (obsEdges e rs).map (·.1))

def soundEdges (e : Env) (rs : List Record) : List Edge :=
  canon (declEdges e.head ++ ((obsEdges e rs).filter (·.2.sound)).map (·.1))

def nodesOf (E : List Edge) : List String := sortStrs (E.map (·.1) ++ E.map (·.2.2))

/-- Structural subjects violated in a graph, with the nodes whose edges support them. -/
def structViol (op : Op) (E : List Edge) : List (Subj × List String) :=
  match op with
  | .edgeForbid S X k T Y =>
    (E.filter fun ed => ed.2.1 == k && nselMatch S ed.1 && !nselMatch X ed.1 && nselMatch T ed.2.2 && !nselMatch Y ed.2.2).map
      fun ed => (Subj.fromTo ed.1 ed.2.2, [ed.1, ed.2.2])
  | .pathForbid S T K V =>
    let ns := nodesOf E
    let blocked := fun n => nselMatch V n || nselMatch S n || nselMatch T n
    (ns.filter fun s => nselMatch S s && !nselMatch V s).flatMap fun s =>
      let r := reachK K blocked E s
      (r.filter (nselMatch T)).map fun t => (Subj.fromTo s t, s :: r)
  | .cycleForbid K =>
    let ns := nodesOf E
    canon ((ns.filter fun n => (reachK K (fun _ => false) E n).contains n).map fun n =>
      let r := reachK K (fun _ => false) E n
      let scc := sortStrs (n :: r.filter (fun m => (reachK K (fun _ => false) E m).contains n))
      (Subj.nodes scc, scc))
  | _ => []

def opKinds : Op → List String
  | .edgeForbid _ _ k _ _ => [k]
  | .pathForbid _ _ K _ => K
  | .cycleForbid K => K
  | _ => []

def structContras (e : Env) (rs brs : List Record) : List Ob :=
  let E := evalEdges e rs
  let Ed := canon (declEdges e.head)
  let Es := soundEdges e rs
  (e.head.claims.filter (·.isStructUpper)).flatMap fun c =>
    let declViol := (structViol c.op Ed).map (·.1)
    let soundViol := (structViol c.op Es).map (·.1)
    ((structViol c.op E).filter (fun sv => !declViol.contains sv.1)).map fun sv =>
      let ns := sv.2
      let sup := ((obsEdges e rs).filter fun p => ns.contains p.1.1 && ns.contains p.1.2.2 &&
        (opKinds c.op).contains p.1.2.1).map (·.2)
      let force := if soundViol.contains sv.1 then Force.sound else .heuristic
      let aff := sortStrs (sup.map (·.f.loc))
      { kind := .contradiction, family := .structure, key := obKey "contradiction" (some c.fp) sv.1,
        claimFp := some c.fp, claimIds := c.ids, claimTier := some c.tier, excl := [c.fp],
        exclOwners := [ownerStar e c], subject := sv.1, force := some force,
        introduced := sup.any (factNew e brs), tier := tierStar e c, owner := ownerStar e c,
        affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
        answerable := force == .heuristic, mechanical := force == .sound : Ob }

/-- Coherence errors of the structure fragment: violations within W_decl (E-structure). -/
def structErrors (e : Env) : List (String × String) :=
  let Ed := canon (declEdges e.head)
  (e.head.claims.filter (·.isStructUpper)).flatMap fun c =>
    if evalStruct c.op Ed then [] else [("E-structure", c.fp)]

/-! ### Conduct: `effects complete` summaries -/

def unitCode (e : Env) (u : String) : List String := (mIds e.mh).filter (fun x => att e.head e.mh x == .unit u)

def callPairs (e : Env) (rs : List Record) : List (String × String) :=
  ((obsFacts e rs).filter (·.f.ty == "call")).map (fun of => (of.f.loc, of.f.to))

/-- reach(u): the unit's code closed under observed calls (A.3.3.10). -/
def reachU (e : Env) (rs : List Record) (u : String) : List String :=
  reachSet (callPairs e rs) (fun _ => true) (unitCode e u)

def conductContras (e : Env) (rs brs : List Record) : List Ob :=
  e.head.claims.flatMap fun c => match c.op with
    | .effectsUpper u C =>
      let r := reachU e rs u
      let facts := (obsFacts e rs).filter (fun of => r.contains of.f.loc)
      let bad := canon (facts.filterMap fun of => match liftAtom e.head of.f with
        | some b => if b.isTrust || C.any (fun a => atomLe e.head a b) then none else some b
        | none => none)
      bad.map fun b =>
        let sup := facts.filter (fun of => liftAtom e.head of.f == some b)
        let force := if sup.any (·.sound) then Force.sound else .heuristic
        let subj := Subj.unitAtom u b.show
        let aff := sortStrs (sup.map (·.f.loc))
        { kind := .contradiction, family := .conduct, key := obKey "contradiction" (some c.fp) subj,
          claimFp := some c.fp, claimIds := c.ids, claimTier := some c.tier, excl := [c.fp],
          exclOwners := [ownerStar e c], subject := subj, force := some force,
          introduced := sup.any (factNew e brs), tier := tierStar e c, owner := ownerStar e c,
          affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
          answerable := force == .heuristic, mechanical := force == .sound : Ob }
    | _ => []

/-- E-conduct: a declared summary atom outside P(u) (A.4.4.12). -/
def conductErrors (e : Env) : List (String × String) :=
  e.head.claims.flatMap fun c => match c.op with
    | .effectsUpper u C | .effectsLower u C =>
      if C.all (fun a => permitted e.head (.unit u) a) then [] else [("E-conduct", "unit " ++ u)]
    | _ => []

end Shape
