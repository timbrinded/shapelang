import Kernel.Coverage
/-! Loosening (model §8, A.8 [D17]): L0; L1 over identities and kernel-computed cells with level,
authority+ and authority-tier parts (A.8.2.3, D2, D11); L3 by heirs, the G_A test, then the
normative depth-first search with a first pass over W_eval edges, and H_A (A.8.4, A.6.2.2);
L4; L6 tuples (A.16.29(a)); L7 fields (A.16.29(b)); counterexamples, realising facts and
exploitation (A.8.3, A.16.10); the rule-3 hint (A.8.1.6, A.16.11); the order class with one
reverse pass (A.8.1.3). Executable layer: L1's level/permit test is `l1_sound`/`l1_complete`
in `Eval`; G_A is `l3_ga_sound` in `Struct`. -/
namespace Shape

open Std

def lvlName (n : Nat) : String := if n == 0 then "none" else (Tier.ofRank n).name
def jq (s : String) : String := (J.str s).jcs
def jstrs (l : List String) : String := (J.arr ((sortStrs l).map .str)).jcs
def jstrsJ (l : List String) : J := .arr ((sortStrs l).map .str)

def l3Budget : Nat := 1000000

/-! ### Swapping base and head (the reverse pass) -/

def Rho.invert (r : Rho) (Sb Sh : Esf) : Rho :=
  let m : HashMap String String := r.map.fold (fun acc b h => acc.insert h b) {}
  let hints : HashMap String String := r.hints.fold (fun acc b h => acc.insert h b) {}
  let mapped := r.map.toList.map (·.2)
  let headItems := Sh.comps.map (·.q) ++ Sh.res.map (·.q) ++ Sh.units.map (·.q)
  let _ := Sb
  { map := m, hints := hints, unmapped := sortStrs (headItems.filter (fun q => !mapped.contains q)),
    renames := [], errors := [] }

/-- W_decl edges of a shape (relations and via pairs, A.4.4.4). -/
def declEdgesOf (S : Esf) (W : World) : List Edge :=
  sortOnL (fun e => [e.1, e.2.1, e.2.2]) (uniq (S.claims.flatMap fun cl => match cl.op with
    | .edgeExists a k b => [(a, k, b)]
    | .effectsLower u _ vias => vias.filterMap fun (_, v) =>
      match (W.unitsBy.get? u).map (·.comp), (W.unitsBy.get? v).map (·.comp) with
      | some a, some b => if a != b then some (a, "calls", b) else none
      | _, _ => none
    | _ => []))

/-- M_h ∪ M_b, head entries first (the union code of the reverse pass). -/
def Manifest.union (mh mb : Manifest) : Manifest :=
  let ids := mb.ids.fold (fun acc k v => if acc.contains k then acc else acc.insert k v) mh.ids
  let children := mb.children.fold (fun acc k v => acc.insert k (sortStrs (((acc.get? k).getD []) ++ v))) mh.children
  { mh with ids := ids, order := sortStrs (mh.order ++ mb.order), children := children }

/-- The context with base and head exchanged, for the reverse pass (A.8.1.3 [D17]): both shapes
    resolved over the union code M_h ∪ M_b, each leniently as a base is (A.6.4.3), the exchanged
    head (the base shape) against M_b and the exchanged base (the head shape) against M_h. -/
def Ctx.swapped (c : Ctx) : Ctx :=
  match c.base with
  | some b =>
    let mu := Manifest.union c.mh c.mb
    let rWb := (buildWorld c.head mu (some c.mh) true).1
    let rWh := (buildWorld b mu (some c.mb) true).1
    let c1 : Ctx :=
      { c with head := b, base := some c.head, Wh := rWh, Wb := some rWb, mh := mu,
               hClaims := c.bClaims, bClaims := c.hClaims, rho := c.rho.invert b c.head,
               heirs := {}, heirOf := {}, impliesC := {}, answeredFinal := [] }
    c1.withHeirs
  | none => c

/-! ### Subjects (A.8.2.2, A.16.29(c)) -/

def Ctx.baseS (c : Ctx) : Esf := c.base.getD c.gov

/-- The base channels T(c) of a checker-decided claim (A.4.5.1). -/
def Ctx.baseChannels (c : Ctx) (cl : Claim) : List String :=
  match c.Wb with
  | some wb => (c.footprint wb cl).2
  | none => []

def Ctx.subjTier (c : Ctx) (subject : String) : Tier :=
  let b := c.baseS
  if subject == "shape" then .critical
  else if strPrefix "policy " subject then
    let t := dropChars 7 subject
    if t == "low" then .low else if t == "normal" then .normal else .critical
  else if strPrefix "component " subject then ((b.comps.find? (·.q == dropChars 10 subject)).map (·.tier)).getD .normal
  else if strPrefix "resource " subject then ((b.res.find? (·.q == dropChars 9 subject)).map (·.tier)).getD .normal
  else if strPrefix "unit " subject then ((b.units.find? (·.q == dropChars 5 subject)).map (·.tier)).getD .normal
  else if strPrefix "provider " subject then
    match b.provs.find? (·.q == dropChars 9 subject) with
    | none => .low
    | some p =>
      b.claims.foldl (fun t cl =>
        if decidesClaim p.decides cl || (c.baseChannels cl).any (fun ch => channelCovered p.observes ch) then tierMax t cl.tier
        else t) .low
  else if strPrefix "actor " subject then
    let q := dropChars 6 subject
    let owned := (b.comps.filter (·.owner == q)).map (·.tier) ++ (b.res.filter (·.owner == q)).map (·.tier) ++
      (b.units.filter (·.owner == q)).map (·.tier) ++ (b.claims.filter (·.owner == q)).map (·.tier)
    let judged := ([Tier.low, .normal, .critical].filter (fun t => (b.policy.tier t).judges.contains q))
    (owned ++ judged).foldl tierMax .low
  else ((c.bClaims.get? subject).map (·.tier)).getD .normal

def Ctx.subjOwner (c : Ctx) (subject : String) : String :=
  let b := c.baseS
  if subject == "shape" || strPrefix "policy " subject || strPrefix "provider " subject || strPrefix "actor " subject then b.owner
  else if strPrefix "component " subject then ((b.comps.find? (·.q == dropChars 10 subject)).map (·.owner)).getD b.owner
  else if strPrefix "resource " subject then ((b.res.find? (·.q == dropChars 9 subject)).map (·.owner)).getD b.owner
  else if strPrefix "unit " subject then ((b.units.find? (·.q == dropChars 5 subject)).map (·.owner)).getD b.owner
  else ((c.bClaims.get? subject).map (·.owner)).getD b.owner

/-! ### L1 NoNewEffect (A.8.2.3) -/

structure LCol where
  key : String
  resB : Option String
  resH : Option String
  trust : Bool
  unmapped : Bool := false
  hintH : Option String := none
deriving Inhabited

