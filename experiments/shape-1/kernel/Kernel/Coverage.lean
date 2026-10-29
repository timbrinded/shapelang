import Kernel.Laws
/-! Coverage (A.7.4 [D3]): the coverage set, Need(x) with observability read from the base
alone (A.4.5.6), meeting by complete absence-sound entries (base ∧ head) or hatch-completeness,
one obligation per component, and vocabulary coverage. Executable layer. -/
namespace Shape

open Std

structure Need where
  claim : Claim
  channel : String
  met : Bool
  final : Bool
  tier : Tier
deriving Inhabited

structure CovOb where
  subject : String
  comp : Option String
  uncovered : List String
  unmet : List (String × String × String × Tier)
  tier : Tier
  owner : String
  unmetClaims : List String
  finalClaims : List String
  depCode : List String
deriving Inhabited

structure VocabOb where
  subject : String
  sites : List String
  tier : Tier
  facts : List WFact
deriving Inhabited

structure CovResult where
  set : List String := []
  needs : List (String × List Need) := []
  unobservable : List String := []
  obligations : List CovOb := []
  vocab : List VocabOb := []
  covered : Nat := 0
deriving Inhabited

/-- Observable channel (A.4.5.6): a hatch channel, or a channel some provider whose base
    declaration is absence-sound declares in the base. -/
def Ctx.observable (c : Ctx) (ch : String) : Bool :=
  strPrefix "hatch(" ch ||
  c.provs.any (fun g => match g.base with
    | some b => b.absence && channelCovered b.observes ch
    | none => false)

/-- tier*(c, x) (A.6.2.4). -/
def Ctx.tierAt (c : Ctx) (cl : Claim) (x : String) : Tier :=
  match c.Wb with
  | none => cl.tier
  | some wb =>
    (((c.heirOf.get? cl.fp).getD []).filterMap (c.bClaims.get? ·)).foldl (fun t cb =>
      if (c.footprint wb cb).1.contains x then tierMax t cb.tier else t) cl.tier

/-- tier*(K) = max(tier_b(ρ⁻¹K), tier_h(K)); ungoverned normal. -/
def Ctx.compTierStar (c : Ctx) (k : String) : Tier :=
  let th := ((c.head.comps.find? (·.q == k)).map (·.tier)).getD .normal
  let bq := c.rho.inv k
  match c.base with
  | some b => match b.comps.find? (·.q == bq) with
    | some kb => tierMax th kb.tier
    | none => th
  | none => th

/-- A need met by a usable complete entry from a provider declaring the channel, absence-sound in
    base and head, not producer-changed (A.7.4.3, A.15.9). -/
def Ctx.needMet (c : Ctx) (x : String) (info : IdInfo) (ch : String) : Bool :=
  if strPrefix "hatch(" ch then info.hatchComplete
  else c.provs.any fun g =>
    g.absenceB && channelCovered g.channelsB ch &&
    (match c.nearestEntry x g.q with
     | some ue => ue.entry.complete && !ue.pc
     | none => false)

