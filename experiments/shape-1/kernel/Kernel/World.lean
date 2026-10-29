import Kernel.Eval
import Kernel.Struct
import Kernel.Cells
import Kernel.Parse
import Std.Data.HashSet
/-! The change context (A.6, A.7.8 steps 1–4): code delta, relocation and finest changes
(A.6.1.5 [D6, D8]); both shapes resolved over M_h — unit bindings, attribution with except
paths, specificity and the base's strictest view (A.3.3, A.6.4.3–4, A.16.21); ρ with the rule-3
hint (A.6.1.4 [D17]); heirs by ⊒ (A.6.2.1, A.5.6); provider governance G* (A.6.2.6); policy*
and eligibility (A.6.3, A.16.12, A.16.15). Executable layer. -/
namespace Shape

open Std

/-! ### Errors raised by the kernel -/

structure KErr where
  code : String
  subject : String
  causes : List (String × String) := []
  dischargers : J := .arr []
deriving Inhabited

def editShapeDis : J := .arr [.obj [("act", .str "edit-shape"), ("by", .str "author"), ("agentSafe", .bool true),
  ("eligible", .arr []), ("creates", .null)]]
def rerunDis : J := .arr [.obj [("act", .str "rerun"), ("by", .str "ci"), ("agentSafe", .bool true),
  ("eligible", .arr []), ("creates", .null)]]

/-! ### Worlds: a shape resolved over M_h -/

structure World where
  S : Esf
  isBase : Bool
  /-- unit Q → the identities it binds (head: at most one) -/
  unitBind : HashMap String (List String)
  /-- identity → the units binding it -/
  idUnits : HashMap String (List String)
  /-- identity → its attribution (several for base ties and overlaps: strictest view) -/
  attOf : HashMap String (List URef)
  /-- position name → its identities -/
  codeOf : HashMap String (List String)
  resOfCode : HashMap String String
  boundKinds : List String
  /-- nodes: non-std components and resources -/
  nodes : List String
  comps : HashMap String Comp
  unitsBy : HashMap String UnitD
deriving Inhabited

def World.att (w : World) (x : String) : List URef := (w.attOf.get? x).getD [.ungov]
def World.att1 (w : World) (x : String) : URef := (w.att x).headD .ungov
def World.code (w : World) (pos : String) : List String := (w.codeOf.get? pos).getD []
def World.bind1 (w : World) (u : String) : Option String := ((w.unitBind.get? u).getD []).head?
def World.binds (w : World) (u : String) : List String := (w.unitBind.get? u).getD []
def World.resOf (w : World) (rc : String) : Option String := w.resOfCode.get? (canonRC rc)

/-- comp(att(x)) for a URef. -/
def World.compOfU (w : World) : URef → Option String
  | .unit q => (w.unitsBy.get? q).map (·.comp)
  | .pseudo k => some k
  | .ungov => none

/-- Identities attributed to component K (its units and K.*). -/
def World.compCode (w : World) (k : String) (m : Manifest) : List String :=
  m.order.filter fun x => (w.att x).any (fun u => w.compOfU u == some k)

def World.unitCode (w : World) (u : String) : List String := w.code u

/-- The positions of the world's shape: units, pseudo-units, ungoverned. -/
def World.positions (w : World) : List String :=
  sortStrs (w.S.units.map (·.q) ++ w.S.comps.map (·.q ++ ".*") ++ ["ungoverned"])

def nodeSel (w : World) (sels : List NSel) : List String :=
  sortStrs (sels.flatMap fun s => match s with
    | .all => w.nodes
    | .comp q => [q]
    | .res q => [q])

/-- Does a glob of component c match a path, its except globs excluded (A.3.3.3 [D25])? -/
def compGlobMatch (c : Comp) (g path : String) : Bool :=
  globMatch g path && !c.exceptPaths.any (globMatch · path)

/-- The in-paths test for default bindings: ⟦paths(K)⟧, all of ids(M_h) without paths. -/
def inPaths (c : Comp) (path : String) : Bool :=
  c.paths.isEmpty || c.paths.any (compGlobMatch c · path)

def byName (S : Esf) (u : UnitD) (m : Manifest) : List String :=
  match S.comps.find? (·.q == u.comp) with
  | none => []
  | some c => m.order.filter fun x => match m.info? x with
    | some i => match i.symbol with
      | some sym => symLast i.lang sym == u.name && inPaths c i.path
      | none => false
    | none => false

