"""DRT: applies the switchable root-cause patches to a scratch copy of the Lean kernel.
Usage: python3 -I patch_kernel.py <kernel-copy-dir>. Each patch is active only when the case JSON
lists its name in "drtFix"; with "drtFix" absent the copy computes exactly what the kernel does."""
import sys, os
K = sys.argv[1]

def patch(rel, old, new, count=1):
    p = os.path.join(K, rel)
    s = open(p).read()
    assert s.count(old) == count, (rel, old[:70], s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)

# drop the proof modules (not needed by the executables; Env gains a field)
patch('Kernel.lean', """import Kernel.Proofs.Perm
import Kernel.Proofs.Final
import Kernel.Proofs.Raise
import Kernel.Proofs.Laws
import Kernel.Proofs.Loosen
""", "")
# Env: patch switches and the base revision
patch('Kernel/Model.lean', """  cells : List (String × String)
deriving Inhabited""", """  cells : List (String × String)
  fixes : List String := []
  baseRev : String := ""
deriving Inhabited

def Env.fx (e : Env) (n : String) : Bool := e.fixes.contains n""")
patch('Kernel/Parse.lean', """        | .arr [.str a, .str b] => some (a, b)
        | _ => none) }""", """        | .arr [.str a, .str b] => some (a, b)
        | _ => none),
      fixes := j.strs "drtFix",
      baseRev := match base with | .obj _ => (base.optStr "revision").getD "" | _ => "" }""")

# K8: observation entries are usable at head, or with deps complete in base and head (A.5.4.2);
#     base reports only from base-revision records (A.7.3.1)
patch('Kernel/Facts.lean', """def recFacts (e : Env) (r : Record) : List OFact :=
  if r.kind == .observation && provDeclared e r.provider then
    r.facts.filterMap fun f => match anchorEntry e.mh r f.loc with
      | some en => if entryUsableIn e.mh en then some ⟨canonFact f, presenceA e r.provider, r.provider.getD ""⟩ else none
      | none => none
  else []""", """def depsBoth (e : Env) : Option String → Bool
  | some q => match bothProv e q with
    | some (b, h) => b.depsComplete && h.depsComplete
    | none => false
  | none => false

def revOk (e : Env) (r : Record) : Bool := !e.fx "K8" || r.revision == e.headRev || depsBoth e r.provider

def recFacts (e : Env) (r : Record) : List OFact :=
  if r.kind == .observation && provDeclared e r.provider then
    r.facts.filterMap fun f => match anchorEntry e.mh r f.loc with
      | some en => if entryUsableIn e.mh en && revOk e r then some ⟨canonFact f, presenceA e r.provider, r.provider.getD ""⟩ else none
      | none => none
  else []""")
patch('Kernel/Facts.lean', """  brs.any fun r => r.kind == .observation && r.facts.any fun g =>""",
"""  brs.any fun r => r.kind == .observation && (!e.fx "K8" || r.revision == e.baseRev) && r.facts.any fun g =>""")
patch('Kernel/Coverage.lean', """      r.entries.any (fun en => en.id == x && en.complete && entryUsableIn e.mh en)""",
"""      r.entries.any (fun en => en.id == x && en.complete && entryUsableIn e.mh en) && revOk e r""")

# KW: authority / effect-forbid witness is one fact, the representative (A.4.4.8-9)
patch('Kernel/Facts.lean', """             witness := sortStrs (sup.map (fun x => factId x.f)),
             answerable := force == .heuristic, mechanical := force == .sound }""",
"""             witness := if e.fx "KW" then
                 (match sortBy (fun a b => (a.sound && !b.sound) || (a.sound == b.sound && strLt (factId a.f) (factId b.f))) sup with
                  | x :: _ => [factId x.f]
                  | [] => [])
               else sortStrs (sup.map (fun x => factId x.f)),
             answerable := force == .heuristic, mechanical := force == .sound }""")

# K11: edge-forbid support is the facts of the (s,k,t) edge only (A.4.4.11)
patch('Kernel/Facts.lean', """      let sup := ((obsEdges e rs).filter fun p => ns.contains p.1.1 && ns.contains p.1.2.2 &&
        (opKinds c.op).contains p.1.2.1).map (·.2)""",
"""      let exactEdge : Option (String × String) := match c.op, sv.1 with
        | .edgeForbid .., .fromTo a b => if e.fx "K11" then some (a, b) else none
        | _, _ => none
      let sup := ((obsEdges e rs).filter fun p => (match exactEdge with
          | some (a, b) => p.1.1 == a && p.1.2.2 == b
          | none => ns.contains p.1.1 && ns.contains p.1.2.2) &&
        (opKinds c.op).contains p.1.2.1).map (·.2)""")

# K12: an implementation digest change (base vs head) makes records producer-changed (A.5.4.1, A.6.2.6c)
patch('Kernel/Laws.lean', """def isPC (e : Env) (r : Record) : Bool :=
  (match r.provider with""", """def implDigestMoved (e : Env) (q : String) : Bool :=
  (sortStrs (((provH e q).bind (·.implDigest)).toList ++ ((provB e q).bind (·.implDigest)).toList)).length > 1

def isPC (e : Env) (r : Record) : Bool :=
  (e.fx "K12" && r.kind != .judgment && (match r.provider with | some q => implDigestMoved e q | none => false)) ||
  (match r.provider with""")

# K4: producer-changed affected adds implementation finest changes (A.7.2.2)
patch('Kernel/Laws.lean', """    (fun r => (r.harness.map (·.id)).filter (finest i.env))""",
"""    (fun r => (r.harness.map (·.id)).filter (finest i.env) ++
      (if i.env.fx "K4" then (match r.provider with
        | some q => (mIds i.env.mh).filter (fun x => finest i.env x && (implPathsU i.env q).any (fun g => globMatch g (idPath x)))
        | none => []) else []))""")

