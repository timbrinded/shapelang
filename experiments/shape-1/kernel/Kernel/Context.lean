import Kernel.World
/-! The derivation context (A.7.8 steps 1–6): worlds, delta, ρ, heirs, G*, policy*, code ≡,
the observed world W_obs° (A.4.4.5) with W_decl (A.4.4.4), Calls° and Refs° (A.3.3.10),
lifted edges (A.4.4.2) and eligibility (A.6.3, A.16.12, A.16.15). Executable layer. -/
namespace Shape

open Std

/-- A world fact (A.12.8.4): observed (records), hatch (manifest) or declared (W_decl). -/
structure WFact where
  fid : String
  ty : String
  /-- the (relocated) identity; `none` for declared facts of an unbound unit -/
  at? : Option String
  verb : String
  res : String
  to : String
  kind : String
  claim : String
  unit : String
  atom : String
  declared : Bool
  observed : Bool
  sound : Bool
  relocated : Bool
  n : Option Nat
  /-- the fact as printed in `facts` (A.16.26(a)) -/
  raw : J
  sources : List (String × String)
  /-- the anchors the fact was reported under: per record, the nearest ancestor-or-self with a
      usable entry from that record's provider (A.4.4.5, A.15.9) -/
  anchors : List String := []
deriving Inhabited

def WFact.atD (f : WFact) : String := match f.at? with | some x => x | none => "unit:" ++ f.unit

structure UEntry where
  record : String
  provider : String
  entry : OEntry
  pc : Bool
deriving Inhabited

structure LEdge where
  src : String
  kind : String
  dst : String
  facts : List WFact
deriving Inhabited

def LEdge.e (l : LEdge) : Edge := (l.src, l.kind, l.dst)

structure Ctx where
  inp : Input
  mode : Mode
  now : Int
  /-- change or preview mode with a base revision -/
  hasBase : Bool
  /-- … whose shape is readable -/
  readable : Bool
  head : Esf
  base : Option Esf
  gov : Esf
  mh : Manifest
  mb : Manifest
  Wh : World
  Wb : Option World
  delta : Delta
  rho : Rho
  heirs : HashMap String (List String)
  heirOf : HashMap String (List String)
  hClaims : HashMap String Claim
  bClaims : HashMap String Claim
  provs : List ProvG
  pol : Policy
  basePol : Policy
  uf : HashMap String String
  impliesC : HashMap String (List String)
  records : List Record
  baseRecords : List Record
  pcRec : HashMap String Bool
  facts : List WFact
  factById : HashMap String WFact
  entries : HashMap String (List UEntry)
  calls : HashMap String (List (String × WFact))
  refsG : HashMap String (List String)
  edges : List LEdge
  declEdges : List LEdge
  unanchored : Nat
  externalCalls : Nat
  ungovernedCalls : Nat
  droppedEdges : Nat
  errors : List KErr
  /-- base claim fps whose final loosening two persons answered in this run (A.6.2.3, A.16.13) -/
  answeredFinal : List String := []
deriving Inhabited

/-! ### Code ≡ (A.5.6.2) -/

partial def ufFind (uf : HashMap String String) (x : String) : String :=
  match uf.get? x with
  | some p => if p == x then x else ufFind uf p
  | none => x

def Ctx.digestEq (c : Ctx) (m : Manifest) (x p d : String) : Bool :=
  m.digestIs x p d ||
    (match m.info? x with
     | some i => i.allDigests.any (fun q => q.1 == p && ufFind c.uf q.2 == ufFind c.uf d)
     | none => false)

def Ctx.prov? (c : Ctx) (q : String) : Option ProvG := c.provs.find? (·.q == q)

/-- The base manifest identity (A.5.2.17): the governance base's, none over an unreadable base. -/
def Ctx.manifestIdentity (c : Ctx) : Option String :=
  if c.hasBase && !c.readable then none else c.gov.manifestId

def Ctx.hasRelay (c : Ctx) : Bool := c.provs.any (fun g => g.base.isSome && g.produces.contains "judgment")

/-! ### Provider producer change (A.5.4.1 [D9]) -/

/-- SourceRef `lang("path#sym")` or an identity, as an identity. -/
def srcRefId (s : String) : String :=
  match (splitChar '(' s) with
  | lang :: rest@(_ :: _) =>
    let inner := "(".intercalate rest
    if strSuffix ")" inner then
      match J.parse (dropRight 1 inner) with
      | .ok (.str p) => lang ++ ":" ++ p
      | _ => s
    else s
  | _ => s

