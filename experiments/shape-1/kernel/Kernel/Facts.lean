import Kernel.Obligation
/-! Checker-decided claims (model §4.2, A.4.4): novelty of facts (A.7.3.1 [D5, D6, D15]),
authority / effect-forbid / summary contradictions through P(u) (A.4.4.7 [D2]), structure
contradictions with canonical witnesses and supports (A.4.4.8–11, A.16.5), refutation of lower
bounds (A.4.4.14, A.16.8 [D7]), and coherence errors (A.4.4.12, A.16.25). Executable layer. -/
namespace Shape

open Std

/-! ### Base-revision reports (A.7.3.1, A.16.6(c)) -/

/-- Usable base-revision observation facts: fid → (n, n present everywhere). -/
def Ctx.baseReported (c : Ctx) : HashMap String (Option Nat) := Id.run do
  let mut out : HashMap String (Option Nat) := {}
  if !c.hasBase then return out
  for r in c.baseRecords do
    if r.kind != .observation then continue
    let some g := (r.provider.bind c.prov?) | continue
    if g.base.isNone then continue
    let atBase := r.revision == c.inp.baseRev
    let usable := r.entries.filter fun en =>
      c.digestEq c.mb en.id en.proj en.digest &&
      (atBase || (g.depsCompleteB && en.deps.all (fun d => c.digestEq c.mb d.id d.proj d.digest)))
    let uids := usable.map (·.id)
    for f in r.facts do
      if f.ty == "hatch" || !c.mb.has f.loc then continue
      if !(c.mb.ancestors f.loc).any (uids.contains ·) then continue
      let fid := factIdOf (canonFactJ f)
      let n := match out.get? fid with
        | some (some a) => (f.n.map (max a))
        | some none => none
        | none => f.n
      out := out.insert fid n
  return out

def withAt (raw : J) (x : String) : J :=
  match raw with
  | .obj kvs => .obj (kvs.map fun (k, v) => if k == "at" then (k, .str x) else (k, v))
  | o => o

/-- Base lower-bound fps (with their renamings), for declared facts (A.7.3.1). -/
def Ctx.baseLowerFps (c : Ctx) : List String :=
  match c.base with
  | some b =>
    let keys := rhoKeys c.rho.map
    (b.claims.filter (·.isLower)).flatMap (fun cb => [cb.fp, (renameClaim keys cb).fp])
  | none => []

/-- New facts (A.7.3.1). -/
def Ctx.factNew (c : Ctx) (reported : HashMap String (Option Nat)) (lowerFps : List String) (f : WFact) : Bool :=
  if !c.hasBase then false
  else if f.declared then !lowerFps.contains f.claim
  else if f.ty == "hatch" then
    let x := f.atD
    let src := c.delta.relocFrom.get? x
    let nb := ((c.mb.markers x).find? (·.1 == f.kind)).map (·.2) |>.getD 0
    let nbr := match src with
      | some y => ((c.mb.markers y).find? (·.1 == f.kind)).map (·.2) |>.getD 0
      | none => 0
    let hn := f.n.getD 0
    c.delta.finest.contains x || !(nb ≥ hn || nbr ≥ hn)
  else
    let x := f.atD
    -- x ∈ Δcode, or the deps of an entry at one of its anchors changed (A.7.3.1): the anchor is
    -- the reporting provider's own, not the first ancestor with any provider's entry
    let anchorDepsChanged := f.anchors.any fun a => ((c.entries.get? a).getD []).any fun ue =>
      ue.entry.deps.any (fun d => c.delta.inDelta d.id)
    if !(c.delta.ids.contains x || anchorDepsChanged) then false
    else
      let reportedOk (fid : String) : Bool := match reported.get? fid, f.n with
        | some (some nb), some nh => nb ≥ nh
        | _, _ => false
      let viaReloc := match c.delta.relocFrom.get? x with
        | some y => reportedOk (factIdOf (withAt f.raw y))
        | none => false
      !(reportedOk f.fid || viaReloc)

/-! ### Representatives and costs (A.4.4.9–10) -/