# K2: a law contradiction's witness is the contradicting record (records §5, A.7.1.1)
patch('Kernel/Laws.lean', """def lawObsFor (i : Input) (c : Claim) : List Ob :=
  let sc := lawSoundContra i c
  let hc := !sc && lawHeurContra i c
  (if sc then [mkLawOb i c .contradiction (some .sound) none] else []) ++
  (if hc then [mkLawOb i c .contradiction (some .heuristic) none] else []) ++""",
"""def lawWitness (i : Input) (c : Claim) (f : Force) : List String :=
  if i.env.fx "K2" then
    match sortStrs ((i.records.filter (fun r => lawContraForce i.env (polStar i) c r == some f && !strPrefix "review:" r.id)).map (·.id)) with
    | x :: _ => [x]
    | [] => []
  else []

def lawObsFor (i : Input) (c : Claim) : List Ob :=
  let sc := lawSoundContra i c
  let hc := !sc && lawHeurContra i c
  (if sc then [{ mkLawOb i c .contradiction (some .sound) none with witness := lawWitness i c .sound }] else []) ++
  (if hc then [{ mkLawOb i c .contradiction (some .heuristic) none with witness := lawWitness i c .heuristic }] else []) ++""")

# K1: coverage bindings add (d, own) per changed dependency that put x in the coverage set (A.7.2.2)
# K3: coverage answer items are K and every claim with an unmet pair (A.7.6.5)
patch('Kernel/Obligation.lean', """  unmetFinal : List String := []""", """  unmetFinal : List String := []
  /-- coverage: (owner*, final) of every claim with an unmet pair (DRT patch K3) -/
  unmetAll : List (String × Bool) := []""")
patch('Kernel/Coverage.lean', """def mkCov (e : Env) (rs : List Record) (g : String) : Ob :=""", """def covDepRows (e : Env) (rs : List Record) (xs : List String) : List CodeRow :=
  finestRows e (sortStrs (rs.flatMap (fun r => (r.entries.filter (fun en => xs.contains en.id)).flatMap
    (fun en => (en.deps.filter (fun d => inDelta e d.id)).map (·.id)))))

def mkCov (e : Env) (rs : List Record) (g : String) : Ob :=""")
patch('Kernel/Coverage.lean', """    introduced := true, tier := covTier e rs g, owner := baseOwner, affected := aff, code := finestRows e aff,""",
"""    introduced := true, tier := covTier e rs g, owner := baseOwner, affected := aff,
    code := finestRows e aff ++ (if e.fx "K1" then covDepRows e rs aff else []),
    unmetAll := claims.map (fun c => (ownerStar e c, tierStar e c == .final)),""")
patch('Kernel/Derive.lean', """    !(eligibleAnswerers i all o o.owner fin fin).isEmpty &&
      o.unmetFinal.all (fun ow => !(eligibleAnswerers i all o ow true true).isEmpty)""",
"""    !(eligibleAnswerers i all o o.owner fin fin).isEmpty &&
      o.unmetFinal.all (fun ow => !(eligibleAnswerers i all o ow true true).isEmpty) &&
      (!i.env.fx "K3" || o.unmetAll.all (fun p => !(eligibleAnswerers i all o p.1 p.2 p.2).isEmpty))""")

# K10: relations (edge.exists) have a footprint and channels, so they need coverage (A.4.5.1, A.7.4.2)
patch('Kernel/Coverage.lean', """      | .pathForbid _ _ K _ | .cycleForbid K => match compOf S u with""",
"""      | .edgeExists a k _ => if e.fx "K10" && compOf S u == some a then
          [if k == "calls" then Chan.call (idLang x) else Chan.edge k] else []
      | .pathForbid _ _ K _ | .cycleForbid K => match compOf S u with""")

# A4 (ambiguity): the pkgjson/gha file identity is command code only when the manifest marks it executable
patch('Kernel/Coverage.lean', """def isExecutable (e : Env) (x : String) : Bool :=
  registeredLangs.contains (idLang x) || isRawExec e x || isCommand x""",
"""def isCommandE (e : Env) (x : String) : Bool :=
  isCommand x && (!e.fx "A4" || (e.mh.find? (·.id == x)).any (·.kind == "exec"))

def isExecutable (e : Env) (x : String) : Bool :=
  registeredLangs.contains (idLang x) || isRawExec e x || isCommandE e x""")
patch('Kernel/Coverage.lean', """    ["ts", "rust", "rs", "verus", "sql"].contains lang || isRawExec e x || isCommand x""",
"""    ["ts", "rust", "rs", "verus", "sql"].contains lang || isRawExec e x || isCommandE e x""")
patch('Kernel/Coverage.lean', """  else lang != "raw" || isRawExec e x || isCommand x""",
"""  else lang != "raw" || isRawExec e x || isCommandE e x""")

# K9: an authenticated observer needs a head record (head revision or deps complete), and only when
#     base and head share a channel (A.5.2.13)
patch('Kernel/Derive.lean', """      let obs := if p.produces.contains .observation && !mine.any (·.kind == .observation) then [("E-provider-missing", "provider " ++ p.q)] else []""",
"""      let chB := match provH e p.q with | some h => p.observes.any (h.observes.contains ·) | none => false
      let obs := if p.produces.contains .observation && (!e.fx "K9" || chB) &&
          !mine.any (fun r => r.kind == .observation && (!e.fx "K9" || r.revision == e.headRev || depsBoth e r.provider))
        then [("E-provider-missing", "provider " ++ p.q)] else []""")