structure L1Acc where
  subject : String
  affected : List String := []
  delta : List String := []
  /-- (position, head atom, column key) entries of the part -/
  pairs : List (String × Atom × String) := []
  /-- the (position, verb, resource) the head admits -/
  admitted : List (String × String × String) := []
  channels : List String := []
deriving Inhabited

def accAdd (m : HashMap String L1Acc) (subj x d : String) (aH : Atom) (colKey : String)
    (adm : Option (String × String × String)) (chans : List String) : HashMap String L1Acc :=
  let a := (m.get? subj).getD { subject := subj }
  let adm' := match adm with
    | some p => if a.admitted.contains p then a.admitted else a.admitted ++ [p]
    | none => a.admitted
  let a' : L1Acc :=
    { a with affected := if a.affected.contains x then a.affected else a.affected ++ [x],
             delta := if a.delta.contains d then a.delta else a.delta ++ [d],
             pairs := if a.pairs.contains (x, aH, colKey) then a.pairs else a.pairs ++ [(x, aH, colKey)],
             admitted := adm',
             channels := a.channels ++ chans.filter (fun ch => !a.channels.contains ch) }
  m.insert subj a'

def verbUniverse (Sb Sh : Esf) (trust : Bool) : List String :=
  let all := sortStrs (Sb.verbs ++ Sh.verbs ++ Sb.effects.map (·.2) ++ Sh.effects.map (·.2) ++
    Sb.hatches.map (·.1) ++ Sh.hatches.map (·.1) ++ ["Hatch", "Undeclared"])
  all.filter (fun v => (impl Sb v "Hatch" || impl Sh v "Hatch") == trust)

/-- A side of a position under a shape: permitted, in A, Lvl, excluding claims. -/
def sideEval (S : Esf) (us : List URef) (res : Option String) (v : String) : Bool × Bool × Nat × List Claim :=
  match res with
  | none => (true, true, 0, [])
  | some r =>
    let a : Atom := ⟨v, r⟩
    (us.all (permitted S · a), us.all (inA S · a), us.foldl (fun m u => max m (lvl S u a)) 0,
     uniq (us.flatMap (fun u => excluding S u a)))

def Ctx.l1Cols (c : Ctx) (Sb Sh : Esf) (Wb Wh : World) : List LCol :=
  let codes := sortStrs ((Sb.res.flatMap (·.bind) ++ Sh.res.flatMap (·.bind)).map canonRC)
  let notStd (q : String) := !strPrefix "std::" q
  let unb := sortStrs ((Sb.res.filter (fun r => r.bind.isEmpty && notStd r.q)).map (·.q) ++
    (Sh.res.filter (fun r => r.bind.isEmpty && notStd r.q)).map (fun r => c.rho.inv r.q))
  codes.map (fun t => ({ key := t, resB := Wb.resOf t, resH := Wh.resOf t, trust := false } : LCol)) ++
  unb.map (fun q =>
    let hq := c.rho.get q
    let resB := if Sb.res.any (·.q == q) then some q else none
    let resH := if Sh.res.any (·.q == hq) then some hq else none
    let hint := (c.rho.hints.get? q).filter (fun h => Sh.res.any (·.q == h))
    -- an unmapped resource without a rule-3 hint is read as removed (A.16.45(a)): the column is
    -- decided like any other; only a hinted one is undecided unless it fails under the hint
    ({ key := "res:" ++ q, resB := resB, resH := resH, trust := false,
       unmapped := resB.isSome && c.rho.unmapped.contains q && hint.isSome, hintH := hint } : LCol)) ++
  [{ key := "trust", resB := some TRUST, resH := some TRUST, trust := true }]

/-- L1 accumulation over all positions for the columns given (A.8.2.3). -/
def Ctx.l1Run (_c : Ctx) (Sb Sh : Esf) (positions : List (String × List URef × List URef)) (cols : List LCol)
    (vOrd vTrust : List String) : HashMap String L1Acc := Id.run do
  let mut acc : HashMap String L1Acc := {}
  -- group positions by (base attribution, head attribution)
  let mut groups : List (String × List URef × List URef × List String) := []
  for (x, bs, hs) in positions do
    let k := ",".intercalate (bs.map (·.name)) ++ "|" ++ ",".intercalate (hs.map (·.name))
    match groups.find? (·.1 == k) with
    | some _ => groups := groups.map (fun g => if g.1 == k then (g.1, g.2.1, g.2.2.1, g.2.2.2 ++ [x]) else g)
    | none => groups := groups ++ [(k, bs, hs, [x])]
  for (_, bs, hs, xs) in groups do
    for col in cols do
      let verbs := if col.trust then vTrust else vOrd
      for v in verbs do
        let (_, aB, _, exB) := sideEval Sb bs col.resB v
        let (pH, aH, lH, exH) := sideEval Sh hs col.resH v
        -- the head's authority level for the atom: excluded by authority at some tier; open
        -- authority or ungoverned (none); or granted (no authority-tier part, A.8.2.3 [D11])
        let headAuth : Option Nat :=
          if !aH then some ((exH.filter (·.isAuthority)).foldl (fun m f => max m f.tier.rank) 0)
          else if col.resH.isNone || hs.all (fun u => match compOf Sh u with
              | some k => (authClaims Sh k).isEmpty
              | none => true) then some 0
          else none
        let shown := match col.resB with
          | some r => v ++ "<" ++ r ++ ">"
          | none => v ++ "<" ++ col.key ++ ">"
        let atomH : Atom := ⟨v, col.resH.getD col.key⟩
        let chans : List String :=
          if col.trust then sortStrs (chanOfAtom Sh ⟨v, TRUST⟩ ++ chanOfAtom Sb ⟨v, TRUST⟩)
          else if strPrefix "res:" col.key then [] else ["effect(" ++ col.key ++ ")"]
        let add (m : HashMap String L1Acc) (subj d : String) : HashMap String L1Acc :=
          xs.foldl (fun m x => accAdd m subj x d atomH col.key (if pH then some (x, v, col.key) else none) chans) m
        -- level parts: base forbids and summaries excluding the atom above the head level
        for f in exB do
          if (f.isForbid || f.isSummary) && lH < f.tier.rank then
            acc := add acc f.fp ("L1 level " ++ shown ++ " " ++ f.tier.name ++ ">" ++ lvlName lH)
          if f.isAuthority && lH < f.tier.rank then
            match f.op, headAuth with
            | .authority k _, some th =>
              if th < f.tier.rank then
                acc := add acc ("component " ++ k) ("L1 authority " ++ f.tier.name ++ ">" ++ lvlName th)
            | _, _ => pure ()
        -- authority+: newly in both A and P at the position [D17]
        if pH && aH && !aB then
          match col.resB with
          | some r =>
            for u in bs do
              if !inA Sb u ⟨v, r⟩ then
                match compOf Sb u with
                | some k => acc := add acc ("component " ++ k) ("L1 authority+ " ++ shown)
                | none => pure ()
          | none => pure ()
  return acc