/-- The implementation of a provider meets Δcode ∪ deleted, or its digest moved. -/
def implMoved (mh mb : Manifest) (d : Delta) (g : ProvG) : Bool :=
  g.implDigests.length > 1 ||
  (d.ids.toList ++ d.deleted).any (fun x =>
    let path := match mh.info? x with
      | some i => i.path
      | none => ((mb.info? x).map (·.path)).getD (idPath x)
    g.implPaths.any (globMatch · path)) ||
  g.implIds.any (fun s => d.inDelta (srcRefId s))

/-- Implementation and harness finest changes of a record's provider (A.7.2.2, A.16.19). -/
def implFinest (mh : Manifest) (d : Delta) (g : ProvG) (r : Record) : List String :=
  sortStrs ((d.finest.toList.filter fun x =>
      let path := ((mh.info? x).map (·.path)).getD (idPath x)
      g.implPaths.any (globMatch · path) || g.implIds.any (fun s => srcRefId s == x)) ++
    (r.harness.map (·.id)).filter (d.finest.contains ·))

def recPC (mh mb : Manifest) (d : Delta) (provs : List ProvG) (r : Record) : Bool :=
  r.kind != .judgment && match r.provider with
    | none => false
    | some q => match provs.find? (·.q == q) with
      | none => false
      | some g => implMoved mh mb d g || r.harness.any (fun h => d.inDelta h.id)

/-! ### Facts -/

def factIdOf (raw : J) : String :=
  match raw with
  | .obj kvs => Hd (.obj (kvs.filter (·.1 != "n")))
  | o => Hd o

def canonFactJ (f : Fact) : J :=
  match f.raw with
  | .obj kvs => .obj (kvs.map fun (k, v) => if k == "resource" && f.ty == "effect" then (k, .str (canonRC f.res)) else (k, v))
  | _ => .null

def mkDeclared (raw : J) (kind : String) (at? : Option String) (unit atom verb res to claim : String) : WFact :=
  { fid := factIdOf raw, ty := "declared", at? := at?, verb := verb, res := res, to := to, kind := kind,
    claim := claim, unit := unit, atom := atom, declared := true, observed := false, sound := true,
    relocated := false, n := some 1, raw := raw, sources := [] }

/-! ### Building the context -/