# K5: actor subject tier = highest base tier of items it owns (A.8.2.2; "or judges" in K5J)
# K6: provider subject tier = highest base tier of claims it decides or whose channels meet its own (A.8.2.2)
# K7: L7 compares a base claim with all its heirs, by ⊒ (op order) as well as equal NF (A.6.2.1)
patch('Kernel/Loosen.lean', """def provTier (Sb : Esf) (p : Prov) : Tier :=""", """def actorTier (Sb : Esf) (pol : Option Policy) (judges : Bool) (q : String) : Tier :=
  let owned := (Sb.comps.filter (·.owner == q)).map (·.tier) ++ (Sb.res.filter (·.owner == q)).map (·.tier) ++
    (Sb.units.filter (·.owner == q)).map (·.tier) ++ (Sb.claims.filter (·.owner == q)).map (·.tier)
  let judged := if judges then (match pol with
    | some p => [(Tier.low, p.low), (.normal, p.normal), (.critical, p.critical)].filterMap
        (fun (t, tp) => if tp.judges.contains q then some t else none)
    | none => []) else []
  (owned ++ judged).foldl tierMax .normal

def chanOfAtom' (S : Esf) (a : Atom) : List String :=
  if a.isTrust then (sortStrs ((S.hatches.filter (fun h => impl S h.1 a.verb)).map (·.2))).map (fun l => "hatch(" ++ l ++ ")")
  else ((S.res.filter (·.q == a.res)).flatMap (·.bind)).map (fun t => "effect(" ++ canonRC t ++ ")")

def kindChan (k : String) : String := if k == "calls" then "call(*)" else "edge(" ++ k ++ ")"

def claimChans (S : Esf) (c : Claim) : List String :=
  let bound := (sortStrs (S.res.flatMap (fun r => r.bind.map canonRC))).map (fun t => "effect(" ++ t ++ ")")
  match c.op with
  | .effectForbid a _ _ => chanOfAtom' S a
  | .authority _ _ => bound
  | .effectsUpper _ _ | .effectsLower _ _ => "call(*)" :: bound
  | .edgeForbid _ _ k _ _ | .edgeExists _ k _ => [kindChan k]
  | .pathForbid _ _ K _ | .cycleForbid K => K.map kindChan
  | _ => []

def provMeets (p : Prov) (ch : String) : Bool :=
  if ch == "call(*)" then p.observes.any (strPrefix "call(")
  else if strPrefix "effect(" ch then p.observes.any (fun o =>
      strPrefix "effect(" o && strSuffix ")" o &&
      rcMatches (String.ofList ((o.toList.drop 7).dropLast)) (String.ofList ((ch.toList.drop 7).dropLast)))
  else p.observes.contains ch

def provTierChan (Sb : Esf) (p : Prov) : Tier :=
  let ts := (Sb.claims.filter (fun c => decidesLaw p c || (claimChans Sb c).any (provMeets p))).map (·.tier)
  ts.foldl tierMax .normal

def opGe (S : Esf) (h b : Claim) : Bool :=
  (h.isStructUpper && b.isStructUpper && stronger h.op b.op) ||
  (match h.op, b.op with
   | .effectsUpper uh Ch, .effectsUpper ub Cb => uh == ub && Ch.all (fun a => Cb.any (fun c => atomLe S c a))
   | _, _ => false)

def provTier (Sb : Esf) (p : Prov) : Tier :=""")
patch('Kernel/Loosen.lean', """  let claimsP := Sb.claims.flatMap fun cb =>
    let heirs := Sh.claims.filter (·.fp == cb.fp)""", """  let claimsP := Sb.claims.flatMap fun cb =>
    let heirs := if e.fx "K7" then sortBy (fun a b => strLt a.fp b.fp) (Sh.claims.filter (fun h => h.fp == cb.fp || opGe Sb h cb))
      else Sh.claims.filter (·.fp == cb.fp)""")
patch('Kernel/Loosen.lean', """  let provP := Sb.provs.flatMap fun pb =>
    let t := provTier Sb pb""", """  let provP := Sb.provs.flatMap fun pb =>
    let t := if e.fx "K6" then provTierChan Sb pb else provTier Sb pb""")
patch('Kernel/Loosen.lean', """      let s := "actor " ++ ab.q
      (if ah.members.all (ab.members.contains ·) then [] else [part s .normal Sb.owner false "member" (jstrs ab.members) (jstrs ah.members)]) ++
      (if ah.operator == ab.operator then [] else
        [part s .normal Sb.owner false "operator" ((ab.operator.map jq).getD "null") ((ah.operator.map jq).getD "null")])""",
"""      let s := "actor " ++ ab.q
      let atr := if e.fx "K5" then actorTier Sb i.basePolicy (e.fx "K5J") ab.q else .normal
      (if ah.members.all (ab.members.contains ·) then [] else [part s atr Sb.owner false "member" (jstrs ab.members) (jstrs ah.members)]) ++
      (if ah.operator == ab.operator then [] else
        [part s atr Sb.owner false "operator" ((ab.operator.map jq).getD "null") ((ah.operator.map jq).getD "null")])""")
print("patched")

# PERF (semantics-preserving, always on in the copy): attribution of an L1 position does not depend
# on the atom, so compute it once per position instead of per (position, atom, forbid).
patch('Kernel/Loosen.lean', """def l1Parts (e : Env) (Sb : Esf) : List LPart :=
  let atoms := atomUniverse e
  (l1PosList e).flatMap fun x => atoms.flatMap fun a => l1PartsAt e Sb x a""",
"""def l1PartsAtU (e : Env) (Sb : Esf) (x : Pos) (ub uh : URef) (a : Atom) : List LPart :=
  let drops := (Sb.claims.filter (forbidCovers Sb ub a)).filterMap fun f =>
    let lh := lvl e.head uh a
    if lh < f.tier.rank then
      some { subject := f.fp, question := "L1", tier := f.tier, owner := f.owner, affected := [x.name],
             delta := ["L1 level " ++ a.show ++ " " ++ f.tier.name ++ ">" ++ lvlName lh],
             realise := posRealise x a }
    else none
  let auth := if permitted e.head uh a && !permitted Sb ub a && inA e.head uh a && !inA Sb ub a then
      match compOf Sb ub with
      | some k =>
        [{ subject := "component " ++ k, question := "L1", tier := ((baseComp Sb k).map (·.tier)).getD .normal,
           owner := ((baseComp Sb k).map (·.owner)).getD Sb.owner, affected := [x.name],
           delta := ["L1 authority+ " ++ a.show], realise := posRealise x a }]
      | none => []
    else []
  drops ++ auth

def l1Parts (e : Env) (Sb : Esf) : List LPart :=
  let atoms := atomUniverse e
  (l1PosList e).flatMap fun x =>
    let ub := attPos Sb e.mh true x
    let uh := attPos e.head e.mh false x
    atoms.flatMap fun a => l1PartsAtU e Sb x ub uh a""")
print("perf patched")