/-- (heuristic, observed): declared (0,0) < sound (0,1) < heuristic (1,1). -/
def factCost (f : WFact) : Nat × Nat :=
  if f.declared then (0, 0) else if f.sound then (0, 1) else (1, 1)

def factLt (a b : WFact) : Bool :=
  let (ha, oa) := factCost a
  let (hb, ob) := factCost b
  ha < hb || (ha == hb && (oa < ob || (oa == ob && strLt a.fid b.fid)))

def bestFact (fs : List WFact) : Option WFact := minWith? factLt fs

def dedupFacts (fs : List WFact) : List WFact :=
  fs.foldl (fun acc f => if acc.any (·.fid == f.fid) then acc else acc ++ [f]) []

/-! ### Lifting sites -/

structure Site where
  x : String
  pos : URef
  atom : Atom
  fact : WFact
deriving Inhabited

/-- The atom a hatch fact lifts to: its kind if the shape declares it for the identity's
    language, else `Undeclared` (A.3.4.5, A.16.9). -/
def hatchAtom (S : Esf) (m : Manifest) (x kind : String) : Atom :=
  let lang := ((m.info? x).map (·.lang)).getD (idLang x)
  if S.hatches.any (fun h => h.1 == kind && h.2 == lang) then ⟨kind, TRUST⟩ else ⟨"Undeclared", TRUST⟩

def Ctx.sites (c : Ctx) (fs : List WFact) : List Site :=
  fs.filterMap fun f =>
    if f.ty == "effect" then
      match f.at?, c.Wh.resOf f.res with
      | some x, some r => some ⟨x, c.Wh.att1 x, ⟨f.verb, r⟩, f⟩
      | _, _ => none
    else if f.ty == "hatch" then
      match f.at? with
      | some x => some ⟨x, c.Wh.att1 x, hatchAtom c.head c.mh x f.kind, f⟩
      | none => none
    else if f.declared && f.atom != "" && f.unit != "" && f.kind != "call" && f.to == "" then
      some ⟨f.atD, .unit f.unit, ⟨f.verb, f.res⟩, f⟩
    else none

/-! ### Lvl_b for tier* (A.6.2.3, A.16.13) -/

def Ctx.baseTierRank (c : Ctx) (cb : Claim) : Nat :=
  if c.answeredFinal.contains cb.fp then
    (((c.heirs.get? cb.fp).getD []).filterMap (c.hClaims.get? ·)).foldl (fun m h => max m h.tier.rank) 0
  else cb.tier.rank

/-- Lvl_b(att_b(x))(b), the base shape over M_h (strictest view over tied attributions). The
    witness fact lifts under the base shape (A.6.2.3: Lvl_b by A.4.4.7 under the base shape over
    M_h): an effect fact through the base bindings, a hatch fact through the base's hatch clauses,
    a declared summary atom through ρ⁻¹ of its head resource Q (when the base has that resource).
    `b` is the head atom, used only in audit mode. -/
def Ctx.lvlBase (c : Ctx) (x : String) (b : Atom) (w : WFact) : Nat :=
  if strPrefix "unit:" x then 0 else
  match c.base, c.Wb with
  | some Sb, some Wb =>
    let atomB : Option Atom :=
      if w.ty == "effect" then (Wb.resOf w.res).map (fun r => ⟨w.verb, r⟩)
      else if w.ty == "hatch" then some (hatchAtom Sb c.mh x w.kind)
      else if w.declared && w.res != "" then
        let rb := c.rho.inv w.res
        if rb == TRUST || Sb.res.any (·.q == rb) then some ⟨w.verb, rb⟩ else none
      else none
    match atomB with
    | some ab => (Wb.att x).foldl (fun m u => max m (lvlT Sb c.baseTierRank u ab)) 0
    | none => 0
  | _, _ => if c.mode == .audit then lvlT c.head (fun cl => cl.tier.rank) (c.Wh.att1 x) b else 0

def typeOrd (cl : Claim) : Nat := if cl.isForbid then 0 else if cl.isSummary then 1 else 2

/-! ### Authority, effect forbids, summaries -/

