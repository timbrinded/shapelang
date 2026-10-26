import Kernel.Laws
/-! Loosening questions (model §8, A.8): L1 (proved sound and complete in `Eval`), L2, L3
(heirs, the proved G_A test, exact single-edge counterexamples for edge forbids, and the
normative depth-first search for path and cycle forbids, whose counterexamples are
validated), L4 and L7. One obligation per base item. -/
namespace Shape

structure LPart where
  subject : String
  question : String
  tier : Tier
  owner : String
  affected : List String
  delta : List String
  /-- (identity, atom) pairs whose realisation exploits the part -/
  realise : List (String × Atom) := []
  exploited : Bool := false
deriving Repr, Inhabited

def lvlName (n : Nat) : String := if n == 0 then "none" else (Tier.ofRank n).name

def baseComp (S : Esf) (k : String) : Option Comp := S.comps.find? (·.q == k)

/-! ### L1 -/

def atomUniverse (e : Env) : List Atom :=
  let shapes := e.head :: (match e.base with | some b => [b] | none => [])
  let hatchVerbs := sortStrs ("Hatch" :: shapes.flatMap (fun s => s.hatches.map (·.1)))
  let verbs := (sortStrs (shapes.flatMap (fun s => s.verbs ++ s.effects.map (·.1) ++ s.effects.map (·.2)))).filter
    (fun v => !hatchVerbs.contains v)
  let ress := sortStrs (shapes.flatMap (fun s => s.res.map (·.q)))
  ress.flatMap (fun r => verbs.map (fun v => (⟨v, r⟩ : Atom))) ++ hatchVerbs.map (fun h => (⟨h, TRUST⟩ : Atom))

def l1PosList (e : Env) : List Pos := (mIds e.mh).map Pos.ident ++ e.cells.map (fun c => Pos.cell c.1 c.2)

def posIdent : Pos → Option String
  | .ident x => some x
  | .cell _ _ => none

def posRealise (x : Pos) (a : Atom) : List (String × Atom) :=
  match posIdent x with | some y => [(y, a)] | none => []

/-- Level parts: base forbids whose protection of `a` at `x` fell. -/
def l1Drops (e : Env) (Sb : Esf) (x : Pos) (a : Atom) : List LPart :=
  (Sb.claims.filter (forbidCovers Sb (attPos Sb e.mh true x) a)).filterMap fun f =>
    if lvl e.head (attPos e.head e.mh false x) a < f.tier.rank then
      some { subject := f.fp, question := "L1", tier := f.tier, owner := f.owner, affected := [x.name],
             delta := ["L1 level " ++ a.show ++ " " ++ f.tier.name ++ ">" ++ lvlName (lvl e.head (attPos e.head e.mh false x) a)],
             realise := posRealise x a }
    else none

def l1AuthCond (e : Env) (Sb : Esf) (x : Pos) (a : Atom) : Bool :=
  permitted e.head (attPos e.head e.mh false x) a && !permitted Sb (attPos Sb e.mh true x) a &&
    inA e.head (attPos e.head e.mh false x) a && !inA Sb (attPos Sb e.mh true x) a

/-- Authority parts: the base component of `x` newly permits `a` through its grants. -/
def l1Auth (e : Env) (Sb : Esf) (x : Pos) (a : Atom) : List LPart :=
  if l1AuthCond e Sb x a then
    match compOf Sb (attPos Sb e.mh true x) with
    | some k =>
      [{ subject := "component " ++ k, question := "L1", tier := ((baseComp Sb k).map (·.tier)).getD .normal,
         owner := ((baseComp Sb k).map (·.owner)).getD Sb.owner, affected := [x.name],
         delta := ["L1 authority+ " ++ a.show], realise := posRealise x a }]
    | none => []
  else []

def l1PartsAt (e : Env) (Sb : Esf) (x : Pos) (a : Atom) : List LPart := l1Drops e Sb x a ++ l1Auth e Sb x a

def l1Parts (e : Env) (Sb : Esf) : List LPart :=
  let atoms := atomUniverse e
  (l1PosList e).flatMap fun x => atoms.flatMap fun a => l1PartsAt e Sb x a

/-! ### L2 (summaries) -/