# PERF (semantics-preserving): deriveJ computes rawObs once (it called it through deriveObs,
# answeredObs, exceptionAnswered and the verdict); coverage computes `uncovered` once and the
# reach of each summarised unit once.
patch('Kernel/Derive.lean', """  let obs := sortBy obLt (dedupKey ((deriveObs inp).map grp))
  let ans := sortBy obLt (dedupKey ((answeredObs inp).map grp))""", """  let openObs := (raw.filter (fun o => !discharged i raw o)).map (finalize i raw)
  let ansObs := raw.filter (discharged i raw)
  let exAnsObs := raw.filter (fun o => !discharged i raw o && (matchedBy i o).isSome && o.introduced && excAnswered i raw o)
  let obs := sortBy obLt (dedupKey (openObs.map grp))
  let ans := sortBy obLt (dedupKey (ansObs.map grp))""")
patch('Kernel/Derive.lean', """        ("verdict", .str (verdictOf errs (deriveObs inp))),""", """        ("verdict", .str (verdictOf errs openObs)),""")
patch('Kernel/Derive.lean', """          ((sortBy obLt (dedupKey (exceptionAnswered inp))).map fun o =>""", """          ((sortBy obLt (dedupKey exAnsObs)).map fun o =>""")
patch('Kernel/Coverage.lean', """def needsOf (e : Env) (rs : List Record) (x : String) : List (Claim × Chan) :=
  let S := e.head""", """def summaryReach (e : Env) (rs : List Record) : List (String × List String) :=
  e.head.claims.filterMap fun c => match c.op with
    | .effectsUpper u _ | .effectsLower u _ => some (u, reachU e rs u)
    | _ => none

def needsOfT (e : Env) (rs : List Record) (tbl : List (String × List String)) (x : String) : List (Claim × Chan) :=
  let reachT (u : String) : List String := ((tbl.find? (·.1 == u)).map (·.2)).getD (reachU e rs u)
  let S := e.head""")
patch('Kernel/Coverage.lean', """        if (reachU e rs uq).contains x then Chan.call (idLang x) :: (boundCodes S).map Chan.effect else []""",
"""        if (reachT uq).contains x then Chan.call (idLang x) :: (boundCodes S).map Chan.effect else []""")
patch('Kernel/Coverage.lean', """def provObserves (p : Prov) : Chan → Bool""", """def needsOf (e : Env) (rs : List Record) (x : String) : List (Claim × Chan) := needsOfT e rs (summaryReach e rs) x

def provObserves (p : Prov) : Chan → Bool""")
patch('Kernel/Coverage.lean', """def uncovered (e : Env) (rs : List Record) : List (String × List (Claim × Chan)) :=
  (coverageSet e rs).filterMap fun x =>
    let un := (needsOf e rs x).filter (fun p => !chanMet e rs x p.2)""", """def uncovered (e : Env) (rs : List Record) : List (String × List (Claim × Chan)) :=
  let tbl := summaryReach e rs
  (coverageSet e rs).filterMap fun x =>
    let un := (needsOfT e rs tbl x).filter (fun p => !chanMet e rs x p.2)""")
patch('Kernel/Coverage.lean', """def mkCov (e : Env) (rs : List Record) (g : String) : Ob :=
  let members := covMembers e rs g""", """def covTierM (e : Env) (g : String) (members : List (String × List (Claim × Chan))) : Tier :=
  let t0 := match covComp g with | some kq => compTierStar e kq | none => .normal
  (members.flatMap (fun p => p.2.map (·.1))).foldl (fun t c => tierMax t (tierStar e c)) t0

def mkCovM (e : Env) (rs : List Record) (g : String) (members : List (String × List (Claim × Chan))) (t : Tier) : Ob :=
  let claims := members.flatMap (fun p => p.2.map (·.1))
  let baseOwner := match covComp g with
    | some kq => ((e.base.bind (fun b => b.comps.find? (·.q == kq))).map (·.owner)).getD
        (((e.head.comps.find? (·.q == kq)).map (·.owner)).getD (govS e).owner)
    | none => (govS e).owner
  let aff := sortStrs (members.map (·.1))
  { kind := .coverage, family := .coverage, key := obKey "coverage" none (.item g), subject := .item g,
    introduced := true, tier := t, owner := baseOwner, affected := aff,
    code := finestRows e aff ++ (if e.fx "K1" then covDepRows e rs aff else []),
    unmetAll := claims.map (fun c => (ownerStar e c, tierStar e c == .final)),
    answerable := true, mechanical := false,
    unmetFinal := sortStrs ((claims.filter (fun c => tierStar e c == .final)).map (ownerStar e ·)) }

def mkCov (e : Env) (rs : List Record) (g : String) : Ob :=
  let members := covMembers e rs g""")
patch('Kernel/Coverage.lean', """def coverageObs (e : Env) (rs : List Record) : List Ob :=
  (sortStrs ((uncovered e rs).map (fun p => covGroup e p.1))).filterMap fun g =>
    if (covTier e rs g).rank < Tier.normal.rank then none else some (mkCov e rs g)""", """def coverageObs (e : Env) (rs : List Record) : List Ob :=
  let unc := uncovered e rs
  (sortStrs (unc.map (fun p => covGroup e p.1))).filterMap fun g =>
    let members := unc.filter (fun p => covGroup e p.1 == g)
    let t := covTierM e g members
    if t.rank < Tier.normal.rank then none else some (mkCovM e rs g members t)""")
print("perf2 patched")

# A8 (ambiguity): coverage of x is met by a complete entry for x or for an ancestor of x (the anchoring
# rule of A.4.4.5), as the prototype reads A.7.4.3
patch('Kernel/Coverage.lean', """      r.entries.any (fun en => en.id == x && en.complete && entryUsableIn e.mh en) && revOk e r""",
"""      r.entries.any (fun en => (if e.fx "A8" then (ancestors e.mh x).contains en.id else en.id == x) && en.complete && entryUsableIn e.mh en) && revOk e r""")
print("A8 applied")