structure CheckOut where
  obs : List Ob := []
  errors : List KErr := []
deriving Inhabited

def factCauseL (f : WFact) : List (String × String) := [("fact", f.fid)]

def Ctx.evalEffects (c : Ctx) (newF : WFact → Bool) : CheckOut := Id.run do
  let sites := (c.sites c.facts).filter (fun s => !permitted c.head s.pos s.atom)
  let keys := sortOnL (fun k => [k.1, k.2]) (uniq (sites.map (fun s => (s.x, s.atom.show))))
  let mut obs : List Ob := []
  let mut errs : List KErr := []
  for (x, a) in keys do
    let ss := sites.filter (fun s => s.x == x && s.atom.show == a)
    let some s0 := ss.head? | continue
    let fs := ss.map (·.fact)
    let some w := bestFact fs | continue
    let L := c.lvlBase x s0.atom w
    let tierO (cl : Claim) : Nat := max cl.tier.rank L
    let excl := sortWith (fun p q => tierO p > tierO q || (tierO p == tierO q &&
        (typeOrd p < typeOrd q || (typeOrd p == typeOrd q && strLt p.fp q.fp)))) (excluding c.head s0.pos s0.atom)
    let some cl := excl.head? | continue
    let subj : J := .obj [("code", .str x), ("atom", .str a)]
    let bindCause : List (String × String) :=
      if w.ty == "effect" then [("binding", "resource " ++ s0.atom.res)] else []
    if fs.any (·.declared) then
      errs := errs ++ [{ code := "E-conduct", subject := keyPreimage "contradiction" (some cl.fp) subj,
                         causes := (fs.filter (·.declared) |>.take 1 |>.map (fun f => ("fact", f.fid))) ++
                           (if strPrefix "unit:" x then [] else [("code", x)]),
                         dischargers := editShapeDis }]
      continue
    let supportCode := sortStrs (fs.filterMap (·.at?))
    let ob : Ob :=
      { kind := "contradiction", key := obKey "contradiction" (some cl.fp) subj, claim := some cl, subject := subj,
        force := some (if w.sound then "sound" else "heuristic"), tier := Tier.ofRank (tierO cl),
        owner := c.ownerStar cl, introduced := c.hasBase && fs.any newF,
        affected := supportCode, code := c.finestRows supportCode,
        support := fs.map (·.fid), witness := [w.fid], facts := [(w.fid, w.raw)],
        causes := factCauseL w ++ bindCause ++ [("code", x)] ++ (excl.drop 1).map (fun o => ("claim", o.fp)) ++ [("claim", cl.fp)],
        excluding := excl }
    obs := obs ++ [ob]
  return { obs := obs, errors := errs }

/-! ### Structure (A.4.4.8–11) -/

def edgeBest (e : LEdge) : WFact := (bestFact e.facts).getD default

/-- Path cost (A.4.4.10): (heuristic facts, observed facts, length, representative ids). -/
def pathCostLt (a b : List LEdge) : Bool :=
  let cost (p : List LEdge) : Nat × Nat := p.foldl (fun (h, o) e => let (x, y) := factCost (edgeBest e); (h + x, o + y)) (0, 0)
  let (ha, oa) := cost a
  let (hb, ob) := cost b
  if ha != hb then ha < hb else if oa != ob then oa < ob
  else if a.length != b.length then a.length < b.length
  else lexStrLt (a.map (fun e => (edgeBest e).fid)) (b.map (fun e => (edgeBest e).fid))

