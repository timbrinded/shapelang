import Kernel.Loosen
/-! Coverage (model §4.5, §7.4, A.4.5, A.7.4): footprints, channels and whether changed
code under a claim was observable. -/
namespace Shape

inductive Chan | effect (t : String) | hatch (l : String) | call (l : String) | edge (k : String)
deriving DecidableEq, Repr, Inhabited

def Chan.str : Chan → String
  | .effect t => "effect(" ++ t ++ ")" | .hatch l => "hatch(" ++ l ++ ")"
  | .call l => "call(" ++ l ++ ")" | .edge k => "edge(" ++ k ++ ")"

def registeredLangs : List String := ["ts", "rust", "rs", "verus"]

def isRawExec (e : Env) (x : String) : Bool :=
  idLang x == "raw" && ((e.mh.find? (·.id == x)).any (·.kind == "exec") ||
    scriptExts.contains (extOf (idPath x)) || scriptNames.contains ((splitChar '/' (idPath x)).getLastD ""))

def isCommand (x : String) : Bool := idLang x == "pkgjson" || idLang x == "gha"

def isExecutable (e : Env) (x : String) : Bool :=
  registeredLangs.contains (idLang x) || isRawExec e x || isCommand x

/-- Carriers of resource-code kinds (A.12.4). -/
def carries (e : Env) (x t : String) : Bool :=
  let tk := rcTagKind t
  let lang := idLang x
  if tk == "pg.table" || tk == "mysql.table" || tk == "sqlite.table" then
    ["ts", "rust", "rs", "verus", "sql"].contains lang || isRawExec e x || isCommand x
  else if tk == "ts.call" then
    lang == "ts" || (lang == "raw" && ["html", "htm", "astro", "vue", "svelte"].contains (extOf (idPath x)))
  else lang != "raw" || isRawExec e x || isCommand x

def chanApplies (e : Env) (x : String) : Chan → Bool
  | .effect t => carries e x t
  | .hatch l => idLang x == l
  | .call l => idLang x == l
  | .edge _ => isExecutable e x

def boundCodes (S : Esf) : List String := sortStrs (S.res.flatMap (fun r => r.bind.map canonRC))

def chanOfAtom (S : Esf) (a : Atom) : List Chan :=
  if a.isTrust then
    (sortStrs ((S.hatches.filter (fun h => impl S h.1 a.verb)).map (·.2))).map Chan.hatch
  else ((S.res.filter (·.q == a.res)).flatMap (·.bind)).map (fun t => Chan.effect (canonRC t))

/-- Need(x): every (claim, channel) with x in F(c) and the channel applying to x. -/
def needsOf (e : Env) (rs : List Record) (x : String) : List (Claim × Chan) :=
  let S := e.head
  let u := att S e.mh x
  S.claims.flatMap fun c =>
    let chans : List Chan := match c.op with
      | .effectForbid a sc ex => if covers S sc ex u then chanOfAtom S a else []
      | .authority k _ => if compOf S u == some k then (boundCodes S).map Chan.effect else []
      | .effectsUpper uq _ | .effectsLower uq _ =>
        if (reachU e rs uq).contains x then Chan.call (idLang x) :: (boundCodes S).map Chan.effect else []
      | .edgeForbid Ssel X k _ _ => match compOf S u with
        | some kq => if nselMatch Ssel kq && !nselMatch X kq then
            [if k == "calls" then Chan.call (idLang x) else Chan.edge k] else []
        | none => []
      | .pathForbid _ _ K _ | .cycleForbid K => match compOf S u with
        | some _ => K.map (fun k => if k == "calls" then Chan.call (idLang x) else Chan.edge k)
        | none => []
      | _ => []
    (chans.filter (chanApplies e x)).map (fun ch => (c, ch))