# K14: non-call edges of declared kinds lift even between code of one component (A.4.4.2: distinctness
# is required for calls only)
patch('Kernel/Facts.lean', """      else (compOfId S m of.f.to).bind (fun b => if a != b then some (a, of.f.kind, b) else none)""",
"""      else (compOfId S m of.f.to).bind (fun b => if a != b || e14 then some (a, of.f.kind, b) else none)""")
patch('Kernel/Facts.lean', """def liftEdge (S : Esf) (m : List MEntry) (of : OFact) : Option Edge :=""",
"""def liftEdge (S : Esf) (m : List MEntry) (of : OFact) (e14 : Bool := false) : Option Edge :=""")
patch('Kernel/Facts.lean', """  (obsFacts e rs).filterMap fun of => (liftEdge e.head e.mh of).map (fun ed => (ed, of))""",
"""  (obsFacts e rs).filterMap fun of => (liftEdge e.head e.mh of (e.fx "K14")).map (fun ed => (ed, of))""")
# A9 (ambiguity): L3 affected = code of the base claim's sources (all nodes for cycles), as the prototype
# reads A.8.3.2 "sources' code"; the kernel used the sources of the counterexample's edges
patch('Kernel/Loosen.lean', """    let affOf (P : List Edge) := sortStrs (P.flatMap (fun ed => compCode e ed.1))""",
"""    let srcNodes : List String := match cb.op with
      | .edgeForbid S _ _ _ _ | .pathForbid S _ _ _ => (e.head.comps.map (·.q)).filter (nselMatch S)
      | _ => e.head.comps.map (·.q)
    let affOf (P : List Edge) := if e.fx "A9" then sortStrs (srcNodes.flatMap (compCode e))
      else sortStrs (P.flatMap (fun ed => compCode e ed.1))""")
print("batch 2 applied")

# ---- batch 3 ----
# shared plumbing: head unit summary modes (A13), group support (A10), realising facts of parts (A10, K16)
patch('Kernel/Model.lean', """  baseRev : String := ""
deriving Inhabited""", """  baseRev : String := ""
  headUnitModes : List (String × Option String) := []
deriving Inhabited""")
patch('Kernel/Parse.lean', """      baseRev := match base with | .obj _ => (base.optStr "revision").getD "" | _ => "" }""",
"""      baseRev := match base with | .obj _ => (base.optStr "revision").getD "" | _ => "",
      headUnitModes := ((head.getD "esf").arrD "units").map (fun u => (u.strD "q", (u.getD "summary").optStr "mode")) }""")
patch('Kernel/Obligation.lean', """  unmetAll : List (String × Bool) := []""", """  unmetAll : List (String × Bool) := []
  /-- support facts used for grouping (DRT patch A10) -/
  gsupport : List String := []""")
patch('Kernel/Loosen.lean', """  realise : List (String × Atom) := []
  exploited : Bool := false""", """  realise : List (String × Atom) := []
  exploited : Bool := false
  /-- fact ids realising the part (DRT patches A10, K16) -/
  rfacts : List String := []""")

# A10 (ambiguity): groups join obligations sharing support facts (all support of contradictions;
# realising facts of loosenings) or affected finest changes, as the prototype reads A.7.2.3
patch('Kernel/Derive.lean', """  let linked (a b : Ob) := a.witness.any (b.witness.contains ·) || (fin a).any ((fin b).contains ·)""",
"""  let sup (o : Ob) := if e.fx "A10" then o.gsupport else o.witness
  let linked (a b : Ob) := (sup a).any ((sup b).contains ·) || (fin a).any ((fin b).contains ·)""")
patch('Kernel/Facts.lean', """             answerable := force == .heuristic, mechanical := force == .sound }

def effContras""", """             gsupport := sortStrs (sup.map (fun x => factId x.f)),
             answerable := force == .heuristic, mechanical := force == .sound }

def effContras""")
patch('Kernel/Facts.lean', """        affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
        answerable := force == .heuristic, mechanical := force == .sound : Ob }

/-- Coherence errors""", """        affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
        gsupport := sortStrs (sup.map (fun x => factId x.f)),
        answerable := force == .heuristic, mechanical := force == .sound : Ob }

/-- Coherence errors""")
patch('Kernel/Facts.lean', """          affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
          answerable := force == .heuristic, mechanical := force == .sound : Ob }
    | _ => []""", """          affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
          gsupport := sortStrs (sup.map (fun x => factId x.f)),
          answerable := force == .heuristic, mechanical := force == .sound : Ob }
    | _ => []""")
patch('Kernel/Loosen.lean', """def mkLoosenOb (e : Env) (rs : List Record) (subject : String) (ps : List LPart) : Ob :=""",
"""def mkLoosenOb (e : Env) (rs : List Record) (subject : String) (ps : List LPart) : Ob :=""")
patch('Kernel/Loosen.lean', """    affected := aff, code := finestRows e aff, delta := sortStrs (ps.flatMap (·.delta)),
    exploited := some expl, answerable := true, mechanical := false }""",
"""    affected := aff, code := finestRows e aff, delta := sortStrs (ps.flatMap (·.delta)),
    gsupport := if e.fx "A10" then sortStrs (ps.flatMap (fun p => p.rfacts ++ p.realise.flatMap (realisingIds e rs))) else [],
    exploited := some expl, answerable := true, mechanical := false }""")