/-- Least-cost simple paths from `start` (Dijkstra, ties by representative ids). -/
partial def shortestPaths (start : String) (edges : List LEdge) (allowInterior : String → Bool) : List (String × List LEdge) := Id.run do
  let mut best : List (String × List LEdge) := []
  let mut settled : List String := []
  let mut queue : List (String × List LEdge) := [(start, [])]
  let mut fuel := 100000
  while !queue.isEmpty && fuel > 0 do
    fuel := fuel - 1
    let sorted := sortWith (fun p q => pathCostLt p.2 q.2 || (!pathCostLt q.2 p.2 && strLt p.1 q.1)) queue
    let cur := sorted.head!
    queue := sorted.tail
    if settled.contains cur.1 && !cur.2.isEmpty then continue
    if !cur.2.isEmpty then
      settled := settled ++ [cur.1]
      best := best ++ [cur]
      if !allowInterior cur.1 then continue
    for e in edges.filter (·.src == cur.1) do
      if settled.contains e.dst then continue
      if cur.2.any (·.src == e.dst) then continue
      queue := queue ++ [(e.dst, cur.2 ++ [e])]
  return best

def reachFromE (edges : List LEdge) (n : String) : List String :=
  reachSet (edges.map (fun e => (e.src, e.dst))) (fun _ => true) ((edges.filter (·.src == n)).map (·.dst))

/-- Non-trivial SCCs of a graph (a self-loop counts, DRT T14), sorted by least node. -/
def sccs (edges : List LEdge) : List (List String) :=
  let nodes := sortStrs (edges.flatMap (fun e => [e.src, e.dst]))
  let reach := nodes.map (fun n => (n, reachFromE edges n))
  let r (n : String) : List String := ((reach.find? (·.1 == n)).map (·.2)).getD []
  let comps := nodes.filterMap fun n =>
    if (r n).contains n then some (sortStrs (n :: nodes.filter (fun m => (r n).contains m && (r m).contains n))) else none
  sortOn (fun l => l.headD "") (uniq comps)

structure StructV where
  subject : J
  witness : List LEdge
  support : List WFact
deriving Inhabited

def Ctx.structViolations (c : Ctx) (cl : Claim) (edges : List LEdge) : List StructV :=
  let ns := c.headNodes
  match cl.op with
  | .edgeForbid S X k T Y =>
    let Ss := (ns S).filter (fun n => !(ns X).contains n)
    let Ts := (ns T).filter (fun n => !(ns Y).contains n)
    (edges.filter (fun e => e.kind == k && Ss.contains e.src && Ts.contains e.dst)).map fun e =>
      ⟨.obj [("from", .str e.src), ("to", .str e.dst)], [e], e.facts⟩
  | .pathForbid S T K V =>
    let Sn := ns S
    let Tn := ns T
    let Vn := ns V
    let kE := edges.filter (fun e => K.contains e.kind)
    (Sn.filter (fun s => !Vn.contains s)).flatMap fun s =>
      let blocked (n : String) := Vn.contains n || Sn.contains n || Tn.contains n
      let sp := shortestPaths s kE (fun n => !blocked n)
      (Tn.filter (· != s)).filterMap fun t =>
        match sp.find? (·.1 == t) with
        | none => none
        | some (_, p) =>
          let fwd := s :: (sp.map (·.1)).filter (fun n => !blocked n)
          let rec back (fuel : Nat) (acc : List String) : List String :=
            match fuel with
            | 0 => acc
            | fuel + 1 =>
              let add := (kE.filter (fun e => acc.contains e.dst && !acc.contains e.src && !Vn.contains e.src &&
                !Tn.contains e.src && (e.src == s || !Sn.contains e.src))).map (·.src)
              if add.isEmpty then acc else back fuel (sortStrs (acc ++ add))
          let bk := back (kE.length + 1) [t]
          let sup := (kE.filter (fun e => fwd.contains e.src && bk.contains e.dst)).flatMap (·.facts)
          some ⟨.obj [("from", .str s), ("to", .str t)], p, sup⟩
  | .cycleForbid K =>
    let kE := edges.filter (fun e => K.contains e.kind)
    (sccs kE).filterMap fun comp =>
      let inner := kE.filter (fun e => comp.contains e.src && comp.contains e.dst)
      let n := comp.headD ""
      let sp := shortestPaths n inner (fun _ => true)
      let cands := (inner.filter (·.dst == n)).filterMap fun e =>
        if e.src == n then some [e] else (sp.find? (·.1 == e.src)).map (fun p => p.2 ++ [e])
      match minWith? pathCostLt cands with
      | some w => some ⟨.obj [("nodes", .arr (comp.map .str))], w, inner.flatMap (·.facts)⟩
      | none => none
  | _ => []