/-- Builds a world. Head errors: E-unbound, E-ambiguous, E-overlap (A.3.3.2, A.3.3.6, A.15.1,
    A.16.20). -/
def buildWorld (S : Esf) (mh : Manifest) (mb : Option Manifest) (isBase : Bool) : World × List KErr := Id.run do
  let mut errs : List KErr := []
  let mut unitBind : HashMap String (List String) := {}
  for u in S.units do
    let mut bound : List String := []
    if !isBase then
      match u.bind with
      | some b =>
        if mh.has b then bound := [b]
        else errs := errs ++ [{ code := "E-unbound", subject := "unit " ++ u.q }]
      | none =>
        match byName S u mh with
        | [x] => bound := [x]
        | [] => errs := errs ++ [{ code := "E-unbound", subject := "unit " ++ u.q }]
        | _ => errs := errs ++ [{ code := "E-ambiguous", subject := "unit " ++ u.q }]
    else
      -- A.6.4.3, A.16.21: default names take the unique M_h match; else x_b if present;
      -- else every new identity in x_b's file (rename in place); else ∅
      let mut xb : Option String := u.bind
      if u.bind.isNone then
        match byName S u mh with
        | [x] => bound := [x]
        | _ =>
          match mb with
          | some m => xb := match byName S u m with | [x] => some x | _ => none
          | none => xb := none
      if bound.isEmpty then
        match xb with
        | some x =>
          if mh.has x then bound := [x]
          else
            match mb with
            | some m =>
              let file := idFile x
              bound := mh.order.filter (fun y => idFile y == file && (idSym y).isSome && !m.has y)
            | none => pure ()
        | none => pure ()
    unitBind := unitBind.insert u.q bound
  let mut idUnits : HashMap String (List String) := {}
  for u in S.units do
    for x in (unitBind.get? u.q).getD [] do
      idUnits := idUnits.insert x (((idUnits.get? x).getD []) ++ [u.q])
  if !isBase then
    for (x, us) in idUnits.toList do
      if us.length > 1 then
        let s := sortStrs us
        errs := errs ++ [{ code := "E-overlap", subject := " ".intercalate (s.map ("unit " ++ ·)) }]
        idUnits := idUnits.insert x [s.headD ""]
  let comps : HashMap String Comp := S.comps.foldl (fun m c => m.insert c.q c) {}
  let unitsBy : HashMap String UnitD := S.units.foldl (fun m u => m.insert u.q u) {}
  -- attribution (A.3.3.5)
  let globAtt (path : String) : List URef :=
    let cands := S.comps.flatMap fun c => (c.paths.filter (compGlobMatch c · path)).map (fun g => (specificity g, c.q))
    match cands with
    | [] => [.ungov]
    | _ =>
      let best := cands.foldl (fun m p => max m p.1) 0
      (sortStrs ((cands.filter (·.1 == best)).map (·.2))).map URef.pseudo
  let mut attOf : HashMap String (List URef) := {}
  let mut codeOf : HashMap String (List String) := {}
  for x in mh.order do
    let anc := mh.ancestors x
    let a : List URef := match anc.find? (fun y => idUnits.contains y) with
      | some y => (sortStrs ((idUnits.get? y).getD [])).map URef.unit
      | none =>
        let g := globAtt ((mh.info? x).map (·.path) |>.getD (idPath x))
        if isBase then g else g.take 1
    attOf := attOf.insert x a
    for r in a do
      codeOf := codeOf.insert r.name (((codeOf.get? r.name).getD []) ++ [x])
  let mut resOfCode : HashMap String String := {}
  for r in S.res do
    for b in r.bind do
      if !resOfCode.contains (canonRC b) then resOfCode := resOfCode.insert (canonRC b) r.q
  let boundKinds := sortStrs (S.res.flatMap (fun r => r.bind.map rcTagKind))
  let nodes := sortStrs ((S.comps.filter (fun c => !strPrefix "std::" c.q)).map (·.q) ++
    (S.res.filter (fun r => !strPrefix "std::" r.q)).map (·.q))
  return ({ S := S, isBase := isBase, unitBind := unitBind, idUnits := idUnits, attOf := attOf, codeOf := codeOf,
            resOfCode := resOfCode, boundKinds := boundKinds, nodes := nodes, comps := comps, unitsBy := unitsBy }, errs)

/-! ### Code delta (A.6.1.5) -/