# K16: an L2 part is exploited when an observed effect in reach(u) lies outside cl_b(C_b) (A.8.3.1-2)
# A13 (ambiguity): a surviving unit without summary is "L2 unknown" (prototype), not "L2 removed"
patch('Kernel/Loosen.lean', """def l2Parts (e : Env) (Sb : Esf) : List LPart :=""", """def declaredFactIdsAt (e : Env) (x : String) (a : Atom) : List String :=
  e.head.claims.flatMap fun c => match c.op with
    | .effectsLower u C =>
      if ((e.head.units.find? (·.q == u)).bind (unitBind e.head e.mh)) == some x then
        (C.filter (fun b => atomLe e.head b a)).map (fun b =>
          Hd (.obj [("type", .str "declared"), ("claim", .str c.fp), ("atom", .str b.show)]))
      else []
    | _ => []

def realisingIds (e : Env) (rs : List Record) (p : String × Atom) : List String :=
  ((obsFacts e rs).filter (fun of => of.f.loc == p.1 && match liftAtom e.head of.f with
    | some b => atomLe e.head b p.2
    | none => false)).map (fun of => factId of.f) ++ declaredFactIdsAt e p.1 p.2

def l2Parts (e : Env) (Sb : Esf) (rs : List Record := []) : List LPart :=""")
patch('Kernel/Loosen.lean', """      let mk (d : List String) : List LPart :=
        [{ subject := cb.fp, question := "L2", tier := cb.tier, owner := cb.owner,
           affected := sortStrs ((Sb.units.filter (·.q == u)).filterMap (unitBind Sb e.mh)), delta := d }]
      if hs.isEmpty then
        if (Sb.units.filter (·.q == u)).any (fun ud => (unitBind Sb e.mh ud).isSome) then
          mk [if e.head.claims.any (fun h => match h.op with | .effectsLower u' _ => u' == u | _ => false)
              then "L2 partial" else "L2 removed"]
        else []""", """      let outside := (obsFacts e rs).filter (fun of => (reachU e rs u).contains of.f.loc && of.f.ty == "effect" &&
        match liftAtom e.head of.f with
        | some b => !Cb.any (fun c => atomLe Sb c b)
        | none => false)
      let rf := if e.fx "K16" then outside.flatMap (fun of => match liftAtom e.head of.f with
          | some b => realisingIds e rs (of.f.loc, b)
          | none => []) else []
      let mk (d : List String) : List LPart :=
        [{ subject := cb.fp, question := "L2", tier := cb.tier, owner := cb.owner,
           affected := sortStrs ((Sb.units.filter (·.q == u)).filterMap (unitBind Sb e.mh)), delta := d,
           exploited := !rf.isEmpty, rfacts := rf }]
      let a13 : String :=
        match e.headUnitModes.find? (·.1 == u) with
        | none => "L2 removed"
        | some (_, some "partial") => "L2 partial"
        | some (_, some _) => "L2 removed"
        | some (_, none) => "L2 unknown"
      if hs.isEmpty then
        if (Sb.units.filter (·.q == u)).any (fun ud => (unitBind Sb e.mh ud).isSome) then
          mk [if e.fx "A13" then a13 else
              if e.head.claims.any (fun h => match h.op with | .effectsLower u' _ => u' == u | _ => false)
              then "L2 partial" else "L2 removed"]
        else []""")
patch('Kernel/Loosen.lean', """    let parts := l1Parts e Sb ++ l2Parts e Sb ++ l3Parts e i.records Sb ++ l4Parts e Sb ++ l7Parts i Sb""",
"""    let parts := l1Parts e Sb ++ l2Parts e Sb i.records ++ l3Parts e i.records Sb ++ l4Parts e Sb ++ l7Parts i Sb""")

# A10 for L3: facts of the realised completing set
patch('Kernel/Loosen.lean', """         affected := affOf P, delta := if loosened then delta else "L3 undecided budget" :: delta,
         exploited := loosened && P.all (Eh.contains ·) }]""", """         affected := affOf P, delta := if loosened then delta else "L3 undecided budget" :: delta,
         exploited := loosened && P.all (Eh.contains ·),
         rfacts := if loosened && P.all (Eh.contains ·) then
           ((obsEdges e rs).filter (fun p => P.contains p.1)).map (fun p => factId p.2.f) else [] }]""")

# K15: path-forbid support by forward and backward passes over interiors outside V ∪ S ∪ T (A.4.4.11)
patch('Kernel/Facts.lean', """def structContras (e : Env) (rs brs : List Record) : List Ob :=""", """def backReach (kE : List Edge) (V S T : List NSel) (s : String) : Nat → List String → List String
  | 0, acc => acc
  | fuel + 1, acc =>
    let add := (kE.filter (fun ed => acc.contains ed.2.2 && !acc.contains ed.1 && !nselMatch V ed.1 &&
      !nselMatch T ed.1 && (ed.1 == s || !nselMatch S ed.1))).map (·.1)
    if add.isEmpty then acc else backReach kE V S T s fuel (sortStrs (acc ++ add))

def pathSuppEdges (S T : List NSel) (K : List String) (V : List NSel) (E : List Edge) (s t : String) : List Edge :=
  let blocked := fun n => nselMatch V n || nselMatch S n || nselMatch T n
  let kE := E.filter (fun ed => K.contains ed.2.1)
  let fwd := s :: (reachK K blocked E s).filter (fun n => !blocked n)
  let back := backReach kE V S T s (kE.length + 1) [t]
  kE.filter (fun ed => fwd.contains ed.1 && back.contains ed.2.2)

def structContras (e : Env) (rs brs : List Record) : List Ob :=""")
patch('Kernel/Facts.lean', """      let exactEdge : Option (String × String) := match c.op, sv.1 with
        | .edgeForbid .., .fromTo a b => if e.fx "K11" then some (a, b) else none
        | _, _ => none
      let sup := ((obsEdges e rs).filter fun p => (match exactEdge with
          | some (a, b) => p.1.1 == a && p.1.2.2 == b
          | none => ns.contains p.1.1 && ns.contains p.1.2.2) &&
        (opKinds c.op).contains p.1.2.1).map (·.2)""", """      let exactEdge : Option (String × String) := match c.op, sv.1 with
        | .edgeForbid .., .fromTo a b => if e.fx "K11" then some (a, b) else none
        | _, _ => none
      let pathEdges : Option (List Edge) := match c.op, sv.1 with
        | .pathForbid S T K V, .fromTo s t => if e.fx "K15" then some (pathSuppEdges S T K V E s t) else none
        | _, _ => none
      let sup := ((obsEdges e rs).filter fun p => (match exactEdge, pathEdges with
          | some (a, b), _ => p.1.1 == a && p.1.2.2 == b
          | none, some pe => pe.contains p.1
          | none, none => ns.contains p.1.1 && ns.contains p.1.2.2) &&
        (opKinds c.op).contains p.1.2.1).map (·.2)""")