def Ctx.evalStructure (c : Ctx) (newF : WFact → Bool) (tierOf : Claim → Tier) : CheckOut := Id.run do
  let mut obs : List Ob := []
  let mut errs : List KErr := []
  for cl in c.head.claims.filter (·.isStructUpper) do
    for v in c.structViolations cl c.edges do
      let wf := v.witness.map edgeBest
      if wf.all (·.declared) then
        errs := errs ++ [{ code := "E-structure", subject := keyPreimage "contradiction" (some cl.fp) v.subject,
                           causes := wf.map (fun f => ("fact", f.fid)), dischargers := editShapeDis }]
        continue
      let sound := wf.all (fun f => f.declared || f.sound)
      let sup := dedupFacts v.support
      let supFids := sortStrs (sup.map (·.fid))
      -- the supporting lifted edges; an edge is new iff all its facts are new (A.16.5 [D5])
      let supEdges := c.edges.filter (fun e => e.facts.any (fun f => supFids.contains f.fid))
      let intro := c.hasBase && supEdges.any (fun e => e.facts.all newF)
      let supportCode := sortStrs (sup.filterMap (·.at?))
      let ob : Ob :=
        { kind := "contradiction", key := obKey "contradiction" (some cl.fp) v.subject, claim := some cl,
          subject := v.subject, force := some (if sound then "sound" else "heuristic"), tier := tierOf cl,
          owner := c.ownerStar cl, introduced := intro, affected := supportCode, code := c.finestRows supportCode,
          support := supFids, witness := wf.map (·.fid), facts := wf.map (fun f => (f.fid, f.raw)),
          causes := wf.map (fun f => ("fact", f.fid)) ++ [("claim", cl.fp)], excluding := [cl] }
      obs := obs ++ [ob]
  return { obs := obs, errors := errs }

/-! ### Footprints and channels (A.4.5) -/

def boundCodes (S : Esf) : List String := sortStrs (S.res.flatMap (·.bind))

/-- chan(v<R>) (A.4.5.2). -/
def chanOfAtom (S : Esf) (a : Atom) : List String :=
  if a.isTrust then
    (sortStrs ((S.hatches.filter (fun h => impl S h.1 a.verb && h.1 != "Undeclared")).map (·.2))).map (fun l => "hatch(" ++ l ++ ")")
  else ((S.res.filter (·.q == a.res)).flatMap (·.bind)).map (fun t => "effect(" ++ t ++ ")")

/-- prod(k, T) (A.4.5.2). -/
def prodChan (S : Esf) (k : String) (T : List String) : List String :=
  if k == "calls" then ["call(*)"] else
  match S.kinds.find? (·.1 == k) with
  | none => []
  | some (_, _, toK) =>
    if toK == "component" then ["edge(" ++ k ++ ")"]
    else T.flatMap fun t => ((S.res.find? (·.q == t)).map (·.bind)).getD [] |>.map (fun b => "edge(" ++ k ++ ", " ++ b ++ ")")

/-- The governed code of a world: identities attributed to some component. -/
def World.governed (w : World) (m : Manifest) : List String :=
  m.order.filter fun x => (w.att x).any (fun u => u != .ungov)

/-- F(c) and T(c) for a checker-decided claim under a world (A.4.5.1–2). -/
def Ctx.footprint (c : Ctx) (w : World) (cl : Claim) : List String × List String :=
  let S := w.S
  let ns := nodeSel w
  match cl.op with
  | .authority k _ => (w.compCode k c.mh, (boundCodes S).map (fun t => "effect(" ++ t ++ ")"))
  | .effectForbid a sc ex =>
    let posns := w.positions.filter (fun p => covers S sc ex (parseURef p))
    (sortStrs (posns.flatMap w.code), chanOfAtom S a)
  | .effectsUpper u _ | .effectsLower u _ _ => (sortStrs (w.code u), (boundCodes S).map (fun t => "effect(" ++ t ++ ")"))
  | .edgeExists a k b => (w.compCode a c.mh, prodChan S k [b])
  | .edgeForbid Ss X k T Y =>
    let src := (ns Ss).filter (fun n => !(ns X).contains n)
    let tgt := (ns T).filter (fun n => !(ns Y).contains n)
    (sortStrs (src.flatMap (w.compCode · c.mh)), prodChan S k tgt)
  | .pathForbid _ T K _ => (w.governed c.mh, sortStrs (K.flatMap (prodChan S · (ns T))))
  | .cycleForbid K => (w.governed c.mh, sortStrs (K.flatMap (prodChan S · w.nodes)))
  | _ => ([], [])