/-- Realising facts and the counterexample of an L1 part (A.16.10(b), A.16.26(b)). -/
def Ctx.l1Finish (c : Ctx) (_Sh : Esf) (_Wh : World) (a : L1Acc) (answer : String) (hint : Bool) : LPart :=
  let sites := c.sites c.facts
  -- a fact realises an entry (x, a, t) when it is at x and lifts to a, an effect fact only
  -- through the column's own resource code t
  let real : List (Site × String) := sites.flatMap fun s =>
    (a.pairs.filter (fun p => p.1 == s.x && p.2.1 == s.atom &&
      (s.fact.ty != "effect" || s.fact.res == p.2.2))).map (fun p => (s, p.2.2))
  let admittedReal := sortOn (·.1.fact.fid) (real.filter (fun r => a.admitted.contains (r.1.x, r.1.atom.verb, r.2)))
  -- A.16.26(b): resource is the column's canonical resource code, res:Q or trust
  let printFact (s : Site) (key : String) : J :=
    let verb := if s.fact.ty == "hatch" then s.fact.kind else s.fact.verb
    .obj [("at", .str s.x), ("verb", .str verb), ("resource", .str key)]
  let (ce, realised) : J × Bool := match admittedReal.head? with
    | some (s, key) => (printFact s key, true)
    | none =>
      match (sortOnL (fun p => [p.1, p.2.1, p.2.2]) a.admitted).head? with
      | some (x, v, r) => (.obj [("at", .str x), ("verb", .str v), ("resource", .str r)], false)
      | none => (.null, false)
  { question := "L1", subject := a.subject, answer := answer, affected := sortStrs a.affected,
    delta := sortStrs a.delta, counterexample := ce, exploited := realised,
    channels := sortStrs a.channels, realised := sortStrs (real.map (·.1.fact.fid)), hintUndecided := hint }

def Ctx.l1Parts (c : Ctx) (cells : List Cell) (rev : Bool) : List LPart := Id.run do
  let some Sb := c.base | return []
  let some Wb := c.Wb | return []
  let Sh := c.head
  let Wh := c.Wh
  let identPos := c.mh.order.map (fun x => (x, Wb.att x, Wh.att x))
  let cellPos := cells.map fun cl =>
    let (bside, hside) := if rev then (cl.h, cl.b) else (cl.b, cl.h)
    (cl.id, bside.map parseURef, hside.map parseURef)
  let positions := identPos ++ cellPos
  let cols := c.l1Cols Sb Sh Wb Wh
  let vOrd := verbUniverse Sb Sh false
  let vTrust := verbUniverse Sb Sh true
  let plainCols := cols.filter (!·.unmapped)
  let unm := cols.filter (·.unmapped)
  let main0 := c.l1Run Sb Sh positions plainCols vOrd vTrust
  let hinted := unm.filterMap fun col => col.hintH.map (fun h => { col with resH := some h, unmapped := false })
  let mainH := c.l1Run Sb Sh positions hinted vOrd vTrust
  let plainU := c.l1Run Sb Sh positions unm vOrd vTrust
  -- merge main and hinted accumulations
  let mut main := main0
  for (k, a) in mainH.toList do
    match main.get? k with
    | some b =>
      let b' : L1Acc :=
        { b with affected := b.affected ++ a.affected.filter (!b.affected.contains ·),
                 delta := b.delta ++ a.delta.filter (!b.delta.contains ·),
                 pairs := b.pairs ++ a.pairs, admitted := b.admitted ++ a.admitted,
                 channels := b.channels ++ a.channels }
      main := main.insert k b'
    | none => main := main.insert k a
  let mut out : List LPart := []
  for k in sortStrs (main.toList.map (·.1)) do
    let some a := main.get? k | continue
    out := out ++ [c.l1Finish Sh Wh a "loosened" false]
  for k in sortStrs (plainU.toList.map (·.1)) do
    if main.contains k then continue
    let some a := plainU.get? k | continue
    out := out ++ [c.l1Finish Sh Wh a "undecided" true]
  return out

/-! ### L3 NoWeakerClaim for structural claims (A.8.4) -/

def opKinds (op : Op) : List String :=
  match op with
  | .edgeForbid _ _ k _ _ => [k]
  | .pathForbid _ _ K _ => K
  | .cycleForbid K => K
  | _ => []

/-- New type-correct candidate edges of the given kinds over the head's nodes. -/
def typeCorrect (S : Esf) (nodes : List String) (ks : List String) : List Edge :=
  let comps := nodes.filter (fun n => S.comps.any (·.q == n))
  let ress := nodes.filter (fun n => S.res.any (·.q == n))
  (sortStrs ks).flatMap fun k => match S.kinds.find? (·.1 == k) with
    | none => []
    | some (_, fr, to) =>
      let fs := if fr == "resource" then ress else comps
      let ts := if to == "resource" then ress else comps
      -- only calls are restricted to distinct components (A.4.4.2): a raw edge of another kind
      -- between two identities of one component lifts to a self-loop
      fs.flatMap fun a => (ts.filter (fun b => k != "calls" || b != a)).map fun b => (a, k, b)

def edgeKT (e : Edge) : List String := [e.2.1, e.2.2, e.1]

/-- The normative depth-first search (A.8.4.2): one budget unit per edge tried; P = prefix edges
    outside W_decl(head); prune when W_decl(head) ∪ P violates a head claim. Returns the search
    leaf's whole prefix path (in path order, A.16.26(b)) and the units spent. -/