structure Delta where
  /-- identities in Δcode at some projection -/
  ids : HashSet String
  /-- (identity, projection) pairs of Δcode, as "id\u0000proj" -/
  pairs : HashSet String
  deleted : List String
  finest : HashSet String
  /-- new identity → the deleted identity it is relocated from -/
  relocFrom : HashMap String String
deriving Inhabited

def pairKey (x p : String) : String := x ++ "\u0000" ++ p

def computeDelta (mh mb : Manifest) (active : Bool) : Delta := Id.run do
  if !active then return { ids := {}, pairs := {}, deleted := [], finest := {}, relocFrom := {} }
  let mut ids : HashSet String := {}
  let mut pairs : HashSet String := {}
  let mut news : List String := []
  for x in mh.order do
    let i := (mh.info? x).get!
    match mb.info? x with
    | none =>
      ids := ids.insert x
      news := news ++ [x]
      for (p, _) in i.digests do pairs := pairs.insert (pairKey x p)
    | some b =>
      for (p, d) in i.digests do
        match (b.digests.find? (·.1 == p)), (b.schemes.find? (·.1 == p)), (i.schemes.find? (·.1 == p)) with
        | some (_, bd), some (_, bs), some (_, hs) =>
          if bs == hs && bd != d then
            ids := ids.insert x
            pairs := pairs.insert (pairKey x p)
        | _, _, _ => pure ()
  let deleted := mb.order.filter (fun y => !mh.has y)
  -- relocation [D6]: unique (kind, language, own digest) pair among new and deleted identities
  let own (m : Manifest) (x : String) : Option String := m.digest x "own"
  let sig (m : Manifest) (x : String) : Option String :=
    match m.info? x, own m x with
    | some i, some o => some (i.kind ++ "\u0000" ++ i.lang ++ "\u0000" ++ o)
    | _, _ => none
  let mut relocFrom : HashMap String String := {}
  for x in news do
    match sig mh x with
    | some s =>
      let sameNew := news.filter (fun y => sig mh y == some s)
      let sameDel := deleted.filter (fun y => sig mb y == some s)
      match sameNew, sameDel with
      | [_], [y] => relocFrom := relocFrom.insert x y
      | _, _ => pure ()
    | none => pure ()
  let mut finest : HashSet String := {}
  for x in mh.order do
    if !mb.has x then
      if !relocFrom.contains x then finest := finest.insert x
    else
      match own mh x, own mb x with
      | some a, some b => if a != b then finest := finest.insert x
      | _, _ => pure ()
  return { ids := ids, pairs := pairs, deleted := deleted, finest := finest, relocFrom := relocFrom }

def Delta.inDelta (d : Delta) (x : String) : Bool := d.ids.contains x || d.deleted.contains x
def Delta.pairIn (d : Delta) (x p : String) : Bool := d.pairs.contains (pairKey x p) || d.deleted.contains x

/-! ### ρ (A.6.1.4 [D17]) -/

structure Rho where
  map : HashMap String String
  hints : HashMap String String
  /-- base items rules 0–2 leave unmapped -/
  unmapped : List String
  renames : List (String × String × String)
  errors : List KErr
deriving Inhabited

def Rho.get (r : Rho) (q : String) : String := (r.map.get? q).getD q
def Rho.getH (r : Rho) (q : String) : String :=
  match r.map.get? q with
  | some h => h
  | none => (r.hints.get? q).getD q
def Rho.inv (r : Rho) (h : String) : String :=
  match r.map.toList.find? (·.2 == h) with
  | some (b, _) => b
  | none => h

structure RItem where
  q : String
  kind : String
  was : Option String
  bind : String
deriving Inhabited

def wasHits (was q : String) : Bool := was == q || strSuffix ("::" ++ was) q || strSuffix ("." ++ was) q

def modOf (q : String) : String := (splitOn "::" q).headD ""