/-! ### Refutation of lower bounds (A.4.4.14, A.16.8 [D7]) -/

/-- The usable complete entry covering x from provider g: at x or the nearest ancestor of x that
    has a usable entry from g (A.15.9). -/
def Ctx.nearestEntry (c : Ctx) (x : String) (prov : String) : Option UEntry :=
  (c.mh.ancestors x).findSome? fun y => ((c.entries.get? y).getD []).find? (·.provider == prov)

def Ctx.evalLower (c : Ctx) (tierOf : Claim → Tier) : List Ob := Id.run do
  let mut obs : List Ob := []
  let observedSites := c.sites (c.facts.filter (·.observed))
  let reportedBase := c.baseRecords.filter (fun r => r.kind == .observation)
  for cl in c.head.claims.filter (·.isLower) do
    let (fp, chans) := c.footprint c.Wh cl
    if fp.isEmpty then continue
    -- every footprint identity has a qualifying usable complete entry on an applicable channel
    let mut ok := true
    let mut refuters : List String := []
    for x in fp do
      let some info := c.mh.info? x | ok := false; break
      let applicable := chans.filterMap (channelAt · info)
      if applicable.isEmpty then ok := false; break
      let hits := c.provs.filterMap fun g =>
        if !g.absenceA then none else
        if !applicable.any (fun t => channelCovered g.channelsA t) then none else
        match c.nearestEntry x g.q with
        | some ue => if ue.entry.complete then some ue.record else none
        | none => none
      if hits.isEmpty then ok := false; break
      refuters := refuters ++ hits
    if !ok then continue
    let refs := sortStrs refuters
    let fpChanged := fp.any (c.delta.ids.contains ·)
    let mk (subj : J) (baseSaw : Bool) : Ob :=
      { kind := "contradiction", key := obKey "contradiction" (some cl.fp) subj, claim := some cl, subject := subj,
        force := some "sound", tier := tierOf cl, owner := c.ownerStar cl,
        introduced := c.hasBase && (fpChanged || baseSaw), affected := fp, code := c.finestRows fp,
        causes := refs.map (fun r => ("record", r)) ++ [("claim", cl.fp)], excluding := [cl], refutation := true }
    match cl.op with
    | .effectsLower u atoms _ =>
      for a in atoms do
        let present := observedSites.any (fun s => fp.contains s.x && atomLe c.head s.atom a)
        if present then continue
        let baseSaw := reportedBase.any fun r => r.facts.any fun f =>
          f.ty == "effect" && fp.contains f.loc && (match c.Wh.resOf f.res with
            | some q => atomLe c.head ⟨f.verb, q⟩ a
            | none => false)
        obs := obs ++ [mk (.obj [("unit", .str u), ("atom", .str a.show)]) baseSaw]
    | .edgeExists a k b =>
      let present := c.edges.any (fun e => e.src == a && e.kind == k && e.dst == b && e.facts.any (·.observed))
      if present then continue
      let codeB := c.Wh.compCode b c.mh
      let baseSaw := reportedBase.any fun r => r.facts.any fun f =>
        fp.contains f.loc && ((k == "calls" && f.ty == "call" && codeB.contains f.to) ||
          (f.ty == "edge" && f.kind == k && (codeB.contains f.to || c.Wh.resOf f.to == some b)))
      obs := obs ++ [mk .null baseSaw]
    | _ => pure ()
  return obs

end Shape