def buildCtx (inp : Input) : Ctx := Id.run do
  let mode := inp.mode
  let hasBase := mode != .audit && inp.hasBaseRev
  let readable := hasBase && !inp.baseUnreadable && inp.base.isSome
  let head := inp.head
  let base := if readable then inp.base else none
  let gov := match base with | some b => b | none => head
  let mh := inp.mh
  let mb := inp.mb
  let (Wh, hErrs) := buildWorld head mh (if hasBase then some mb else none) false
  let Wb := base.map (fun b => (buildWorld b mh (some mb) true).1)
  let delta := computeDelta mh mb hasBase
  let rho := match base, Wb with
    | some b, some wb => computeRho b head wb Wh
    | _, _ => { map := {}, hints := {}, unmapped := [], renames := [], errors := [] }
  -- over an unreadable base the head stands in for L0's owner and answerers only (A.16.16); the
  -- base declares no providers, relay or manifest identity (A.6.2.6(d,e), A.5.2.17, A.7.6.8)
  let provs := provGov (if hasBase && !readable then ({ q := "", owner := "" } : Esf) else gov) head
  let pol := match base with | some b => policyStar b.policy head.policy | none => head.policy
  let basePol := gov.policy
  -- code ≡: contributing equivalence records (A.5.6.1-2)
  let contributing (r : Record) : Bool := match r.provider with
    | some q => match provs.find? (·.q == q) with
      | some g => g.presenceB && g.decidesB.contains "equivalence"
      | none => false
    | none => false
  let mut uf : HashMap String String := {}
  for r in inp.records do
    if r.kind == .equivalence && r.pairSpace == "code" && r.result == .equivalent && contributing r then
      let a := ufFind uf r.pairFrom
      let b := ufFind uf r.pairTo
      if a != b then
        if strLt a b then uf := uf.insert b a else uf := uf.insert a b
  let mut impliesC : HashMap String (List String) := {}
  for r in inp.records do
    if r.kind == .equivalence && r.pairSpace == "claim" && contributing r then
      impliesC := impliesC.insert r.pairFrom (((impliesC.get? r.pairFrom).getD []) ++ [r.pairTo])
      if r.result == .equivalent then
        impliesC := impliesC.insert r.pairTo (((impliesC.get? r.pairTo).getD []) ++ [r.pairFrom])
  let hClaims : HashMap String Claim := head.claims.foldl (fun m c => m.insert c.fp c) {}
  let bClaims : HashMap String Claim := match base with
    | some b => b.claims.foldl (fun m c => m.insert c.fp c) {}
    | none => {}
  let ctx0 : Ctx :=
    { inp := inp, mode := mode, now := inp.now, hasBase := hasBase, readable := readable,
      head := head, base := base, gov := gov, mh := mh, mb := mb, Wh := Wh, Wb := Wb, delta := delta,
      rho := rho, heirs := {}, heirOf := {}, hClaims := hClaims, bClaims := bClaims, provs := provs,
      pol := pol, basePol := basePol, uf := uf, impliesC := impliesC, records := inp.records,
      baseRecords := inp.baseRecords, pcRec := {}, facts := [], factById := {}, entries := {}, calls := {},
      refsG := {}, edges := [], declEdges := [], unanchored := 0, externalCalls := 0, ungovernedCalls := 0,
      droppedEdges := 0, errors := hErrs ++ rho.errors }
  -- producer change per record
  let mut pcRec : HashMap String Bool := {}
  for r in inp.records do
    pcRec := pcRec.insert r.id (hasBase && recPC mh mb delta provs r)
  -- usable observation entries and observed facts (A.4.4.5, A.5.4.2)
  let mut entries : HashMap String (List UEntry) := {}
  let mut byFid : HashMap String WFact := {}
  let mut fidOrder : List String := []
  let mut unanchored := 0
  let mut externalCalls := 0
  for r in inp.records do
    if r.kind != .observation then continue
    let pq := r.provider.getD ""
    let some g := provs.find? (·.q == pq) | continue
    let pc := (pcRec.get? r.id).getD false
    let atHead := r.revision == inp.headRev
    let mut usable : List String := []
    for en in r.entries do
      let ok := ctx0.digestEq mh en.id en.proj en.digest &&
        (atHead || (g.depsCompleteB && en.deps.all (fun dd => ctx0.digestEq mh dd.id dd.proj dd.digest)))
      if !ok then continue
      usable := usable ++ [en.id]
      entries := entries.insert en.id (((entries.get? en.id).getD []) ++ [⟨r.id, pq, en, pc⟩])
    for f in r.facts do
      if f.ty == "hatch" then continue
      let mut loc := f.loc
      let mut relocated := false
      if !mh.has loc then
        let rec up (fuel : Nat) (y : Option String) : Option String :=
          match fuel, y with
          | 0, _ => none
          | _, none => none
          | fuel + 1, some z => if mh.has z then some z else up fuel (parentOfId z)
        match up 64 (parentOfId loc) with
        | some p => loc := p; relocated := true
        | none => unanchored := unanchored + 1; continue
      let anchor? := (mh.ancestors loc).find? (usable.contains ·)
      if anchor?.isNone then
        unanchored := unanchored + 1
        continue
      let anchor := anchor?.getD loc
      if f.ty == "call" && !mh.has f.to then
        externalCalls := externalCalls + 1
        continue
      let raw := canonFactJ f
      let fid := factIdOf raw
      let presence := g.presenceA && !relocated
      match byFid.get? fid with
      | some prev =>
        let n := match prev.n, f.n with
          | some a, some b => some (max a b)
          | some a, none => some a
          | none, b => b
        let rawN := match raw, n with
          | .obj kvs, some k => .obj ((kvs.filter (·.1 != "n")) ++ [("n", .num k)])
          | o, _ => o
        let upd : WFact :=
          { prev with n := n, sound := prev.sound || presence, raw := if n.isSome then rawN else prev.raw,
                      sources := prev.sources ++ [(r.id, pq)],
                      anchors := if prev.anchors.contains anchor then prev.anchors else prev.anchors ++ [anchor] }
        byFid := byFid.insert fid upd
      | none =>
        fidOrder := fidOrder ++ [fid]
        let nf : WFact :=
          { fid := fid, ty := f.ty, at? := some loc, verb := f.verb, res := if f.ty == "effect" then canonRC f.res else f.res,
            to := f.to, kind := f.kind, claim := "", unit := "", atom := "", declared := false, observed := true,
            sound := presence, relocated := relocated, n := f.n, raw := raw, sources := [(r.id, pq)],
            anchors := [anchor] }
        byFid := byFid.insert fid nf
  let obsFacts := fidOrder.filterMap (byFid.get? ·)
  -- manifest hatch facts (A.3.4.4)
  let hatchFs : List WFact := mh.order.flatMap fun x =>
    (mh.markers x).filterMap fun (k, n) =>
      if n == 0 then none else
      let raw : J := .obj [("type", .str "hatch"), ("at", .str x), ("kind", .str k)]
      some { fid := Hd raw, ty := "hatch", at? := some x, verb := k, res := TRUST, to := "", kind := k, claim := "",
             unit := "", atom := "", declared := false, observed := true, sound := true, relocated := false,
             n := some n, raw := .obj [("type", .str "hatch"), ("at", .str x), ("kind", .str k), ("n", .num n)],
             sources := [("manifest:" ++ mh.revision, "manifest")] }
  -- W_decl (A.4.4.4)
  let declFs : List WFact := head.claims.flatMap fun c => match c.op with
    | .effectsLower u atoms vias =>
      let x := Wh.bind1 u
      atoms.map (fun a => mkDeclared (.obj [("type", .str "declared"), ("claim", .str c.fp), ("atom", .str a.show)])
          "" x u a.show a.verb a.res "" c.fp) ++
      vias.flatMap (fun (a, v) =>
        [mkDeclared (.obj [("type", .str "declared"), ("claim", .str c.fp), ("atom", .str (a.show ++ " via " ++ v))])
           "call" x u a.show a.verb a.res ((Wh.bind1 v).getD "") c.fp,
         mkDeclared (.obj [("type", .str "declared"), ("claim", .str c.fp), ("atom", .str a.show), ("unit", .str v)])
           "" (Wh.bind1 v) v a.show a.verb a.res "" c.fp])
    | .edgeExists a k b => [mkDeclared (.obj [("type", .str "declared"), ("claim", .str c.fp)]) k none a "" "" "" b c.fp]
    | _ => []
  let facts := sortOn (·.fid) (declFs ++ obsFacts ++ hatchFs)
  let factById : HashMap String WFact := facts.foldl (fun m f => m.insert f.fid f) {}
  -- Calls° (A.3.3.10)
  let mut calls : HashMap String (List (String × WFact)) := {}
  for f in facts do
    let isCall := f.ty == "call" || (f.declared && f.kind == "call")
    match isCall, f.at? with
    | true, some x =>
      if f.to != "" && mh.has f.to then calls := calls.insert x (((calls.get? x).getD []) ++ [(f.to, f)])
    | _, _ => pure ()
  let callsS := calls.fold (fun m k v => m.insert k (sortOnL (fun p => [p.1, p.2.fid]) v)) calls
  let refsG : HashMap String (List String) := mh.order.foldl (fun m x =>
    m.insert x (((mh.info? x).map (·.refs)).getD [] |>.filter (mh.has ·))) {}
  -- lifted edges (A.4.4.2)
  let lift (fs : List WFact) : List LEdge × Nat × Nat := Id.run do
    let mut byKey : HashMap String LEdge := {}
    let mut keys : List String := []
    let mut ung := 0
    let mut dropped := 0
    let compAt (x : String) : Option String := Wh.compOfU (Wh.att1 x)
    for f in fs do
      let add (s k t : String) (bk : HashMap String LEdge) (ks : List String) : HashMap String LEdge × List String :=
        let key := s ++ "\u0000" ++ k ++ "\u0000" ++ t
        match bk.get? key with
        | some e => (bk.insert key { e with facts := e.facts ++ [f] }, ks)
        | none => (bk.insert key ⟨s, k, t, [f]⟩, ks ++ [key])
      if f.declared && f.kind != "" && f.kind != "call" && f.to != "" then
        let (b, k) := add f.unit f.kind f.to byKey keys
        byKey := b; keys := k
      else if (f.ty == "call" || (f.declared && f.kind == "call")) && f.at?.isSome && f.to != "" then
        match compAt f.atD, compAt f.to with
        | some a, some b =>
          if a != b then
            let (bk, k) := add a "calls" b byKey keys
            byKey := bk; keys := k
        | _, _ => ung := ung + 1
      else if f.ty == "edge" && f.at?.isSome then
        match head.kinds.find? (·.1 == f.kind) with
        | none => dropped := dropped + 1
        | some (_, _, toK) =>
          let a := compAt f.atD
          let b := if toK == "resource" then Wh.resOf f.to else if mh.has f.to then compAt f.to else none
          match a, b with
          | some a, some b =>
            let (bk, k) := add a f.kind b byKey keys
            byKey := bk; keys := k
          | _, _ => ung := ung + 1
    let es := sortOnL (fun e => [e.src, e.kind, e.dst]) (keys.filterMap (byKey.get? ·))
    return (es.map (fun e => { e with facts := sortOn (·.fid) e.facts }), ung, dropped)
  let (edges, ung, dropped) := lift facts
  let (declEdges, _, _) := lift declFs
  -- heirs (A.6.2.1, A.5.6.3-4)
  let ctx1 : Ctx :=
    { ctx0 with pcRec := pcRec, facts := facts, factById := factById, entries := entries,
                calls := callsS, refsG := refsG, edges := edges, declEdges := declEdges, unanchored := unanchored,
                externalCalls := externalCalls, ungovernedCalls := ung, droppedEdges := dropped }
  return ctx1