def provObserves (p : Prov) : Chan → Bool
  | .effect t => p.observes.any (fun o =>
      strPrefix "effect(" o && strSuffix ")" o && rcMatches (String.ofList ((o.toList.drop 7).dropLast)) t)
  | .call l => p.observes.contains ("call(" ++ l ++ ")")
  | .edge k => p.observes.any (fun o => o == "edge(" ++ k ++ ")" || strPrefix ("edge(" ++ k ++ ",") o)
  | .hatch _ => false

def hatchComplete (e : Env) (x : String) : Bool :=
  let es := e.mh.filter (·.id == x)
  !es.isEmpty && es.all (·.hatchComplete)

/-- Met by a usable complete entry from a provider absence-sound and observing the channel
    in base and head, not producer-changed; hatch channels by hatch-completeness. -/
def chanMet (e : Env) (rs : List Record) (x : String) : Chan → Bool
  | .hatch _ => hatchComplete e x
  | ch => rs.any fun r => r.kind == .observation && !isPC e r &&
      (match r.provider with
       | some q => match bothProv e q with
         | some (b, h) => b.absence && h.absence && provObserves b ch && provObserves h ch
         | none => false
       | none => false) &&
      r.entries.any (fun en => en.id == x && en.complete && entryUsableIn e.mh en)

def coverageSet (e : Env) (rs : List Record) : List String :=
  if !hasBase e then [] else
  sortStrs ((mIds e.mh).filter (finest e) ++
    rs.flatMap (fun r => (r.entries.filter (fun en => en.deps.any (fun d => inDelta e d.id))).map (·.id)))

def uncovered (e : Env) (rs : List Record) : List (String × List (Claim × Chan)) :=
  (coverageSet e rs).filterMap fun x =>
    let un := (needsOf e rs x).filter (fun p => !chanMet e rs x p.2)
    if un.isEmpty then none else some (x, un)

def covGroup (e : Env) (x : String) : String :=
  match compOfId e.head e.mh x with
  | some k => "component " ++ k
  | none => "ungoverned"

def compTierStar (e : Env) (k : String) : Tier :=
  let th := ((e.head.comps.find? (·.q == k)).map (·.tier)).getD .normal
  match e.base.bind (fun b => b.comps.find? (·.q == k)) with
  | some cb => tierMax th cb.tier
  | none => th

def covMembers (e : Env) (rs : List Record) (g : String) : List (String × List (Claim × Chan)) :=
  (uncovered e rs).filter (fun p => covGroup e p.1 == g)

def covComp (g : String) : Option String := if strPrefix "component " g then some (dropChars 10 g) else none

def covTier (e : Env) (rs : List Record) (g : String) : Tier :=
  let t0 := match covComp g with | some kq => compTierStar e kq | none => .normal
  ((covMembers e rs g).flatMap (fun p => p.2.map (·.1))).foldl (fun t c => tierMax t (tierStar e c)) t0

def mkCov (e : Env) (rs : List Record) (g : String) : Ob :=
  let members := covMembers e rs g
  let claims := members.flatMap (fun p => p.2.map (·.1))
  let baseOwner := match covComp g with
    | some kq => ((e.base.bind (fun b => b.comps.find? (·.q == kq))).map (·.owner)).getD
        (((e.head.comps.find? (·.q == kq)).map (·.owner)).getD (govS e).owner)
    | none => (govS e).owner
  let aff := sortStrs (members.map (·.1))
  { kind := .coverage, family := .coverage, key := obKey "coverage" none (.item g), subject := .item g,
    introduced := true, tier := covTier e rs g, owner := baseOwner, affected := aff, code := finestRows e aff,
    answerable := true, mechanical := false,
    unmetFinal := sortStrs ((claims.filter (fun c => tierStar e c == .final)).map (ownerStar e ·)) }

/-- One coverage obligation per component (and for `ungoverned`); below normal it is health only. -/
def coverageObs (e : Env) (rs : List Record) : List Ob :=
  (sortStrs ((uncovered e rs).map (fun p => covGroup e p.1))).filterMap fun g =>
    if (covTier e rs g).rank < Tier.normal.rank then none else some (mkCov e rs g)

end Shape