def l2Parts (e : Env) (Sb : Esf) : List LPart :=
  Sb.claims.flatMap fun cb => match cb.op with
    | .effectsUpper u Cb =>
      if e.head.claims.any (·.fp == cb.fp) then [] else
      let hs := e.head.claims.filterMap fun h => match h.op with
        | .effectsUpper u' C => if u' == u then some C else none
        | _ => none
      let mk (d : List String) : List LPart :=
        [{ subject := cb.fp, question := "L2", tier := cb.tier, owner := cb.owner,
           affected := sortStrs ((Sb.units.filter (·.q == u)).filterMap (unitBind Sb e.mh)), delta := d }]
      if hs.isEmpty then
        if (Sb.units.filter (·.q == u)).any (fun ud => (unitBind Sb e.mh ud).isSome) then
          mk [if e.head.claims.any (fun h => match h.op with | .effectsLower u' _ => u' == u | _ => false)
              then "L2 partial" else "L2 removed"]
        else []
      else if hs.any (fun C => C.all (fun a => Cb.any (fun c => atomLe Sb c a))) then []
      else
        let extra := sortStrs ((hs.flatMap id).filter (fun a => !Cb.any (fun c => atomLe Sb c a)) |>.map (fun a => "L2 +" ++ a.show))
        mk extra
    | _ => []

/-! ### L3 (structure) -/

def candEdges (S : Esf) : List Edge :=
  let nodes (ty : String) : List String :=
    if ty == "resource" then sortStrs (S.res.map (·.q)) else sortStrs (S.comps.map (·.q))
  S.kinds.flatMap fun k => (nodes k.2.1).flatMap fun a => ((nodes k.2.2).filter (· != a)).map fun b => (a, k.1, b)

def edgeLt (a b : Edge) : Bool := strLt a.2.1 b.2.1 || (a.2.1 == b.2.1 && strLt a.2.2 b.2.2)

def outEdges (G : List Edge) (K : List String) (n : String) : List Edge :=
  sortBy edgeLt (G.filter (fun ed => ed.1 == n && K.contains ed.2.1))