partial def dfsL3 (heads : List Op) (W : List Edge) (outE : String → List Edge) (isT : String → Bool)
    (avoid : String → Bool) (skipTo : String → Bool) (start : String) (v : String) (P : List Edge)
    (path : List Edge) (visited : List String) (units : Nat) : Option (List Edge) × Nat := Id.run do
  let mut u := units
  for e in outE v do
    u := u + 1
    if u > l3Budget then return (none, u)
    if skipTo e.2.2 then continue
    if visited.contains e.2.2 && !(isT e.2.2) then continue
    let P' := if W.contains e then P else P ++ [e]
    let path' := path ++ [e]
    if !heads.all (fun h => evalStruct h (W ++ P')) then continue
    if isT e.2.2 then return (some path', u)
    if avoid e.2.2 || visited.contains e.2.2 then continue
    let (r, u2) := dfsL3 heads W outE isT avoid skipTo start e.2.2 P' path' (e.2.2 :: visited) u
    u := u2
    if r.isSome || u > l3Budget then return (r, u)
  return (none, u)

/-- `found path`: the search leaf's prefix path (for edge forbids, the one violating edge). -/
inductive L3Res | implied | found (path : List Edge) | budget (units : Nat)
deriving Inhabited

def l3Search (heads : List Op) (W : List Edge) (G : List Edge) (base : Op) (nodes : List String) (units0 : Nat) :
    L3Res × Nat :=
  let K := opKinds base
  let gK := sortWith (fun a b => lexStrLt (edgeKT a) (edgeKT b)) (G.filter (fun e => K.contains e.2.1))
  let outE (n : String) : List Edge := gK.filter (·.1 == n)
  match base with
  | .pathForbid S T _ V =>
    let isS := nselMatch S
    let isT := nselMatch T
    let isV := nselMatch V
    let starts := nodes.filter (fun s => isS s && !isV s)
    let rec go (ss : List String) (u : Nat) : L3Res × Nat :=
      match ss with
      | [] => (.implied, u)
      | s :: rest =>
        let isTs (n : String) := isT n && n != s
        let (r, u2) := dfsL3 heads W outE isTs (fun n => isV n || isS n || isT n) (fun _ => false) s s [] [] [s] u
        match r with
        | some P => (.found P, u2)
        | none => if u2 > l3Budget then (.budget u2, u2) else go rest u2
    go starts units0
  | .cycleForbid _ =>
    let ns := sortStrs (gK.flatMap (fun e => [e.1, e.2.2]))
    let rec goC (ss : List String) (u : Nat) : L3Res × Nat :=
      match ss with
      | [] => (.implied, u)
      | n :: rest =>
        let (r, u2) := dfsL3 heads W outE (· == n) (fun _ => false) (fun m => strLt m n) n n [] [] [n] u
        match r with
        | some P => (.found P, u2)
        | none => if u2 > l3Budget then (.budget u2, u2) else goC rest u2
    goC ns units0
  | _ => (.implied, units0)

/-- Support edges of a structural claim in an edge set (A.4.4.11), for H_A (A.6.2.2). -/
def supportEdges (op : Op) (E : List Edge) (nodes : List String) : List Edge :=
  match op with
  | .edgeForbid S X k T Y =>
    E.filter (fun e => e.2.1 == k && nselMatch S e.1 && !nselMatch X e.1 && nselMatch T e.2.2 && !nselMatch Y e.2.2)
  | .pathForbid S T K V =>
    let kE := E.filter (fun e => K.contains e.2.1)
    let blocked (n : String) := nselMatch V n || nselMatch S n || nselMatch T n
    let pairs := kE.map (fun e => (e.1, e.2.2))
    let starts := nodes.filter (fun s => nselMatch S s && !nselMatch V s)
    -- forward: reachable from some start through non-blocked interiors
    let fwd := sortStrs (starts ++ reachSet pairs (fun n => !blocked n) (starts.flatMap fun s => (kE.filter (·.1 == s)).map (·.2.2)))
    let fwdI := fwd.filter (fun n => starts.contains n || !blocked n)
    -- backward: nodes from which a target is reachable through non-blocked interiors
    let targets := nodes.filter (nselMatch T)
    let rpairs := kE.map (fun e => (e.2.2, e.1))
    let bwd := sortStrs (targets ++ reachSet rpairs (fun n => !blocked n) (targets.flatMap fun t => (kE.filter (·.2.2 == t)).map (·.1)))
    kE.filter (fun e => fwdI.contains e.1 && (targets.contains e.2.2 || (bwd.contains e.2.2 && !blocked e.2.2)))
  | .cycleForbid K =>
    let kE := E.filter (fun e => K.contains e.2.1)
    let reach (n : String) := reachSet (kE.map (fun e => (e.1, e.2.2))) (fun _ => true) ((kE.filter (·.1 == n)).map (·.2.2))
    kE.filter (fun e => (reach e.2.2).contains e.1)
  | _ => []

/-- The L3 decision over explicit edge sets (A.8.4.2): G_A ⊨ base implies (`l3_ga_sound`); edge
    forbids are exact on G_A, the least violating edge by (from, kind, to) with W_eval(head) edges
    first; path and cycle forbids run the first pass over W_eval(head) edges, then the search over
    G_A, sharing one budget of 10^6 units. Also the executable core that `l3fuzz` checks. -/
def l3Decide (heads : List Op) (base : Op) (declE evalE ga : List Edge) (nodes : List String) : L3Res × Nat :=
  if evalStruct base ga then (.implied, 0) else
  match base with
  | .edgeForbid S X k T Y =>
    let viol := (sortOnL (fun e => [e.1, e.2.1, e.2.2]) ga).filter fun e =>
      e.2.1 == k && nselMatch S e.1 && !nselMatch X e.1 && nselMatch T e.2.2 && !nselMatch Y e.2.2
    let violE := viol.filter (evalE.contains ·)
    match (violE ++ viol).head? with
    | some e => (.found [e], 0)
    | none => (.implied, 0)
  | _ =>
    let (r1, u1) := l3Search heads declE (uniq (declE ++ evalE)) base nodes 0
    match r1 with
    | .implied => l3Search heads declE ga base nodes u1
    | r => (r, u1)

structure L3Out where
  part : Option LPart := none
  /-- the part's shell under this reading (delta, affected, channels; no counterexample) -/
  shell : LPart := default
  /-- H_A: head structural claims (fps), when implied with no heir -/
  ha : List String := []
  units : Nat := 0
deriving Inhabited

/-- The shell of an L3 part under a reading (A.16.45(c)): delta, affected and channels. -/
def Ctx.l3Shell (c : Ctx) (cb : Claim) (keys : List (String × String)) : LPart :=
  let Sh := c.head
  let ren := renameClaim keys cb
  let heads := Sh.claims.filter (·.isStructUpper)
  let nodes := c.Wh.nodes
  let K := opKinds ren.op
  let sharing := heads.filter (fun h => (opKinds h.op).any (K.contains ·))
  let srcNodes : List String := match ren.op with
    | .cycleForbid _ => nodes
    | .pathForbid S _ _ _ => nodes.filter (nselMatch S)
    | .edgeForbid S X _ _ _ => nodes.filter (fun n => nselMatch S n && !nselMatch X n)
    | _ => []
  let chans := sortStrs (match ren.op with
    | .edgeForbid _ _ k T Y => prodChan Sh k ((nodes.filter (nselMatch T)).filter (fun n => !nselMatch Y n))
    | .pathForbid _ T Ks _ => Ks.flatMap (prodChan Sh · (nodes.filter (nselMatch T)))
    | .cycleForbid Ks => Ks.flatMap (prodChan Sh · nodes)
    | _ => [])
  { question := "L3", subject := cb.fp, answer := "undecided",
    affected := sortStrs (srcNodes.flatMap (c.Wh.compCode · c.mh)),
    delta := sortStrs (sharing.map (fun h => "L3 head " ++ h.fp)), channels := chans }

def Ctx.l3One (c : Ctx) (cb : Claim) (keys : List (String × String)) (declE evalE : List Edge) : L3Out :=
  let Sh := c.head
  let ren := renameClaim keys cb
  let heads := Sh.claims.filter (·.isStructUpper)
  let headOps := heads.map (·.op)
  let nodes := c.Wh.nodes
  let K := opKinds ren.op
  let shell := c.l3Shell cb keys
  let delta := shell.delta
  let cands := (typeCorrect Sh nodes K).filter (fun e => !declE.contains e)
  let ga := declE ++ cands.filter (fun e => headOps.all (fun h => evalStruct h (e :: declE)))
  let affected := shell.affected
  let chans := shell.channels
  let haOf : List String :=
    let all := declE ++ cands
    let sup := (supportEdges ren.op all nodes).filter (fun e => !declE.contains e)
    sortStrs ((heads.filter (fun h => sup.any (fun e => !evalStruct h.op (e :: declE)))).map (·.fp))
  let evalKeys := evalE
  let mk (P : List Edge) (answer : String) (units : Nat) : LPart :=
    -- realised: the leaf's path is a path of W_eval(head) (A.8.3.1), declared edges included
    let realisedP := answer == "loosened" && !P.isEmpty && P.all (fun e => evalKeys.contains e || declE.contains e)
    let facts := if realisedP then
        sortStrs (P.flatMap fun e => ((c.edges.find? (fun l => l.e == e)).map (fun l => l.facts.map (·.fid))).getD [])
      else []
    { question := "L3", subject := cb.fp, answer := answer, affected := affected,
      delta := if answer == "undecided" then delta ++ ["L3 budget " ++ toString units] else delta,
      counterexample := if answer == "loosened" then .arr (P.map fun e => .obj [("from", .str e.1), ("kind", .str e.2.1), ("to", .str e.2.2)]) else .null,
      exploited := realisedP, channels := chans, realised := facts }
  match l3Decide headOps ren.op declE evalE ga nodes with
  | (.implied, u) => { ha := haOf, units := u, shell := shell }
  | (.found P, u) => { part := some (mk P "loosened" u), units := u, shell := shell }
  | (.budget u, _) => { part := some (mk [] "undecided" u), units := u, shell := shell }

/-! ### L4 laws (A.8.2.3, A.15.13) -/

def lawOn (cl : Claim) : List String := match cl.op with | .law on _ => sortStrs on | _ => []

def Ctx.l4One (c : Ctx) (cb : Claim) (keys : List (String × String)) : LPart :=
  let ren := renameClaim keys cb
  let laws := c.head.claims.filter (·.isLaw)
  let byId := laws.filter (fun h => h.ids.any (cb.ids.contains ·))
  let related := if byId.isEmpty then laws.filter (fun h => lawOn h == lawOn ren && h.form == cb.form) else byId
  let removed := related.isEmpty
  let isJ := match cb.req with
    | some r => r.level == .none || (r.level.rank == 0 && r.judged)
    | none => isInformal cb
  let proj := ((cb.req.map (·.proj)).getD "unit")
  let req := c.reqOf ren isJ (if isJ then proj else if proj == "trust" then "trust" else "unit")
  { question := "L4", subject := cb.fp, answer := if removed then "loosened" else "undecided",
    affected := sortStrs (req.map (·.1)),
    delta := if removed then ["L4 removed"] else sortStrs (related.map (fun h => "L4 head " ++ h.fp)) }

/-! ### L6 NoShrunkJurisdiction (A.8.2.3, A.16.29(a)) -/

structure Tup where
  ty : String
  val : List (String × J)
  claim : Claim
deriving Inhabited

def Tup.json (t : Tup) : J := .obj ((("type", .str t.ty)) :: t.val)

def reqGe (h b : Option Req) : Bool :=
  match b with
  | none => true
  | some rb => match h with
    | none => false
    | some rh => decide (rh.level.rank ≥ rb.level.rank) && (!rh.judged || rb.judged) &&
        rb.pins.all (rh.pins.contains ·) && (rh.proj == "unit" || rh.proj == rb.proj)

def stmtJ (cl : Claim) : J :=
  match J.parse cl.argsJ with
  | .ok a => a.getD "statement"
  | .error _ => .null

def Ctx.tuplesAt (c : Ctx) (claims : List Claim) (node : Option String) (unitQ : Option String) (x : String) : List Tup :=
  let ns (sels : List NSel) := c.Wh.nodes.filter (nselMatch sels)
  claims.flatMap fun cl => match cl.op, node with
    | .pathForbid S T K V, some k =>
      let (Sn, Tn, Vn) := (ns S, ns T, ns V)
      let Ks := sortStrs K
      (if Sn.contains k && !Vn.contains k then [⟨"path-source", [("T", jstrsJ Tn), ("K", jstrsJ Ks), ("V", jstrsJ Vn)], cl⟩] else []) ++
      (if Tn.contains k then [⟨"path-target", [("S", jstrsJ Sn), ("K", jstrsJ Ks), ("V", jstrsJ Vn)], cl⟩] else []) ++
      (if Vn.contains k then [⟨"via", [("S", jstrsJ Sn), ("T", jstrsJ Tn), ("K", jstrsJ Ks)], cl⟩] else [])
    | .edgeForbid S X kk T Y, some k =>
      let Sx := (ns S).filter (fun n => !(ns X).contains n)
      let Ty := (ns T).filter (fun n => !(ns Y).contains n)
      (if Sx.contains k then [⟨"edge-source", [("k", .str kk), ("T", jstrsJ Ty)], cl⟩] else []) ++
      (if Ty.contains k then [⟨"edge-target", [("S", jstrsJ Sx), ("k", .str kk)], cl⟩] else [])
    | .cycleForbid K, some _ => [⟨"cycle-member", [("K", jstrsJ K)], cl⟩]
    | .law on _, _ =>
      let hit := (match unitQ with | some u => on.contains ("unit " ++ u) | none => false) ||
        (match node with | some k => on.contains ("component " ++ k) | none => false) || on.contains ("code " ++ x)
      if hit then [⟨"law-member", [("statement", stmtJ cl)], cl⟩] else []
    | _, _ => []

def tupStrs (t : Tup) (k : String) : List String :=
  match t.val.find? (·.1 == k) with
  | some (_, .arr xs) => xs.filterMap J.str?
  | _ => []

def tupDominates (h b : Tup) : Bool :=
  h.ty == b.ty && decide (h.claim.tier.rank ≥ b.claim.tier.rank) && reqGe h.claim.req b.claim.req &&
  (let sup (k : String) := supsetS (tupStrs h k) (tupStrs b k)
   let sub (k : String) := supsetS (tupStrs b k) (tupStrs h k)
   let k1 := (h.val.find? (·.1 == "k")).map (·.2.jcs) == (b.val.find? (·.1 == "k")).map (·.2.jcs)
   match h.ty with
   | "path-source" => sup "T" && sup "K" && sub "V"
   | "path-target" => sup "S" && sup "K" && sub "V"
   | "edge-source" => k1 && sup "T"
   | "edge-target" => k1 && sup "S"
   | "cycle-member" => sup "K"
   | _ => h.json.jcs == b.json.jcs)

structure L6Acc where
  subject : String
  affected : List String := []
  delta : List String := []
  channels : List String := []
  ce : List WFact := []
deriving Inhabited

def Ctx.l6Run (c : Ctx) (keys : List (String × String)) (cells : List Cell) (rev : Bool) : HashMap String L6Acc := Id.run do
  let some Sb := c.base | return {}
  let some Wb := c.Wb | return {}
  let Wh := c.Wh
  let isL6 (cl : Claim) := cl.isStructUpper || cl.isLaw
  let baseC := (Sb.claims.filter isL6).map (renameClaim keys)
  let baseOrig := Sb.claims.filter isL6
  let headC := c.head.claims.filter isL6
  let ren (q : String) : String := renameStr keys q
  let renU (u : URef) : URef := match u with
    | .unit q => .unit (ren q) | .pseudo k => .pseudo (ren k) | .ungov => .ungov
  let posOf (S : Esf) (u : URef) : Option String × Option String :=
    (compOf S u, match u with | .unit q => some q | _ => none)
  let mut acc : HashMap String L6Acc := {}
  let identPos := c.mh.order.map (fun x => (x, Wb.att x, Wh.att x))
  let cellPos := cells.map fun cl =>
    let (bside, hside) := if rev then (cl.h, cl.b) else (cl.b, cl.h)
    (cl.id, bside.map parseURef, hside.map parseURef)
  let sites := c.facts.filter (fun f => f.ty == "call" || f.ty == "edge")
  for (x, bs, hs) in identPos ++ cellPos do
    let hU := hs.headD .ungov
    let changed := bs.any (fun u => renU u != hU || (compOf Sb u).map ren != compOf c.head hU)
    if !changed then continue
    let (hk, hu) := posOf c.head hU
    let th := c.tuplesAt headC hk hu x
    for bu in bs do
      let (bk0, bu0) := posOf Sb bu
      let tb := c.tuplesAt baseC (bk0.map ren) (bu0.map ren) x
      for b in tb do
        if b.ty == "via" then continue
        if th.any (fun h => tupDominates h b) then continue
        let orig := (baseOrig.find? (fun o => (renameClaim keys o).fp == b.claim.fp)).getD b.claim
        let subj := orig.fp
        let d := "L6 drop " ++ x ++ " " ++ b.json.jcs
        let a := (acc.get? subj).getD { subject := subj }
        let chans := (c.footprint Wh b.claim).2
        let ks := opKinds b.claim.op
        let ceF := sites.filter fun f => f.at? == some x &&
          ((f.ty == "call" && ks.contains "calls") || (f.ty == "edge" && ks.contains f.kind))
        let a' : L6Acc :=
          { a with affected := if a.affected.contains x then a.affected else a.affected ++ [x],
                   delta := if a.delta.contains d then a.delta else a.delta ++ [d],
                   channels := a.channels ++ chans.filter (!a.channels.contains ·), ce := a.ce ++ ceF }
        acc := acc.insert subj a'
    -- new head via tuples
    let tbAll := bs.flatMap (fun bu => let (bk0, bu0) := posOf Sb bu; c.tuplesAt baseC (bk0.map ren) (bu0.map ren) x)
    for h in th do
      if h.ty != "via" then continue
      if tbAll.any (fun b => b.ty == "via" && b.json.jcs == h.json.jcs) then continue
      let some subj := ((c.heirOf.get? h.claim.fp).getD []).head? | continue
      let d := "L6 via " ++ x ++ " " ++ (J.obj h.val).jcs
      let a := (acc.get? subj).getD { subject := subj }
      let a' : L6Acc :=
        { a with affected := if a.affected.contains x then a.affected else a.affected ++ [x],
                 delta := if a.delta.contains d then a.delta else a.delta ++ [d] }
      acc := acc.insert subj a'
  return acc

def Ctx.l6Finish (_c : Ctx) (a : L6Acc) (answer : String) (hint : Bool) : LPart :=
  let ce := sortOn (·.fid) a.ce
  let printF (f : WFact) : J := match f.raw with
    | .obj kvs => .obj (kvs.filter (·.1 != "n"))
    | o => o
  { question := "L6", subject := a.subject, answer := answer, affected := sortStrs a.affected,
    delta := sortStrs a.delta, counterexample := (ce.head?.map printF).getD .null,
    exploited := !ce.isEmpty && answer == "loosened", channels := sortStrs a.channels,
    realised := sortStrs (ce.map (·.fid)), hintUndecided := hint }

def Ctx.l6Parts (c : Ctx) (cells : List Cell) (rev : Bool) : List LPart :=
  let plainK := rhoKeys c.rho.map
  let plain := c.l6Run plainK cells rev
  if c.rho.hints.isEmpty then
    (sortStrs (plain.toList.map (·.1))).filterMap fun k => (plain.get? k).map (c.l6Finish · "loosened" false)
  else
    let hm : HashMap String String := c.rho.hints.fold (fun m b h => if m.contains b then m else m.insert b h) c.rho.map
    let hinted := c.l6Run (rhoKeys hm) cells rev
    let ks := sortStrs (plain.toList.map (·.1) ++ hinted.toList.map (·.1))
    ks.filterMap fun k => match hinted.get? k with
      | some a => some (c.l6Finish a "loosened" false)
      | none => (plain.get? k).map (fun a => { c.l6Finish a "undecided" true with counterexample := .null, exploited := false })

/-! ### L7 NoWeakerGovernance (A.8.2.3, A.12.8.7, A.16.29(b)) -/

def reqJStr (r : Option Req) : String :=
  match r with
  | some r => (J.obj [("level", .str r.level.name), ("judged", .bool r.judged), ("pins", jstrsJ r.pins),
      ("projection", .str r.proj)]).jcs
  | none => "null"

def provFieldJ (p : Prov) (f : String) : J :=
  match f with
  | "produces" => jstrsJ p.producesS
  | "observes" => jstrsJ p.observes
  | "decides" => jstrsJ p.decides
  | "presence" => .bool p.presence
  | "absence" => .bool p.absence
  | "persist" => .bool p.persist
  | "depsComplete" => .bool p.depsComplete
  | "identity" => match p.identity with | some s => .str s | none => .null
  | "trusts" => .arr ((sortOnL (fun t => [t.1, t.2]) p.trusts).map (fun t => .arr [.str t.1, .str t.2]))
  | "implementation" => .obj [("paths", jstrsJ p.implPaths), ("ids", jstrsJ p.implIds),
      ("digest", match p.implDigest with | some d => .str d | none => .null)]
  | _ => .null

def Ctx.l7Parts (c : Ctx) (haMap : HashMap String (List String)) : List LPart := Id.run do
  let some Sb := c.base | return []
  let Sh := c.head
  let mut acc : List (String × String × String) := []   -- (subject, answer, delta)
  let add (acc : List (String × String × String)) (s ans field b h : String) := acc ++ [(s, ans, "L7 " ++ field ++ " " ++ b ++ " " ++ h)]
  let notStd (q : String) := !strPrefix "std::" q
  let ren (q : String) := c.rho.get q
  let hasDecl := Sb.q != "" && Sb.owner != ""
  -- an inherited field is reported once, where it is written, not at each inheriting item
  -- [D18]: the base and head fields are inherited from the same (ρ-matched) item
  let together (bFrom hFrom : Option String) : Bool :=
    match bFrom, hFrom with
    | some bf, some hf =>
      if bf == "shape" || bf == "default" then bf == hf
      else match splitOn " " bf with
        | kind :: rest@(_ :: _) => hf == kind ++ " " ++ ren (" ".intercalate rest)
        | _ => false
    | _, _ => false
  -- claims with heirs
  for cb in Sb.claims do
    let heirs := sortOn (·.fp) (((c.heirs.get? cb.fp).getD []).filterMap (c.hClaims.get? ·))
    if heirs.isEmpty then
      -- H_A members of lower tier: one line, the least such member by fp
      let ha := sortOn (·.fp) (((haMap.get? cb.fp).getD []).filterMap (c.hClaims.get? ·))
      match (ha.filter (fun h => h.tier.rank < cb.tier.rank)).head? with
      | some h => acc := add acc cb.fp "loosened" "tier" (jq cb.tier.name) (jq h.tier.name)
      | none => pure ()
      continue
    let ok := heirs.any (fun h => decide (h.tier.rank ≥ cb.tier.rank) && reqGe h.req cb.req)
    if !ok then
      let best := heirs.headD cb
      let tierFell := !heirs.any (fun h => decide (h.tier.rank ≥ cb.tier.rank))
      if tierFell then
        if !heirs.all (fun h => together cb.tierFrom h.tierFrom) then
          acc := add acc cb.fp "loosened" "tier" (jq cb.tier.name) (jq best.tier.name)
      else acc := add acc cb.fp "loosened" "requirement" (reqJStr cb.req) (reqJStr best.req)
    if hasDecl then
      for h in heirs do
        if h.owner != cb.owner && !together cb.ownerFrom h.ownerFrom then
          acc := add acc cb.fp "undecided" "owner" (jq cb.owner) (jq h.owner)
  -- policy entries and the shape
  if hasDecl then
    for (t, nm) in [(Tier.low, "low"), (.normal, "normal"), (.critical, "critical")] do
      let b := Sb.policy.tier t
      let h := Sh.policy.tier t
      let s := "policy " ++ nm
      if !b.blocks.all (h.blocks.contains ·) then acc := add acc s "loosened" "blocks" (jstrs b.blocks) (jstrs h.blocks)
      if h.maxAge > b.maxAge then acc := add acc s "loosened" "max_age" (toString b.maxAge) (toString h.maxAge)
      if h.floor.rank < b.floor.rank then acc := add acc s "loosened" "floor" (jq b.floor.name) (jq h.floor.name)
      if !h.judges.all (b.judges.contains ·) then acc := add acc s "loosened" "judges" (jstrs b.judges) (jstrs h.judges)
    match Sb.policy.budget with
    | some bb =>
      match Sh.policy.budget with
      | some hb => if hb > bb then acc := add acc "shape" "loosened" "budget" (toString bb) (toString hb)
      | none => acc := add acc "shape" "loosened" "budget" (toString bb) "null"
    | none => pure ()
    if Sb.owner != Sh.owner then acc := add acc "shape" "undecided" "owner" (jq Sb.owner) (jq Sh.owner)
    match Sb.manifestId, Sh.manifestId with
    | some m, none => acc := add acc "shape" "loosened" "manifest" (jq m) "null"
    | some m, some m' => if m != m' then acc := add acc "shape" "undecided" "manifest" (jq m) (jq m')
    | none, some m' => acc := add acc "shape" "undecided" "manifest" "null" (jq m')
    | none, none => pure ()
  -- vocabulary items
  for kb in Sb.comps.filter (fun k => notStd k.q) do
    let some kh := Sh.comps.find? (·.q == ren kb.q) | continue
    let s := "component " ++ kb.q
    if kh.tier.rank < kb.tier.rank then acc := add acc s "loosened" "tier" (jq kb.tier.name) (jq kh.tier.name)
    if !kh.allows.all (kb.allows.contains ·) then acc := add acc s "loosened" "allows" (jstrs kb.allows) (jstrs kh.allows)
    if !kh.assumes.all (kb.assumes.contains ·) then acc := add acc s "loosened" "assumes" (jstrs kb.assumes) (jstrs kh.assumes)
    if hasDecl && kh.owner != kb.owner && !(kb.ownerFrom == some "shape" && kh.ownerFrom == some "shape") then
      acc := add acc s "undecided" "owner" (jq kb.owner) (jq kh.owner)
  for rb in Sb.res.filter (fun r => notStd r.q) do
    let some rh := Sh.res.find? (·.q == ren rb.q) | continue
    let s := "resource " ++ rb.q
    if rh.tier.rank < rb.tier.rank then acc := add acc s "loosened" "tier" (jq rb.tier.name) (jq rh.tier.name)
    if hasDecl && rh.owner != rb.owner && !(rb.ownerFrom == some "shape" && rh.ownerFrom == some "shape") then
      acc := add acc s "undecided" "owner" (jq rb.owner) (jq rh.owner)
  for ub in Sb.units do
    let some uh := Sh.units.find? (·.q == ren ub.q) | continue
    let s := "unit " ++ ub.q
    if uh.tier.rank < ub.tier.rank && !together ub.tierFrom uh.tierFrom then
      acc := add acc s "loosened" "tier" (jq ub.tier.name) (jq uh.tier.name)
    if hasDecl && uh.owner != ub.owner && !together ub.ownerFrom uh.ownerFrom then
      acc := add acc s "undecided" "owner" (jq ub.owner) (jq uh.owner)
  -- providers
  for pb in Sb.provs do
    let s := "provider " ++ pb.q
    match Sh.provs.find? (·.q == pb.q) with
    | none => acc := add acc s "loosened" "removed" (jq pb.q) "null"
    | some ph =>
      if !ph.trusts.all (pb.trusts.contains ·) then
        acc := add acc s "loosened" "trusts" (provFieldJ pb "trusts").jcs (provFieldJ ph "trusts").jcs
      for f in ["produces", "observes", "decides", "presence", "absence", "persist", "depsComplete", "identity", "implementation"] do
        let bv := (provFieldJ pb f).jcs
        let hv := (provFieldJ ph f).jcs
        if bv != hv then acc := add acc s "undecided" f bv hv
  -- actors
  for ab in Sb.actors.filter (fun a => notStd a.q) do
    let some ah := Sh.actors.find? (·.q == ren ab.q) | continue
    let s := "actor " ++ ab.q
    if !ah.identities.all (ab.identities.contains ·) then acc := add acc s "undecided" "identity" (jstrs ab.identities) (jstrs ah.identities)
    if !ah.members.all (ab.members.contains ·) then acc := add acc s "undecided" "member" (jstrs ab.members) (jstrs ah.members)
    if ah.operator != ab.operator then
      acc := add acc s "undecided" "operator" ((ab.operator.map jq).getD "null") ((ah.operator.map jq).getD "null")
  let subjects := uniq (acc.map (·.1))
  return subjects.map fun s =>
    let mine := acc.filter (·.1 == s)
    { question := "L7", subject := s, answer := if mine.any (·.2.1 == "loosened") then "loosened" else "undecided",
      affected := [], delta := sortStrs (mine.map (·.2.2)) }

/-! ### All questions -/

structure LResult where
  parts : List LPart := []
  cells : List Cell := []
  /-- H_A: base fp → head fps -/
  ha : HashMap String (List String) := {}
  /-- head fp → base fps it is an H_A member for -/
  haOf : HashMap String (List String) := {}
  cellsUndecided : Bool := false
  l3Units : Nat := 0
  forward : String := "implied"
  order : Option String := none
  errors : List KErr := []
deriving Inhabited

def passClass (ps : List LPart) : String :=
  if ps.any (·.answer == "loosened") then "loosened"
  else if ps.any (·.answer == "undecided") then "undecided" else "implied"

/-- The questions of one pass (forward or reverse). -/
def Ctx.loosenPass (c : Ctx) (cells : List Cell) (rev : Bool) : List LPart × HashMap String (List String) × Nat := Id.run do
  let some Sb := c.base | return ([], {}, 0)
  let mut parts : List LPart := c.l1Parts cells rev
  let mut ha : HashMap String (List String) := {}
  let mut units := 0
  let declE := if rev then declEdgesOf c.head c.Wh else c.declEdges.map (·.e)
  let evalE := if rev then declE else uniq (c.edges.map (·.e))
  let keysPlain := rhoKeys c.rho.map
  let hm : HashMap String String := c.rho.hints.fold (fun m b h => if m.contains b then m else m.insert b h) c.rho.map
  let keysHint := rhoKeys hm
  for cb in Sb.claims do
    if !((c.heirs.get? cb.fp).getD []).isEmpty then continue
    let um := c.unmappedIn cb
    if cb.isStructUpper then
      if um.isEmpty then
        let o := c.l3One cb keysPlain declE evalE
        units := units + o.units
        match o.part with
        | some p => parts := parts ++ [p]
        | none => if !o.ha.isEmpty then ha := ha.insert cb.fp o.ha
      else if !um.all (c.rho.hints.contains ·) then
        -- A.16.45(a): a node the rule-3 reading leaves unmapped fails under that reading too, so
        -- the part is loosened (read as removed); no search leaf, so no counterexample
        let o := c.l3Shell cb keysHint
        parts := parts ++ [{ o with answer := "loosened" }]
      else
        -- A.8.1.6, A.16.11(b), A.16.45(c): undecided unless it also fails under the rule-3 hint;
        -- the undecided part is read under the hint except for its counterexample (null)
        let renH := renameClaim keysHint cb
        let hintHeir := c.head.claims.any fun ch =>
          ch.opName == cb.opName &&
          (((ch.fp == renH.fp || ch.fp == cb.fp) && c.closureEq ch) || c.opGeq ch renH ||
           (((c.impliesC.get? ch.fp).getD []).any (fun f => f == cb.fp || f == renH.fp)))
        if hintHeir then
          parts := parts ++ [{ c.l3Shell cb keysHint with hintUndecided := true }]
        else
          let o := c.l3One cb keysHint declE evalE
          units := units + o.units
          match o.part with
          | some p =>
            if p.answer == "loosened" then parts := parts ++ [p]
            else parts := parts ++ [{ o.shell with hintUndecided := true }]
          | none => parts := parts ++ [{ o.shell with hintUndecided := true }]
    else if cb.isLaw then
      if um.isEmpty then parts := parts ++ [c.l4One cb keysPlain]
      else
        let ren := renameClaim keysHint cb
        let hintHeir := c.head.claims.any (fun h => h.isLaw && (h.fp == ren.fp || c.opGeq h ren))
        if hintHeir then parts := parts ++ [{ c.l4One cb keysPlain with answer := "undecided", hintUndecided := true }]
        else parts := parts ++ [c.l4One cb keysHint]
  parts := parts ++ c.l6Parts cells rev
  parts := parts ++ c.l7Parts ha
  return (parts, ha, units)

/-- Exploitation by the coverage clause (A.8.3.1, A.16.10(a)). -/
def Ctx.exploitedByCoverage (c : Ctx) (p : LPart) : Bool :=
  if p.question == "L0" || p.question == "L7" then false else
  let t := c.subjTier p.subject
  let blocks := t == .final || (c.pol.tier t).blocks.contains "coverage"
  if !blocks then false else
  let changed := p.affected.filter (c.delta.ids.contains ·)
  let obs := p.channels.filter c.observable
  if obs.isEmpty then !changed.isEmpty
  else changed.any fun x => match c.mh.info? x with
    | some info => obs.any fun ch => match channelAt ch info with
      | some ch' => !c.needMet x info ch'
      | none => false
    | none => false

def Ctx.loosening (c : Ctx) : LResult := Id.run do
  if !c.hasBase || c.mode == .audit then return {}
  if !c.readable then
    let p : LPart := { question := "L0", subject := "shape", answer := "undecided", affected := [], delta := ["L0 unreadable"] }
    return { parts := [p], forward := "undecided", order := some "undecided" }
  let some Sb := c.base | return {}
  let some Wb := c.Wb | return {}
  let globOwners (S : Esf) (side : Bool) : List GlobOwner :=
    (S.comps.filter (fun k => !strPrefix "std::" k.q)).flatMap fun k =>
      k.paths.map fun g => { side := side, glob := g, owner := k.q ++ ".*", excepts := k.exceptPaths }
  let cr := computeCells (globOwners Sb true ++ globOwners c.head false)
  let _ := Wb
  let (fwd, ha, units) := c.loosenPass cr.cells false
  let fwd := fwd.map fun p =>
    let e := p.question != "L0" && p.question != "L7" && (p.exploited || c.exploitedByCoverage p)
    { p with exploited := e }
  let haOf : HashMap String (List String) := ha.fold (fun m b hs => hs.foldl (fun m h => m.insert h (sortStrs (((m.get? h).getD []) ++ [b]))) m) {}
  -- the reverse pass with base and head exchanged (A.8.1.3, A.16.11(a))
  let cs := c.swapped
  let (rev, _, _) := cs.loosenPass cr.cells true
  let fc := passClass fwd
  let rl := rev.any (fun p => p.answer == "loosened" && !p.hintUndecided)
  let cls := if fc == "undecided" then "undecided"
    else if fc == "loosened" then (if rl then "incomparable" else "looser")
    else if rl then "tighter" else "equivalent"
  -- head cell ties: E-overlap (A.3.3.6)
  let errs : List KErr := (cr.cells.filter (fun cl => cl.h.length > 1)).map fun cl =>
    { code := "E-overlap", subject := " ".intercalate (cl.h.map (fun p => "component " ++ dropRight 2 p)) }
  let res : LResult :=
    { parts := fwd, cells := cr.cells, ha := ha, haOf := haOf, cellsUndecided := cr.undecided,
      l3Units := units, forward := fc, order := some cls, errors := uniq' errs }
  return res
where
  uniq' (es : List KErr) : List KErr := es.foldl (fun acc e => if acc.any (fun x => x.code == e.code && x.subject == e.subject) then acc else acc ++ [e]) []

end Shape