/-! ### Governance: actors and eligibility (A.6.3) -/

def Ctx.actor? (c : Ctx) (q : String) : Option Actor := c.gov.actors.find? (·.q == q)
def Ctx.isPerson (c : Ctx) (q : String) : Bool := ((c.actor? q).map (·.kind == "person")).getD false
def Ctx.isAgent (c : Ctx) (q : String) : Bool := ((c.actor? q).map (·.kind == "agent")).getD false

/-- The persons of an actor (a person, or a team's persons, recursively). -/
def Ctx.personsOf (c : Ctx) (q : String) : List String :=
  let rec go (fuel : Nat) (q : String) : List String :=
    match fuel with
    | 0 => []
    | fuel + 1 => match c.actor? q with
      | some a => if a.kind == "person" then [a.q] else if a.kind == "team" then a.members.flatMap (go fuel) else []
      | none => []
  sortStrs (go (c.gov.actors.length + 1) q)

/-- The agents among an actor's members (a team named in judges contributes them only with
    `agents`, A.15.6). -/
def Ctx.agentsOf (c : Ctx) (q : String) : List String :=
  let rec go (fuel : Nat) (q : String) : List String :=
    match fuel with
    | 0 => []
    | fuel + 1 => match c.actor? q with
      | some a => if a.kind == "agent" then [a.q] else if a.kind == "team" then a.members.flatMap (go fuel) else []
      | none => []
  sortStrs (go (c.gov.actors.length + 1) q)