/-- The normative depth-first search (A.8.4.2), one budget unit per edge tried. -/
def dfs (heads : List Op) (W G : List Edge) (K : List String) (isT avoid : String → Bool) :
    Nat → String → List String → List Edge → Nat → Option (List Edge) × Nat
  | 0, _, _, _, b => (none, b)
  | fuel + 1, n, visited, P, b =>
    (outEdges G K n).foldl (fun acc ed =>
      match acc with
      | (some r, b') => (some r, b')
      | (none, 0) => (none, 0)
      | (none, b' + 1) =>
        let P' := if W.contains ed then P else P ++ [ed]
        if !heads.all (fun h => evalStruct h (W ++ P')) then (none, b')
        else if isT ed.2.2 then (some P', b')
        else if visited.contains ed.2.2 || avoid ed.2.2 then (none, b')
        else dfs heads W G K isT avoid fuel ed.2.2 (ed.2.2 :: visited) P' b') (none, b)

inductive SearchResult | found (P : List Edge) | exhausted | budget
deriving Repr, Inhabited

def l3Budget : Nat := 1000000

def searchCex (heads : List Op) (base : Op) (W G : List Edge) : SearchResult :=
  let ns := nodesOf G
  let fuel := ns.length + 1
  let run (starts : List String) (isT : String → String → Bool) (avoid : String → String → Bool) : SearchResult :=
    let r := starts.foldl (fun acc s =>
      match acc with
      | (some P, b) => (some P, b)
      | (none, 0) => (none, 0)
      | (none, b) => dfs heads W G (opKinds base) (isT s) (avoid s) fuel s [s] [] b) (none, l3Budget)
    match r with
    | (some P, _) => .found P
    | (none, 0) => .budget
    | (none, _) => .exhausted
  match base with
  | .pathForbid S T _ V =>
    run (ns.filter (fun s => nselMatch S s && !nselMatch V s)) (fun _ t => nselMatch T t)
      (fun _ m => nselMatch V m || nselMatch S m || nselMatch T m)
  | .cycleForbid _ => run ns (fun s m => m == s) (fun s m => strLt m s)
  | _ => .exhausted

def edgeName (ed : Edge) : String := ed.1 ++ " -" ++ ed.2.1 ++ "-> " ++ ed.2.2

/-- The L3 decision for one base structural claim (A.8.4.2). -/
inductive L3Verdict
  | heir                      -- some head claim is at least as strict by the op order
  | ga                        -- G_A satisfies the base claim (implied, `l3_ga_sound`)
  | edgeCex (ed : Edge)       -- edge forbid: a G_A edge violates it (exact)
  | searchCex (P : List Edge) -- path/cycle: a validated completing set
  | budget                    -- undecided at budget
  | exhausted                 -- search finished without counterexample (dfs_complete open)
deriving Repr, Inhabited

def edgeViolates (S X : List NSel) (k : String) (T Y : List NSel) (ed : Edge) : Bool :=
  ed.2.1 == k && nselMatch S ed.1 && !nselMatch X ed.1 && nselMatch T ed.2.2 && !nselMatch Y ed.2.2

def l3Tail (heads : List Op) (cb : Op) (W G : List Edge) : L3Verdict :=
  match cb with
  | .edgeForbid S X k T Y =>
    match (sortBy edgeLt G).find? (edgeViolates S X k T Y) with
    | some ed => .edgeCex ed
    | none => .exhausted
  | _ =>
    match searchCex heads cb W G with
    | .found P => if validCex heads cb W P then .searchCex P else .budget
    | .budget => .budget
    | .exhausted => .exhausted

def l3Decide (heads : List Op) (cb : Op) (W G : List Edge) : L3Verdict :=
  if heads.any (fun h => stronger h cb) then .heir
  else if evalStruct cb G then .ga
  else l3Tail heads cb W G

def l3Parts (e : Env) (rs : List Record) (Sb : Esf) : List LPart :=
  let heads := e.head.claims.filter (·.isStructUpper)
  let W := canon (declEdges e.head)
  let G := gaEdges (heads.map (·.op)) W (candEdges e.head)
  let Eh := evalEdges e rs
  (Sb.claims.filter (·.isStructUpper)).flatMap fun cb =>
    let sharing := heads.filter (fun h => (opKinds h.op).any ((opKinds cb.op).contains ·))
    let delta := sharing.map (fun h => "L3 head " ++ h.fp)
    let affOf (P : List Edge) := sortStrs (P.flatMap (fun ed => compCode e ed.1))
    let mk (loosened : Bool) (P : List Edge) : List LPart :=
      [{ subject := cb.fp, question := "L3", tier := cb.tier, owner := cb.owner,
         affected := affOf P, delta := if loosened then delta else "L3 undecided budget" :: delta,
         exploited := loosened && P.all (Eh.contains ·) }]
    match l3Decide (heads.map (·.op)) cb.op W G with
    | .heir | .ga | .exhausted => []
    | .edgeCex ed => mk true [ed]
    | .searchCex P => mk true P
    | .budget => mk false []

/-! ### L4 (laws) -/

def l4Parts (e : Env) (Sb : Esf) : List LPart :=
  (Sb.claims.filter (·.isLaw)).flatMap fun cb =>
    if e.head.claims.any (·.fp == cb.fp) then [] else
    let named := e.head.claims.filter (fun h => h.isLaw && h.ids.any (cb.ids.contains ·))
    let aff := sortStrs ((reqPairs e cb (lawKindFor cb) ((cb.req.map (·.proj)).getD "unit")).map (·.1))
    [{ subject := cb.fp, question := "L4", tier := cb.tier, owner := cb.owner, affected := aff,
       delta := if named.isEmpty then ["L4 removed"] else named.map (fun h => "L4 head " ++ h.fp) }]

/-! ### L7 (governance) -/

def reqGe (h b : Req) : Bool :=
  decide (h.level.rank ≥ b.level.rank) && (!h.judged || b.judged) && b.pins.all (h.pins.contains ·) &&
    (h.proj == "unit" || h.proj == b.proj)

def jq (s : String) : String := (J.str s).jcs
def jstrs (l : List String) : String := (J.arr (l.map .str)).jcs
def jnum (n : Nat) : String := toString n
def reqJ (r : Option Req) : String :=
  match r with
  | some r => (J.obj [("level", .str r.level.name), ("judged", .bool r.judged), ("pins", .arr (r.pins.map .str)),
      ("projection", .str r.proj)]).jcs
  | none => "null"

def provTier (Sb : Esf) (p : Prov) : Tier :=
  let ts := (Sb.claims.filter (fun c => decidesLaw p c || (!p.observes.isEmpty && !c.isLaw))).map (·.tier)
  ts.foldl tierMax .normal

/-- L7 (A.8.2.3) with deltas `L7 <field> <JCS(base)> <JCS(head)>` (A.12.8.7). -/
def l7Parts (i : Input) (Sb : Esf) : List LPart :=
  let e := i.env
  let Sh := e.head
  let part (subj : String) (t : Tier) (ow : String) (loosened : Bool) (field b h : String) : LPart :=
    { subject := subj, question := if loosened then "L7" else "L7?", tier := t, owner := ow, affected := [],
      delta := ["L7 " ++ field ++ " " ++ b ++ " " ++ h] }
  let claimsP := Sb.claims.flatMap fun cb =>
    let heirs := Sh.claims.filter (·.fp == cb.fp)
    if heirs.isEmpty then [] else
    let ok := heirs.any (fun h => decide (h.tier.rank ≥ cb.tier.rank) &&
      (match cb.req with
       | none => true
       | some rb => match h.req with | some rh => reqGe rh rb | none => false))
    let best := heirs.headD cb
    (if ok then [] else
      if best.tier.rank < cb.tier.rank then [part cb.fp cb.tier cb.owner true "tier" (jq cb.tier.name) (jq best.tier.name)]
      else [part cb.fp cb.tier cb.owner true "requirement" (reqJ cb.req) (reqJ best.req)]) ++
    (heirs.filter (·.owner != cb.owner)).map (fun h => part cb.fp cb.tier cb.owner false "owner" (jq cb.owner) (jq h.owner))
  let polP := match i.basePolicy with
    | some bp =>
      [(Tier.low, bp.low, i.headPolicy.low), (.normal, bp.normal, i.headPolicy.normal), (.critical, bp.critical, i.headPolicy.critical)].flatMap
        fun (t, b, h) =>
          let s := "policy " ++ t.name
          (if b.blocks.all (h.blocks.contains ·) then [] else [part s t Sb.owner true "blocks" (jstrs b.blocks) (jstrs h.blocks)]) ++
          (if h.maxAge > b.maxAge then [part s t Sb.owner true "max_age" (jnum b.maxAge) (jnum h.maxAge)] else []) ++
          (if h.floor.rank < b.floor.rank then [part s t Sb.owner true "floor" (jq b.floor.name) (jq h.floor.name)] else []) ++
          (if h.judges.all (b.judges.contains ·) then [] else [part s t Sb.owner true "judges" (jstrs b.judges) (jstrs h.judges)])
    | none => []
  let shapeP := (match i.basePolicy with
      | some bp => match bp.budget with
        | some bb => match i.headPolicy.budget with
          | some hb => if hb > bb then [part "shape" .critical Sb.owner true "budget" (jnum bb) (jnum hb)] else []
          | none => [part "shape" .critical Sb.owner true "budget" (jnum bb) "null"]
        | none => []
      | none => []) ++
    (if Sb.owner != "" && Sb.owner != Sh.owner then [part "shape" .critical Sb.owner false "owner" (jq Sb.owner) (jq Sh.owner)] else [])
  let notStd (q : String) := !strPrefix "std::" q
  let compP := (Sb.comps.filter (fun c => notStd c.q)).flatMap fun cb =>
    match Sh.comps.find? (·.q == cb.q) with
    | some ch =>
      let s := "component " ++ cb.q
      (if ch.tier.rank < cb.tier.rank then [part s cb.tier cb.owner true "tier" (jq cb.tier.name) (jq ch.tier.name)] else []) ++
      (if ch.allows.all (cb.allows.contains ·) then [] else [part s cb.tier cb.owner true "allows" (jstrs cb.allows) (jstrs ch.allows)]) ++
      (if ch.assumes.all (cb.assumes.contains ·) then [] else [part s cb.tier cb.owner true "assumes" (jstrs cb.assumes) (jstrs ch.assumes)]) ++
      (if ch.owner == cb.owner then [] else [part s cb.tier cb.owner false "owner" (jq cb.owner) (jq ch.owner)])
    | none => []
  let resP := (Sb.res.filter (fun r => notStd r.q)).flatMap fun rb =>
    match Sh.res.find? (·.q == rb.q) with
    | some rh =>
      let s := "resource " ++ rb.q
      (if rh.tier.rank < rb.tier.rank then [part s rb.tier rb.owner true "tier" (jq rb.tier.name) (jq rh.tier.name)] else []) ++
      (if rh.owner == rb.owner then [] else [part s rb.tier rb.owner false "owner" (jq rb.owner) (jq rh.owner)])
    | none => []
  let unitP := Sb.units.flatMap fun ub =>
    match Sh.units.find? (·.q == ub.q) with
    | some uh =>
      let s := "unit " ++ ub.q
      (if uh.tier.rank < ub.tier.rank then [part s ub.tier ub.owner true "tier" (jq ub.tier.name) (jq uh.tier.name)] else []) ++
      (if uh.owner == ub.owner then [] else [part s ub.tier ub.owner false "owner" (jq ub.owner) (jq uh.owner)])
    | none => []
  let provP := Sb.provs.flatMap fun pb =>
    let t := provTier Sb pb
    let s := "provider " ++ pb.q
    match Sh.provs.find? (·.q == pb.q) with
    | none => [part s t Sb.owner true "removed" (jq pb.q) "null"]
    | some ph =>
      (if ph.trusts.all (pb.trusts.contains ·) then [] else
        [part s t Sb.owner true "trusts" ((pb.fields.find? (·.1 == "trusts")).map (·.2) |>.getD (jstrs pb.trusts))
          ((ph.fields.find? (·.1 == "trusts")).map (·.2) |>.getD (jstrs ph.trusts))]) ++
      (pb.fields.filterMap fun (f, bv) =>
        let hv := ((ph.fields.find? (·.1 == f)).map (·.2)).getD "null"
        if bv == hv then none else some (part s t Sb.owner false f bv hv))
  let actorP := (Sb.actors.filter (fun a => notStd a.q)).flatMap fun ab =>
    match Sh.actors.find? (·.q == ab.q) with
    | some ah =>
      let s := "actor " ++ ab.q
      (if ah.members.all (ab.members.contains ·) then [] else [part s .normal Sb.owner false "member" (jstrs ab.members) (jstrs ah.members)]) ++
      (if ah.operator == ab.operator then [] else
        [part s .normal Sb.owner false "operator" ((ab.operator.map jq).getD "null") ((ah.operator.map jq).getD "null")])
    | none => []
  claimsP ++ polP ++ shapeP ++ compP ++ resP ++ unitP ++ provP ++ actorP

/-! ### Loosening obligations -/

def realised (e : Env) (rs : List Record) (p : String × Atom) : Bool :=
  (obsFacts e rs).any (fun of => of.f.loc == p.1 && match liftAtom e.head of.f with
    | some b => atomLe e.head b p.2
    | none => false) ||
  e.head.claims.any (fun c => match c.op with
    | .effectsUpper u C | .effectsLower u C =>
      ((e.head.units.find? (·.q == u)).bind (unitBind e.head e.mh)) == some p.1 && C.any (fun b => atomLe e.head b p.2)
    | _ => false)

def mkLoosenOb (e : Env) (rs : List Record) (subject : String) (ps : List LPart) : Ob :=
  let p0 := ps.headD default
  let aff := sortStrs (ps.flatMap (·.affected))
  let qs := sortStrs (ps.map (fun p => if p.question == "L7?" then "L7" else p.question))
  let expl := ps.any (fun p => p.exploited || p.realise.any (realised e rs))
  { kind := .loosening, family := .loosening, key := obKey "loosening" none (.item subject),
    subject := .item subject, questions := qs, introduced := true, tier := p0.tier, owner := p0.owner,
    affected := aff, code := finestRows e aff, delta := sortStrs (ps.flatMap (·.delta)),
    exploited := some expl, answerable := true, mechanical := false }

def loosenObs (i : Input) : List Ob :=
  let e := i.env
  match e.base with
  | some Sb =>
    if !hasBase e then [] else
    let parts := l1Parts e Sb ++ l2Parts e Sb ++ l3Parts e i.records Sb ++ l4Parts e Sb ++ l7Parts i Sb
    (sortStrs (parts.map (·.subject))).map fun s => mkLoosenOb e i.records s (parts.filter (·.subject == s))
  | none => []

end Shape