# A11 (ambiguity): path forbids have no s = t pairs (simple paths, as A.8.4.2's search and the prototype)
patch('Kernel/Facts.lean', """def structViol (op : Op) (E : List Edge) : List (Subj × List String) :=""",
"""def structViol (op : Op) (E : List Edge) (a11 : Bool := false) : List (Subj × List String) :=""")
patch('Kernel/Facts.lean', """      (r.filter (nselMatch T)).map fun t => (Subj.fromTo s t, s :: r)""",
"""      (r.filter (fun t => nselMatch T t && (!a11 || t != s))).map fun t => (Subj.fromTo s t, s :: r)""")
patch('Kernel/Facts.lean', """    let declViol := (structViol c.op Ed).map (·.1)
    let soundViol := (structViol c.op Es).map (·.1)
    ((structViol c.op E).filter (fun sv => !declViol.contains sv.1)).map fun sv =>""",
"""    let a11 := e.fx "A11"
    let declViol := (structViol c.op Ed a11).map (·.1)
    let soundViol := (structViol c.op Es a11).map (·.1)
    ((structViol c.op E a11).filter (fun sv => !declViol.contains sv.1)).map fun sv =>""")
patch('Kernel/Facts.lean', """    if evalStruct c.op Ed then [] else [("E-structure", c.fp)]""",
"""    if (if e.fx "A11" then (structViol c.op Ed true).isEmpty else evalStruct c.op Ed) then [] else [("E-structure", c.fp)]""")

# A12 (ambiguity): a removed law is "changed" (L4 head <fp>) when a head law has the same name, or the
# same targets and statement form (prototype), not only the same name
patch('Kernel/Loosen.lean', """    let named := e.head.claims.filter (fun h => h.isLaw && h.ids.any (cb.ids.contains ·))""",
"""    let form (c : Claim) : Nat := match c.op with
      | .law _ (.schema ..) => 0 | .law _ (.hosted _) => 1 | .law _ (.text _) => 2 | _ => 3
    let named := e.head.claims.filter (fun h => h.isLaw && (h.ids.any (cb.ids.contains ·) ||
      (e.fx "A12" && lawTargets h == lawTargets cb && form h == form cb)))""")
print("batch 3 applied")

# ---- batch 4 ----
# K17: summary contradictions: support adds the calls (x,y) with x in reach(u) and a site reachable from y
#      (A.4.4.11); force is sound iff some site is reached by presence-sound calls and is itself sound or
#      declared (canonical witness, A.4.4.10/13)
# K18: sites include atoms W_decl declares for other units bound in reach(u) (Xt, A.4.4.2)
patch('Kernel/Facts.lean', """      let r := reachU e rs u
      let facts := (obsFacts e rs).filter (fun of => r.contains of.f.loc)
      let bad := canon (facts.filterMap fun of => match liftAtom e.head of.f with
        | some b => if b.isTrust || C.any (fun a => atomLe e.head a b) then none else some b
        | none => none)
      bad.map fun b =>
        let sup := facts.filter (fun of => liftAtom e.head of.f == some b)
        let force := if sup.any (·.sound) then Force.sound else .heuristic
        let subj := Subj.unitAtom u b.show
        let aff := sortStrs (sup.map (·.f.loc))""", """      let r := reachU e rs u
      let facts := (obsFacts e rs).filter (fun of => r.contains of.f.loc)
      let decl : List (String × Atom × String × String) := if e.fx "K18" then e.head.claims.flatMap (fun d => match d.op with
          | .effectsLower v D => if v == u then [] else
              match (e.head.units.find? (·.q == v)).bind (unitBind e.head e.mh) with
              | some x => if r.contains x then D.map (fun a => (x, a, d.fp,
                  Hd (.obj [("type", .str "declared"), ("claim", .str d.fp), ("atom", .str a.show)]))) else []
              | none => []
          | _ => []) else []
      let bad := canon ((facts.filterMap fun of => match liftAtom e.head of.f with
        | some b => if b.isTrust || C.any (fun a => atomLe e.head a b) then none else some b
        | none => none) ++ decl.filterMap (fun d => if d.2.1.isTrust || C.any (fun a => atomLe e.head a d.2.1) then none else some d.2.1))
      bad.map fun b =>
        let sup0 := facts.filter (fun of => liftAtom e.head of.f == some b)
        let dsup := decl.filter (fun d => d.2.1 == b)
        let siteLocs := sup0.map (·.f.loc) ++ dsup.map (·.1)
        let allCalls := (obsFacts e rs).filter (fun of => of.f.ty == "call")
        let calls := if e.fx "K17" then allCalls.filter (fun of => r.contains of.f.loc &&
            (reachSet (callPairs e rs) (fun _ => true) [of.f.to]).any (siteLocs.contains ·)) else []
        let sup := sup0 ++ calls
        let soundR := reachSet ((allCalls.filter (·.sound)).map (fun of => (of.f.loc, of.f.to))) (fun _ => true) (unitCode e u)
        let force := if e.fx "K17" then
            (if sup0.any (fun of => of.sound && soundR.contains of.f.loc) || dsup.any (fun d => soundR.contains d.1) then Force.sound else .heuristic)
          else if sup.any (·.sound) then Force.sound else .heuristic
        let baseLower (fp : String) : Bool := match e.base with
          | some bs => bs.claims.any (fun bc => bc.fp == fp && match bc.op with | .effectsLower .. => true | _ => false)
          | none => false
        let subj := Subj.unitAtom u b.show
        let aff := sortStrs (sup.map (·.f.loc) ++ dsup.map (·.1))""")
patch('Kernel/Facts.lean', """          introduced := sup.any (factNew e brs), tier := tierStar e c, owner := ownerStar e c,
          affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
          gsupport := sortStrs (sup.map (fun x => factId x.f)),""", """          introduced := sup.any (factNew e brs) || (hasBase e && dsup.any (fun d => !baseLower d.2.2.1)),
          tier := tierStar e c, owner := ownerStar e c,
          affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
          gsupport := sortStrs (sup.map (fun x => factId x.f) ++ dsup.map (·.2.2.2)),""")
print("batch 4 applied")