def computeRho (Sb Sh : Esf) (Wb Wh : World) : Rho := Id.run do
  let items (S : Esf) (W : World) : List RItem :=
    S.comps.map (fun c => ⟨c.q, "component", c.was, "\n".intercalate c.paths⟩) ++
    S.res.map (fun r => ⟨r.q, "resource", r.was, "\n".intercalate r.bind⟩) ++
    S.units.map (fun u => ⟨u.q, "unit", u.was, "\n".intercalate (W.binds u.q)⟩) ++
    S.actors.map (fun a => ⟨a.q, "actor", a.was, ""⟩)
  let hi := items Sh Wh
  let bi := items Sb Wb
  let mut m : HashMap String String := {}
  let mut taken : List String := []
  let mut renames : List (String × String × String) := []
  for b in bi do
    if hi.any (fun h => h.q == b.q && h.kind == b.kind) then
      m := m.insert b.q b.q
      taken := taken ++ [b.q]
  for b in bi do
    if m.contains b.q then continue
    let wh := hi.filter (fun h => h.kind == b.kind && (h.was.map (wasHits · b.q)).getD false)
    match wh with
    | [h] =>
      if !taken.contains h.q then
        m := m.insert b.q h.q
        taken := taken ++ [h.q]
        renames := renames ++ [(b.q, h.q, "was")]
        continue
    | _ => pure ()
    if b.bind == "" then continue
    match hi.filter (fun h => h.kind == b.kind && !taken.contains h.q && h.bind == b.bind) with
    | [h] =>
      m := m.insert b.q h.q
      taken := taken ++ [h.q]
      renames := renames ++ [(b.q, h.q, "binding")]
    | _ => pure ()
  -- units follow renamed components
  for u in Sb.units do
    if m.contains u.q then continue
    match m.get? u.comp with
    | some c' =>
      let hq := c' ++ "." ++ u.name
      if c' != u.comp && Sh.units.any (·.q == hq) then
        m := m.insert u.q hq
        renames := renames ++ [(u.q, hq, "component")]
    | none => pure ()
  -- rule 3: a unique remove-and-add per kind and module is a hint only
  let mut hints : HashMap String String := {}
  let mut unmapped : List String := []
  let mapped := m.toList.map (·.2)
  for kind in ["component", "resource", "unit"] do
    let removed := bi.filter (fun b => b.kind == kind && !m.contains b.q)
    let added := hi.filter (fun h => h.kind == kind && !mapped.contains h.q)
    unmapped := unmapped ++ removed.map (·.q)
    let mods := sortStrs (removed.map (modOf ·.q) ++ added.map (modOf ·.q))
    for md in mods do
      match removed.filter (modOf ·.q == md), added.filter (modOf ·.q == md) with
      | [r], [a] =>
        -- a hint maps nothing and is never listed in renames (A.6.1.4, A.16.38)
        hints := hints.insert r.q a.q
      | _, _ => pure ()
  for u in Sb.units do
    if m.contains u.q || hints.contains u.q then continue
    match hints.get? u.comp with
    | some c' => if Sh.units.any (·.q == c' ++ "." ++ u.name) then hints := hints.insert u.q (c' ++ "." ++ u.name)
    | none => pure ()
  -- E-was
  let mut errs : List KErr := []
  for h in hi do
    match h.was with
    | some w =>
      if hi.any (fun x => x.kind == h.kind && (x.q == w || strSuffix ("::" ++ w) x.q)) then
        errs := errs ++ [{ code := "E-was", subject := h.kind ++ " " ++ h.q }]
      if (hi.filter (fun x => x.kind == h.kind && x.was == some w)).length > 1 then
        errs := errs ++ [{ code := "E-was", subject := h.kind ++ " " ++ h.q }]
    | none => pure ()
  return { map := m, hints := hints, unmapped := sortStrs unmapped, renames := renames, errors := errs }

/-- Rename qualified names in a string by a map (token boundaries as the prototype's regex:
    preceded by start, whitespace or `<`; followed by end, whitespace, `>` or `.`). -/
def renameOne (from_ to : String) (s : String) : String :=
  let fc := from_.toList
  let rec go (fuel : Nat) (prev : Option Char) (cs : List Char) (out : List Char) : List Char :=
    match fuel with
    | 0 => out.reverse ++ cs
    | fuel + 1 =>
      match cs with
      | [] => out.reverse
      | c :: rest =>
        let startOk := match prev with | none => true | some p => p.isWhitespace || p == '<'
        let after := cs.drop fc.length
        let endOk := match after with | [] => true | d :: _ => d.isWhitespace || d == '>' || d == '.'
        if startOk && fc.isPrefixOf cs && endOk then go fuel fc.getLast? after (to.toList.reverse ++ out)
        else go fuel (some c) rest (c :: out)
  String.ofList (go (s.length + 1) none s.toList [])

def renameStr (keys : List (String × String)) (s : String) : String :=
  keys.foldl (fun acc (f, t) => renameOne f t acc) s

partial def renameJ (keys : List (String × String)) : J → J
  | .str s => .str (renameStr keys s)
  | .arr xs =>
    let ys := xs.map (renameJ keys)
    if ys.all (fun y => (J.str? y).isSome) then .arr ((sortStrs (ys.filterMap J.str?)).map .str)
    else .arr ys
  | .obj kvs => .obj (kvs.map fun (k, v) => (k, renameJ keys v))
  | o => o

def rhoKeys (m : HashMap String String) : List (String × String) :=
  sortWith (fun a b => a.1.length > b.1.length || (a.1.length == b.1.length && strLt a.1 b.1))
    (m.toList.filter (fun p => p.1 != p.2))

/-- A base claim renamed under ρ: its op and fp (A.5.6.3). -/
def renameClaim (keys : List (String × String)) (c : Claim) : Claim :=
  if keys.isEmpty then c else
  match J.parse c.argsJ with
  | .ok args =>
    let a := renameJ keys args
    { c with op := parseOp c.opName a, argsJ := a.jcs,
             fp := Hd (.obj [("v", .str "shape.claim.v1"), ("op", .str c.opName), ("args", a)]) }
  | .error _ => c

/-! ### Provider governance G* (A.6.2.6) -/

structure ProvG where
  q : String
  base : Option Prov
  head : Option Prov
  presenceA : Bool
  absenceA : Bool
  presenceB : Bool
  absenceB : Bool
  depsCompleteB : Bool
  channelsA : List String
  channelsB : List String
  decidesA : List String
  decidesB : List String
  establishes : Bool
  identity : Option String
  authenticated : Bool
  implPaths : List String
  implIds : List String
  implDigests : List String
  produces : List String
  trusts : List (String × String)
  persist : Bool
deriving Inhabited

def provGov (Sgov Sh : Esf) : List ProvG :=
  let qs := sortStrs (Sgov.provs.map (·.q) ++ Sh.provs.map (·.q))
  qs.map fun q =>
    let b := Sgov.provs.find? (·.q == q)
    let h := Sh.provs.find? (·.q == q)
    let both := b.isSome && h.isSome
    let bb (f : Prov → Bool) := (b.map f).getD false
    let hb (f : Prov → Bool) := (h.map f).getD false
    let bl (f : Prov → List String) := (b.map f).getD []
    let hl (f : Prov → List String) := (h.map f).getD []
    { q := q, base := b, head := h,
      presenceA := bb (·.presence) || hb (·.presence), absenceA := bb (·.absence) || hb (·.absence),
      presenceB := both && bb (·.presence) && hb (·.presence), absenceB := both && bb (·.absence) && hb (·.absence),
      depsCompleteB := both && bb (·.depsComplete) && hb (·.depsComplete),
      channelsA := sortStrs (bl (·.observes) ++ hl (·.observes)),
      channelsB := if both then interS (bl (·.observes)) (hl (·.observes)) else [],
      decidesA := sortStrs (bl (·.decides) ++ hl (·.decides)),
      decidesB := if both then interS (bl (·.decides)) (hl (·.decides)) else [],
      establishes := both, identity := b.bind (·.identity), authenticated := (b.bind (·.identity)).isSome,
      implPaths := sortStrs (bl (·.implPaths) ++ hl (·.implPaths)),
      implIds := sortStrs (bl (·.implIds) ++ hl (·.implIds)),
      implDigests := sortStrs ((b.bind (·.implDigest)).toList ++ (h.bind (·.implDigest)).toList),
      produces := match b with | some p => p.producesS | none => hl (·.producesS),
      trusts := (b.map (·.trusts)).getD [], persist := bb (·.persist) }

/-- Does the provider decide claim c (A.5.2.4)? -/
def decidesClaim (decides : List String) (c : Claim) : Bool :=
  match c.op with
  | .law _ (.schema n _ _) => decides.contains ("template " ++ n)
  | .law _ (.hosted r) => decides.contains ("statements " ++ idLang r)
  | _ => false

/-! ### policy* (A.6.2.6) -/

def tpStar (b h : TierPol) : TierPol :=
  { floor := levelMax b.floor h.floor, blocks := sortStrs (b.blocks ++ h.blocks),
    maxAge := min b.maxAge h.maxAge, judges := interS b.judges h.judges }

def policyStar (b h : Policy) : Policy :=
  { low := tpStar b.low h.low, normal := tpStar b.normal h.normal, critical := tpStar b.critical h.critical,
    budget := match b.budget, h.budget with
      | some x, some y => some (min x y)
      | some x, none => some x
      | none, y => y }

end Shape