def Ctx.coverage (c : Ctx) : CovResult := Id.run do
  if !c.hasBase || !c.readable then return {}
  let claims := c.head.claims.filter (·.isUpper)
  let fps : List (Claim × List String × List String) := claims.map (fun cl => let f := c.footprint c.Wh cl; (cl, f.1, f.2))
  -- the coverage set (A.7.4.1)
  let mut set0 : List String := c.mh.order.filter (c.delta.finest.contains ·)
  let mut depCause : List (String × List String) := []
  for r in c.records do
    for en in r.entries do
      let ch := (en.deps.filter (fun d => c.delta.inDelta d.id)).map (·.id)
      if !ch.isEmpty && c.mh.has en.id then
        set0 := set0 ++ [en.id]
        depCause := depCause ++ [(en.id, ch)]
  match c.base, c.Wb with
  | some b, some wb =>
    let keys := rhoKeys c.rho.map
    for (cl, fh, _) in fps do
      match b.claims.find? (fun cb => cb.fp == cl.fp || (renameClaim keys cb).fp == cl.fp) with
      | some cb =>
        let fb := (c.footprint wb cb).1
        set0 := set0 ++ fh.filter (fun x => !fb.contains x)
      | none => pure ()
  | _, _ => pure ()
  let set := sortStrs set0
  let mut needs : List (String × List Need) := []
  let mut unobs : List String := []
  let mut covered := 0
  let mut uncovered : List (String × List Need) := []
  for x in set do
    let some info := c.mh.info? x | continue
    let mut list : List Need := []
    for (cl, fh, chans) in fps do
      if !fh.contains x then continue
      for t in chans do
        match channelAt t info with
        | none => pure ()
        | some ch =>
          let tx := c.tierAt cl x
          let fin := tx == .final
          if !c.observable ch && !fin then
            unobs := unobs ++ [cl.fp ++ " " ++ ch]
            continue
          let nd : Need := { claim := cl, channel := ch, met := c.needMet x info ch, final := fin, tier := tx }
          list := list ++ [nd]
    needs := needs ++ [(x, list)]
    if list.all (·.met) then covered := covered + 1
    else uncovered := uncovered ++ [(x, list.filter (!·.met))]
  -- one obligation per component (A.7.4.4)
  let compOf (x : String) : String := (c.Wh.compOfU (c.Wh.att1 x)).getD "ungoverned"
  let comps := sortStrs (uncovered.map (fun p => compOf p.1))
  let mut obs : List CovOb := []
  for k in comps do
    let items := uncovered.filter (fun p => compOf p.1 == k)
    let isU := k == "ungoverned"
    let unmet := items.flatMap (fun (x, ns) => ns.map (fun n => (x, n.claim.fp, n.channel, n.tier)))
    let t0 := if isU then Tier.normal else c.compTierStar k
    let t := unmet.foldl (fun t u => tierMax t u.2.2.2) t0
    let owner := if isU then c.gov.owner else
      match c.base.bind (fun b => b.comps.find? (·.q == c.rho.inv k)) with
      | some kb => kb.owner
      | none => ((c.head.comps.find? (·.q == k)).map (·.owner)).getD c.gov.owner
    let ob : CovOb :=
      { subject := if isU then "ungoverned" else "component " ++ k, comp := if isU then none else some k,
        uncovered := sortStrs (items.map (·.1)),
        unmet := sortOnL (fun u => [u.1, u.2.1, u.2.2.1]) unmet, tier := t, owner := owner,
        unmetClaims := sortStrs (unmet.map (·.2.1)),
        finalClaims := sortStrs ((unmet.filter (·.2.2.2 == .final)).map (·.2.1)),
        depCode := sortStrs (items.flatMap (fun (x, _) => ((depCause.filter (·.1 == x)).flatMap (·.2)))) }
    obs := obs ++ [ob]
  -- vocabulary coverage (A.7.4.6)
  let reported := c.baseReported
  let lowerFps := c.baseLowerFps
  let mut vocab : List VocabOb := []
  for f in c.facts do
    if f.ty != "effect" || !f.observed then continue
    let some x := f.at? | continue
    let some info := c.mh.info? x | continue
    if !c.factNew reported lowerFps f then continue
    let lifted := c.Wh.resOf f.res
    let subj? : Option String :=
      if lifted.isNone && c.Wh.boundKinds.contains (rcTagKind f.res) then some ("resourceCode " ++ f.res)
      else if lifted.isSome && !c.head.verbs.contains f.verb then some ("verb " ++ f.verb)
      else none
    let some subj := subj? | continue
    let mut tier? : Option Tier := none
    for (cl, fh, chans) in fps do
      if !fh.contains x then continue
      let applies := chans.any fun t => match channelAt t info with
        | some ch =>
          strPrefix "effect(" ch && (if strPrefix "verb " subj then channelCovered [ch] ("effect(" ++ f.res ++ ")")
            else rcTagKind ((chanInner "effect(" ch).getD "") == rcTagKind f.res)
        | none => false
      if applies then tier? := some (match tier? with | some t => tierMax t (c.tierAt cl x) | none => c.tierAt cl x)
    let some t := tier? | continue
    match vocab.find? (·.subject == subj) with
    | some v =>
      vocab := vocab.map (fun w => if w.subject == subj then { w with sites := sortStrs (w.sites ++ [x]), tier := tierMax w.tier t, facts := w.facts ++ [f] } else w)
      let _ := v
    | none => vocab := vocab ++ [{ subject := subj, sites := [x], tier := t, facts := [f] }]
  let res : CovResult :=
    { set := set, needs := needs, unobservable := sortStrs unobs, obligations := obs,
      vocab := sortOn (·.subject) vocab, covered := covered }
  return res

end Shape