structure EQ where
  tier : Tier
  /-- the item's owner (base owner, owner* per claim, base shape owner, …) -/
  owner : String
  /-- loosenings, exception answers, producer-changed answers: never an agent -/
  noAgent : Bool
  /-- an act on a final item (A.6.3.4, A.16.12) -/
  final : Bool

/-- Actors eligible by role under a judges list, ignoring authorship (A.6.3.3, A.16.12(a)). -/
def Ctx.roleUnder (c : Ctx) (judges : List String) (q : EQ) : List String :=
  if q.final then sortStrs (c.personsOf q.owner ++ c.personsOf c.gov.owner)
  else
    let withAgents := judges.contains "agents"
    let out := judges.flatMap fun j =>
      if j == "owner" then c.personsOf q.owner
      else if j == "agents" then (c.gov.actors.filter (·.kind == "agent")).map (·.q)
      else c.personsOf j ++ (if withAgents then c.agentsOf j else [])
    (sortStrs out).filter fun a => (c.actor? a).isSome && !(q.noAgent && c.isAgent a)

def Ctx.roleEligible (c : Ctx) (q : EQ) : List String := c.roleUnder (c.pol.tier q.tier).judges q

/-- Is j eligible for an act of this change (`actOfChange`) on an item? Returns `some self`. -/
def Ctx.eligible (c : Ctx) (q : EQ) (j : String) (actOfChange : Bool := true) : Option Bool :=
  if !(c.roleEligible q).contains j then none
  else if !actOfChange || !c.inp.authors.contains j then some false
  else
    let persons := (c.roleUnder (c.basePol.tier q.tier).judges q).filter (c.isPerson ·)
    -- the self fallback reads the base judges only, so it never applies over an unreadable base
    -- (A.6.2.6, A.16.16)
    -- and only when o involves no final item (A.6.3.3): never for an obligation at tier final
    if c.isPerson j && !q.final && q.tier != .final && !c.inp.unmappedBot && persons == [j] &&
        !(c.hasBase && !c.readable) then some true
    else none

def Ctx.eligibleNow (c : Ctx) (q : EQ) : List String :=
  (c.roleEligible q).filter (fun j => (c.eligible q j).isSome)

/-- Two distinct eligible persons, each of at least one required actor, together covering every
    required actor (A.6.3.4, A.16.12(a)). -/
def Ctx.twoPersons (c : Ctx) (cands : List String) (owners : List String) : Bool :=
  let ps := (uniq cands).filter fun p => c.isPerson p && owners.any (fun o => (c.personsOf o).contains p)
  ps.any fun p1 => ps.any fun p2 => p1 != p2 &&
    owners.all (fun o => (c.personsOf o).contains p1 || (c.personsOf o).contains p2)

end Shape