# A11 also in L3's search: path-forbid counterexamples are simple paths, so t = s never ends one (A.8.4.2)
patch('Kernel/Loosen.lean', """def searchCex (heads : List Op) (base : Op) (W G : List Edge) : SearchResult :=""",
"""def searchCex (heads : List Op) (base : Op) (W G : List Edge) (a11 : Bool := false) : SearchResult :=""")
patch('Kernel/Loosen.lean', """    run (ns.filter (fun s => nselMatch S s && !nselMatch V s)) (fun _ t => nselMatch T t)""",
"""    run (ns.filter (fun s => nselMatch S s && !nselMatch V s)) (fun s t => nselMatch T t && (!a11 || t != s))""")
patch('Kernel/Loosen.lean', """def l3Tail (heads : List Op) (cb : Op) (W G : List Edge) : L3Verdict :=""",
"""def l3Tail (heads : List Op) (cb : Op) (W G : List Edge) (a11 : Bool := false) : L3Verdict :=""")
patch('Kernel/Loosen.lean', """    match searchCex heads cb W G with""", """    match searchCex heads cb W G a11 with""")
patch('Kernel/Loosen.lean', """def l3Decide (heads : List Op) (cb : Op) (W G : List Edge) : L3Verdict :=
  if heads.any (fun h => stronger h cb) then .heir
  else if evalStruct cb G then .ga
  else l3Tail heads cb W G""", """def l3Decide (heads : List Op) (cb : Op) (W G : List Edge) (a11 : Bool := false) : L3Verdict :=
  if heads.any (fun h => stronger h cb) then .heir
  else if evalStruct cb G then .ga
  else l3Tail heads cb W G a11""")
patch('Kernel/Loosen.lean', """    match l3Decide (heads.map (·.op)) cb.op W G with""", """    match l3Decide (heads.map (·.op)) cb.op W G (e.fx "A11") with""")
print("A11-L3 applied")

# K7b: tier*, owner*, R* read every base claim the head claim is an heir of by ⊒ (op order: structural
#      forbids, summaries), not only the equal-NF one (A.6.2.1/3/5); owner* = the least-fp base claim's
#      owner (prototype); the witness condition of A.6.2.3 is not applied (as in the prototype)
patch('Kernel/Facts.lean', """def baseSame (e : Env) (c : Claim) : List Claim :=
  match e.base with
  | some b => if hasBase e then b.claims.filter (·.fp == c.fp) else []
  | none => []""", """def opGeF (S : Esf) (h b : Claim) : Bool :=
  (h.isStructUpper && b.isStructUpper && stronger h.op b.op) ||
  (match h.op, b.op with
   | .effectsUpper uh Ch, .effectsUpper ub Cb => uh == ub && Ch.all (fun a => Cb.any (fun c => atomLe S c a))
   | _, _ => false)

def baseSame (e : Env) (c : Claim) : List Claim :=
  match e.base with
  | some b => if hasBase e then
      (if e.fx "K7b" then sortBy (fun x y => strLt x.fp y.fp) (b.claims.filter (fun cb => cb.fp == c.fp || opGeF e.head c cb))
       else b.claims.filter (·.fp == c.fp)) else []
  | none => []""")
print("K7b applied")

# ---- batch 5 ----
# A14 (ambiguity): an observed fact anchors to the nearest ancestor-or-self entry that is usable
#      (prototype), not to the nearest entry, usable or not (kernel) (A.4.4.5)
patch('Kernel/Facts.lean', """def recFacts (e : Env) (r : Record) : List OFact :=
  if r.kind == .observation && provDeclared e r.provider then
    r.facts.filterMap fun f => match anchorEntry e.mh r f.loc with""", """def anchorUsable (e : Env) (m : List MEntry) (r : Record) (x : String) : Option OEntry :=
  if e.fx "A14" then (ancestors m x).findSome? (fun y => r.entries.find? (fun en => en.id == y && entryUsableIn m en))
  else anchorEntry m r x

def recFacts (e : Env) (r : Record) : List OFact :=
  if r.kind == .observation && provDeclared e r.provider then
    r.facts.filterMap fun f => match anchorUsable e e.mh r f.loc with""")
patch('Kernel/Facts.lean', """      (match anchorEntry e.mb r g.loc with""", """      (match anchorUsable e e.mb r g.loc with""")
# K20: the coverage set holds head identities only (A.7.4.1 over M_h; deleted ids cannot be covered)
patch('Kernel/Coverage.lean', """  sortStrs ((mIds e.mh).filter (finest e) ++
    rs.flatMap (fun r => (r.entries.filter (fun en => en.deps.any (fun d => inDelta e d.id))).map (·.id)))""",
"""  sortStrs ((mIds e.mh).filter (finest e) ++
    (rs.flatMap (fun r => (r.entries.filter (fun en => en.deps.any (fun d => inDelta e d.id))).map (·.id))).filter
      (fun x => !e.fx "K20" || e.mh.any (·.id == x)))""")
# K19: structural support includes the declared facts of relation edges in the support region; they are
#      new when the relation is added or changed (A.4.4.11, A.7.3.1)
patch('Kernel/Facts.lean', """        (opKinds c.op).contains p.1.2.1).map (·.2)
      let force := if soundViol.contains sv.1 then Force.sound else .heuristic""", """        (opKinds c.op).contains p.1.2.1).map (·.2)
      let declSup : List (String × String) := if e.fx "K19" then
        e.head.claims.filterMap (fun dc => match dc.op with
          | .edgeExists a k b => if (opKinds c.op).contains k && (match exactEdge, pathEdges with
              | some (x, y), _ => a == x && b == y
              | none, some pe => pe.contains (a, k, b)
              | none, none => ns.contains a && ns.contains b)
            then some (dc.fp, Hd (.obj [("type", .str "declared"), ("claim", .str dc.fp)])) else none
          | _ => none) else []
      let baseLowerFp (fp : String) : Bool := match e.base with
        | some bs => bs.claims.any (fun bc => bc.fp == fp && match bc.op with | .edgeExists .. | .effectsLower .. => true | _ => false)
        | none => false
      let force := if soundViol.contains sv.1 then Force.sound else .heuristic""")
patch('Kernel/Facts.lean', """        introduced := sup.any (factNew e brs), tier := tierStar e c, owner := ownerStar e c,
        affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
        gsupport := sortStrs (sup.map (fun x => factId x.f)),""", """        introduced := sup.any (factNew e brs) || (hasBase e && declSup.any (fun d => !baseLowerFp d.1)),
        tier := tierStar e c, owner := ownerStar e c,
        affected := aff, code := finestRows e aff, witness := sortStrs (sup.map (fun x => factId x.f)),
        gsupport := sortStrs (sup.map (fun x => factId x.f) ++ declSup.map (·.2)),""")
print("batch 5 applied")
